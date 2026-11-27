import { ConvexError, v } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireRole } from "./lib/authz";
import { toServiceDate } from "./lib/dates";
import { sha256Hex } from "./lib/hmac";
import { MAX_DISH_LENGTH, normaliseDish } from "./lib/dishInsights";
import { DEFAULT_PORTION_GRAMS, portionsFromKg } from "./lib/portions";
import { mintConfirmCode } from "./lib/supply";
import {
  accessDelivery,
  ARRIVAL_MS,
  checkPortions,
  CODE_COOLDOWN_MS,
  operation,
  receiptStatus,
  requestKey,
  requireOpenReceipt,
  textField,
  timeline,
} from "./lib/deliveryWorkflow";
import { notifyDelivery } from "./deliveryNotifications";
import { readNumberSetting, SettingKey } from "./settings";

const attemptLimiter = new RateLimiter(components.rateLimiter, {
  receiptFailures: { kind: "fixed window", rate: 5, period: ARRIVAL_MS },
});

export const dispatchArgs = {
  schoolId: v.id("schools"),
  // Suppliers send containers + net kg; portions is the legacy direct count.
  portions: v.optional(v.number()),
  containers: v.optional(v.number()),
  netKg: v.optional(v.number()),
  vehicle: v.string(),
  docketRef: v.optional(v.string()),
  requestId: v.string(),
  dish: v.optional(v.string()),
};
export async function dispatchDelivery(
  ctx: MutationCtx,
  actor: Doc<"users">,
  args: {
    schoolId: Id<"schools">;
    portions?: number;
    containers?: number;
    netKg?: number;
    vehicle: string;
    docketRef?: string;
    requestId: string;
    dish?: string;
  },
) {
  const byWeight = args.netKg !== undefined;
  if (byWeight) {
    if (!Number.isSafeInteger(args.containers) || args.containers! < 1 || args.containers! > 1000)
      throw new ConvexError("Enter a whole number of containers between 1 and 1,000.");
    if (!Number.isFinite(args.netKg) || args.netKg! <= 0 || args.netKg! > 100_000)
      throw new ConvexError("Enter the net food weight in kg, above 0.");
  }
  // ponytail: one serving size for every dish; per-dish grams when dishes differ enough to skew pay.
  const portions = byWeight
    ? portionsFromKg(args.netKg!, await readNumberSetting(ctx, SettingKey.PortionGrams, DEFAULT_PORTION_GRAMS))
    : (args.portions ?? 0);
  checkPortions(portions, false);
  const vehicle = textField(args.vehicle, "Vehicle", 100);
  // Optional: the supplier's own paper docket number, when they keep one.
  const supplierDocket = args.docketRef?.trim() ? textField(args.docketRef, "Docket reference", 100) : "";
  const dish = normaliseDish(args.dish ?? "");
  if (dish.length > MAX_DISH_LENGTH)
    throw new ConvexError(`Dish must be at most ${MAX_DISH_LENGTH} characters.`);
  const key = requestKey(actor._id, args.requestId);
  const fingerprint = await sha256Hex(
    JSON.stringify([args.schoolId, portions, args.containers, args.netKg, vehicle, supplierDocket, ...(dish ? [dish] : [])]),
  );
  const previous = await ctx.db
    .query("deliveries")
    .withIndex("by_requestKey", (q) => q.eq("requestKey", key))
    .unique();
  if (previous) {
    if (previous.requestFingerprint !== fingerprint)
      throw new ConvexError(
        "Dispatch request already used with different details.",
      );
    return {
      deliveryId: previous._id,
      reference: previous.reference!,
      portions: previous.portions,
      expectedArrivalAt: previous.expectedArrivalAt!,
    };
  }
  let supplierId = actor._id;
  if (actor.role === "admin") {
    const suppliers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "supplier"))
      .take(2);
    if (suppliers.length !== 1)
      throw new ConvexError(
        "Configure one pilot supplier before dispatching as an administrator.",
      );
    supplierId = suppliers[0]._id;
  }
  const school = await ctx.db.get(args.schoolId);
  if (!school?.active) throw new ConvexError("Choose an active pilot school.");
  const now = Date.now();
  const serviceDate = toServiceDate(now);
  // Readable over the phone: school code, YYMMDD, and that day's delivery count.
  const sameDay = await ctx.db
    .query("deliveries")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", serviceDate))
    .take(100);
  const reference = `${school.code}-${serviceDate.slice(2).replaceAll("-", "")}-${sameDay.length + 1}`;
  const docketRef = supplierDocket || reference;
  const deliveryId = await ctx.db.insert("deliveries", {
    schoolId: args.schoolId,
    serviceDate,
    portions,
    ...(byWeight && { containers: args.containers, netKg: args.netKg }),
    vehicle,
    docketRef,
    reference,
    ...(dish && { dish }),
    declaredBy: supplierId,
    dispatchedAt: now,
    expectedConfirmBy: now + ARRIVAL_MS,
    expectedArrivalAt: now + ARRIVAL_MS,
    status: "declared",
    confirmCodeHash: "",
    workflowVersion: 2,
    requestKey: key,
    requestFingerprint: fingerprint,
    reviewRequired: false,
  });
  const delivery = (await ctx.db.get(deliveryId))!;
  await timeline(
    ctx,
    deliveryId,
    "dispatched",
    `${portions} portions${byWeight ? ` (${args.containers} containers, ${args.netKg} kg)` : ""}${dish ? ` of ${dish}` : ""} dispatched. Vehicle ${vehicle}${supplierDocket ? `; docket ${supplierDocket}` : ""}.`,
    actor._id,
  );
  const deadline = new Date(now + ARRIVAL_MS).toLocaleTimeString("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
  });
  await notifyDelivery(
    ctx,
    delivery,
    "dispatched",
    `${school.name}: ${portions} portions${byWeight ? ` in ${args.containers} containers` : ""} incoming. Reference ${reference}. Expected by ${deadline} EAT. Confirm receipt in Dishi.`,
  );
  await ctx.scheduler.runAt(
    now + ARRIVAL_MS,
    internal.deliveryWorkflow.markOverdue,
    { deliveryId },
  );
  return { deliveryId, reference, portions, expectedArrivalAt: now + ARRIVAL_MS };
}
export const dispatch = mutation({
  args: dispatchArgs,
  handler: async (ctx, args) =>
    dispatchDelivery(ctx, await requireRole(ctx, ["supplier", "admin"]), args),
});

