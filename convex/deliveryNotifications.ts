import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireRole, requireUser } from "./lib/authz";
import { selectSmsChannel } from "./lib/channels";
import { requestKey, textField, timeline } from "./lib/deliveryWorkflow";
import { readSetting, SettingKey } from "./settings";

export async function notifyDelivery(
  ctx: MutationCtx,
  delivery: Doc<"deliveries">,
  event: string,
  body: string,
  escalate = false,
) {
  const recipients = [
    `school:${delivery.schoolId}`,
    ...(escalate ? [`supplier:${delivery.declaredBy}`, "admin"] : []),
  ];
  for (const recipientKey of recipients) {
    const dedupeKey = `${delivery._id}:${event}:${recipientKey}`;
    if (
      await ctx.db
        .query("deliveryInbox")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
        .unique()
    )
      continue;
    await ctx.db.insert("deliveryInbox", {
      recipientKey,
      dedupeKey,
      deliveryId: delivery._id,
      body,
    });
    const contacts = (
      await ctx.db
        .query("operationalContacts")
        .withIndex("by_recipientKey", (q) => q.eq("recipientKey", recipientKey))
        .take(20)
    ).filter((c) => c.active);
    if (!contacts.length) {
      await ctx.db.insert("deliverySms", {
        deliveryId: delivery._id,
        recipientKey,
        dedupeKey,
        body,
        status: "failed",
        failureReason: "No operational SMS contact configured",
        attempts: 0,
      });
    }
    for (const contact of contacts) {
      const smsId = await ctx.db.insert("deliverySms", {
        deliveryId: delivery._id,
        recipientKey,
        dedupeKey: `${dedupeKey}:${contact.msisdn}`,
        msisdn: contact.msisdn,
        body,
        status: "queued",
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.deliveryNotifications.send, {
        smsId,
      });
    }
  }
}

export const claim = internalMutation({
  args: { smsId: v.id("deliverySms") },
  handler: async (ctx, { smsId }) => {
    const sms = await ctx.db.get(smsId);
    if (!sms || sms.status !== "queued") return null;
    await ctx.db.patch(smsId, {
      status: "sending",
      attempts: sms.attempts + 1,
    });
    await ctx.scheduler.runAfter(
      90_000,
      internal.deliveryNotifications.expireSend,
      { smsId, attempt: sms.attempts + 1 },
    );
    return {
      ...sms,
      channel: String(
        (await readSetting(ctx, SettingKey.SmsChannel)) ?? "console",
      ),
    };
  },
});
export const expireSend = internalMutation({
  args: { smsId: v.id("deliverySms"), attempt: v.number() },
  handler: async (ctx, args) => {
    const sms = await ctx.db.get(args.smsId);
    if (sms?.status === "sending" && sms.attempts === args.attempt)
      await ctx.db.patch(sms._id, {
        status: "failed",
        failureReason: "Send outcome unknown. Check provider before retrying.",
      });
  },
});
export const finish = internalMutation({
  args: {
    smsId: v.id("deliverySms"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    failureReason: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { smsId, ...result }) => {
    const sms = await ctx.db.get(smsId);
    if (sms?.status === "sending") await ctx.db.patch(smsId, result);
  },
});
export const send = internalAction({
  args: { smsId: v.id("deliverySms") },
  handler: async (ctx, args) => {
    const sms = await ctx.runMutation(
      internal.deliveryNotifications.claim,
      args,
    );
    if (!sms) return;
    try {
      if (!sms.msisdn) throw new Error("missing_contact");
      // The console adapter is useful in development, but must not claim a real send.
      const result = !["celcom", "africastalking"].includes(sms.channel)
        ? {
            status: "failed" as const,
            failureReason: "SMS console mode: no SMS sent",
          }
        : await selectSmsChannel(sms.channel).send({
            to: sms.msisdn,
            body: sms.body,
          });
      await ctx.runMutation(internal.deliveryNotifications.finish, {
        ...args,
        ...result,
      });
    } catch {
      await ctx.runMutation(internal.deliveryNotifications.finish, {
        ...args,
        status: "failed",
        failureReason: "SMS provider unavailable",
      });
    }
  },
});
function inboxKey(actor: Doc<"users">) {
  return actor.role === "school"
    ? `school:${actor.schoolId}`
    : actor.role === "supplier"
      ? `supplier:${actor._id}`
      : "admin";
}
export const inbox = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireRole(ctx, ["school", "supplier", "admin"]);
    return await ctx.db
      .query("deliveryInbox")
      .withIndex("by_recipientKey", (q) =>
        q.eq("recipientKey", inboxKey(actor)),
      )
      .order("desc")
      .take(50);
  },
});
export const markRead = mutation({
  args: { id: v.id("deliveryInbox") },
  handler: async (ctx, { id }) => {
    const actor = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.recipientKey !== inboxKey(actor) || actor.role === "county")
      throw new ConvexError("Inbox access denied.");
    await ctx.db.patch(id, { readAt: Date.now() });
  },
});
export const contacts = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return {
      contacts: await ctx.db.query("operationalContacts").take(100),
      suppliers: await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("role"), "supplier"))
        .take(20),
    };
  },
});
export const saveContact = mutation({
  args: {
    schoolId: v.optional(v.id("schools")),
    supplierId: v.optional(v.id("users")),
    name: v.string(),
    msisdn: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin"]);
    if (args.schoolId && args.supplierId)
      throw new ConvexError("Choose one contact audience.");
    if (args.schoolId && !(await ctx.db.get(args.schoolId)))
      throw new ConvexError("Unknown school.");
    if (
      args.supplierId &&
      (await ctx.db.get(args.supplierId))?.role !== "supplier"
    )
      throw new ConvexError("Unknown supplier.");
    if (!/^\+[1-9]\d{7,14}$/.test(args.msisdn))
      throw new ConvexError(
        "Use an international phone number, for example +254712345678.",
      );
    const recipientKey = args.schoolId
      ? `school:${args.schoolId}`
      : args.supplierId
        ? `supplier:${args.supplierId}`
        : "admin";
    const rows = await ctx.db
      .query("operationalContacts")
      .withIndex("by_recipientKey", (q) => q.eq("recipientKey", recipientKey))
      .take(21);
    const existing = rows.find((c) => c.msisdn === args.msisdn);
    const value = {
      recipientKey,
      name: textField(args.name, "Contact name", 100),
      msisdn: args.msisdn,
      active: args.active,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else {
      if (rows.length >= 20)
        throw new ConvexError("Maximum 20 contacts per audience.");
      await ctx.db.insert("operationalContacts", value);
    }
    await ctx.db.insert("events", {
      eventId: requestKey(actor._id, crypto.randomUUID()),
      type: "admin.delivery_contact_changed",
      occurredAt: Date.now(),
      recordedAt: Date.now(),
      schemaVersion: 1,
      correlationId: recipientKey,
      payload: {
        actor_id: actor._id,
        active: args.active,
        recipient: recipientKey,
      },
    });
  },
});
export const failures = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return (
      await ctx.db
        .query("deliverySms")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(50)
    ).map((row) => ({
      _id: row._id,
      deliveryId: row.deliveryId,
      body: row.body,
      recipientKey: row.recipientKey,
      failureReason: row.failureReason,
      attempts: row.attempts,
    }));
  },
});
export const retry = mutation({
  args: { smsId: v.id("deliverySms") },
  handler: async (ctx, { smsId }) => {
    const actor = await requireRole(ctx, ["admin"]);
    const sms = await ctx.db.get(smsId);
    if (!sms || sms.status !== "failed") return;
    const contacts = await ctx.db
      .query("operationalContacts")
      .withIndex("by_recipientKey", (q) =>
        q.eq("recipientKey", sms.recipientKey),
      )
      .take(20);
    const contact = contacts.find(
      (c) => c.active && (!sms.msisdn || c.msisdn === sms.msisdn),
    );
    if (!contact)
      throw new ConvexError("Configure an active contact before retrying.");
    await ctx.db.patch(smsId, {
      status: "queued",
      msisdn: contact.msisdn,
      failureReason: undefined,
    });
    await timeline(
      ctx,
      sms.deliveryId,
      "sms.retry",
      "Administrator requested an SMS retry.",
      actor._id,
    );
    await ctx.scheduler.runAfter(0, internal.deliveryNotifications.send, {
      smsId,
    });
  },
});
