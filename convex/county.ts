import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireRole } from "./lib/authz";
import { addDays } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { rankByVariance, varianceStreak, type SchoolVarianceRow } from "./lib/county";
import { computeVariance } from "./lib/supply";
import { overrideRate, overrideTolerancePct } from "./overrides";
import { eventPayload } from "./schema";
import { readNumberSetting, SettingKey } from "./settings";

const SCHEMA_VERSION = 1;
const COUNTY_ROLES = ["county", "admin"] as const;
const MAX_SCHOOLS = 100;
const MAX_RECONCILIATION_DAYS = 366;
const NOTIFICATION_SCAN_CAP = 5000;
const DRILL_CAP = 500;
const PERCENT = 100;
const DEFAULT_VARIANCE_TOLERANCE_PCT = 10;
const DEFAULT_VARIANCE_STREAK_DAYS = 3;
const VARIANCE_EVENT = "reconciliation.variance_exceeded";
const OVERRIDE_RATE_EVENT = "integrity.override_rate_exceeded";
const REACHED_STATUSES = new Set<Doc<"notifications">["status"]>(["sent", "delivered"]);
const ATTEMPTED_STATUSES = new Set<Doc<"notifications">["status"]>(["sent", "delivered", "failed"]);

type DateRange = { from: string; to: string };

type SchoolRow = SchoolVarianceRow & { schoolId: Id<"schools"> };

type ProgrammeTotals = { schoolsActive: number; mealsServed: number; guardiansReached: number; deliverabilityPct: number };

type Thresholds = { varianceTolerancePct: number; varianceStreakDays: number; overrideTolerancePct: number };

async function readThresholds(ctx: QueryCtx): Promise<Thresholds> {
  return {
    varianceTolerancePct: await readNumberSetting(ctx, SettingKey.VarianceTolerancePct, DEFAULT_VARIANCE_TOLERANCE_PCT),
    varianceStreakDays: await readNumberSetting(ctx, SettingKey.VarianceStreakDays, DEFAULT_VARIANCE_STREAK_DAYS),
    overrideTolerancePct: await overrideTolerancePct(ctx),
  };
}

// Newest first, so the streak walk starts at `to` and stops at the first
// in-tolerance day. Non-school days have no row and are skipped by construction.
export async function reconciliationsNewestFirst(ctx: QueryCtx, schoolId: Id<"schools">, range: DateRange): Promise<Doc<"reconciliations">[]> {
  return await ctx.db
    .query("reconciliations")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", schoolId).gte("serviceDate", range.from).lte("serviceDate", range.to))
    .order("desc")
    .take(MAX_RECONCILIATION_DAYS);
}

async function streakAt(ctx: QueryCtx, schoolId: Id<"schools">, to: string, tolerancePct: number): Promise<number> {
  const rows = await reconciliationsNewestFirst(ctx, schoolId, { from: addDays(to, -(MAX_RECONCILIATION_DAYS - 1)), to });
  return varianceStreak(rows.map((row) => row.variancePct), tolerancePct);
}

async function schoolRow(ctx: QueryCtx, school: Doc<"schools">, range: DateRange, tolerancePct: number): Promise<SchoolRow> {
  const rows = await reconciliationsNewestFirst(ctx, school._id, range);
  const dispatched = rows.reduce((sum, row) => sum + row.dispatched, 0);
  const confirmed = rows.reduce((sum, row) => sum + row.confirmed, 0);
  const consumed = rows.reduce((sum, row) => sum + row.consumed, 0);
  return {
    schoolId: school._id,
    schoolCode: school.code,
    schoolName: school.name,
    days: rows.length,
    dispatched,
    confirmed,
    consumed,
    ...computeVariance(confirmed, consumed),
    streakDays: await streakAt(ctx, school._id, range.to, tolerancePct),
    overrideRatePct: (await overrideRate(ctx, { schoolId: school._id, to: range.to })).ratePct,
  };
}

// GV-07: programme totals over the period. Guardians reached is distinct
// recipients of a sent/delivered message; deliverability is delivered over
// attempted. ponytail: capped scan of the period's notifications; aggregate
// component once a period exceeds the cap.
async function programmeTotals(ctx: QueryCtx, rows: SchoolRow[], range: DateRange): Promise<ProgrammeTotals> {
  const fromMs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toMs = Date.parse(`${addDays(range.to, 1)}T00:00:00.000Z`);
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_creation_time", (q) => q.gte("_creationTime", fromMs).lt("_creationTime", toMs))
    .take(NOTIFICATION_SCAN_CAP);
  const reached = new Set<Id<"guardians">>();
  let attempted = 0;
  let delivered = 0;
  for (const notification of notifications) {
    if (REACHED_STATUSES.has(notification.status)) {
      reached.add(notification.guardianId);
    }
    if (ATTEMPTED_STATUSES.has(notification.status)) {
      attempted += 1;
    }
    if (notification.status === "delivered") {
      delivered += 1;
    }
  }
  return {
    schoolsActive: rows.length,
    mealsServed: rows.reduce((sum, row) => sum + row.consumed, 0),
    guardiansReached: reached.size,
    deliverabilityPct: attempted === 0 ? 0 : Math.round((delivered / attempted) * PERCENT),
  };
}

