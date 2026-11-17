import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { addDays, toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { compareThreshold, projectDepletion } from "./lib/wallet/threshold";
import type { eventPayload } from "./schema";
import { readNumberSetting, readSetting, SettingKey } from "./settings";

const SCHEMA_VERSION = 1;
const DEFAULT_MEAL_PRICE_KES = 5;
const DEFAULT_LOW_BALANCE_THRESHOLD_KES = 50;
const DEFAULT_RE_ARM_MARGIN_KES = 20;
const DEFAULT_FORECAST_LEAD_SCHOOL_DAYS = 3;
const BURN_RATE_LOOKBACK_DAYS = 14;
const CALENDAR_LOOKAHEAD_ROWS = 30;
const ASSUMED_MEALS_PER_SCHOOL_DAY = 1;

export const paymentEventValidator = v.object({
  externalRef: v.string(),
  schoolCode: v.string(),
  studentRef: v.string(),
  amountKes: v.number(),
  newBalanceKes: v.optional(v.number()),
  occurredAt: v.optional(v.number()),
});

type BalanceChange = {
  wallet: Doc<"wallets">;
  student: Doc<"students">;
  newBalanceKes: number;
  causeEventId: string;
  correlationId: string;
  now: number;
};

type WalletEvent = {
  type: string;
  eventId: string;
  payload: Infer<typeof eventPayload>;
};

async function emitWalletEvent(
  ctx: MutationCtx,
  change: BalanceChange,
  event: WalletEvent,
): Promise<void> {
  await recordEvent(ctx, {
    eventId: event.eventId,
    type: event.type,
    occurredAt: change.now,
    recordedAt: change.now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: change.correlationId,
    payload: { student_id: change.student._id, ...event.payload },
    schoolId: change.student.schoolId,
    studentId: change.student._id,
    serviceDate: toServiceDate(change.now),
  });
}

// FR-304: observed meals per possible school day over the trailing window;
// a child with no history is assumed to eat every school day.
async function mealsPerSchoolDay(
  ctx: MutationCtx,
  change: BalanceChange,
): Promise<number> {
  const today = toServiceDate(change.now);
  const rows = await ctx.db
    .query("expectations")
    .withIndex("by_student_serviceDate", (q) =>
      q
        .eq("studentId", change.student._id)
        .gte("serviceDate", addDays(today, -BURN_RATE_LOOKBACK_DAYS))
        .lte("serviceDate", today),
    )
    .collect();
  if (rows.length === 0) {
    return ASSUMED_MEALS_PER_SCHOOL_DAY;
  }
  return rows.filter((row) => row.status === "fulfilled").length / rows.length;
}

async function upcomingSchoolDays(
  ctx: MutationCtx,
  now: number,
): Promise<string[]> {
  if ((await readSetting(ctx, SettingKey.TreatEveryDayAsSchoolDay)) === true) {
    return Array.from({ length: CALENDAR_LOOKAHEAD_ROWS }, (_, index) =>
      addDays(toServiceDate(now), index + 1),
    );
  }
  const rows = await ctx.db
    .query("academicCalendar")
    .withIndex("by_serviceDate", (q) => q.gt("serviceDate", toServiceDate(now)))
    .take(CALENDAR_LOOKAHEAD_ROWS);
  return rows.filter((row) => row.isSchoolDay).map((row) => row.serviceDate);
}

// P-04: one forecast per (student, projected date) — the eventId is the dedupe.
async function forecastDepletion(
  ctx: MutationCtx,
  change: BalanceChange,
): Promise<void> {
  const leadSchoolDays = await readNumberSetting(
    ctx,
    SettingKey.DepletionForecastLeadSchoolDays,
    DEFAULT_FORECAST_LEAD_SCHOOL_DAYS,
  );
  const forecast = projectDepletion({
    balanceKes: change.newBalanceKes,
    mealPriceKes: await readNumberSetting(
      ctx,
      SettingKey.MealPriceKes,
      DEFAULT_MEAL_PRICE_KES,
    ),
    mealsPerSchoolDay: await mealsPerSchoolDay(ctx, change),
    upcomingSchoolDays: await upcomingSchoolDays(ctx, change.now),
  });
  if (
    forecast.projectedDate === null ||
    forecast.schoolDaysCovered > leadSchoolDays
  ) {
    return;
  }
  const eventId = `wallet.depletion_forecast:${change.student._id}:${forecast.projectedDate}`;
  const existing = await ctx.db
    .query("events")
    .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
    .unique();
  if (existing) {
    return;
  }
  await emitWalletEvent(ctx, change, {
    type: "wallet.depletion_forecast",
    eventId,
    payload: {
      projected_date: forecast.projectedDate,
      meals_remaining: forecast.mealsRemaining,
    },
  });
}

// FR-302 / FR-406: every balance movement lands here — mirror, compare with
// hysteresis, forecast. Emission is decided by the pure comparator.
async function settleBalance(
  ctx: MutationCtx,
  change: BalanceChange,
): Promise<void> {
  const thresholdKes = await readNumberSetting(
    ctx,
    SettingKey.LowBalanceThresholdKes,
    DEFAULT_LOW_BALANCE_THRESHOLD_KES,
  );
  const verdict = compareThreshold({
    previousBalanceKes: change.wallet.balanceKes,
    balanceKes: change.newBalanceKes,
    armed: change.wallet.lowBalanceArmed ?? true,
    thresholdKes,
    reArmMarginKes: await readNumberSetting(
      ctx,
      SettingKey.LowBalanceReArmMarginKes,
      DEFAULT_RE_ARM_MARGIN_KES,
    ),
  });
  await ctx.db.patch(change.wallet._id, {
    balanceKes: change.newBalanceKes,
    lowBalanceArmed: verdict.armed,
    updatedAt: change.now,
  });
  if (verdict.lowBalance) {
    await emitWalletEvent(ctx, change, {
      type: "wallet.low_balance",
      eventId: `wallet.low_balance:${change.causeEventId}`,
      payload: { balance: change.newBalanceKes, threshold: thresholdKes },
    });
  }
  if (verdict.depleted) {
    await emitWalletEvent(ctx, change, {
      type: "wallet.depleted",
      eventId: `wallet.depleted:${change.causeEventId}`,
      payload: {},
    });
  }
  await forecastDepletion(ctx, change);
}

// FR-303 / ST-02: called after the tap is already recorded. No wallet row means
// serve-and-record; the mirror may go negative — the payer owns the truth.
export async function debitForMeal(
  ctx: MutationCtx,
  tap: {
    student: Doc<"students">;
    eventId: string;
    correlationId: string;
    now: number;
  },
): Promise<void> {
  const wallet = await ctx.db
    .query("wallets")
    .withIndex("by_student", (q) => q.eq("studentId", tap.student._id))
    .unique();
  if (!wallet) {
    return;
  }
  const amountKes = await readNumberSetting(
    ctx,
    SettingKey.MealPriceKes,
    DEFAULT_MEAL_PRICE_KES,
  );
  const change: BalanceChange = {
    wallet,
    student: tap.student,
    newBalanceKes: wallet.balanceKes - amountKes,
    causeEventId: tap.eventId,
    correlationId: tap.correlationId,
    now: tap.now,
  };
  await emitWalletEvent(ctx, change, {
    type: "wallet.debited",
    eventId: `wallet.debited:${tap.eventId}`,
    payload: { amount: amountKes, new_balance: change.newBalanceKes },
  });
  await settleBalance(ctx, change);
}

// FR-301: the payer contract. No gateway is wired yet, so this internal
// mutation *is* the mock payer (`npx convex run wallets:applyPayment`).
// Idempotent on the payer's reference; an authoritative newBalanceKes
// overwrites the mirror, otherwise the amount is added to it.
export const applyPayment = internalMutation({
  args: paymentEventValidator,
  returns: v.union(
    v.literal("applied"),
    v.literal("duplicate"),
    v.literal("unknown_student"),
  ),
  handler: async (ctx, args) => {
    const eventId = `wallet.topped_up:${args.externalRef}`;
    const replay = await ctx.db
      .query("events")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (replay) {
      return "duplicate";
    }
    const school = await ctx.db
      .query("schools")
      .withIndex("by_code", (q) => q.eq("code", args.schoolCode))
      .unique();
    const student = school
      ? await ctx.db
          .query("students")
          .withIndex("by_school_ref", (q) =>
            q.eq("schoolId", school._id).eq("studentRef", args.studentRef),
          )
          .unique()
      : null;
    if (!student) {
      return "unknown_student";
    }
    const now = Date.now();
    const wallet =
      (await ctx.db
        .query("wallets")
        .withIndex("by_student", (q) => q.eq("studentId", student._id))
        .unique()) ??
      (await ctx.db.get(
        await ctx.db.insert("wallets", {
          studentId: student._id,
          balanceKes: 0,
        }),
      ))!;
    const change: BalanceChange = {
      wallet,
      student,
      newBalanceKes: args.newBalanceKes ?? wallet.balanceKes + args.amountKes,
      causeEventId: eventId,
      correlationId: eventId,
      now: args.occurredAt ?? now,
    };
    await emitWalletEvent(ctx, change, {
      type: "wallet.topped_up",
      eventId,
      payload: { amount: args.amountKes, new_balance: change.newBalanceKes },
    });
    await settleBalance(ctx, change);
    return "applied";
  },
});
