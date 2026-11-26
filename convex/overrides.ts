import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { fulfilExpectation } from "./expectations";
import { requireSchoolScope } from "./lib/authz";
import { addDays, toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { overrideReason } from "./schema";
import { readNumberSetting, readSetting, SettingKey } from "./settings";
import { debitForMeal } from "./wallets";

const SCHEMA_VERSION = 1;
const OVERRIDE_EVENT = "meal.override_served";
const TAP_EVENT = "meal.tapped";
const RATE_LOOKBACK_DAYS = 14;
const RATE_READ_CAP = 5000;
const DEFAULT_OVERRIDE_TOLERANCE_PCT = 15;
const PERCENT = 100;
const MAX_DELIVERIES_PER_DAY = 100;

export const OverrideFailure = {
  StudentNotInSchool: "student_not_in_school",
  StudentInactive: "student_inactive",
  NoSupply: "no_supply",
} as const;

type OverrideReason = Infer<typeof overrideReason>;

type OverrideArgs = { actor: Doc<"users">; schoolId: Id<"schools">; studentId: Id<"students">; reasonCode: OverrideReason };

type OverrideResult = { status: "served" | "already_served"; serviceDate: string };

// ST-04: the meal already counted today, by tap or by override, if any.
export async function mealServedOn(ctx: QueryCtx, studentId: Id<"students">, serviceDate: string): Promise<Doc<"events"> | null> {
  for (const type of [TAP_EVENT, OVERRIDE_EVENT]) {
    const hit = await ctx.db
      .query("events")
      .withIndex("by_student_serviceDate_type", (q) => q.eq("studentId", studentId).eq("serviceDate", serviceDate).eq("type", type))
      .first();
    if (hit) {
      return hit;
    }
  }
  return null;
}

export type SupplyStatus = { supplied: boolean; portions: number; dishes: string[] };

// No supply, no service: a school serves only once it has recorded receiving
// a supplier delivery for that day. `serviceRequiresSupply: false` is the
// admin's escape hatch for a supplier-side outage.
export async function supplyFor(ctx: QueryCtx, schoolId: Id<"schools">, serviceDate: string): Promise<SupplyStatus> {
  const deliveries = await ctx.db
    .query("deliveries")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", schoolId).eq("serviceDate", serviceDate))
    .take(MAX_DELIVERIES_PER_DAY);
  const received = deliveries.filter((delivery) => (delivery.portionsReceived ?? 0) > 0);
  const gateOff = (await readSetting(ctx, SettingKey.ServiceRequiresSupply)) === false;
  return {
    supplied: gateOff || received.length > 0,
    portions: received.reduce((sum, delivery) => sum + (delivery.portionsReceived ?? 0), 0),
    dishes: [...new Set(received.flatMap((delivery) => (delivery.dish ? [delivery.dish] : [])))],
  };
}

export const supplyToday = query({
  args: { schoolId: v.id("schools") },
  returns: v.object({ serviceDate: v.string(), supplied: v.boolean(), portions: v.number(), dishes: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const serviceDate = toServiceDate(Date.now());
    return { serviceDate, ...(await supplyFor(ctx, args.schoolId, serviceDate)) };
  },
});

// FR-205 / ST-03 / NFR-405: a staff-served meal is a countable meal with a
// reason and an accountable staff id. ST-04 still holds — one meal per day,
// whether it arrived by tap or override.
export async function serveByOverride(ctx: MutationCtx, args: OverrideArgs): Promise<OverrideResult> {
  const student = await ctx.db.get(args.studentId);
  if (!student || student.schoolId !== args.schoolId) {
    throw new ConvexError(OverrideFailure.StudentNotInSchool);
  }
  if (student.status !== "active") {
    throw new ConvexError(OverrideFailure.StudentInactive);
  }
  const now = Date.now();
  const serviceDate = toServiceDate(now);
  if (await mealServedOn(ctx, student._id, serviceDate)) {
    return { status: "already_served", serviceDate };
  }
  if (!(await supplyFor(ctx, args.schoolId, serviceDate)).supplied) {
    throw new ConvexError(OverrideFailure.NoSupply);
  }
  const eventId = `${OVERRIDE_EVENT}:${student._id}:${serviceDate}`;
  await recordEvent(ctx, {
    eventId,
    type: OVERRIDE_EVENT,
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: eventId,
    payload: { student_id: student._id, reason_code: args.reasonCode, staff_id: args.actor._id },
    schoolId: student.schoolId,
    studentId: student._id,
    serviceDate,
  });
  await fulfilExpectation(ctx, student._id, serviceDate);
  await debitForMeal(ctx, { student, eventId, correlationId: eventId, now });
  return { status: "served", serviceDate };
}

export const serve = mutation({
  args: { schoolId: v.id("schools"), studentId: v.id("students"), reasonCode: overrideReason },
  returns: v.object({ status: v.union(v.literal("served"), v.literal("already_served")), serviceDate: v.string() }),
  handler: async (ctx, args) => {
    const actor = await requireSchoolScope(ctx, args.schoolId);
    return await serveByOverride(ctx, { actor, ...args });
  },
});

async function countSchoolEvents(ctx: QueryCtx, key: { schoolId: Id<"schools">; type: string; from: string; to: string }): Promise<number> {
  const rows = await ctx.db
    .query("events")
    .withIndex("by_school_type_serviceDate", (q) => q.eq("schoolId", key.schoolId).eq("type", key.type).gte("serviceDate", key.from).lte("serviceDate", key.to))
    .take(RATE_READ_CAP);
  return rows.length;
}

export async function overrideTolerancePct(ctx: QueryCtx): Promise<number> {
  return await readNumberSetting(ctx, SettingKey.OverrideRateTolerancePct, DEFAULT_OVERRIDE_TOLERANCE_PCT);
}

export type OverrideRate = { overrides: number; served: number; ratePct: number; tolerancePct: number; from: string; to: string };

// SC-05 / GV-04: the school sees its own rate. Shared with the county view.
// ponytail: two capped index reads over the trailing window; aggregate later.
export async function overrideRate(ctx: QueryCtx, args: { schoolId: Id<"schools">; to: string }): Promise<OverrideRate> {
  const from = addDays(args.to, -(RATE_LOOKBACK_DAYS - 1));
  const overrides = await countSchoolEvents(ctx, { schoolId: args.schoolId, type: OVERRIDE_EVENT, from, to: args.to });
  const taps = await countSchoolEvents(ctx, { schoolId: args.schoolId, type: TAP_EVENT, from, to: args.to });
  const served = overrides + taps;
  return {
    overrides,
    served,
    ratePct: served === 0 ? 0 : Math.round((overrides / served) * PERCENT),
    tolerancePct: await overrideTolerancePct(ctx),
    from,
    to: args.to,
  };
}

export const rateForSchool = query({
  args: { schoolId: v.id("schools"), to: v.string() },
  returns: v.object({ overrides: v.number(), served: v.number(), ratePct: v.number(), tolerancePct: v.number(), from: v.string(), to: v.string() }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await overrideRate(ctx, args);
  },
});
