import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { declareDispatch, paymentLines, publishForecast, reconcileDay, resolveDelivery } from "../convex/deliveries";
import { computeVariance, forecastPortions, toPaymentCsv } from "../convex/lib/supply";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-21";
const TOMORROW = "2026-09-22";
const NOW = Date.parse(`${TODAY}T07:00:00.000Z`);
const CONFIRM_WINDOW_MINUTES = 120;
const MILLISECONDS_PER_MINUTE = 60_000;
const PORTION_RATE = 25;
const ROSTER_SIZE = 30;
const SERVED_TODAY = 27;
const HISTORY: { serviceDate: string; expected: number; fulfilled: number }[] = [
  { serviceDate: "2026-09-08", expected: 30, fulfilled: 24 },
  { serviceDate: "2026-09-15", expected: 30, fulfilled: 27 },
  { serviceDate: "2026-09-16", expected: 30, fulfilled: 30 },
];

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; supplier: Doc<"users">; staff: Doc<"users"> };

afterEach(() => {
  vi.useRealTimers();
});

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  return await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "deliveryConfirmWindowMinutes", value: CONFIRM_WINDOW_MINUTES, description: "test" });
    await ctx.db.insert("settings", { key: "supplierPortionRateKes", value: PORTION_RATE, description: "test" });
    for (const day of [TODAY, TOMORROW]) {
      await ctx.db.insert("academicCalendar", { serviceDate: day, isSchoolDay: true, dayType: "full" });
    }
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const supplierId = await ctx.db.insert("users", { authUserId: "auth-supplier", displayName: "Kitchen Ltd", role: "supplier" });
    const staffId = await ctx.db.insert("users", { authUserId: "auth-staff", displayName: "Head cook", role: "school", schoolId });
    for (let index = 0; index < ROSTER_SIZE; index += 1) {
      const studentId = await ctx.db.insert("students", { schoolId, studentRef: `STU-${index}`, fullName: `Child ${index}`, className: "4A", status: "active" });
      await ctx.db.insert("expectations", {
        schoolId,
        studentId,
        serviceDate: TODAY,
        windowStart: NOW,
        windowEnd: NOW,
        cutoffAt: NOW,
        status: index < SERVED_TODAY ? "fulfilled" : "missed",
      });
    }
    return { schoolId, supplier: (await ctx.db.get(supplierId))!, staff: (await ctx.db.get(staffId))! };
  });
}

async function dispatch(t: Harness, world: World, portions: number, docketRef: string) {
  return await t.run(async (ctx) => await declareDispatch(ctx, { actor: world.supplier, schoolId: world.schoolId, serviceDate: TODAY, portions, docketRef }));
}

type Resolution = { code: string; portionsReceived: number; action: "confirm" | "dispute"; note?: string };

async function resolve(t: Harness, world: World, resolution: Resolution) {
  return await t.run(async (ctx) => await resolveDelivery(ctx, { actor: world.staff, schoolId: world.schoolId, ...resolution }));
}

async function eventTypes(t: Harness): Promise<string[]> {
  const rows = await t.run(async (ctx) => await ctx.db.query("events").collect());
  return rows.map((row) => row.type);
}

async function paymentFileFor(t: Harness) {
  return await t.run(async (ctx) => await paymentLines(ctx, { from: TODAY, to: TODAY }));
}