export type CountyOverview = { rows: SchoolRow[]; totals: ProgrammeTotals; thresholds: Thresholds };

export async function countyOverview(ctx: QueryCtx, range: DateRange): Promise<CountyOverview> {
  const thresholds = await readThresholds(ctx);
  const schools = (await ctx.db.query("schools").take(MAX_SCHOOLS)).filter((school) => school.active);
  const rows: SchoolRow[] = [];
  for (const school of schools) {
    rows.push(await schoolRow(ctx, school, range, thresholds.varianceTolerancePct));
  }
  const ranked = rankByVariance(rows);
  return { rows: ranked, totals: await programmeTotals(ctx, ranked, range), thresholds };
}

async function emitOnce(ctx: MutationCtx, event: { eventId: string; type: string; schoolId: Id<"schools">; serviceDate: string; payload: Record<string, string | number> }): Promise<boolean> {
  const already = await ctx.db
    .query("events")
    .withIndex("by_eventId", (q) => q.eq("eventId", event.eventId))
    .unique();
  if (already) {
    return false;
  }
  const now = Date.now();
  await recordEvent(ctx, {
    eventId: event.eventId,
    type: event.type,
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: event.eventId,
    payload: { school_id: event.schoolId, ...event.payload },
    schoolId: event.schoolId,
    serviceDate: event.serviceDate,
  });
  return true;
}

// GV-03 / GV-04 / FR-705: runs after each daily reconciliation. Variance
// streak and override rate are checked against their tolerances; each alert
// fires at most once per school per service day, so a recompute is a no-op.
export async function flagIntegrity(ctx: MutationCtx, args: { schoolId: Id<"schools">; serviceDate: string }): Promise<{ varianceExceeded: boolean; overrideRateExceeded: boolean }> {
  const thresholds = await readThresholds(ctx);
  const streakDays = await streakAt(ctx, args.schoolId, args.serviceDate, thresholds.varianceTolerancePct);
  const rate = await overrideRate(ctx, { schoolId: args.schoolId, to: args.serviceDate });
  let varianceExceeded = false;
  let overrideRateExceeded = false;
  if (streakDays >= thresholds.varianceStreakDays) {
    const latest = (await reconciliationsNewestFirst(ctx, args.schoolId, { from: args.serviceDate, to: args.serviceDate }))[0];
    varianceExceeded = await emitOnce(ctx, {
      eventId: `${VARIANCE_EVENT}:${args.schoolId}:${args.serviceDate}`,
      type: VARIANCE_EVENT,
      schoolId: args.schoolId,
      serviceDate: args.serviceDate,
      payload: { variance_pct: latest?.variancePct ?? 0, streak_days: streakDays },
    });
  }
  if (rate.ratePct > rate.tolerancePct) {
    overrideRateExceeded = await emitOnce(ctx, {
      eventId: `${OVERRIDE_RATE_EVENT}:${args.schoolId}:${args.serviceDate}`,
      type: OVERRIDE_RATE_EVENT,
      schoolId: args.schoolId,
      serviceDate: args.serviceDate,
      payload: { override_pct: rate.ratePct, period: `${rate.from}/${rate.to}` },
    });
  }
  return { varianceExceeded, overrideRateExceeded };
}

const schoolRowValidator = v.object({
  schoolId: v.id("schools"),
  schoolCode: v.string(),
  schoolName: v.string(),
  days: v.number(),
  dispatched: v.number(),
  confirmed: v.number(),
  consumed: v.number(),
  variance: v.number(),
  variancePct: v.number(),
  streakDays: v.number(),
  overrideRatePct: v.number(),
});

export const overview = query({
  args: { from: v.string(), to: v.string() },
  returns: v.object({
    rows: v.array(schoolRowValidator),
    totals: v.object({ schoolsActive: v.number(), mealsServed: v.number(), guardiansReached: v.number(), deliverabilityPct: v.number() }),
    thresholds: v.object({ varianceTolerancePct: v.number(), varianceStreakDays: v.number(), overrideTolerancePct: v.number() }),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, COUNTY_ROLES);
    return await countyOverview(ctx, args);
  },
});

// GV-08 / FR-703: any figure on the county screen resolves to the events
// behind it — same school, same event type, same period.
export const eventsFor = query({
  args: { schoolId: v.id("schools"), type: v.string(), from: v.string(), to: v.string() },
  returns: v.array(
    v.object({ _id: v.id("events"), eventId: v.string(), occurredAt: v.number(), serviceDate: v.optional(v.string()), correlationId: v.string(), payload: eventPayload }),
  ),
  handler: async (ctx, args) => {
    await requireRole(ctx, COUNTY_ROLES);
    const rows = await ctx.db
      .query("events")
      .withIndex("by_school_type_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("type", args.type).gte("serviceDate", args.from).lte("serviceDate", args.to))
      .order("desc")
      .take(DRILL_CAP);
    return rows.map((row) => ({ _id: row._id, eventId: row.eventId, occurredAt: row.occurredAt, serviceDate: row.serviceDate, correlationId: row.correlationId, payload: row.payload }));
  },
});
