import { dispatchDelivery, dispatchArgs as newDispatchArgs } from "./deliveryWorkflow";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { dayAttendanceSummary } from "./attendance";
import { flagIntegrity } from "./county";
import { countExpectations, isSchoolDay } from "./expectations";
import { requireRole, requireSchoolScope } from "./lib/authz";
import { addDays, toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { sha256Hex } from "./lib/hmac";
import {
  computeVariance,
  forecastPortions,
  mintConfirmCode,
  normaliseConfirmCode,
  toPaymentCsv,
  type DayConsumption,
  type PaymentLine,
} from "./lib/supply";
import { deliveryStatus, forecastConfidence } from "./schema";
import { readNumberSetting, SettingKey } from "./settings";

const SCHEMA_VERSION = 1;
const MILLISECONDS_PER_MINUTE = 60_000;
const DEFAULT_CONFIRM_WINDOW_MINUTES = 120;
const DEFAULT_PORTION_RATE_KES = 25;
const FORECAST_LOOKBACK_DAYS = 14;
const ACTIVE_STUDENT_READ_CAP = 1000;
const MAX_DELIVERIES_PER_DAY = 100;
const MAX_SCHOOLS = 100;
const MAX_PAYMENT_LINES = 1000;
const CONSUMPTION_PAGE_SIZE = 200;

const DISPATCH_ROLES = ["supplier", "admin"] as const;
const CONFIRM_ROLES = ["school", "admin"] as const;
const SCHOOL_PICKER_ROLES = ["supplier", "county", "admin"] as const;
const PAYMENT_FILE_ROLES = ["county", "admin"] as const;

export const DeliveryFailure = {
  UnknownSchool: "UNKNOWN_SCHOOL",
  InvalidPortions: "INVALID_PORTIONS",
  UnknownCode: "UNKNOWN_CODE",
} as const;


const resolveArgs = {
  schoolId: v.id("schools"),
  code: v.string(),
  portionsReceived: v.number(),
  action: v.union(v.literal("confirm"), v.literal("dispute")),
  note: v.optional(v.string()),
};

const forecastResultValidator = v.union(
  v.literal("not_school_day"),
  v.object({ portions: v.number(), confidence: forecastConfidence }),
);

const reconciliationResultValidator = v.union(
  v.object({ status: v.literal("chained") }),
  v.object({
    status: v.literal("computed"),
    dispatched: v.number(),
    confirmed: v.number(),
    received: v.optional(v.number()),
    consumed: v.number(),
    variance: v.number(),
    variancePct: v.number(),
  }),
);

type ReconciliationResult =
  | { status: "chained" }
  | { status: "computed"; dispatched: number; confirmed: number; consumed: number; variance: number; variancePct: number };

type DispatchArgs = {
  actor: Doc<"users">;
  schoolId: Id<"schools">;
  serviceDate: string;
  portions: number;
  vehicle?: string;
  docketRef: string;
  dispatchedAt?: number;
};

type ResolveArgs = {
  actor: Doc<"users">;
  schoolId: Id<"schools">;
  code: string;
  portionsReceived: number;
  action: "confirm" | "dispute";
  note?: string;
};

async function hashConfirmCode(schoolId: Id<"schools">, code: string): Promise<string> {
  return await sha256Hex(`${schoolId}:${normaliseConfirmCode(code)}`);
}

type DeliveryEvent = { type: string; delivery: Doc<"deliveries">; payload: Record<string, string | number>; now: number };

async function emitDeliveryEvent(ctx: MutationCtx, event: DeliveryEvent): Promise<void> {
  await recordEvent(ctx, {
    eventId: `${event.type}:${event.delivery._id}`,
    type: event.type,
    occurredAt: event.now,
    recordedAt: event.now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: event.delivery._id,
    payload: { delivery_id: event.delivery._id, school_id: event.delivery.schoolId, ...event.payload },
    schoolId: event.delivery.schoolId,
    serviceDate: event.delivery.serviceDate,
  });
}

// FR-603 / SU-02: the declaration mints the one-time code the school will
// confirm with (SC-02); only its hash is stored. The unconfirmed sweep is
// scheduled here, at the expected confirmation time, like the meal sweep.
export async function declareDispatch(ctx: MutationCtx, args: DispatchArgs): Promise<{ deliveryId: Id<"deliveries">; confirmCode: string }> {
  if (!Number.isInteger(args.portions) || args.portions <= 0) {
    throw new ConvexError(DeliveryFailure.InvalidPortions);
  }
  if (!(await ctx.db.get(args.schoolId))) {
    throw new ConvexError(DeliveryFailure.UnknownSchool);
  }
  const now = Date.now();
  const dispatchedAt = args.dispatchedAt ?? now;
  const confirmWindowMinutes = await readNumberSetting(ctx, SettingKey.DeliveryConfirmWindowMinutes, DEFAULT_CONFIRM_WINDOW_MINUTES);
  const confirmCode = mintConfirmCode();
  const deliveryId = await ctx.db.insert("deliveries", {
    schoolId: args.schoolId,
    serviceDate: args.serviceDate,
    portions: args.portions,
    vehicle: args.vehicle,
    docketRef: args.docketRef,
    dispatchedAt,
    declaredBy: args.actor._id,
    confirmCodeHash: await hashConfirmCode(args.schoolId, confirmCode),
    expectedConfirmBy: dispatchedAt + confirmWindowMinutes * MILLISECONDS_PER_MINUTE,
    status: "declared",
  });
  const delivery = (await ctx.db.get(deliveryId))!;
  await emitDeliveryEvent(ctx, {
    type: "delivery.dispatched",
    delivery,
    now,
    payload: { portions: args.portions, vehicle: args.vehicle ?? "", dispatched_at: dispatchedAt, docket_ref: args.docketRef },
  });
  await ctx.scheduler.runAt(delivery.expectedConfirmBy, internal.deliveries.sweepUnconfirmed, { deliveryId });
  return { deliveryId, confirmCode };
}

// FR-604 / SU-03: confirmation is by the receiving school, by code. A replayed
// confirmation of an already-resolved delivery changes nothing.
// ponytail: code lookup is .unique() per school; a same-day collision within
// one school throws — regenerate on the supplier side if it ever happens.
export async function resolveDelivery(ctx: MutationCtx, args: ResolveArgs): Promise<{ deliveryId: Id<"deliveries">; status: Doc<"deliveries">["status"] }> {
  if (!Number.isSafeInteger(args.portionsReceived) || args.portionsReceived < 0) throw new ConvexError(DeliveryFailure.InvalidPortions);
  const hash = await hashConfirmCode(args.schoolId, args.code);
  const delivery = await ctx.db
    .query("deliveries")
    .withIndex("by_school_confirmCodeHash", (q) => q.eq("schoolId", args.schoolId).eq("confirmCodeHash", hash))
    .unique();
  if (!delivery || delivery.workflowVersion === 2) {
    throw new ConvexError(DeliveryFailure.UnknownCode);
  }
  if (delivery.status === "confirmed" || delivery.status === "disputed") {
    return { deliveryId: delivery._id, status: delivery.status };
  }
  const status = args.action === "confirm" ? "confirmed" : "disputed";
  const now = Date.now();
  await ctx.db.patch(delivery._id, {
    status,
    portionsReceived: args.portionsReceived,
    resolvedBy: args.actor._id,
    resolvedAt: now,
    note: args.note,
  });
  await emitDeliveryEvent(ctx, {
    type: `delivery.${status}`,
    delivery,
    now,
    payload: { portions_received: args.portionsReceived, confirmed_by: args.actor._id, note: args.note ?? "" },
  });
  return { deliveryId: delivery._id, status };
}

// FR-605 / SU-05: absence class — a declared delivery nobody confirmed by the
// expected time. A late confirmation still lands (unconfirmed → confirmed).
export const sweepUnconfirmed = internalMutation({
  args: { deliveryId: v.id("deliveries") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "declared") {
      return false;
    }
    await ctx.db.patch(delivery._id, { status: "unconfirmed" });
    await emitDeliveryEvent(ctx, {
      type: "delivery.unconfirmed",
      delivery,
      now: Date.now(),
      payload: { expected_by: delivery.expectedConfirmBy, portions: delivery.portions },
    });
    return true;
  },
});

