import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { AuthzFailure } from "./lib/roles";
import { PILOT_SCHOOL_CODE } from "./seed";
import schema from "./schema";

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
// one seeded pilot school — correct while the pilot is one school, wrong once
// a second actor type (county/supplier/admin) needs to sign in. Upgrade to a
// real invite/role-assignment flow before D9.
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
