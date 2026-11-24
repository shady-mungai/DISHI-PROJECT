import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { reconciliationsNewestFirst } from "./county";
import { requireRole } from "./lib/authz";
import { addDays } from "./lib/dates";
import { attendanceByWeekday, DEFAULT_MIN_DISH_DAYS, dishInsights, type DishInsight, type InsightDay, type WeekdayAttendance } from "./lib/dishInsights";
import { forecastAccuracy, type ForecastAccuracy } from "./lib/monitor";
import { deliveryStatus } from "./schema";
import { readNumberSetting, SettingKey } from "./settings";

const SUPPLIER_ROLES = ["supplier", "county", "admin"] as const;
const MAX_SCHOOLS = 100;
const MAX_FORECAST_DAYS = 366;
const MAX_UNCONFIRMED = 200;
const MAX_STALLED = 200;
const STALLED_EVENT = "service.stalled";
const MAX_DELIVERIES_IN_RANGE = 2000;
const MAX_RECENT_DISHES = 50;
const RECENT_DELIVERIES_SCANNED = 200;

type DateRange = { from: string; to: string };

type SchoolDayRow = {
  schoolId: Id<"schools">;
  schoolCode: string;
  serviceDate: string;
  forecast: number | null;
  dispatched: number;
  confirmed: number;
  received: number | null;
  consumed: number;
  variance: number;
  variancePct: number;
};

type SchoolAccuracy = { schoolId: Id<"schools">; schoolCode: string } & ForecastAccuracy;

type UnconfirmedDelivery = { _id: Id<"deliveries">; schoolCode: string; serviceDate: string; docketRef: string; portions: number; expectedConfirmBy: number; status: Doc<"deliveries">["status"] };

type StalledAlert = { _id: Id<"events">; schoolCode: string; serviceDate: string; occurredAt: number; tapsSoFar: number; expectedRunRate: number; shortfallPct: number };

export type SupplierOverview = { rows: SchoolDayRow[]; accuracy: SchoolAccuracy[]; unconfirmed: UnconfirmedDelivery[]; stalled: StalledAlert[] };

async function forecastsByDay(ctx: QueryCtx, schoolId: Id<"schools">, range: DateRange): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query("forecasts")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", schoolId).gte("serviceDate", range.from).lte("serviceDate", range.to))
    .take(MAX_FORECAST_DAYS);
  return new Map(rows.map((row) => [row.serviceDate, row.portions]));
}

// SU-06 / SU-08: the per-school-day ledger and how well the forecast held up.
async function schoolLedger(ctx: QueryCtx, school: Doc<"schools">, range: DateRange): Promise<{ rows: SchoolDayRow[]; accuracy: SchoolAccuracy }> {
  const forecasts = await forecastsByDay(ctx, school._id, range);
  const reconciliations = await reconciliationsNewestFirst(ctx, school._id, range);
  const rows = reconciliations.map((row) => ({
    schoolId: school._id,
    schoolCode: school.code,
    serviceDate: row.serviceDate,
    forecast: forecasts.get(row.serviceDate) ?? null,
    dispatched: row.dispatched,
    confirmed: row.confirmed,
    received: row.received ?? null,
    consumed: row.consumed,
    variance: row.variance,
    variancePct: row.variancePct,
  }));
  const pairs = rows.flatMap((row) => (row.forecast === null ? [] : [{ forecast: row.forecast, actual: row.consumed }]));
  return { rows, accuracy: { schoolId: school._id, schoolCode: school.code, ...forecastAccuracy(pairs) } };
}

function numberField(payload: Doc<"events">["payload"], key: string): number {
  const value = payload[key];
  return typeof value === "number" ? value : 0;
}