export const declare = mutation({
  args: newDispatchArgs,
  handler: async (ctx, args) => dispatchDelivery(ctx, await requireRole(ctx, DISPATCH_ROLES), args),
});

export const resolve = mutation({
  args: resolveArgs,
  returns: v.object({ deliveryId: v.id("deliveries"), status: deliveryStatus }),
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, CONFIRM_ROLES);
    if (actor.role === "admin" && !args.note?.trim()) throw new ConvexError("A reason is required for central-admin confirmation.");
    await requireSchoolScope(ctx, args.schoolId);
    return await resolveDelivery(ctx, { actor, ...args });
  },
});

export const listForSchoolDay = query({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("deliveries"),
      portions: v.number(),
      vehicle: v.optional(v.string()),
      docketRef: v.string(),
      dispatchedAt: v.number(),
      expectedConfirmBy: v.number(),
      status: deliveryStatus,
      portionsReceived: v.optional(v.number()),
      note: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const rows = await ctx.db
      .query("deliveries")
      .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
      .take(MAX_DELIVERIES_PER_DAY);
    return rows.map((row) => ({
      _id: row._id,
      portions: row.portions,
      vehicle: row.vehicle,
      docketRef: row.docketRef,
      dispatchedAt: row.dispatchedAt,
      expectedConfirmBy: row.expectedConfirmBy,
      status: row.status,
      portionsReceived: row.portionsReceived,
      note: row.note,
    }));
  },
});

