import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireSchoolScope } from "./lib/authz";
import { maskMsisdn } from "./lib/mask";
import { notificationStatus } from "./schema";
import { readSetting, SettingKey } from "./settings";

const RECENT_LIMIT = 20;
const DEFAULT_SMS_CHANNEL = "console";

export const getForDelivery = internalQuery({
  args: { notificationId: v.id("notifications") },
  returns: v.union(
    v.null(),
    v.object({ msisdn: v.string(), body: v.string(), status: notificationStatus, channelName: v.string() }),
  ),
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      return null;
    }
    const channelName = String((await readSetting(ctx, SettingKey.SmsChannel)) ?? DEFAULT_SMS_CHANNEL);
    return { msisdn: notification.msisdn, body: notification.body, status: notification.status, channelName };
  },
});

export const markResult = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.notificationId, {
      status: args.status,
      providerMessageId: args.providerMessageId,
      failureReason: args.failureReason,
      sentAt: args.status === "sent" ? Date.now() : undefined,
    });
    return null;
  },
});

export const recentForSchool = query({
  args: { schoolId: v.id("schools") },
  returns: v.array(
    v.object({
      _id: v.id("notifications"),
      ruleKey: v.string(),
      maskedMsisdn: v.string(),
      body: v.string(),
      status: notificationStatus,
      failureReason: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .order("desc")
      .take(RECENT_LIMIT);
    return rows.map((row) => ({
      _id: row._id,
      ruleKey: row.ruleKey,
      maskedMsisdn: maskMsisdn(row.msisdn),
      body: row.body,
      status: row.status,
      failureReason: row.failureReason,
      createdAt: row._creationTime,
    }));
  },
});
