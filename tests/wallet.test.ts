import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { compareThreshold, projectDepletion } from "../convex/lib/wallet/threshold";
import { seedRules } from "../convex/rules";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const TODAY = "2026-09-14";
const SCHOOL_DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21"];
const NOW = Date.parse(`${TODAY}T09:30:00.000Z`);
const DEVICE_REF = "READER-01";
const TAG_UID = "tag-001";
const SCHOOL_CODE = "SCH-1";
const STUDENT_REF = "STU-1";
const MILLISECONDS_PER_DAY = 86_400_000;
const MEAL_PRICE = 5;
const THRESHOLD = 50;
const MARGIN = 20;

type Harness = ReturnType<typeof convexTest>;

async function seedWorld(t: Harness, openingBalanceKes?: number): Promise<{ schoolId: Id<"schools">; studentId: Id<"students"> }> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const ids = await t.run(async (ctx) => {
    await seedRules(ctx);
    await ctx.db.insert("settings", { key: "collapseWindowMinutes", value: 0, description: "test" });
    for (const day of SCHOOL_DAYS) {
      await ctx.db.insert("academicCalendar", { serviceDate: day, isSchoolDay: true, dayType: "full" });
    }
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: SCHOOL_CODE, name: "Pilot Primary", active: true });
    const studentId = await ctx.db.insert("students", { schoolId, studentRef: STUDENT_REF, fullName: "Amina Njeri", className: "4A", status: "active" });
    const guardianId = await ctx.db.insert("guardians", { msisdn: "+254700000123", displayName: "Wanjiku Njeri", language: "en", optedOutTypes: [] });
    await ctx.db.insert("guardianLinks", { guardianId, studentId, relationship: "mother", active: true });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId, status: "active", issuedAt: NOW });
    if (openingBalanceKes !== undefined) {
      await ctx.db.insert("wallets", { studentId, balanceKes: openingBalanceKes });
    }
    return { schoolId, studentId };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: ids.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  return ids;
}

// One countable meal per day (ST-04): each tap lands on the next day.
async function tap(t: Harness, eventId: string) {
  const [result] = await t.mutation(internal.ingest.recordBatch, { deviceRef: DEVICE_REF, events: [{ eventId, tagUid: TAG_UID, occurredAt: Date.now() }] });
  vi.setSystemTime(Date.now() + MILLISECONDS_PER_DAY);
  return result;
}

async function topUp(t: Harness, externalRef: string, amountKes: number) {
  return await t.mutation(internal.wallets.applyPayment, { externalRef, schoolCode: SCHOOL_CODE, studentRef: STUDENT_REF, amountKes });
}

async function eventTypes(t: Harness): Promise<string[]> {
  const rows = await t.run(async (ctx) => await ctx.db.query("events").collect());
  return rows.map((row) => row.type).filter((type) => type.startsWith("wallet."));
}

async function balance(t: Harness): Promise<number> {
  const wallet = await t.run(async (ctx) => await ctx.db.query("wallets").first());
  return wallet?.balanceKes ?? Number.NaN;
}

