import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  accessDelivery,
  imageType,
  MAX_PHOTO_BYTES,
  requestKey,
  requireOpenReceipt,
  timeline,
} from "./lib/deliveryWorkflow";
import type { Id } from "./_generated/dataModel";

export const uploadAccess = internalQuery({
  args: { deliveryId: v.id("deliveries"), requestId: v.string() },
  handler: async (ctx, args) => {
    const { actor, delivery } = await accessDelivery(
      ctx,
      args.deliveryId,
      "school",
    );
    const key = requestKey(actor._id, args.requestId);
    const previous = await ctx.db
      .query("deliveryEvidence")
      .withIndex("by_requestKey", (q) => q.eq("requestKey", key))
      .unique();
    if (previous && previous.deliveryId !== args.deliveryId)
      throw new ConvexError("Upload reference already used.");
    if (!previous) requireOpenReceipt(delivery);
    return { previousId: previous?._id ?? null };
  },
});
export const register = internalMutation({
  args: {
    deliveryId: v.id("deliveries"),
    requestId: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const { actor, delivery } = await accessDelivery(
      ctx,
      args.deliveryId,
      "school",
    );
    const key = requestKey(actor._id, args.requestId);
    const previous = await ctx.db
      .query("deliveryEvidence")
      .withIndex("by_requestKey", (q) => q.eq("requestKey", key))
      .unique();
    if (previous) {
      if (previous.deliveryId !== args.deliveryId)
        throw new ConvexError("Upload reference already used.");
      if (previous.storageId !== args.storageId)
        await ctx.storage.delete(args.storageId);
      return previous._id;
    }
    requireOpenReceipt(delivery);
    const metadata = await ctx.db.system.get(args.storageId);
    if (
      !metadata ||
      metadata.size > MAX_PHOTO_BYTES ||
      metadata.size !== args.size ||
      (metadata.contentType !== undefined &&
        metadata.contentType !== args.contentType) ||
      !["image/jpeg", "image/png", "image/webp"].includes(args.contentType)
    )
      throw new ConvexError("Invalid photo.");
    const id = await ctx.db.insert("deliveryEvidence", {
      deliveryId: args.deliveryId,
      uploadedBy: actor._id,
      storageId: args.storageId,
      contentType: args.contentType,
      size: args.size,
      requestKey: key,
    });
    await timeline(
      ctx,
      delivery._id,
      "photo.uploaded",
      "School uploaded receipt evidence.",
      actor._id,
    );
    await ctx.scheduler.runAfter(
      24 * 60 * 60_000,
      internal.deliveryPhotos.cleanUnused,
      { evidenceId: id },
    );
    return id;
  },
});
export const cleanUnused = internalMutation({
  args: { evidenceId: v.id("deliveryEvidence") },
  handler: async (ctx, args) => {
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) return;
    const delivery = await ctx.db.get(evidence.deliveryId);
    if (delivery?.evidenceId === evidence._id) return;
    await ctx.storage.delete(evidence.storageId);
    await ctx.db.delete(evidence._id);
  },
});
export const readAccess = internalQuery({
  args: { evidenceId: v.id("deliveryEvidence") },
  handler: async (ctx, args) => {
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) throw new ConvexError("Photo not found.");
    const { actor, delivery } = await accessDelivery(ctx, evidence.deliveryId);
    if (
      actor.role === "county" ||
      (delivery.evidenceId !== evidence._id &&
        evidence.uploadedBy !== actor._id)
    )
      throw new ConvexError("Photo access denied.");
    return { storageId: evidence.storageId, contentType: evidence.contentType };
  },
});
export const PHOTO_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Delivery-Id, X-Request-Id",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export const upload = httpAction(async (ctx, req) => {
  let stored: Id<"_storage"> | undefined;
  try {
    if (!(await ctx.auth.getUserIdentity()))
      return Response.json(
        { error: "Sign in before uploading." },
        { status: 401, headers: PHOTO_HEADERS },
      );
    const deliveryId = req.headers.get(
      "X-Delivery-Id",
    ) as Id<"deliveries"> | null;
    const requestId = req.headers.get("X-Request-Id");
    if (!deliveryId || !requestId)
      return Response.json(
        { error: "Missing delivery reference." },
        { status: 400, headers: PHOTO_HEADERS },
      );
    const access = await ctx.runQuery(internal.deliveryPhotos.uploadAccess, {
      deliveryId,
      requestId,
    });
    if (access.previousId)
      return Response.json(
        { evidenceId: access.previousId },
        { headers: PHOTO_HEADERS },
      );
    if (Number(req.headers.get("Content-Length")) > MAX_PHOTO_BYTES)
      return Response.json(
        { error: "Photo must be 10 MB or smaller." },
        { status: 413, headers: PHOTO_HEADERS },
      );
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Missing photo");
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        return Response.json(
          { error: "Photo must be 10 MB or smaller." },
          { status: 413, headers: PHOTO_HEADERS },
        );
      }
      parts.push(new Uint8Array(value));
    }
    const blob = new Blob(parts);
    const type = imageType(
      new Uint8Array(await blob.slice(0, 32).arrayBuffer()),
    );
    if (!type || req.headers.get("Content-Type") !== type)
      return Response.json(
        { error: "Choose a JPEG, PNG or WebP photo." },
        { status: 415, headers: PHOTO_HEADERS },
      );
    stored = await ctx.storage.store(new Blob(parts, { type }));
    const evidenceId = await ctx.runMutation(internal.deliveryPhotos.register, {
      deliveryId,
      requestId,
      storageId: stored,
      contentType: type,
      size,
    });
    return Response.json({ evidenceId }, { headers: PHOTO_HEADERS });
  } catch {
    if (stored) await ctx.storage.delete(stored);
    return Response.json(
      {
        error:
          "Upload could not be saved. Check your access and try again, or request a receipt code.",
      },
      { status: 400, headers: PHOTO_HEADERS },
    );
  }
});
export const read = httpAction(async (ctx, req) => {
  try {
    if (!(await ctx.auth.getUserIdentity()))
      return new Response("Sign in required", {
        status: 401,
        headers: PHOTO_HEADERS,
      });
    const evidenceId = new URL(req.url).searchParams.get(
      "id",
    ) as Id<"deliveryEvidence">;
    const evidence = await ctx.runQuery(internal.deliveryPhotos.readAccess, {
      evidenceId,
    });
    const blob = await ctx.storage.get(evidence.storageId);
    if (!blob)
      return new Response("Photo not found", {
        status: 404,
        headers: PHOTO_HEADERS,
      });
    return new Response(blob, {
      headers: { ...PHOTO_HEADERS, "Content-Type": evidence.contentType },
    });
  } catch {
    return new Response("Photo access denied", {
      status: 403,
      headers: PHOTO_HEADERS,
    });
  }
});
