import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { sha256Hex } from "./lib/hmac";

const INITIAL_QUEUE_DEPTH = 0;
const INITIAL_CLOCK_SKEW_SECONDS = 0;

// The raw `secret` is never stored. Both the device and this mutation hash it
// with SHA-256 once at provisioning time; that hash becomes the HMAC signing
// key each side uses independently, so the shared secret itself never
// touches the database.
export const registerDevice = internalMutation({
  args: {
    deviceRef: v.string(),
    schoolId: v.id("schools"),
    secret: v.string(),
    firmwareVersion: v.string(),
  },
  returns: v.id("devices"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_deviceRef", (q) => q.eq("deviceRef", args.deviceRef))
      .unique();
    if (existing) {
      return existing._id;
    }

    const secretHash = await sha256Hex(args.secret);
    return await ctx.db.insert("devices", {
      deviceRef: args.deviceRef,
      schoolId: args.schoolId,
      secretHash,
      firmwareVersion: args.firmwareVersion,
      queueDepth: INITIAL_QUEUE_DEPTH,
      clockSkewSeconds: INITIAL_CLOCK_SKEW_SECONDS,
    });
  },
});
