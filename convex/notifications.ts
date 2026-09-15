import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { findOrCreateGuardian } from "./enrolment";
import { requireSchoolScope } from "./lib/authz";
import { nairobiDayStart } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { smsSegments } from "./lib/gsm7";
import { maskMsisdn } from "./lib/mask";
import { notificationStatus } from "./schema";
import { readNumberSetting, readSetting, SettingKey } from "./settings";

const RECENT_LIMIT = 20;
const SPEND_SCAN_LIMIT = 2000;
const SCHEMA_VERSION = 1;
const DEFAULT_SMS_CHANNEL = "console";
const DEFAULT_COST_PER_SEGMENT_KES = 1;
const BILLED_STATUSES: ReadonlySet<string> = new Set(["sent", "delivered"]);

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

// FR-507: gateway DLR lands here. Unknown ids are ignored (the gateway may
// report on messages sent by another system sharing the sender id).
export const recordDeliveryReport = internalMutation({
  args: { providerMessageId: v.string(), delivered: v.boolean(), reason: v.string() },
  returns: v.union(v.null(), v.id("notifications")),
  handler: async (ctx, args) => {
    const notification = await ctx.db
      .query("notifications")
      .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", args.providerMessageId))
      .first();
    if (!notification) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(notification._id, {
      status: args.delivered ? "delivered" : "failed",
      failureReason: args.delivered ? undefined : args.reason,
    });
    await recordEvent(ctx, {
      eventId: `notification.dlr:${notification._id}:${args.providerMessageId}`,
      type: args.delivered ? "notification.delivered" : "notification.failed",
      occurredAt: now,
      recordedAt: now,
      schemaVersion: SCHEMA_VERSION,
      correlationId: notification.correlationId,
      payload: args.delivered
        ? { notification_id: notification._id, delivered_at: now }
        : { notification_id: notification._id, failure_reason: args.reason },
      schoolId: notification.schoolId,
    });
    return notification._id;
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
      suppressionReason: v.optional(v.string()),
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
      suppressionReason: row.suppressionReason,
      createdAt: row._creationTime,
    }));
  },
});

type RuleSpend = { ruleKey: string; sent: number; suppressed: number; segments: number; costKes: number };

// NFR-605: spend per trigger type, computed on read for today's Nairobi day.
// ponytail: bounded scan of the school's rows; move to an aggregate once a
// day exceeds the read budget.
export const spendByRuleToday = query({
  args: { schoolId: v.id("schools") },
  returns: v.array(
    v.object({ ruleKey: v.string(), sent: v.number(), suppressed: v.number(), segments: v.number(), costKes: v.number() }),
  ),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const costPerSegment = await readNumberSetting(ctx, SettingKey.SmsCostPerSegmentKes, DEFAULT_COST_PER_SEGMENT_KES);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId).gte("_creationTime", nairobiDayStart(Date.now())))
      .take(SPEND_SCAN_LIMIT);

    const byRule = new Map<string, RuleSpend>();
    for (const row of rows) {
      const spend = byRule.get(row.ruleKey) ?? { ruleKey: row.ruleKey, sent: 0, suppressed: 0, segments: 0, costKes: 0 };
      if (row.status === "suppressed") {
        spend.suppressed += 1;
      } else if (BILLED_STATUSES.has(row.status)) {
        spend.sent += 1;
        spend.segments += row.segments;
        spend.costKes += row.segments * costPerSegment;
      }
      byRule.set(row.ruleKey, spend);
    }
    return [...byRule.values()];
  },
});

// Ops smoke test: one real notification through deliver and the DLR webhook.
export const sendTest = internalMutation({
  args: { msisdn: v.string(), body: v.string() },
  returns: v.id("notifications"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const correlationId = crypto.randomUUID();
    const guardian = await findOrCreateGuardian(ctx, args.msisdn);
    const eventId = await ctx.db.insert("events", {
      eventId: `notification.test:${correlationId}`,
      type: "notification.test",
      occurredAt: now,
      recordedAt: now,
      schemaVersion: SCHEMA_VERSION,
      correlationId,
      payload: {},
    });
    const notificationId = await ctx.db.insert("notifications", {
      dedupeKey: `test:${correlationId}`,
      ruleKey: "test",
      eventId,
      correlationId,
      guardianId: guardian.id,
      msisdn: args.msisdn,
      channel: "sms",
      body: args.body,
      segments: smsSegments(args.body),
      status: "queued",
    });
    await ctx.scheduler.runAfter(0, internal.channels.deliver, { notificationId });
    return notificationId;
  },
});
