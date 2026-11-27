import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { addDays } from "../convex/lib/dates";
import { forecastAccuracy, runRate } from "../convex/lib/monitor";
import { checkStalledService } from "../convex/monitor";
import { supplierOverview } from "../convex/supplier";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-21";
const YESTERDAY = addDays(TODAY, -1);
const WINDOW_START = Date.parse(`${TODAY}T09:30:00.000Z`);
const WINDOW_MINUTES = 90;
const MILLISECONDS_PER_MINUTE = 60_000;
const WINDOW_END = WINDOW_START + WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;
const MIDPOINT = WINDOW_START + (WINDOW_MINUTES / 2) * MILLISECONDS_PER_MINUTE;
const ROSTER = 20;
const STALLED_THRESHOLD_PCT = 30;
const DEVICE_REF = "READER-01";

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; tagUids: string[] };

afterEach(() => {
  vi.useRealTimers();
});

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: WINDOW_START, toFake: ["Date"] });
  const world = await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "stalledServiceThresholdPct", value: STALLED_THRESHOLD_PCT, description: "test" });
    await ctx.db.insert("settings", { key: "serviceWindowMinutes", value: WINDOW_MINUTES, description: "test" });
    await ctx.db.insert("academicCalendar", { serviceDate: TODAY, isSchoolDay: true, dayType: "full" });
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const tagUids: string[] = [];
    for (let index = 0; index < ROSTER; index += 1) {
      const studentId = await ctx.db.insert("students", { schoolId, studentRef: `STU-${index}`, fullName: `Child ${index}`, className: "4A", status: "active" });
      const tagUid = `tag-${index}`;
      await ctx.db.insert("tags", { tagUid, studentId, status: "active", issuedAt: WINDOW_START });
      tagUids.push(tagUid);
    }
    return { schoolId, tagUids };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: world.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: TODAY, serviceStartAt: WINDOW_START });
  return world;
}

async function tapMany(t: Harness, world: World, count: number) {
  const events = world.tagUids.slice(0, count).map((tagUid, index) => ({ eventId: `tap-${index}`, tagUid, occurredAt: Date.now() }));
  await t.mutation(internal.ingest.recordBatch, { deviceRef: DEVICE_REF, events });
}

async function check(t: Harness, world: World) {
  return await t.run(async (ctx) => await checkStalledService(ctx, { schoolId: world.schoolId, serviceDate: TODAY }));
}

async function eventsOfType(t: Harness, type: string): Promise<Doc<"events">[]> {
  const rows = await t.run(async (ctx) => await ctx.db.query("events").collect());
  return rows.filter((row) => row.type === type);
}

async function seedLedger(t: Harness, world: World) {
  await t.run(async (ctx) => {
    const supplierId = await ctx.db.insert("users", { authUserId: "auth-supplier", displayName: "Kitchen", role: "supplier" });
    await ctx.db.insert("forecasts", { schoolId: world.schoolId, serviceDate: YESTERDAY, portions: 20, confidence: "high", computedAt: WINDOW_START });
    await ctx.db.insert("forecasts", { schoolId: world.schoolId, serviceDate: TODAY, portions: 20, confidence: "high", computedAt: WINDOW_START });
    await ctx.db.insert("reconciliations", { schoolId: world.schoolId, serviceDate: YESTERDAY, dispatched: 20, confirmed: 20, consumed: 16, variance: 4, variancePct: 20, computedAt: WINDOW_START });
    await ctx.db.insert("reconciliations", { schoolId: world.schoolId, serviceDate: TODAY, dispatched: 20, confirmed: 18, consumed: 18, variance: 0, variancePct: 0, computedAt: WINDOW_START });
    await ctx.db.insert("deliveries", {
      schoolId: world.schoolId,
      serviceDate: TODAY,
      portions: 20,
      docketRef: "DK-9",
      dispatchedAt: WINDOW_START,
      declaredBy: supplierId,
      confirmCodeHash: "hash",
      expectedConfirmBy: WINDOW_START,
      status: "unconfirmed",
    });
  });
}