describe("supply chain: dispatch → confirm → reconcile → payment file (D10)", () => {
  test("forecast: same-weekday history beats any history beats the roster (FR-602)", () => {
    expect(forecastPortions({ activeStudents: 30, history: HISTORY, serviceDate: "2026-09-21" })).toEqual({ portions: 27, confidence: "medium" });
    expect(forecastPortions({ activeStudents: 30, history: HISTORY, serviceDate: "2026-09-22" })).toEqual({ portions: 26, confidence: "medium" });
    expect(forecastPortions({ activeStudents: 30, history: HISTORY, serviceDate: "2026-09-24" })).toEqual({ portions: 27, confidence: "medium" });
    expect(forecastPortions({ activeStudents: 30, history: [], serviceDate: "2026-09-24" })).toEqual({ portions: 30, confidence: "low" });
    const threeMondays = [...HISTORY, { serviceDate: "2026-09-14", expected: 30, fulfilled: 27 }, { serviceDate: "2026-09-07", expected: 30, fulfilled: 27 }, { serviceDate: "2026-08-31", expected: 30, fulfilled: 27 }];
    expect(forecastPortions({ activeStudents: 30, history: threeMondays, serviceDate: "2026-09-21" }).confidence).toBe("high");
  });

  test("variance and csv are pure (FR-606, FR-608)", () => {
    expect(computeVariance(30, 27)).toEqual({ variance: 3, variancePct: 10 });
    expect(computeVariance(0, 0)).toEqual({ variance: 0, variancePct: 0 });
    expect(computeVariance(0, 5)).toEqual({ variance: -5, variancePct: -100 });
    const csv = toPaymentCsv([{ schoolCode: "SCH-1", serviceDate: TODAY, docketRef: 'DK,"1"', portionsConfirmed: 30, rateKes: 25, amountKes: 750 }]);
    expect(csv).toBe(`school_code,service_date,docket_ref,portions_confirmed,rate_kes,amount_kes\nSCH-1,${TODAY},"DK,""1""",30,25,750`);
  });

  test("a dispatch with no school confirmation produces no payment-file line (Sprint 2 exit, SU-03, SU-07)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const { confirmCode } = await dispatch(t, world, 30, "DK-1");
    expect(confirmCode).toMatch(/^\d{6}$/);
    expect(await eventTypes(t)).toContain("delivery.dispatched");
    expect(await paymentFileFor(t)).toEqual([]);

    await resolve(t, world, { code: confirmCode, portionsReceived: 30, action: "confirm" });
    expect(await paymentFileFor(t)).toEqual([
      { schoolCode: "SCH-1", serviceDate: TODAY, docketRef: "DK-1", portionsConfirmed: 30, rateKes: PORTION_RATE, amountKes: 30 * PORTION_RATE },
    ]);
    expect(await eventTypes(t)).toContain("delivery.confirmed");
  });

  test("a wrong code is rejected; a replayed confirmation changes nothing (SC-02, FR-604)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const { deliveryId, confirmCode } = await dispatch(t, world, 30, "DK-1");
    await expect(resolve(t, world, { code: "000000", portionsReceived: 30, action: "confirm" })).rejects.toThrow();
    expect(await resolve(t, world, { code: confirmCode, portionsReceived: 28, action: "dispute", note: "two short" })).toEqual({ deliveryId, status: "disputed" });
    expect(await resolve(t, world, { code: confirmCode, portionsReceived: 30, action: "confirm" })).toEqual({ deliveryId, status: "disputed" });
    expect((await eventTypes(t)).filter((type) => type.startsWith("delivery."))).toEqual(["delivery.dispatched", "delivery.disputed"]);
    expect(await paymentFileFor(t)).toEqual([]);
  });

  test("the sweep marks a declared delivery unconfirmed at the expected time; a late confirmation still lands (FR-605)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const { deliveryId, confirmCode } = await dispatch(t, world, 30, "DK-1");
    vi.setSystemTime(NOW + CONFIRM_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE);
    expect(await t.mutation(internal.deliveries.sweepUnconfirmed, { deliveryId })).toBe(true);
    expect(await t.mutation(internal.deliveries.sweepUnconfirmed, { deliveryId })).toBe(false);
    expect((await eventTypes(t)).filter((type) => type === "delivery.unconfirmed")).toHaveLength(1);

    await resolve(t, world, { code: confirmCode, portionsReceived: 30, action: "confirm" });
    expect(await paymentFileFor(t)).toHaveLength(1);
  });

  test("reconciliation joins dispatched, confirmed and consumed for the school-day (FR-606)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const first = await dispatch(t, world, 20, "DK-1");
    await dispatch(t, world, 12, "DK-2");
    await resolve(t, world, { code: first.confirmCode, portionsReceived: 20, action: "confirm" });
    const result = await t.run(async (ctx) => await reconcileDay(ctx, { schoolId: world.schoolId, serviceDate: TODAY }));
    expect(result).toEqual({ status: "computed", dispatched: 32, confirmed: 20, received: 20, consumed: SERVED_TODAY, variance: -7, variancePct: -35 });
    const row = await t.run(async (ctx) => await ctx.db.query("reconciliations").unique());
    expect(row?.consumed).toBe(SERVED_TODAY);
    expect(await eventTypes(t)).toContain("reconciliation.daily_computed");
  });

  test("tomorrow's forecast is published once per school-day and refreshed on recompute (FR-601, SC-01)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const forecast = await t.run(async (ctx) => await publishForecast(ctx, { schoolId: world.schoolId, serviceDate: TOMORROW }));
    expect(forecast).toEqual({ portions: SERVED_TODAY, confidence: "medium" });
    await t.run(async (ctx) => await publishForecast(ctx, { schoolId: world.schoolId, serviceDate: TOMORROW }));
    expect((await eventTypes(t)).filter((type) => type === "demand.forecast_published")).toHaveLength(1);
    expect(await t.run(async (ctx) => await publishForecast(ctx, { schoolId: world.schoolId, serviceDate: "2026-09-27" }))).toBe("not_school_day");
  });
});
