import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { AuthzFailure } from "./lib/roles";
import { PILOT_SCHOOL_CODE } from "./seed";
import schema, { userRole } from "./schema";

export const me = query({
  args: {},
  returns: v.union(v.null(), schema.doc("users")),
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }
    return await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
  },
});

// ponytail: every self-serve signup becomes a "school" user scoped to the
// one seeded pilot school; `assignRole` below promotes a signed-up account to
// supplier/county/admin from the CLI. Replace with an invite flow when a
// second school or self-serve supplier onboarding exists.
export const bootstrapProfile = mutation({
  args: { displayName: v.string() },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError(AuthzFailure.NotAuthenticated);
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (existing) {
      return existing._id;
    }

    const school = await ctx.db
      .query("schools")
      .withIndex("by_code", (q) => q.eq("code", PILOT_SCHOOL_CODE))
      .unique();
    if (!school) {
      throw new ConvexError("PILOT_SCHOOL_NOT_SEEDED");
    }

    return await ctx.db.insert("users", {
      authUserId: authUser._id,
      displayName: args.displayName,
      role: "school",
      schoolId: school._id,
    });
  },
});

// npx convex run users:assignRole '{"userId":"<users _id>","role":"supplier"}'
export const assignRole = internalMutation({
  args: { userId: v.id("users"), role: userRole, schoolId: v.optional(v.id("schools")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError(AuthzFailure.NoProfile);
    }
    await ctx.db.patch(user._id, { role: args.role, schoolId: args.role === "school" ? (args.schoolId ?? user.schoolId) : undefined });
    return null;
  },
});