async function finishReceipt(
  ctx: MutationCtx,
  delivery: Doc<"deliveries">,
  actor: Doc<"users">,
  portions: number,
  problem: string,
) {
  const now = Date.now();
  const status = receiptStatus(delivery, portions, problem);
  await ctx.db.patch(delivery._id, {
    portionsReceived: portions,
    reportedProblem: problem || undefined,
    note: problem || undefined,
    receiptRecordedAt: delivery.receiptRecordedAt ?? now,
    receiptConfirmedAt: now,
    receiptMethod: "code",
    status,
    resolvedBy: actor._id,
    resolvedAt: now,
    // The supplier entering the school's code is the confirmation.
    reviewRequired: status === "disputed",
  });
  const code = await ctx.db
    .query("receiptCodes")
    .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
    .unique();
  if (code) await ctx.db.patch(code._id, { usedAt: now, hash: "" });
  await timeline(
    ctx,
    delivery._id,
    `receipt.${status}`,
    `${portions} received via code.${problem ? ` Problem: ${problem}` : ""}`,
    actor._id,
  );
  await notifyDelivery(
    ctx,
    delivery,
    `receipt.${status}`,
    status === "disputed"
      ? `Delivery ${delivery.reference} disputed: ${portions} of ${delivery.portions} portions received.${problem ? ` Problem: ${problem.slice(0, 80)}` : ""} Admin review needed.`
      : `Delivery ${delivery.reference} confirmed: ${portions} of ${delivery.portions} portions received.`,
    status === "disputed"
      ? ["school", "supplier", "admin"]
      : ["school", "supplier"],
  );
  await ctx.scheduler.runAfter(0, internal.deliveries.reconcilePageFor, {
    schoolId: delivery.schoolId,
    serviceDate: delivery.serviceDate,
    cursor: null,
    consumedSoFar: 0,
  });
  return status;
}
const receiptArgs = {
  deliveryId: v.id("deliveries"),
  portionsReceived: v.number(),
  problem: v.string(),
  requestId: v.string(),
};
export const requestCode = mutation({
  args: receiptArgs,
  handler: async (ctx, args) => {
    const { actor, delivery } = await accessDelivery(
      ctx,
      args.deliveryId,
      "school",
    );
    const op = await operation(ctx, actor._id, args.requestId, [
      "code",
      args.deliveryId,
      args.portionsReceived,
      args.problem,
    ]);
    if (op.previous) return { code: null, expiresAt: op.previous.expiresAt! };
    requireOpenReceipt(delivery);
    checkPortions(args.portionsReceived);
    if (args.problem.length > 500)
      throw new ConvexError("Keep the problem description to 500 characters.");
    const previous = await ctx.db
      .query("receiptCodes")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
      .unique();
    let code = mintConfirmCode();
    while (
      previous &&
      previous.hash ===
        (await sha256Hex(`${delivery._id}:${previous.generation}:${code}`))
    )
      code = mintConfirmCode();
    const now = Date.now();
    const generation = (previous?.generation ?? 0) + 1;
    const expiresAt = now + ARRIVAL_MS;
    const value = {
      deliveryId: delivery._id,
      hash: await sha256Hex(`${delivery._id}:${generation}:${code}`),
      expiresAt,
      generation,
      portionsReceived: args.portionsReceived,
      problem: args.problem.trim(),
      requestedBy: actor._id,
      failures: previous?.failures ?? 0,
      cooldownUntil: previous?.cooldownUntil,
    };
    if (previous) await ctx.db.replace(previous._id, value);
    else await ctx.db.insert("receiptCodes", value);
    await ctx.db.patch(delivery._id, {
      receiptRecordedAt: delivery.receiptRecordedAt ?? now,
      receiptBy: actor._id,
      receiptMethod: "code",
      portionsReceived: args.portionsReceived,
      reportedProblem: args.problem.trim() || undefined,
    });
    await timeline(
      ctx,
      delivery._id,
      "receipt.code_requested",
      `${args.portionsReceived} received. Code expires in 30 minutes.`,
      actor._id,
    );
    await ctx.db.insert("deliveryOperations", {
      key: op.key,
      fingerprint: op.fingerprint,
      deliveryId: delivery._id,
      status: "code_requested",
      expiresAt,
    });
    return { code, expiresAt };
  },
});
export const redeemCode = mutation({
  args: {
    deliveryId: v.id("deliveries"),
    code: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, delivery } = await accessDelivery(
      ctx,
      args.deliveryId,
      "supplier",
    );
    const op = await operation(ctx, actor._id, args.requestId, [
      "redeem",
      args.deliveryId,
      args.code,
    ]);
    if (op.previous) return { status: op.previous.status };
    requireOpenReceipt(delivery);
    const entry = await ctx.db
      .query("receiptCodes")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
      .unique();
    const now = Date.now();
    let status: string;
    if (!entry || entry.usedAt || entry.expiresAt <= now)
      status = "Code expired or unavailable. Ask the school for a new code.";
    else if (entry.cooldownUntil && entry.cooldownUntil > now)
      status =
        "Too many incorrect attempts. Try again after the 15-minute cooldown.";
    else if (
      !/^\d{6}$/.test(args.code) ||
      entry.hash !==
        (await sha256Hex(`${delivery._id}:${entry.generation}:${args.code}`))
    ) {
      if (entry.cooldownUntil)
        await attemptLimiter.reset(ctx, "receiptFailures", {
          key: delivery._id,
        });
      const limit = await attemptLimiter.limit(ctx, "receiptFailures", {
        key: delivery._id,
      });
      const failures = limit.ok
        ? (entry.cooldownUntil ? 0 : entry.failures) + 1
        : 5;
      await ctx.db.patch(entry._id, {
        failures,
        cooldownUntil: failures >= 5 ? now + CODE_COOLDOWN_MS : undefined,
      });
      status =
        failures >= 5
          ? "Five incorrect attempts. Codes are locked for 15 minutes."
          : "Incorrect code. Check the code with the school.";
    } else {
      status = await finishReceipt(
        ctx,
        delivery,
        actor,
        entry.portionsReceived,
        entry.problem,
      );
    }
    // Return failures instead of throwing: the attempt and cooldown must commit.
    if (status !== "confirmed" && status !== "disputed")
      await timeline(
        ctx,
        delivery._id,
        "receipt.code_rejected",
        status,
        actor._id,
      );
    await ctx.db.insert("deliveryOperations", {
      key: op.key,
      fingerprint: op.fingerprint,
      deliveryId: delivery._id,
      status,
    });
    return { status };
  },
});
export const markOverdue = internalMutation({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (
      !delivery ||
      delivery.workflowVersion !== 2 ||
      delivery.receiptRecordedAt !== undefined ||
      delivery.overdueAt !== undefined ||
      Date.now() < delivery.expectedArrivalAt! ||
      delivery.status === "confirmed" ||
      delivery.status === "disputed"
    )
      return false;
    await ctx.db.patch(deliveryId, {
      overdueAt: Date.now(),
      status: "unconfirmed",
      reviewRequired: true,
    });
    await timeline(
      ctx,
      deliveryId,
      "overdue",
      "No school receipt recorded within 30 minutes.",
    );
    await notifyDelivery(
      ctx,
      delivery,
      "overdue",
      `Delivery ${delivery.reference ?? delivery.docketRef} is overdue: ${delivery.portions} portions. Contact the school and supplier. Late receipt can still be recorded.`,
      ["school", "supplier", "admin"],
    );
    return true;
  },
});
export const resolve = mutation({
  args: {
    deliveryId: v.id("deliveries"),
    decision: v.union(
      v.literal("confirm"),
      v.literal("dispute"),
      v.literal("reviewed"),
    ),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor, delivery } = await accessDelivery(
      ctx,
      args.deliveryId,
      "admin",
    );
    const reason = textField(args.reason, "Resolution reason");
    const op = await operation(ctx, actor._id, args.requestId, [
      "resolve",
      args.deliveryId,
      args.decision,
      reason,
    ]);
    if (op.previous) return;
    if (args.decision === "confirm" && delivery.portionsReceived === undefined)
      throw new ConvexError(
        "The school must record received quantities before confirmation.",
      );
    if (
      delivery.receiptRecordedAt === undefined &&
      delivery.workflowVersion === 2
    )
      throw new ConvexError(
        "The school must record receipt first. Contact the school or supplier about this overdue delivery.",
      );
    const status =
      args.decision === "reviewed"
        ? delivery.status
        : args.decision === "confirm"
          ? "confirmed"
          : "disputed";
    await ctx.db.patch(delivery._id, {
      status,
      reviewRequired: false,
      reviewResolvedAt: Date.now(),
      resolvedAt: Date.now(),
      resolvedBy: actor._id,
      note: reason,
    });
    await timeline(
      ctx,
      delivery._id,
      `admin.${args.decision}`,
      reason,
      actor._id,
    );
    if (args.decision !== "reviewed")
      await notifyDelivery(
        ctx,
        delivery,
        `admin.${status}`,
        `Delivery ${delivery.reference} ${status} by administrator: ${reason.slice(0, 100)}`,
        ["school", "supplier"],
      );
    await ctx.db.insert("events", {
      eventId: op.key,
      type: "admin.delivery_resolved",
      occurredAt: Date.now(),
      recordedAt: Date.now(),
      schemaVersion: 2,
      correlationId: delivery._id,
      schoolId: delivery.schoolId,
      serviceDate: delivery.serviceDate,
      payload: {
        actor_id: actor._id,
        reason,
        previous_status: delivery.status,
        status,
        decision: args.decision,
      },
    });
    const code = await ctx.db
      .query("receiptCodes")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
      .unique();
    if (code && args.decision !== "reviewed")
      await ctx.db.patch(code._id, { usedAt: Date.now(), hash: "" });
    await ctx.db.insert("deliveryOperations", {
      key: op.key,
      fingerprint: op.fingerprint,
      deliveryId: delivery._id,
      status,
    });
    await ctx.scheduler.runAfter(0, internal.deliveries.reconcilePageFor, {
      schoolId: delivery.schoolId,
      serviceDate: delivery.serviceDate,
      cursor: null,
      consumedSoFar: 0,
    });
  },
});