export const listSchools = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("schools"), code: v.string(), name: v.string() })),
  handler: async (ctx) => {
    await requireRole(ctx, SCHOOL_PICKER_ROLES);
    const schools = await ctx.db.query("schools").take(MAX_SCHOOLS);
    return schools.filter((school) => school.active).map((school) => ({ _id: school._id, code: school.code, name: school.name }));
  },
});

// FR-602: trailing consumption per day, read from the expectations table.
// ponytail: 3 capped index reads per lookback day; fine until aggregate time.
async function trailingConsumption(ctx: QueryCtx, schoolId: Id<"schools">, serviceDate: string): Promise<DayConsumption[]> {
  const history: DayConsumption[] = [];
  for (let offset = FORECAST_LOOKBACK_DAYS; offset >= 1; offset -= 1) {
    const day = addDays(serviceDate, -offset);
    const fulfilled = await countExpectations(ctx, { schoolId, serviceDate: day, status: "fulfilled" });
    const missed = await countExpectations(ctx, { schoolId, serviceDate: day, status: "missed" });
    const pending = await countExpectations(ctx, { schoolId, serviceDate: day, status: "pending" });
    history.push({ serviceDate: day, expected: fulfilled + missed + pending, fulfilled });
  }
  return history;
}

// FR-601 / SU-01 / SC-01: one forecast row per school per service day; the
// event fires on first publication, a recompute only refreshes the row.
export async function publishForecast(
  ctx: MutationCtx,
  args: { schoolId: Id<"schools">; serviceDate: string },
): Promise<"not_school_day" | { portions: number; confidence: Doc<"forecasts">["confidence"] }> {
  if (!(await isSchoolDay(ctx, args.serviceDate))) {
    return "not_school_day";
  }
  const activeStudents = await ctx.db
    .query("students")
    .withIndex("by_school_status", (q) => q.eq("schoolId", args.schoolId).eq("status", "active"))
    .take(ACTIVE_STUDENT_READ_CAP);
  const forecast = forecastPortions({
    activeStudents: activeStudents.length,
    history: await trailingConsumption(ctx, args.schoolId, args.serviceDate),
    serviceDate: args.serviceDate,
  });
  const now = Date.now();
  const existing = await ctx.db
    .query("forecasts")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { ...forecast, computedAt: now });
    return forecast;
  }
  const forecastId = await ctx.db.insert("forecasts", { ...args, ...forecast, computedAt: now });
  await recordEvent(ctx, {
    eventId: `demand.forecast_published:${args.schoolId}:${args.serviceDate}`,
    type: "demand.forecast_published",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: forecastId,
    payload: { school_id: args.schoolId, service_date: args.serviceDate, portions_forecast: forecast.portions, confidence: forecast.confidence },
    schoolId: args.schoolId,
    serviceDate: args.serviceDate,
  });
  return forecast;
}

