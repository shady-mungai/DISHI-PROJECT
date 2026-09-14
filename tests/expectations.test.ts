import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { addDays, toServiceDate } from "../convex/lib/dates";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

// Always next week: startSchoolDay schedules the sweep at cutoffAt, and
// convex-test fires any past-due schedule immediately, which would mark
// every expectation missed before the tap under test arrives.
const DAYS_AHEAD = 7;
const SCHOOL_DAY = addDays(toServiceDate(Date.now()), DAYS_AHEAD);
const HOLIDAY = addDays(SCHOOL_DAY, -1);
const SERVICE_START_AT = Date.parse(`${SCHOOL_DAY}T09:30:00.000Z`);
const ACTIVE_STUDENTS = 5;
const DEVICE_REF = "READER-01";
const DEVICE_SECRET = "demo-device-secret";
const TAG_UID = "tag-001";

type Harness = ReturnType<typeof convexTest>;

async function seedSchool(t: Harness): Promise<{ schoolId: Id<"schools">; studentIds: Id<"students">[] }> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("academicCalendar", { serviceDate: SCHOOL_DAY, isSchoolDay: true, dayType: "full" });
    await ctx.db.insert("academicCalendar", { serviceDate: HOLIDAY, isSchoolDay: false, dayType: "holiday" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Test School", active: true });
    const studentIds: Id<"students">[] = [];
    for (let index = 0; index < ACTIVE_STUDENTS; index += 1) {
      studentIds.push(
        await ctx.db.insert("students", {
          schoolId,
          studentRef: `STU-${index}`,
          fullName: `Student ${index}`,
          className: "4A",
          status: "active",
        }),
      );
    }
    await ctx.db.insert("students", {
      schoolId,
      studentRef: "STU-LEFT",
      fullName: "Left School",
      className: "4A",
      status: "deactivated",
    });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId: studentIds[0], status: "active", issuedAt: Date.now() });
    return { schoolId, studentIds };
  });
}

async function startDay(t: Harness, schoolId: Id<"schools">, pageSize?: number) {
  return await t.mutation(internal.expectations.startSchoolDay, {
    schoolId,
    serviceDate: SCHOOL_DAY,
    serviceStartAt: SERVICE_START_AT,
    pageSize,
  });
}

async function countByStatus(t: Harness, status: "pending" | "fulfilled" | "missed"): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("expectations").collect();
    return rows.filter((row) => row.status === status).length;
  });
}

async function eventsOfType(t: Harness, type: string) {
  return await t.run(async (ctx) => {
    const events = await ctx.db.query("events").collect();
    return events.filter((event) => event.type === type);
  });
}

describe("expectations", () => {
  test("materialises one pending row per active student and is idempotent (FR-207, FR-405)", async () => {
    const t = convexTest(schema, modules);
    const { schoolId } = await seedSchool(t);

    const first = await startDay(t, schoolId);
    expect(first).toEqual({ status: "materialised", created: ACTIVE_STUDENTS, existing: 0, chained: false });
    expect(await countByStatus(t, "pending")).toBe(ACTIVE_STUDENTS);
    expect(await eventsOfType(t, "meal.expectation_created")).toHaveLength(ACTIVE_STUDENTS);

    const second = await startDay(t, schoolId);
    expect(second).toEqual({ status: "materialised", created: 0, existing: ACTIVE_STUDENTS, chained: false });
    expect(await eventsOfType(t, "meal.expectation_created")).toHaveLength(ACTIVE_STUDENTS);
  });

  test("creates nothing on a non-school day (FR-207)", async () => {
    const t = convexTest(schema, modules);
    const { schoolId } = await seedSchool(t);

    const result = await t.mutation(internal.expectations.startSchoolDay, {
      schoolId,
      serviceDate: HOLIDAY,
      serviceStartAt: SERVICE_START_AT,
    });

    expect(result.status).toBe("not_school_day");
    expect(await countByStatus(t, "pending")).toBe(0);
  });

  test("pages the roster and chains through the scheduler", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { schoolId } = await seedSchool(t);

      const first = await startDay(t, schoolId, 2);
      expect(first.chained).toBe(true);
      expect(first.created).toBe(2);

      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const total = await t.run(async (ctx) => (await ctx.db.query("expectations").collect()).length);
      expect(total).toBe(ACTIVE_STUDENTS);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an accepted tap fulfils the pending expectation", async () => {
    const t = convexTest(schema, modules);
    const { schoolId } = await seedSchool(t);
    await startDay(t, schoolId);
    await t.mutation(internal.devices.registerDevice, {
      deviceRef: DEVICE_REF,
      schoolId,
      secret: DEVICE_SECRET,
      firmwareVersion: "1.0.0",
    });

    const results = await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: [{ eventId: "e1", tagUid: TAG_UID, occurredAt: SERVICE_START_AT }],
    });

    expect(results[0].status).toBe("accepted");
    expect(await countByStatus(t, "fulfilled")).toBe(1);
    expect(await countByStatus(t, "pending")).toBe(ACTIVE_STUDENTS - 1);
  });

  test("sweep marks only pending rows missed, emits meal.missed once (FR-208)", async () => {
    const t = convexTest(schema, modules);
    const { schoolId, studentIds } = await seedSchool(t);
    await startDay(t, schoolId);
    await t.run(async (ctx) => {
      const fulfilled = await ctx.db
        .query("expectations")
        .withIndex("by_student_serviceDate", (q) => q.eq("studentId", studentIds[0]).eq("serviceDate", SCHOOL_DAY))
        .unique();
      await ctx.db.patch(fulfilled!._id, { status: "fulfilled" });
    });

    const sweep = await t.mutation(internal.expectations.sweepMissed, { schoolId, serviceDate: SCHOOL_DAY });
    expect(sweep).toEqual({ missed: ACTIVE_STUDENTS - 1, chained: false });
    expect(await countByStatus(t, "fulfilled")).toBe(1);
    expect(await countByStatus(t, "pending")).toBe(0);

    const missedEvents = await eventsOfType(t, "meal.missed");
    expect(missedEvents).toHaveLength(ACTIVE_STUDENTS - 1);
    expect(missedEvents[0].payload.expectation_id).toBeTypeOf("string");
    expect(missedEvents[0].payload.service_date).toBe(SCHOOL_DAY);

    const again = await t.mutation(internal.expectations.sweepMissed, { schoolId, serviceDate: SCHOOL_DAY });
    expect(again.missed).toBe(0);
    expect(await eventsOfType(t, "meal.missed")).toHaveLength(ACTIVE_STUDENTS - 1);
  });
});
