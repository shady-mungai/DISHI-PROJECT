import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { metricsReport } from "../convex/admin";
import { p95, spanDurations } from "../convex/lib/metrics";
import { isTransientFailure, retryDelayMs } from "../convex/lib/retry";
import { purgeExpiredOnce } from "../convex/retention";
import { deactivateStudent } from "../convex/roster";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-21";
const NOW = Date.parse(`${TODAY}T10:00:00.000Z`);
const MILLISECONDS_PER_DAY = 86_400_000;
const DEVICE_REF = "READER-01";
const TAG_UID = "tag-001";
const MAX_ATTEMPTS = 3;

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; studentId: Id<"students">; guardianId: Id<"guardians"> };

afterEach(() => {
  vi.useRealTimers();
});

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const world = await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "deliveryMaxAttempts", value: MAX_ATTEMPTS, description: "test" });
    await ctx.db.insert("settings", { key: "retentionEventDays", value: 30, description: "test" });
    await ctx.db.insert("settings", { key: "retentionNotificationDays", value: 7, description: "test" });
    await ctx.db.insert("settings", { key: "retentionStudentDays", value: 1, description: "test" });
    await ctx.db.insert("academicCalendar", { serviceDate: TODAY, isSchoolDay: true, dayType: "full" });
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const studentId = await ctx.db.insert("students", { schoolId, studentRef: "STU-1", fullName: "Amina Njeri", className: "4A", status: "active" });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId, status: "active", issuedAt: NOW });
    const guardianId = await ctx.db.insert("guardians", { msisdn: "254700000123", displayName: "Mama Amina", language: "en", optedOutTypes: [] });
    await ctx.db.insert("guardianLinks", { guardianId, studentId, relationship: "mother", active: true });
    return { schoolId, studentId, guardianId };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: world.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  return world;
}

async function insertNotification(t: Harness, world: World, dedupeKey: string) {
  return await t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", { eventId: `evt-${dedupeKey}`, type: "meal.tapped", occurredAt: NOW, recordedAt: NOW, schemaVersion: 1, correlationId: dedupeKey, payload: {} });
    return await ctx.db.insert("notifications", { dedupeKey, ruleKey: "r", eventId, correlationId: dedupeKey, guardianId: world.guardianId, msisdn: "254700000123", channel: "sms", body: "b", segments: 1, status: "queued" });
  });
}

describe("hardening: retries, revocation, retention, audit, metrics (D15)", () => {
  test("pure helpers: transient classification, doubling backoff, p95, sweep spans", () => {
    expect(isTransientFailure("gateway_unreachable")).toBe(true);
    expect(isTransientFailure("http_503")).toBe(true);
    expect(isTransientFailure("http_400")).toBe(false);
    expect(isTransientFailure("AbsentSubscriber")).toBe(false);
    expect([1, 2, 3].map((attempt) => retryDelayMs(attempt, 30))).toEqual([30_000, 60_000, 120_000]);
    expect(p95([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])).toBe(1000);
    expect(p95([5, 1, 3])).toBe(5);
    expect(p95([])).toBe(0);
    expect([...spanDurations([{ key: "a", at: 10 }, { key: "a", at: 25 }, { key: "b", at: 7 }]).entries()]).toEqual([["a", 15], ["b", 0]]);
  });

  test("a transient gateway failure is retried with backoff up to the limit, then recorded as failed (NFR-205)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const notificationId = await insertNotification(t, world, "n1");
    const fail = async () => await t.mutation(internal.notifications.markResult, { notificationId, status: "failed", failureReason: "gateway_unreachable" });
    expect(await fail()).toBe("retry_scheduled");
    expect(await fail()).toBe("retry_scheduled");
    expect((await t.run(async (ctx) => await ctx.db.get(notificationId)))?.status).toBe("queued");
    expect(await fail()).toBe("failed");
    const row = await t.run(async (ctx) => await ctx.db.get(notificationId));
    expect(row).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, failureReason: "gateway_unreachable" });
    const rejected = await insertNotification(t, world, "n2");
    expect(await t.mutation(internal.notifications.markResult, { notificationId: rejected, status: "failed", failureReason: "AbsentSubscriber" })).toBe("failed");
  });

  test("a revoked device is unknown to ingest on its next contact (NFR-406)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect(await t.query(internal.ingest.getDeviceSecretHash, { deviceRef: DEVICE_REF })).not.toBeNull();
    await t.run(async (ctx) => {
      const device = (await ctx.db.query("devices").withIndex("by_deviceRef", (q) => q.eq("deviceRef", DEVICE_REF)).unique())!;
      await ctx.db.patch(device._id, { revokedAt: NOW });
    });
    expect(await t.query(internal.ingest.getDeviceSecretHash, { deviceRef: DEVICE_REF })).toBeNull();
  });

  test("retention purges expired operational rows, keeps audit events, and de-identifies a long-deactivated child (NFR-505, FR-802)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await t.run(async (ctx) => await deactivateStudent(ctx, { schoolId: world.schoolId, studentId: world.studentId, reason: "transferred" }));
    const oldNotification = await insertNotification(t, world, "old");
    await t.run(async (ctx) => {
      await ctx.db.insert("events", { eventId: "audit-old", type: "admin.rule_changed", occurredAt: NOW, recordedAt: NOW, schemaVersion: 1, correlationId: "audit-old", payload: {} });
    });
    vi.setSystemTime(NOW + 40 * MILLISECONDS_PER_DAY);
    const freshNotification = await insertNotification(t, world, "fresh");
    const result = await t.run(async (ctx) => await purgeExpiredOnce(ctx));
    expect(result.notifications).toBe(1);
    expect(result.studentsDeidentified).toBe(1);
    expect(result.events).toBeGreaterThan(0);
    expect(await t.run(async (ctx) => await ctx.db.get(oldNotification))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(freshNotification))).not.toBeNull();
    const remainingTypes = await t.run(async (ctx) => (await ctx.db.query("events").collect()).map((row) => row.type));
    expect(remainingTypes).toContain("admin.rule_changed");
    expect(remainingTypes.filter((type) => type === "student.deactivated")).toHaveLength(0);
    const student = await t.run(async (ctx) => await ctx.db.get(world.studentId));
    expect(student?.fullName).toBe("Student STU-1");
    expect(await t.run(async (ctx) => await ctx.db.query("guardianLinks").collect())).toHaveLength(0);
    expect(await t.run(async (ctx) => await purgeExpiredOnce(ctx))).toMatchObject({ notifications: 0, studentsDeidentified: 0 });
  });

  test("metrics report p95 lags (FR-802, NFR-803)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: TODAY, serviceStartAt: NOW });
    await t.mutation(internal.ingest.recordBatch, { deviceRef: DEVICE_REF, events: [{ eventId: "tap-1", tagUid: TAG_UID, occurredAt: NOW - 1500 }] });
    const metrics = await t.run(async (ctx) => await metricsReport(ctx, { from: TODAY, to: TODAY }));
    expect(metrics.taps).toBe(1);
    expect(metrics.ingestionLagP95Ms).toBe(1500);
    expect(metrics.evaluations).toBeGreaterThanOrEqual(2);
  });
});
