import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { seedRules } from "../convex/rules";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const SCHOOL_DAY = "2026-09-14";
const SERVICE_START_AT = Date.parse(`${SCHOOL_DAY}T09:30:00.000Z`);
const DEVICE_REF = "READER-01";
const TAG_UID = "tag-001";
const GUARDIAN_MSISDN = "+254700000123";
const GUARDIAN_NAME = "Wanjiku Njeri";
const TAPPED_RULE = "guardian.meal_tapped";
const MISSED_RULE = "guardian.meal_missed";

type Harness = ReturnType<typeof convexTest>;

const SECOND_TAG_UID = "tag-002";
const ALL_DAY_QUIET = { start: 0, end: 24 };

async function seedWorld(t: Harness): Promise<{ schoolId: Id<"schools">; studentId: Id<"students">; guardianId: Id<"guardians"> }> {
  const ids = await t.run(async (ctx) => {
    await seedRules(ctx);
    await ctx.db.insert("academicCalendar", { serviceDate: SCHOOL_DAY, isSchoolDay: true, dayType: "full" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const studentId = await ctx.db.insert("students", {
      schoolId,
      studentRef: "STU-1",
      fullName: "Amina Njeri",
      className: "4A",
      status: "active",
    });
    const guardianId = await ctx.db.insert("guardians", {
      msisdn: GUARDIAN_MSISDN,
      displayName: GUARDIAN_NAME,
      language: "en",
      optedOutTypes: [],
    });
    await ctx.db.insert("guardianLinks", { guardianId, studentId, relationship: "mother", active: true });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId, status: "active", issuedAt: Date.now() });
    return { schoolId, studentId, guardianId };
  });
  await t.mutation(internal.devices.registerDevice, {
    deviceRef: DEVICE_REF,
    schoolId: ids.schoolId,
    secret: "demo-device-secret",
    firmwareVersion: "1.0.0",
  });
  return ids;
}

async function setSetting(t: Harness, key: string, value: number): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key, value, description: "test" });
  });
}

async function tap(t: Harness, eventId: string, tagUid = TAG_UID): Promise<void> {
  await t.mutation(internal.ingest.recordBatch, {
    deviceRef: DEVICE_REF,
    events: [{ eventId, tagUid, occurredAt: SERVICE_START_AT }],
  });
}

async function notifications(t: Harness) {
  return await t.run(async (ctx) => await ctx.db.query("notifications").collect());
}