export const publishForecastFor = internalMutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: forecastResultValidator,
  handler: async (ctx, args) => await publishForecast(ctx, args),
});

async function forEachActiveSchool(ctx: MutationCtx, visit: (schoolId: Id<"schools">) => Promise<void>): Promise<number> {
  const schools = await ctx.db.query("schools").take(MAX_SCHOOLS);
  const active = schools.filter((school) => school.active);
  for (const school of active) {
    await visit(school._id);
  }
  return active.length;
}

// Cron entry (overnight): tomorrow's forecast for every active school.
export const publishForecastsForAllSchools = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const serviceDate = addDays(toServiceDate(Date.now()), 1);
    return await forEachActiveSchool(ctx, async (schoolId) => {
      await ctx.scheduler.runAfter(0, internal.deliveries.publishForecastFor, { schoolId, serviceDate });
    });
  },
});

export const runForecastNow = mutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: forecastResultValidator,
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await publishForecast(ctx, args);
  },
});

export const forecastFor = query({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.union(v.null(), v.object({ portions: v.number(), confidence: forecastConfidence, computedAt: v.number() })),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const row = await ctx.db
      .query("forecasts")
      .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
      .unique();
    return row ? { portions: row.portions, confidence: row.confidence, computedAt: row.computedAt } : null;
  },
});

type ReconcileArgs = { schoolId: Id<"schools">; serviceDate: string; cursor: string | null; consumedSoFar: number };

async function finaliseReconciliation(ctx: MutationCtx, args: ReconcileArgs): Promise<ReconciliationResult> {
  const deliveries = await ctx.db
    .query("deliveries")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
    .take(MAX_DELIVERIES_PER_DAY);
  const dispatched = deliveries.reduce((sum, row) => sum + row.portions, 0);
  const confirmed = deliveries.filter((row) => row.status === "confirmed").reduce((sum, row) => sum + (row.portionsReceived ?? 0), 0);
  const received = deliveries.reduce((sum, row) => sum + (row.portionsReceived ?? 0), 0);
  const totals = { dispatched, confirmed, received, consumed: args.consumedSoFar, ...computeVariance(confirmed, args.consumedSoFar) };
  const attendance = await dayAttendanceSummary(ctx, args);
  const now = Date.now();
  const existing = await ctx.db
    .query("reconciliations")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
    .unique();
  let reconciliationId: Id<"reconciliations">;
  if (existing) {
    await ctx.db.patch(existing._id, { ...totals, attendance, computedAt: now });
    reconciliationId = existing._id;
  } else {
    reconciliationId = await ctx.db.insert("reconciliations", { schoolId: args.schoolId, serviceDate: args.serviceDate, ...totals, attendance, computedAt: now });
  }
  await recordEvent(ctx, {
    eventId: `reconciliation.daily_computed:${reconciliationId}:${now}`,
    type: "reconciliation.daily_computed",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: reconciliationId,
    payload: { school_id: args.schoolId, service_date: args.serviceDate, ...totals },
    schoolId: args.schoolId,
    serviceDate: args.serviceDate,
  });
  await flagIntegrity(ctx, {
    schoolId: args.schoolId,
    serviceDate: args.serviceDate,
    consumed: totals.consumed,
    received: deliveries.length > 0 ? received : null,
  });
  return { status: "computed", ...totals };
}

