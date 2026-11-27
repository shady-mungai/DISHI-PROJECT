import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { countyOverview, flagIntegrity } from "../convex/county";
import { reconcileDay } from "../convex/deliveries";
import { rankByVariance, toCountyCsv, varianceStreak } from "../convex/lib/county";
import { addDays } from "../convex/lib/dates";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-21";
const NOW = Date.parse(`${TODAY}T15:00:00.000Z`);
const TOLERANCE_PCT = 10;
const STREAK_DAYS = 3;
const PERIOD_DAYS = 7;
const FROM = addDays(TODAY, -(PERIOD_DAYS - 1));

type Harness = ReturnType<typeof convexTest>;
type World = { steady: Id<"schools">; leaky: Id<"schools">; guardianId: Id<"guardians"> };
type DayFigures = { serviceDate: string; confirmed: number; consumed: number };

afterEach(() => {
  vi.useRealTimers();
});

const LEAKY_HISTORY: DayFigures[] = [
  { serviceDate: addDays(TODAY, -3), confirmed: 100, consumed: 100 },
  { serviceDate: addDays(TODAY, -2), confirmed: 100, consumed: 80 },
  { serviceDate: addDays(TODAY, -1), confirmed: 100, consumed: 70 },
];
const STEADY_HISTORY: DayFigures[] = [
  { serviceDate: addDays(TODAY, -2), confirmed: 50, consumed: 48 },
  { serviceDate: addDays(TODAY, -1), confirmed: 50, consumed: 49 },
];

async function insertReconciliation(ctx: { db: { insert: (table: "reconciliations", doc: Omit<Doc<"reconciliations">, "_id" | "_creationTime">) => Promise<Id<"reconciliations">> } }, schoolId: Id<"schools">, day: DayFigures) {
  const variance = day.confirmed - day.consumed;
  await ctx.db.insert("reconciliations", {
    schoolId,
    serviceDate: day.serviceDate,
    dispatched: day.confirmed,
    confirmed: day.confirmed,
    consumed: day.consumed,
    variance,
    variancePct: Math.round((variance / day.confirmed) * 100),
    computedAt: NOW,
  });
}

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  return await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "varianceTolerancePct", value: TOLERANCE_PCT, description: "test" });
    await ctx.db.insert("settings", { key: "varianceStreakDays", value: STREAK_DAYS, description: "test" });
    await ctx.db.insert("academicCalendar", { serviceDate: TODAY, isSchoolDay: true, dayType: "full" });
    const steady = await ctx.db.insert("schools", { code: "SCH-A", name: "Steady Primary", active: true });
    const leaky = await ctx.db.insert("schools", { code: "SCH-B", name: "Leaky Primary", active: true });
    await ctx.db.insert("schools", { code: "SCH-X", name: "Closed Primary", active: false });
    for (const day of STEADY_HISTORY) {
      await insertReconciliation(ctx, steady, day);
    }
    for (const day of LEAKY_HISTORY) {
      await insertReconciliation(ctx, leaky, day);
    }
    const guardianId = await ctx.db.insert("guardians", { msisdn: "254700000001", displayName: "G", language: "en", optedOutTypes: [] });
    return { steady, leaky, guardianId };
  });
}

async function leakyStudentsAndDelivery(t: Harness, world: World, confirmed: number, consumed: number) {
  await t.run(async (ctx) => {
    const supplierId = await ctx.db.insert("users", { authUserId: "auth-supplier", displayName: "Kitchen", role: "supplier" });
    await ctx.db.insert("deliveries", {
      schoolId: world.leaky,
      serviceDate: TODAY,
      portions: confirmed,
      docketRef: "DK-1",
      dispatchedAt: NOW,
      declaredBy: supplierId,
      confirmCodeHash: "hash",
      expectedConfirmBy: NOW,
      status: "confirmed",
      portionsReceived: confirmed,
    });
    for (let index = 0; index < consumed; index += 1) {
      const studentId = await ctx.db.insert("students", { schoolId: world.leaky, studentRef: `STU-${index}`, fullName: `Child ${index}`, className: "4A", status: "active" });
      await ctx.db.insert("expectations", { schoolId: world.leaky, studentId, serviceDate: TODAY, windowStart: NOW, windowEnd: NOW, cutoffAt: NOW, status: "fulfilled" });
    }
  });
}

async function eventsOfType(t: Harness, type: string): Promise<Doc<"events">[]> {
  const rows = await t.run(async (ctx) => await ctx.db.query("events").collect());
  return rows.filter((row) => row.type === type);
}

async function overview(t: Harness) {
  return await t.run(async (ctx) => await countyOverview(ctx, { from: FROM, to: TODAY }));
}