async function runScheduled(t: Harness): Promise<void> {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

describe("rules engine", () => {
  test("a delivery report flips the notification and emits a notification.delivered event (FR-507)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: [{ eventId: "tap-1", tagUid: TAG_UID, occurredAt: SERVICE_START_AT }],
    });
    await runScheduled(t);
    const providerMessageId = (await notifications(t))[0].providerMessageId!;

    const matched = await t.mutation(internal.notifications.recordDeliveryReport, {
      providerMessageId,
      delivered: true,
      reason: "Delivered",
    });
    const unknown = await t.mutation(internal.notifications.recordDeliveryReport, {
      providerMessageId: "nope",
      delivered: false,
      reason: "x",
    });

    expect(matched).not.toBeNull();
    expect(unknown).toBeNull();
    expect((await notifications(t))[0].status).toBe("delivered");
    const events = await t.run(async (ctx) => await ctx.db.query("events").collect());
    expect(events.filter((event) => event.type === "notification.delivered")).toHaveLength(1);
  });

  test("a tap becomes one delivered guardian SMS (P-01)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);

    await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: [{ eventId: "tap-1", tagUid: TAG_UID, occurredAt: SERVICE_START_AT }],
    });
    await runScheduled(t);

    const rows = await notifications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].ruleKey).toBe(TAPPED_RULE);
    expect(rows[0].msisdn).toBe(GUARDIAN_MSISDN);
    expect(rows[0].body).toContain("Amina Njeri");
    expect(rows[0].body).toContain(`Dear ${GUARDIAN_NAME}`);
    expect(rows[0].body).toContain(SCHOOL_DAY);
    expect(rows[0].status).toBe("sent");
  });

  test("re-evaluating the same event queues nothing new", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: [{ eventId: "tap-1", tagUid: TAG_UID, occurredAt: SERVICE_START_AT }],
    });
    await runScheduled(t);
    const eventId = await t.run(async (ctx) => (await ctx.db.query("events").first())!._id);

    const again = await t.mutation(internal.rules.evaluate, { eventId });

    expect(again).toEqual({ matched: 1, queued: 0 });
    expect(await notifications(t)).toHaveLength(1);
  });

  test("a missed meal becomes a guardian SMS, a disabled rule sends nothing (P-02)", async () => {
    const t = convexTest(schema, modules);
    const { schoolId } = await seedWorld(t);
    await t.run(async (ctx) => {
      const tapped = await ctx.db
        .query("rules")
        .withIndex("by_key", (q) => q.eq("key", TAPPED_RULE))
        .unique();
      await ctx.db.patch(tapped!._id, { enabled: false });
    });

    await t.mutation(internal.expectations.startSchoolDay, { schoolId, serviceDate: SCHOOL_DAY, serviceStartAt: SERVICE_START_AT });
    await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: [{ eventId: "tap-1", tagUid: TAG_UID, occurredAt: SERVICE_START_AT }],
    });
    await t.run(async (ctx) => {
      const expectation = await ctx.db.query("expectations").first();
      await ctx.db.patch(expectation!._id, { status: "pending" });
    });
    await t.mutation(internal.expectations.sweepMissed, { schoolId, serviceDate: SCHOOL_DAY });
    await runScheduled(t);

    const rows = await notifications(t);
    expect(rows.map((row) => row.ruleKey)).toEqual([MISSED_RULE]);
  });

  test("an opted-out type is suppressed with a reason and an audit event (FR-502, P-08)", async () => {
    const t = convexTest(schema, modules);
    const { guardianId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(guardianId, { optedOutTypes: ["meal.tapped"] });
    });

    await tap(t, "tap-1");
    await runScheduled(t);

    const rows = await notifications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("suppressed");
    expect(rows[0].suppressionReason).toBe("opted_out");
    const events = await t.run(async (ctx) => await ctx.db.query("events").collect());
    const suppressed = events.filter((event) => event.type === "notification.suppressed");
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].payload.suppression_reason).toBe("opted_out");
  });

  test("the daily cap drops the message past the cap (P-06)", async () => {
    const t = convexTest(schema, modules);
    const { schoolId, guardianId } = await seedWorld(t);
    await setSetting(t, "dailyMessageCap", 1);
    await t.run(async (ctx) => {
      const secondStudentId = await ctx.db.insert("students", {
        schoolId,
        studentRef: "STU-2",
        fullName: "Baraka Njeri",
        className: "2B",
        status: "active",
      });
      await ctx.db.insert("guardianLinks", { guardianId, studentId: secondStudentId, relationship: "mother", active: true });
      await ctx.db.insert("tags", { tagUid: SECOND_TAG_UID, studentId: secondStudentId, status: "active", issuedAt: Date.now() });
    });

    await tap(t, "tap-1");
    await tap(t, "tap-2", SECOND_TAG_UID);
    await runScheduled(t);

    const statuses = (await notifications(t)).map((row) => [row.status, row.suppressionReason]);
    expect(statuses).toEqual([
      ["sent", undefined],
      ["suppressed", "daily_cap"],
    ]);
  });

  test("quiet hours hold the message until they end", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    await setSetting(t, "quietHoursStartHour", ALL_DAY_QUIET.start);
    await setSetting(t, "quietHoursEndHour", ALL_DAY_QUIET.end);

    await tap(t, "tap-1");
    await t.mutation(internal.rules.evaluate, {
      eventId: await t.run(async (ctx) => (await ctx.db.query("events").first())!._id),
    });

    const rows = await notifications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].deliverAt).toBeGreaterThan(Date.now());
  });

  test("a Kiswahili guardian gets the Kiswahili template (P-10, NFR-705)", async () => {
    const t = convexTest(schema, modules);
    const { guardianId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(guardianId, { language: "sw" });
    });

    await tap(t, "tap-1");
    await runScheduled(t);

    const rows = await notifications(t);
    expect(rows[0].body).toContain("Mpendwa");
    expect(rows[0].templateVersion).toBe(2);
    expect(rows[0].segments).toBe(1);
  });
});
