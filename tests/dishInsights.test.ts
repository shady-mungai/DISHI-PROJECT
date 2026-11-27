import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { RegisterFailure, submitRegister } from "../convex/attendance";
import { reconcileDay } from "../convex/deliveries";
import { dispatchDelivery } from "../convex/deliveryWorkflow";
import { classifyMiss } from "../convex/lib/attendance";
import { attendanceByWeekday, dishInsights, type InsightDay } from "../convex/lib/dishInsights";
import { supplierInsights } from "../convex/supplier";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const FRIDAY = "2026-09-25";
const WINDOW_START = Date.parse(`${FRIDAY}T09:30:00.000Z`);
const WINDOW_MINUTES = 90;
const CUTOFF_OFFSET_MINUTES = 30;
const MILLISECONDS_PER_MINUTE = 60_000;
const AFTER_CUTOFF = WINDOW_START + (WINDOW_MINUTES + CUTOFF_OFFSET_MINUTES + 1) * MILLISECONDS_PER_MINUTE;
const ROSTER = 4;
const DEVICE_REF = "READER-01";

afterEach(() => {
  vi.useRealTimers();
});

function day(overrides: Partial<InsightDay>): InsightDay {
  return {
    schoolId: "school-a",
    serviceDate: FRIDAY,
    dish: null,
    received: 100,
    consumed: 80,
    attendance: { registerTaken: true, absent: 0, missedPresent: 20, missedSupply: 0, missedUnknown: 0 },
    ...overrides,
  };
}

function presentMissing(missedPresent: number): InsightDay["attendance"] {
  return { registerTaken: true, absent: 0, missedPresent, missedSupply: 0, missedUnknown: 0 };
}

describe("classifyMiss", () => {
  test("food running out wins over the register", () => {
    expect(classifyMiss({ registerTaken: true, portionsAvailable: 10, mealsServed: 10 })).toBe("supply");
  });
  test("present pupil with food left did not eat", () => {
    expect(classifyMiss({ registerTaken: true, portionsAvailable: 20, mealsServed: 10 })).toBe("present");
  });
  test("no register means the reason is unknown", () => {
    expect(classifyMiss({ registerTaken: false, portionsAvailable: 20, mealsServed: 10 })).toBe("unknown");
  });
});

describe("dishInsights", () => {
  test("a dish is judged against the same weekday, not the week", () => {
    const days = [
      day({ serviceDate: "2026-09-25", dish: "githeri", consumed: 60, attendance: presentMissing(40) }),
      day({ serviceDate: "2026-10-02", dish: "rice and beans", consumed: 80, attendance: presentMissing(20) }),
      day({ serviceDate: "2026-09-28", dish: "githeri", consumed: 90, attendance: presentMissing(10) }),
    ];
    const githeri = dishInsights(days, 1).find((row) => row.dish === "githeri");
    expect(githeri?.uptakePct).toBe(75);
    expect(githeri?.uptakeVsWeekday).toBe(-5);
    expect(githeri?.leftoverPct).toBe(25);
  });

  test("days without a dish feed the baseline but rank nothing", () => {
    const rows = dishInsights([day({ dish: null }), day({ dish: "ugali", serviceDate: "2026-10-02" })], 2);
    expect(rows.map((row) => row.dish)).toEqual(["ugali"]);
    expect(rows[0].enoughData).toBe(false);
  });

  test("no portions received leaves leftover unknown, no register leaves uptake unknown", () => {
    const [row] = dishInsights([day({ dish: "pilau", received: 0, attendance: null })], 1);
    expect(row.leftoverPct).toBeNull();
    expect(row.uptakePct).toBeNull();
  });
});