describe("county dashboard: ranked variance, streaks, totals, drill, export (D12)", () => {
  test("streak counts consecutive out-of-tolerance days from the newest and ranking is by magnitude (GV-02, GV-03, FR-702)", () => {
    expect(varianceStreak([30, 20, 0, 40], TOLERANCE_PCT)).toBe(2);
    expect(varianceStreak([5, 40], TOLERANCE_PCT)).toBe(0);
    expect(varianceStreak([-15, 15], TOLERANCE_PCT)).toBe(2);
    const ranked = rankByVariance([{ code: "a", variancePct: 2 }, { code: "b", variancePct: -30 }, { code: "c", variancePct: 12 }]);
    expect(ranked.map((row) => row.code)).toEqual(["b", "c", "a"]);
  });

  test("the overview ranks schools by variance, carries the streak, and totals the programme (GV-01, GV-02, GV-07)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", { eventId: "e", type: "meal.tapped", occurredAt: NOW, recordedAt: NOW, schemaVersion: 1, correlationId: "c", payload: {} });
      for (const [dedupeKey, status] of [["d1", "delivered"], ["d2", "failed"]] as const) {
        await ctx.db.insert("notifications", { dedupeKey, ruleKey: "r", eventId, correlationId: "c", guardianId: world.guardianId, msisdn: "254700000001", channel: "sms", body: "b", segments: 1, status });
      }
    });
    const result = await overview(t);
    expect(result.rows.map((row) => row.schoolCode)).toEqual(["SCH-B", "SCH-A"]);
    expect(result.rows[0]).toMatchObject({ days: 3, confirmed: 300, consumed: 250, variance: 50, variancePct: 17, streakDays: 2 });
    expect(result.rows[1]).toMatchObject({ days: 2, streakDays: 0 });
    expect(result.totals).toEqual({ schoolsActive: 2, mealsServed: 347, guardiansReached: 1, deliverabilityPct: 50 });
    expect(result.thresholds).toEqual({ varianceTolerancePct: TOLERANCE_PCT, varianceStreakDays: STREAK_DAYS, overrideTolerancePct: 15 });
  });

  test("today's reconciliation completes a streak and emits variance_exceeded exactly once (GV-03, FR-705)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await leakyStudentsAndDelivery(t, world, 100, 60);
    const result = await t.run(async (ctx) => await reconcileDay(ctx, { schoolId: world.leaky, serviceDate: TODAY }));
    expect(result).toMatchObject({ status: "computed", variancePct: 40 });
    const [exceeded] = await eventsOfType(t, "reconciliation.variance_exceeded");
    expect(exceeded.payload).toEqual({ school_id: world.leaky, variance_pct: 40, streak_days: STREAK_DAYS });
    expect(await t.run(async (ctx) => await flagIntegrity(ctx, { schoolId: world.leaky, serviceDate: TODAY, consumed: 60, received: 100 }))).toEqual({ varianceExceeded: false, overrideRateExceeded: false, consumedExceedsReceived: false });
    expect(await eventsOfType(t, "reconciliation.variance_exceeded")).toHaveLength(1);
    expect((await overview(t)).rows[0].streakDays).toBe(STREAK_DAYS);
  });

  test("a steady school never trips the streak (GV-03)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    expect(await t.run(async (ctx) => await flagIntegrity(ctx, { schoolId: world.steady, serviceDate: TODAY, consumed: 0, received: null }))).toEqual({ varianceExceeded: false, overrideRateExceeded: false, consumedExceedsReceived: false });
    expect(await eventsOfType(t, "reconciliation.variance_exceeded")).toHaveLength(0);
  });

  test("more meals eaten than portions received is flagged the same day, exactly once", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await leakyStudentsAndDelivery(t, world, 16, 40);
    await t.run(async (ctx) => await reconcileDay(ctx, { schoolId: world.leaky, serviceDate: TODAY }));
    const [flag] = await eventsOfType(t, "integrity.consumed_exceeds_received");
    expect(flag.payload).toEqual({ school_id: world.leaky, consumed: 40, received: 16, excess: 24 });
    await t.run(async (ctx) => await reconcileDay(ctx, { schoolId: world.leaky, serviceDate: TODAY }));
    expect(await eventsOfType(t, "integrity.consumed_exceeds_received")).toHaveLength(1);
  });

  test("the export carries one line per school in ranked order (GV-06, FR-704)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    const csv = toCountyCsv((await overview(t)).rows);
    const [header, first, second] = csv.split("\n");
    expect(header).toBe("school_code,school_name,days,dispatched,confirmed,consumed,variance,variance_pct,streak_days,override_rate_pct");
    expect(first).toBe("SCH-B,Leaky Primary,3,300,300,250,50,17,2,0");
    expect(second).toBe("SCH-A,Steady Primary,2,100,100,97,3,3,0,0");
  });
});