// FR-606: the cross-stream join. Consumption is paged over fulfilled
// expectations and chained through the scheduler; the delivery stream is
// small per school-day and joined on the last page.
async function reconcilePage(ctx: MutationCtx, args: ReconcileArgs): Promise<ReconciliationResult> {
  const page = await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) =>
      q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate).eq("status", "fulfilled"),
    )
    .paginate({ numItems: CONSUMPTION_PAGE_SIZE, cursor: args.cursor });
  const consumedSoFar = args.consumedSoFar + page.page.length;
  if (page.isDone) {
    return await finaliseReconciliation(ctx, { ...args, consumedSoFar });
  }
  await ctx.scheduler.runAfter(0, internal.deliveries.reconcilePageFor, { ...args, cursor: page.continueCursor, consumedSoFar });
  return { status: "chained" };
}

export const reconcilePageFor = internalMutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string(), cursor: v.union(v.string(), v.null()), consumedSoFar: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => await reconcilePage(ctx, args),
});

export async function reconcileDay(ctx: MutationCtx, args: { schoolId: Id<"schools">; serviceDate: string }): Promise<ReconciliationResult> {
  return await reconcilePage(ctx, { ...args, cursor: null, consumedSoFar: 0 });
}

// Cron entry (after the last cutoff): today's reconciliation for every school.
export const reconcileAllSchools = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const serviceDate = toServiceDate(Date.now());
    return await forEachActiveSchool(ctx, async (schoolId) => {
      await ctx.scheduler.runAfter(0, internal.deliveries.reconcilePageFor, { schoolId, serviceDate, cursor: null, consumedSoFar: 0 });
    });
  },
});

export const runReconciliationNow = mutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await reconcileDay(ctx, args);
  },
});

export const reconciliationFor = query({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.union(
    v.null(),
    v.object({ dispatched: v.number(), confirmed: v.number(), received: v.optional(v.number()), consumed: v.number(), variance: v.number(), variancePct: v.number(), computedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const row = await ctx.db
      .query("reconciliations")
      .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
      .unique();
    if (!row) {
      return null;
    }
    return { dispatched: row.dispatched, confirmed: row.confirmed, received: row.received, consumed: row.consumed, variance: row.variance, variancePct: row.variancePct, computedAt: row.computedAt };
  },
});

// FR-608 / SU-07: the payment file is derived from confirmed deliveries and
// nothing else — a declared-but-unconfirmed dispatch has no line.
export async function paymentLines(ctx: QueryCtx, range: { from: string; to: string }): Promise<PaymentLine[]> {
  const rateKes = await readNumberSetting(ctx, SettingKey.SupplierPortionRateKes, DEFAULT_PORTION_RATE_KES);
  const confirmed = await ctx.db
    .query("deliveries")
    .withIndex("by_status_serviceDate", (q) => q.eq("status", "confirmed").gte("serviceDate", range.from).lte("serviceDate", range.to))
    .take(MAX_PAYMENT_LINES);
  const schoolCodes = new Map<Id<"schools">, string>();
  const lines: PaymentLine[] = [];
  for (const delivery of confirmed) {
    if (!schoolCodes.has(delivery.schoolId)) {
      schoolCodes.set(delivery.schoolId, (await ctx.db.get(delivery.schoolId))?.code ?? "");
    }
    const portionsConfirmed = delivery.portionsReceived ?? 0;
    lines.push({
      schoolCode: schoolCodes.get(delivery.schoolId) ?? "",
      serviceDate: delivery.serviceDate,
      docketRef: delivery.docketRef,
      portionsConfirmed,
      rateKes,
      amountKes: portionsConfirmed * rateKes,
    });
  }
  return lines;
}

const paymentLineValidator = v.object({
  schoolCode: v.string(),
  serviceDate: v.string(),
  docketRef: v.string(),
  portionsConfirmed: v.number(),
  rateKes: v.number(),
  amountKes: v.number(),
});

export const paymentFile = query({
  args: { from: v.string(), to: v.string() },
  returns: v.object({ lines: v.array(paymentLineValidator), csv: v.string() }),
  handler: async (ctx, args) => {
    await requireRole(ctx, PAYMENT_FILE_ROLES);
    const lines = await paymentLines(ctx, args);
    return { lines, csv: toPaymentCsv(lines) };
  },
});