describe("wallet mirror, hysteresis and depletion forecast (D8)", () => {
  test("comparator: one warning on the downward crossing, re-armed only above threshold + margin (FR-406, P-03)", () => {
    const base = { thresholdKes: THRESHOLD, reArmMarginKes: MARGIN };
    const crossed = compareThreshold({ ...base, previousBalanceKes: 55, balanceKes: 50, armed: true });
    expect(crossed).toEqual({ armed: false, lowBalance: true, depleted: false });
    const hovering = compareThreshold({ ...base, previousBalanceKes: 50, balanceKes: 55, armed: false });
    expect(hovering.lowBalance).toBe(false);
    expect(hovering.armed).toBe(false);
    const recovered = compareThreshold({ ...base, previousBalanceKes: 55, balanceKes: 71, armed: false });
    expect(recovered).toEqual({ armed: true, lowBalance: false, depleted: false });
    expect(compareThreshold({ ...base, previousBalanceKes: 5, balanceKes: 0, armed: false }).depleted).toBe(true);
  });

  test("forecast: burn rate × price → first uncovered school day (FR-304)", () => {
    const days = SCHOOL_DAYS.slice(1);
    expect(projectDepletion({ balanceKes: 14, mealPriceKes: MEAL_PRICE, mealsPerSchoolDay: 1, upcomingSchoolDays: days })).toEqual({ mealsRemaining: 2, schoolDaysCovered: 2, projectedDate: "2026-09-17" });
    expect(projectDepletion({ balanceKes: 10, mealPriceKes: MEAL_PRICE, mealsPerSchoolDay: 0.5, upcomingSchoolDays: days }).projectedDate).toBe("2026-09-21");
    expect(projectDepletion({ balanceKes: 100, mealPriceKes: MEAL_PRICE, mealsPerSchoolDay: 1, upcomingSchoolDays: days }).projectedDate).toBeNull();
    expect(projectDepletion({ balanceKes: 100, mealPriceKes: MEAL_PRICE, mealsPerSchoolDay: 0, upcomingSchoolDays: days }).projectedDate).toBeNull();
  });

  test("a wallet oscillating at the threshold emits exactly one warning; a full recovery re-arms it (Sprint 2 exit)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t, THRESHOLD + MEAL_PRICE);
    await tap(t, "tap-1");
    expect(await balance(t)).toBe(THRESHOLD);
    await topUp(t, "pay-1", MEAL_PRICE);
    await tap(t, "tap-2");
    await topUp(t, "pay-2", MEAL_PRICE);
    await tap(t, "tap-3");
    expect((await eventTypes(t)).filter((type) => type === "wallet.low_balance")).toHaveLength(1);

    await topUp(t, "pay-3", MARGIN);
    expect(await balance(t)).toBe(THRESHOLD + MARGIN);
    await tap(t, "tap-4");
    expect((await eventTypes(t)).filter((type) => type === "wallet.low_balance")).toHaveLength(1);

    await topUp(t, "pay-4", MARGIN + MEAL_PRICE + 1);
    await tap(t, "tap-5");
    expect((await eventTypes(t)).filter((type) => type === "wallet.low_balance")).toHaveLength(1);
    await topUp(t, "pay-5", 1);
    await tap(t, "tap-6");
    expect((await eventTypes(t)).filter((type) => type === "wallet.low_balance")).toHaveLength(1);
  });

  test("re-arm above threshold + margin, then a second crossing warns again", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t, THRESHOLD);
    await tap(t, "tap-1");
    await topUp(t, "pay-1", MARGIN + MEAL_PRICE + 1);
    expect(await balance(t)).toBe(THRESHOLD + MARGIN + 1);
    const tapsToCrossAgain = Math.ceil((MARGIN + 1) / MEAL_PRICE);
    for (let day = 0; day < tapsToCrossAgain; day += 1) {
      await tap(t, `tap-again-${day}`);
    }
    expect((await eventTypes(t)).filter((type) => type === "wallet.low_balance")).toHaveLength(2);
  });

  test("forecast names the run-out date, is sent once per date, and depleted fires on the zero crossing (P-04)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t, MEAL_PRICE * 4);
    await tap(t, "tap-1");
    await runScheduled(t);
    const rows = await t.run(async (ctx) => await ctx.db.query("events").withIndex("by_type_occurredAt", (q) => q.eq("type", "wallet.depletion_forecast")).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ projected_date: "2026-09-18", meals_remaining: 3 });
    const bodies = (await t.run(async (ctx) => await ctx.db.query("notifications").collect())).map((row) => row.body);
    expect(bodies).toContainEqual("Dear Wanjiku Njeri, Amina Njeri's balance covers 3 more meals and runs out on 2026-09-18. Please top up.");

    await tap(t, "tap-2");
    await tap(t, "tap-3");
    await tap(t, "tap-4");
    const types = await eventTypes(t);
    expect(types.filter((type) => type === "wallet.depletion_forecast")).toHaveLength(1);
    expect(types.filter((type) => type === "wallet.depleted")).toHaveLength(1);
  });

  test("top-ups are idempotent on externalRef and an authoritative balance overwrites the mirror (FR-301, FR-302)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t, 10);
    expect(await topUp(t, "pay-1", 40)).toBe("applied");
    expect(await topUp(t, "pay-1", 40)).toBe("duplicate");
    expect(await balance(t)).toBe(50);
    await t.mutation(internal.wallets.applyPayment, { externalRef: "pay-2", schoolCode: SCHOOL_CODE, studentRef: STUDENT_REF, amountKes: 10, newBalanceKes: 200 });
    expect(await balance(t)).toBe(200);
    expect(await topUp(t, "pay-3", 10).then(() => t.mutation(internal.wallets.applyPayment, { externalRef: "pay-4", schoolCode: SCHOOL_CODE, studentRef: "nobody", amountKes: 10 }))).toBe("unknown_student");
  });

  test("a tap with no wallet row is still served and recorded (FR-303, ST-02)", async () => {
    const t = convexTest(schema, modules);
    await seedWorld(t);
    expect((await tap(t, "tap-1")).status).toBe("accepted");
    expect(await eventTypes(t)).toEqual([]);
  });
});

async function runScheduled(t: Harness): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}