describe("attendanceByWeekday", () => {
  test("attendance is present over present plus absent on register days", () => {
    const [friday] = attendanceByWeekday([day({ consumed: 70, attendance: { registerTaken: true, absent: 20, missedPresent: 5, missedSupply: 5, missedUnknown: 0 } })]);
    expect(friday.weekday).toBe("Friday");
    expect(friday.attendancePct).toBe(80);
    expect(friday.missedSupply).toBe(5);
  });
});

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; studentIds: Id<"students">[]; staff: Doc<"users">; supplier: Doc<"users"> };

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: WINDOW_START - MILLISECONDS_PER_MINUTE, toFake: ["Date"] });
  const world = await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "serviceWindowMinutes", value: WINDOW_MINUTES, description: "test" });
    await ctx.db.insert("settings", { key: "cutoffOffsetMinutes", value: CUTOFF_OFFSET_MINUTES, description: "test" });
    await ctx.db.insert("academicCalendar", { serviceDate: FRIDAY, isSchoolDay: true, dayType: "full" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    await ctx.db.insert("menuItems", { dish: "githeri", active: true });
    const studentIds: Id<"students">[] = [];
    for (let index = 0; index < ROSTER; index += 1) {
      const studentId = await ctx.db.insert("students", { schoolId, studentRef: `STU-${index}`, fullName: `Child ${index}`, className: "4A", status: "active" });
      await ctx.db.insert("tags", { tagUid: `tag-${index}`, studentId, status: "active", issuedAt: WINDOW_START });
      studentIds.push(studentId);
    }
    const staffId = await ctx.db.insert("users", { authUserId: "auth-staff", displayName: "Head", role: "school", schoolId });
    const supplierId = await ctx.db.insert("users", { authUserId: "auth-supplier", displayName: "Kitchen", role: "supplier" });
    return { schoolId, studentIds, staff: (await ctx.db.get(staffId))!, supplier: (await ctx.db.get(supplierId))! };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: world.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  return world;
}

async function receiveDelivery(t: Harness, world: World, portions: number) {
  await t.run(async (ctx) => {
    const { deliveryId } = await dispatchDelivery(ctx, world.supplier, { schoolId: world.schoolId, portions, vehicle: "KDA 001", docketRef: "D-1", requestId: "r-1", dish: "  Githeri  " });
    await ctx.db.patch(deliveryId, { status: "confirmed", portionsReceived: portions, receiptRecordedAt: WINDOW_START });
  });
}

async function tap(t: Harness, indexes: number[]) {
  await t.mutation(internal.ingest.recordBatch, {
    deviceRef: DEVICE_REF,
    events: indexes.map((index) => ({ eventId: `tap-${index}`, tagUid: `tag-${index}`, occurredAt: Date.now() })),
  });
}

describe("register, sweep and insights", () => {
  test("absent pupils are swept as absent, untapped present pupils as missed with a reason", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const [tapped, absentButTapped, absent, present] = world.studentIds;
    await receiveDelivery(t, world, ROSTER);
    await t.run(async (ctx) => await submitRegister(ctx, { actor: world.staff, schoolId: world.schoolId, absentStudentIds: [absentButTapped, absent] }));
    await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: FRIDAY, serviceStartAt: WINDOW_START });
    vi.setSystemTime(WINDOW_START);
    await tap(t, [0, 1]);
    vi.setSystemTime(AFTER_CUTOFF);
    await t.mutation(internal.expectations.sweepMissed, { schoolId: world.schoolId, serviceDate: FRIDAY });

    const rows = await t.run(async (ctx) => await ctx.db.query("expectations").collect());
    const byStudent = new Map(rows.map((row) => [row.studentId, row]));
    expect(byStudent.get(tapped)?.status).toBe("fulfilled");
    expect(byStudent.get(absentButTapped)?.status).toBe("fulfilled");
    expect(byStudent.get(absent)?.status).toBe("absent");
    expect(byStudent.get(present)).toMatchObject({ status: "missed", missReason: "present" });
    const types = (await t.run(async (ctx) => await ctx.db.query("events").collect())).map((event) => event.type);
    expect(types).toContain("meal.absent");

    await t.run(async (ctx) => await reconcileDay(ctx, { schoolId: world.schoolId, serviceDate: FRIDAY }));
    const reconciliation = await t.run(async (ctx) => await ctx.db.query("reconciliations").first());
    expect(reconciliation?.attendance).toEqual({ registerTaken: true, absent: 1, missedPresent: 1, missedSupply: 0, missedUnknown: 0 });

    const insights = await t.run(async (ctx) => await supplierInsights(ctx, { from: FRIDAY, to: FRIDAY }));
    expect(insights.dishes).toEqual([expect.objectContaining({ dish: "githeri", days: 1, uptakePct: 66.7, leftoverPct: 50 })]);
    expect(insights.weekdays).toEqual([expect.objectContaining({ weekday: "Friday", attendancePct: 75 })]);
  });

  test("the register closes at the meal cutoff", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: FRIDAY, serviceStartAt: WINDOW_START });
    vi.setSystemTime(AFTER_CUTOFF);
    await expect(
      t.run(async (ctx) => await submitRegister(ctx, { actor: world.staff, schoolId: world.schoolId, absentStudentIds: [] })),
    ).rejects.toThrow(RegisterFailure.Closed);
  });
});