describe("supplier dashboard + intra-day monitor (D13)", () => {
  test("run rate is linear across the window and accuracy is volume-weighted absolute error with signed bias (FR-607, SU-08)", () => {
    expect(runRate({ expected: 20, tapsSoFar: 3, windowStart: WINDOW_START, windowEnd: WINDOW_END, now: MIDPOINT })).toEqual({ expectedSoFar: 10, shortfallPct: 70, elapsedPct: 50 });
    expect(runRate({ expected: 20, tapsSoFar: 12, windowStart: WINDOW_START, windowEnd: WINDOW_END, now: MIDPOINT }).shortfallPct).toBe(0);
    expect(runRate({ expected: 20, tapsSoFar: 0, windowStart: WINDOW_START, windowEnd: WINDOW_END, now: WINDOW_START }).shortfallPct).toBe(0);
    expect(forecastAccuracy([{ forecast: 20, actual: 16 }, { forecast: 20, actual: 22 }])).toEqual({ days: 2, meanAbsErrorPct: 16, biasPct: 5 });
    expect(forecastAccuracy([])).toEqual({ days: 0, meanAbsErrorPct: 0, biasPct: 0 });
    // One near-zero forecast no longer explodes the figure (per-day % of forecast gave ±1100%).
    expect(forecastAccuracy([{ forecast: 1, actual: 23 }, { forecast: 38, actual: 38 }])).toEqual({ days: 2, meanAbsErrorPct: 36, biasPct: -36 });
    // A zero forecast on a day pupils ate is a full miss; a 0/0 day is skipped.
    expect(forecastAccuracy([{ forecast: 0, actual: 30 }, { forecast: 0, actual: 0 }])).toEqual({ days: 1, meanAbsErrorPct: 100, biasPct: -100 });
  });

  test("a school at 30% of its expected rate mid-window is flagged stalled exactly once (FR-607, SU-04)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await tapMany(t, world, 3);
    vi.setSystemTime(MIDPOINT);
    expect(await check(t, world)).toEqual({ status: "stalled", shortfallPct: 70 });
    expect(await check(t, world)).toEqual({ status: "already_flagged", shortfallPct: 70 });
    const [stalled] = await eventsOfType(t, "service.stalled");
    expect(stalled.payload).toMatchObject({ school_id: world.schoolId, taps_so_far: 3, expected_run_rate: 10, at_time: MIDPOINT });
  });

  test("a school on track is not flagged, and nothing fires after the window closes", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await tapMany(t, world, 9);
    vi.setSystemTime(MIDPOINT);
    expect((await check(t, world)).status).toBe("on_track");
    vi.setSystemTime(WINDOW_END + MILLISECONDS_PER_MINUTE);
    expect((await check(t, world)).status).toBe("window_closed");
    expect(await eventsOfType(t, "service.stalled")).toHaveLength(0);
  });

  test("the overview joins forecast to the ledger, scores accuracy, and lists unconfirmed deliveries and stalled alerts (SU-05, SU-06, SU-08)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await seedLedger(t, world);
    await tapMany(t, world, 2);
    vi.setSystemTime(MIDPOINT);
    await check(t, world);
    const result = await t.run(async (ctx) => await supplierOverview(ctx, { from: YESTERDAY, to: TODAY }));
    expect(result.rows.map((row) => [row.serviceDate, row.forecast, row.consumed, row.variancePct])).toEqual([
      [TODAY, 20, 18, 0],
      [YESTERDAY, 20, 16, 20],
    ]);
    expect(result.accuracy).toEqual([{ schoolId: world.schoolId, schoolCode: "SCH-1", days: 2, meanAbsErrorPct: 18, biasPct: 18 }]);
    expect(result.unconfirmed).toHaveLength(1);
    expect(result.unconfirmed[0]).toMatchObject({ schoolCode: "SCH-1", docketRef: "DK-9", status: "unconfirmed" });
    expect(result.stalled).toHaveLength(1);
    expect(result.stalled[0]).toMatchObject({ schoolCode: "SCH-1", serviceDate: TODAY, tapsSoFar: 2, expectedRunRate: 10, shortfallPct: 80 });
  });
});
