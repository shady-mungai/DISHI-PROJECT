import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireUser } from "./authz";
import { sha256Hex } from "./hmac";

export const ARRIVAL_MS = 30 * 60_000;
export const CODE_COOLDOWN_MS = 15 * 60_000;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function checkPortions(n: number, allowZero = true) {
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 1_000_000)
    throw new ConvexError(
      "Enter a whole number of portions between 0 and 1,000,000.",
    );
}
export function textField(value: string, label: string, max = 500) {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max)
    throw new ConvexError(`${label} is required (maximum ${max} characters).`);
  return cleaned;
}
export function requestKey(actor: Id<"users">, requestId: string) {
  return `${actor}:${textField(requestId, "Request reference", 100)}`;
}
export async function operation(
  ctx: MutationCtx,
  actor: Id<"users">,
  requestId: string,
  input: unknown,
) {
  const key = requestKey(actor, requestId);
  const fingerprint = await sha256Hex(JSON.stringify(input));
  const previous = await ctx.db
    .query("deliveryOperations")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (previous && previous.fingerprint !== fingerprint)
    throw new ConvexError(
      "This request reference was already used. Start a new request.",
    );
  return { key, fingerprint, previous };
}
export async function accessDelivery(
  ctx: QueryCtx,
  deliveryId: Id<"deliveries">,
  mode: "read" | "school" | "supplier" | "admin" = "read",
) {
  const actor = await requireUser(ctx);
  const delivery = await ctx.db.get(deliveryId);
  if (!delivery) throw new ConvexError("Delivery not found.");
  const school =
    actor.role === "school" && actor.schoolId === delivery.schoolId;
  const supplier =
    actor.role === "supplier" && actor._id === delivery.declaredBy;
  const admin = actor.role === "admin";
  if (
    !(mode === "read"
      ? school || supplier || admin || actor.role === "county"
      : mode === "school"
        ? school
        : mode === "supplier"
          ? supplier
          : admin)
  )
    throw new ConvexError("This delivery is outside your access scope.");
  return { actor, delivery };
}
export function requireV2(delivery: Doc<"deliveries">) {
  if (delivery.workflowVersion !== 2)
    throw new ConvexError(
      "Use the historical confirmation form for this delivery.",
    );
}
export function requireOpenReceipt(delivery: Doc<"deliveries">) {
  requireV2(delivery);
  if (
    delivery.receiptConfirmedAt !== undefined ||
    delivery.status === "confirmed" ||
    delivery.status === "disputed"
  )
    throw new ConvexError(
      "Receipt is already submitted. Ask central admin to resolve any correction.",
    );
}
export async function timeline(
  ctx: MutationCtx,
  deliveryId: Id<"deliveries">,
  type: string,
  detail: string,
  actorId?: Id<"users">,
) {
  await ctx.db.insert("deliveryTimeline", {
    deliveryId,
    type,
    detail,
    actorId,
    at: Date.now(),
  });
}
export function receiptStatus(
  delivery: Doc<"deliveries">,
  portions: number,
  problem: string,
) {
  return portions === delivery.portions && !problem
    ? ("confirmed" as const)
    : ("disputed" as const);
}
export function imageType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    return "image/png";
  if (
    bytes.length >= 16 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
