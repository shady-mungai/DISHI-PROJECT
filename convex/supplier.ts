import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { reconciliationsNewestFirst } from "./county";
import { requireRole } from "./lib/authz";
import { addDays } from "./lib/dates";
import { forecastAccuracy, type ForecastAccuracy } from "./lib/monitor";
import { deliveryStatus } from "./schema";

const SUPPLIER_ROLES = ["supplier", "county", "admin"] as const;
const MAX_SCHOOLS = 100;
const MAX_FORECAST_DAYS = 366;
const MAX_UNCONFIRMED = 200;
const MAX_STALLED = 200;
const STALLED_EVENT = "service.stalled";

type DateRange = { from: string; to: string };

type SchoolDayRow = {
  schoolId: Id<"schools">;
  schoolCode: string;
  serviceDate: string;
  forecast: number | null;
  dispatched: number;
  confirmed: number;
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