export async function supplierOverview(ctx: QueryCtx, range: DateRange): Promise<SupplierOverview> {
  const schools = (await ctx.db.query("schools").take(MAX_SCHOOLS)).filter((school) => school.active);
  const codes = new Map(schools.map((school) => [school._id, school.code]));
  const rows: SchoolDayRow[] = [];
  const accuracy: SchoolAccuracy[] = [];
  for (const school of schools) {
    const ledger = await schoolLedger(ctx, school, range);
    rows.push(...ledger.rows);
    accuracy.push(ledger.accuracy);
  }
  rows.sort((left, right) => right.serviceDate.localeCompare(left.serviceDate) || Math.abs(right.variancePct) - Math.abs(left.variancePct));

  const unconfirmedRows = await ctx.db
    .query("deliveries")
    .withIndex("by_status_serviceDate", (q) => q.eq("status", "unconfirmed").gte("serviceDate", range.from).lte("serviceDate", range.to))
    .order("desc")
    .take(MAX_UNCONFIRMED);
  const unconfirmed = unconfirmedRows.map((row) => ({
    _id: row._id,
    schoolCode: codes.get(row.schoolId) ?? "",
    serviceDate: row.serviceDate,
    docketRef: row.docketRef,
    portions: row.portions,
    expectedConfirmBy: row.expectedConfirmBy,
    status: row.status,
  }));

  const fromMs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toMs = Date.parse(`${addDays(range.to, 1)}T00:00:00.000Z`);
  const stalledRows = await ctx.db
    .query("events")
    .withIndex("by_type_occurredAt", (q) => q.eq("type", STALLED_EVENT).gte("occurredAt", fromMs).lt("occurredAt", toMs))
    .order("desc")
    .take(MAX_STALLED);
  const stalled = stalledRows.map((row) => ({
    _id: row._id,
    schoolCode: (row.schoolId && codes.get(row.schoolId)) ?? "",
    serviceDate: row.serviceDate ?? "",
    occurredAt: row.occurredAt,
    tapsSoFar: numberField(row.payload, "taps_so_far"),
    expectedRunRate: numberField(row.payload, "expected_run_rate"),
    shortfallPct: numberField(row.payload, "shortfall_pct"),
  }));

  return { rows, accuracy, unconfirmed, stalled };
}

