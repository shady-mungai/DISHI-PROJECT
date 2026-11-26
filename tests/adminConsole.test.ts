import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { deliverabilityReport, dryRunPage, traceChain } from "../convex/admin";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-21";
const NOW = Date.parse(`${TODAY}T10:00:00.000Z`);
const DEVICE_REF = "READER-01";
const TAG_UID = "tag-001";
const TEMPLATES = { en: "{{child}} ate at {{school}}.", sw: "{{child}} amekula {{school}}." };
const ALWAYS = JSON.stringify({ op: "always" });
const NEVER = JSON.stringify({ op: "eq", field: "student_id", value: "nobody" });

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; guardianId: Id<"guardians"> };

afterEach(() => {
  vi.useRealTimers();
});

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const world = await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "collapseWindowMinutes", value: 0, description: "test" });
    await ctx.db.insert("settings", { key: "smsCostPerSegmentKes", value: 0.8, description: "test" });
    await ctx.db.insert("academicCalendar", { serviceDate: TODAY, isSchoolDay: true, dayType: "full" });
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const studentId = await ctx.db.insert("students", { schoolId, studentRef: "STU-1", fullName: "Amina Njeri", className: "4A", status: "active" });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId, status: "active", issuedAt: NOW });
    const guardianId = await ctx.db.insert("guardians", { msisdn: "254700000123", displayName: "Mama Amina", language: "en", optedOutTypes: [] });
    await ctx.db.insert("guardianLinks", { guardianId, studentId, relationship: "mother", active: true });
    return { schoolId, guardianId };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: world.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: TODAY, serviceStartAt: NOW });
  await t.mutation(internal.ingest.recordBatch, { deviceRef: DEVICE_REF, events: [{ eventId: "tap-1", tagUid: TAG_UID, occurredAt: NOW }] });
  return world;
}

async function countNotifications(t: Harness): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length);
}

describe("admin console: dry run, deliverability, trace (D14)", () => {
  test("a dry run renders what the rule would send and writes nothing (FR-404, AD-05)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    const before = await countNotifications(t);
    const report = await t.run(async (ctx) => await dryRunPage(ctx, { eventType: "meal.tapped", predicate: ALWAYS, templates: TEMPLATES, from: TODAY, to: TODAY, cursor: null }));
    expect(report).toMatchObject({ scanned: 1, matched: 1, recipients: 1, segments: 1, isDone: true });
    expect(report.samples[0]).toEqual({ eventId: "tap-1", maskedMsisdn: "*********123", body: "Dear Mama Amina, Amina Njeri ate at Pilot Primary." });
    const unmatched = await t.run(async (ctx) => await dryRunPage(ctx, { eventType: "meal.tapped", predicate: NEVER, templates: TEMPLATES, from: TODAY, to: TODAY, cursor: null }));
    expect(unmatched).toMatchObject({ scanned: 1, matched: 0, recipients: 0 });
    expect(await countNotifications(t)).toBe(before);
    await expect(
      t.run(async (ctx) => await dryRunPage(ctx, { eventType: "meal.tapped", predicate: "not json", templates: TEMPLATES, from: TODAY, to: TODAY, cursor: null })),
    ).rejects.toThrow();
  });

  test("deliverability groups by day, failure reason, guardian and rule spend (AD-02, AD-03, AD-06)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await t.run(async (ctx) => {
      const event = (await ctx.db.query("events").first())!;
      const base = { ruleKey: "guardian.meal_tapped", eventId: event._id, correlationId: event.correlationId, schoolId: world.schoolId, guardianId: world.guardianId, msisdn: "254700000123", channel: "sms" as const, body: "b", segments: 1 };
      await ctx.db.insert("notifications", { ...base, dedupeKey: "n1", status: "delivered" });
      await ctx.db.insert("notifications", { ...base, dedupeKey: "n2", status: "failed", failureReason: "absent_subscriber" });
      await ctx.db.insert("notifications", { ...base, dedupeKey: "n3", status: "failed", failureReason: "absent_subscriber" });
      await ctx.db.insert("notifications", { ...base, dedupeKey: "n4", ruleKey: "guardian.meal_missed", status: "suppressed", suppressionReason: "quiet_hours" });
    });
    const report = await t.run(async (ctx) => await deliverabilityReport(ctx, { from: TODAY, to: TODAY }));
    expect(report.byDay).toEqual([{ day: TODAY, queued: 0, sent: 0, delivered: 1, failed: 2, suppressed: 1, deliveredPct: 33 }]);
    expect(report.byFailureReason).toEqual([{ reason: "absent_subscriber", count: 2 }]);
    expect(report.undeliverable).toHaveLength(1);
    expect(report.undeliverable[0]).toMatchObject({ maskedMsisdn: "*********123", schoolCode: "SCH-1", failures: 2, lastReason: "absent_subscriber" });
    expect(report.spendByRule).toEqual([
      { ruleKey: "guardian.meal_tapped", sent: 1, suppressed: 0, segments: 1, costKes: 0.8 },
      { ruleKey: "guardian.meal_missed", sent: 0, suppressed: 1, segments: 0, costKes: 0 },
    ]);
  });

  test("a notification id, provider id or event id resolves to the originating event (AD-07, NFR-802)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const notificationId = await t.run(async (ctx) => {
      const event = (await ctx.db.query("events").withIndex("by_eventId", (q) => q.eq("eventId", "tap-1")).unique())!;
      return await ctx.db.insert("notifications", {
        dedupeKey: "n1",
        ruleKey: "guardian.meal_tapped",
        eventId: event._id,
        correlationId: event.correlationId,
        schoolId: world.schoolId,
        guardianId: world.guardianId,
        msisdn: "254700000123",
        channel: "sms",
        body: "b",
        segments: 1,
        status: "delivered",
        providerMessageId: "prov-42",
      });
    });
    const byNotification = await t.run(async (ctx) => await traceChain(ctx, notificationId));
    expect(byNotification.events.map((row) => row.eventId)).toContain("tap-1");
    expect(byNotification.notifications[0]).toMatchObject({ maskedMsisdn: "*********123", providerMessageId: "prov-42" });
    const byProvider = await t.run(async (ctx) => await traceChain(ctx, "prov-42"));
    expect(byProvider.correlationId).toBe(byNotification.correlationId);
    const byEvent = await t.run(async (ctx) => await traceChain(ctx, "tap-1"));
    expect(byEvent.correlationId).toBe(byNotification.correlationId);
  });
});
