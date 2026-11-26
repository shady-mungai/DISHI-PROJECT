import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { settingValue } from "./schema";
import type { Infer } from "convex/values";

export type SettingValue = Infer<typeof settingValue>;

export const SettingKey = {
  TreatEveryDayAsSchoolDay: "treatEveryDayAsSchoolDay",
  ServiceWindowMinutes: "serviceWindowMinutes",
  CutoffOffsetMinutes: "cutoffOffsetMinutes",
  MealPriceKes: "mealPriceKes",
  LowBalanceThresholdKes: "lowBalanceThresholdKes",
  LowBalanceReArmMarginKes: "lowBalanceReArmMarginKes",
  DepletionForecastLeadSchoolDays: "depletionForecastLeadSchoolDays",
  DailyMessageCap: "dailyMessageCap",
  CollapseWindowMinutes: "collapseWindowMinutes",
  QuietHoursStartHour: "quietHoursStartHour",
  QuietHoursEndHour: "quietHoursEndHour",
  StalledServiceThresholdPct: "stalledServiceThresholdPct",
  VarianceTolerancePct: "varianceTolerancePct",
  DishInsightsMinDays: "dishInsightsMinDays",
  ServiceRequiresSupply: "serviceRequiresSupply",
  TasteLikedMaxSkipPct: "tasteLikedMaxSkipPct",
  TasteDislikedMinSkipPct: "tasteDislikedMinSkipPct",
  VarianceStreakDays: "varianceStreakDays",
  OverrideRateTolerancePct: "overrideRateTolerancePct",
  ClockSkewToleranceSeconds: "clockSkewToleranceSeconds",
  SmsChannel: "smsChannel",
  SmsCostPerSegmentKes: "smsCostPerSegmentKes",
  DeliveryConfirmWindowMinutes: "deliveryConfirmWindowMinutes",
  SupplierPortionRateKes: "supplierPortionRateKes",
  ReaderSilentHours: "readerSilentHours",
  DeliveryMaxAttempts: "deliveryMaxAttempts",
  DeliveryRetryBaseSeconds: "deliveryRetryBaseSeconds",
  RetentionEventDays: "retentionEventDays",
  RetentionNotificationDays: "retentionNotificationDays",
  RetentionStudentDays: "retentionStudentDays",
} as const;

export const DEMO_SETTINGS: ReadonlyArray<{
  key: string;
  value: SettingValue;
  description: string;
}> = [
  {
    key: SettingKey.TreatEveryDayAsSchoolDay,
    value: true,
    description:
      "Development mode: treat every date as a school day, including weekends and dates missing from the calendar",
  },
  {
    key: SettingKey.ServiceWindowMinutes,
    value: 5,
    description: "Length of the compressed demo service window",
  },
  {
    key: SettingKey.CutoffOffsetMinutes,
    value: 2,
    description: "Minutes after window close before the missed-meal sweep",
  },
  {
    key: SettingKey.MealPriceKes,
    value: 5,
    description: "Subsidised guardian contribution per meal",
  },
  {
    key: SettingKey.LowBalanceThresholdKes,
    value: 50,
    description: "Balance at which a low-balance warning is raised",
  },
  {
    key: SettingKey.LowBalanceReArmMarginKes,
    value: 20,
    description: "Recovery margin above threshold before re-arming",
  },
  {
    key: SettingKey.DepletionForecastLeadSchoolDays,
    value: 3,
    description:
      "School days of cover left at which the depletion forecast is sent",
  },
  {
    key: SettingKey.DailyMessageCap,
    value: 3,
    description: "Maximum messages per guardian per day",
  },
  {
    key: SettingKey.CollapseWindowMinutes,
    value: 0,
    description: "Window across which messages are merged; 0 sends on tap",
  },
  {
    key: SettingKey.QuietHoursStartHour,
    value: 21,
    description: "Hour at which quiet hours begin",
  },
  {
    key: SettingKey.QuietHoursEndHour,
    value: 6,
    description: "Hour at which quiet hours end",
  },
  {
    key: SettingKey.StalledServiceThresholdPct,
    value: 30,
    description:
      "Shortfall against expected run rate that flags stalled service",
  },
  {
    key: SettingKey.VarianceTolerancePct,
    value: 10,
    description: "Reconciliation variance considered actionable",
  },
  {
    key: SettingKey.TasteLikedMaxSkipPct,
    value: 10,
    description: "Skip rate below which a dish counts as liked",
  },
  {
    key: SettingKey.TasteDislikedMinSkipPct,
    value: 30,
    description: "Skip rate above which a dish counts as disliked",
  },
  {
    key: SettingKey.VarianceStreakDays,
    value: 3,
    description: "Consecutive breach days before escalation",
  },
  {
    key: SettingKey.OverrideRateTolerancePct,
    value: 15,
    description: "Override rate above which a school is flagged",
  },
  {
    key: SettingKey.ClockSkewToleranceSeconds,
    value: 120,
    description: "Device clock skew tolerated before flagging",
  },
  {
    key: SettingKey.SmsChannel,
    value: "console",
    description: "SMS channel adapter: console | celcom | africastalking",
  },
  {
    key: SettingKey.SmsCostPerSegmentKes,
    value: 0.8,
    description: "Gateway price per SMS segment, for spend reporting",
  },
  {
    key: SettingKey.DeliveryConfirmWindowMinutes,
    value: 120,
    description:
      "Minutes after dispatch before a delivery is swept as unconfirmed",
  },
  {
    key: SettingKey.SupplierPortionRateKes,
    value: 25,
    description: "Amount paid to the supplier per confirmed portion",
  },
  {
    key: SettingKey.ReaderSilentHours,
    value: 20,
    description: "Hours without a reader sync before it is flagged silent",
  },
  {
    key: SettingKey.DeliveryMaxAttempts,
    value: 3,
    description:
      "Delivery attempts before a transient gateway failure is recorded as failed",
  },
  {
    key: SettingKey.DeliveryRetryBaseSeconds,
    value: 30,
    description: "First retry delay; doubles per attempt",
  },
  {
    key: SettingKey.RetentionEventDays,
    value: 365,
    description: "Days operational events are kept (audit events are exempt)",
  },
  {
    key: SettingKey.RetentionNotificationDays,
    value: 90,
    description: "Days notification rows (message bodies, MSISDNs) are kept",
  },
  {
    key: SettingKey.RetentionStudentDays,
    value: 365,
    description:
      "Days after deactivation before a student record is de-identified",
  },
];

export async function readNumberSetting(
  ctx: QueryCtx,
  key: string,
  fallback: number,
): Promise<number> {
  const value = await readSetting(ctx, key);
  return typeof value === "number" ? value : fallback;
}

export async function readSetting(
  ctx: QueryCtx,
  key: string,
): Promise<SettingValue | undefined> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row?.value;
}

export const seedDefaults = internalMutation({
  args: { overwrite: v.optional(v.boolean()) },
  returns: v.object({ created: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    let created = 0;
    let updated = 0;

    for (const setting of DEMO_SETTINGS) {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", setting.key))
        .unique();

      if (!existing) {
        await ctx.db.insert("settings", setting);
        created += 1;
        continue;
      }

      if (args.overwrite === true) {
        await ctx.db.patch(existing._id, {
          value: setting.value,
          description: setting.description,
        });
        updated += 1;
      }
    }

    return { created, updated };
  },
});

export const set = internalMutation({
  args: { key: v.string(), value: settingValue },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!existing) {
      throw new Error(`unknown setting: ${args.key}`);
    }
    await ctx.db.patch(existing._id, { value: args.value });
    return null;
  },
});