export const overview = query({
  args: { from: v.string(), to: v.string() },
  returns: v.object({
    rows: v.array(
      v.object({
        schoolId: v.id("schools"),
        schoolCode: v.string(),
        serviceDate: v.string(),
        forecast: v.union(v.number(), v.null()),
        dispatched: v.number(),
        confirmed: v.number(),
        received: v.union(v.number(), v.null()),
        consumed: v.number(),
        variance: v.number(),
        variancePct: v.number(),
      }),
    ),
    accuracy: v.array(v.object({ schoolId: v.id("schools"), schoolCode: v.string(), days: v.number(), meanAbsErrorPct: v.number(), biasPct: v.number() })),
    unconfirmed: v.array(
      v.object({ _id: v.id("deliveries"), schoolCode: v.string(), serviceDate: v.string(), docketRef: v.string(), portions: v.number(), expectedConfirmBy: v.number(), status: deliveryStatus }),
    ),
    stalled: v.array(
      v.object({ _id: v.id("events"), schoolCode: v.string(), serviceDate: v.string(), occurredAt: v.number(), tapsSoFar: v.number(), expectedRunRate: v.number(), shortfallPct: v.number() }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, SUPPLIER_ROLES);
    return await supplierOverview(ctx, args);
  },
});

export type SupplierInsights = { minDays: number; dishes: DishInsight[]; weekdays: WeekdayAttendance[] };

async function nonFullDays(ctx: QueryCtx, range: DateRange): Promise<Set<string>> {
  const calendar = await ctx.db
    .query("academicCalendar")
    .withIndex("by_serviceDate", (q) => q.gte("serviceDate", range.from).lte("serviceDate", range.to))
    .take(MAX_FORECAST_DAYS);
  return new Set(calendar.filter((day) => day.dayType !== "full").map((day) => day.serviceDate));
}

// A day counts for a dish only when every delivery that day names the same dish.
function soleDish(deliveries: ReadonlyArray<Doc<"deliveries">>): string | null {
  const dishes = new Set(deliveries.map((delivery) => delivery.dish ?? ""));
  const [only] = dishes;
  return dishes.size === 1 && only ? only : null;
}

async function dishesByDay(ctx: QueryCtx, schoolId: Id<"schools">, range: DateRange): Promise<Map<string, string | null>> {
  const deliveries = await ctx.db
    .query("deliveries")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", schoolId).gte("serviceDate", range.from).lte("serviceDate", range.to))
    .take(MAX_DELIVERIES_IN_RANGE);
  const byDay = new Map<string, Doc<"deliveries">[]>();
  for (const delivery of deliveries) {
    byDay.set(delivery.serviceDate, [...(byDay.get(delivery.serviceDate) ?? []), delivery]);
  }
  return new Map([...byDay].map(([serviceDate, rows]) => [serviceDate, soleDish(rows)]));
}

async function schoolInsightDays(ctx: QueryCtx, school: Doc<"schools">, range: DateRange, skipped: ReadonlySet<string>): Promise<InsightDay[]> {
  const dishes = await dishesByDay(ctx, school._id, range);
  const reconciliations = await reconciliationsNewestFirst(ctx, school._id, range);
  return reconciliations
    .filter((row) => !skipped.has(row.serviceDate))
    .map((row) => ({
      schoolId: school._id,
      serviceDate: row.serviceDate,
      dish: dishes.get(row.serviceDate) ?? null,
      received: row.received ?? row.confirmed,
      consumed: row.consumed,
      attendance: row.attendance ?? null,
    }));
}

// Aggregates only: suppliers never see pupil-level attendance.
export async function supplierInsights(ctx: QueryCtx, range: DateRange): Promise<SupplierInsights> {
  const schools = (await ctx.db.query("schools").take(MAX_SCHOOLS)).filter((school) => school.active);
  const skipped = await nonFullDays(ctx, range);
  const days: InsightDay[] = [];
  for (const school of schools) {
    days.push(...(await schoolInsightDays(ctx, school, range, skipped)));
  }
  const minDays = await readNumberSetting(ctx, SettingKey.DishInsightsMinDays, DEFAULT_MIN_DISH_DAYS);
  const dishes = dishInsights(days, minDays).sort((left, right) => (right.leftoverPct ?? -Infinity) - (left.leftoverPct ?? -Infinity));
  return { minDays, dishes, weekdays: attendanceByWeekday(days) };
}

const nullableNumber = v.union(v.number(), v.null());

export const insights = query({
  args: { from: v.string(), to: v.string() },
  returns: v.object({
    minDays: v.number(),
    dishes: v.array(
      v.object({
        dish: v.string(),
        days: v.number(),
        enoughData: v.boolean(),
        uptakePct: nullableNumber,
        leftoverPct: nullableNumber,
        uptakeVsWeekday: nullableNumber,
        leftoverVsWeekday: nullableNumber,
      }),
    ),
    weekdays: v.array(
      v.object({
        weekday: v.string(),
        registerDays: v.number(),
        attendancePct: nullableNumber,
        uptakePct: nullableNumber,
        absent: v.number(),
        missedPresent: v.number(),
        missedSupply: v.number(),
        missedUnknown: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, SUPPLIER_ROLES);
    return await supplierInsights(ctx, args);
  },
});

export const recentDishes = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const actor = await requireRole(ctx, SUPPLIER_ROLES);
    const recent = await ctx.db
      .query("deliveries")
      .withIndex("by_declaredBy_and_serviceDate", (q) => q.eq("declaredBy", actor._id))
      .order("desc")
      .take(RECENT_DELIVERIES_SCANNED);
    return [...new Set(recent.flatMap((delivery) => (delivery.dish ? [delivery.dish] : [])))].slice(0, MAX_RECENT_DISHES);
  },
});
