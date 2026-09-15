import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { selectSmsChannel } from "./lib/channels";
import type { SmsSendResult } from "./lib/channels/types";

// The only place a notification leaves the deployment. Swap adapters via the
// smsChannel setting; the rule and policy layers never see the provider.
export const deliver = internalAction({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const notification = await ctx.runQuery(internal.notifications.getForDelivery, args);
    if (!notification || notification.status !== "queued") {
      return null;
    }
    const result = await selectSmsChannel(notification.channelName).send({
      to: notification.msisdn,
      body: notification.body,
    });
    await ctx.runMutation(internal.notifications.markResult, { notificationId: args.notificationId, ...result });
    return null;
  },
});

export const sendTest = internalAction({
  args: { to: v.string(), body: v.string() },
  returns: v.union(
    v.object({ status: v.literal("sent"), providerMessageId: v.string() }),
    v.object({ status: v.literal("failed"), failureReason: v.string() }),
  ),
  handler: async (ctx, args): Promise<SmsSendResult> => {
    const channelName: string = await ctx.runQuery(internal.settings.getSmsChannel, {});
    return await selectSmsChannel(channelName).send(args);
  },
});
