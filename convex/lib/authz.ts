import { ConvexError } from "convex/values";
import { authComponent } from "../auth";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { AuthzFailure, isInSchoolScope, isRoleAllowed, type Role } from "./roles";

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    throw new ConvexError(AuthzFailure.NotAuthenticated);
  }

  const profile = await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
    .unique();
  if (!profile) {
    throw new ConvexError(AuthzFailure.NoProfile);
  }

  return profile;
}

export async function requireRole(
  ctx: QueryCtx,
  allowed: readonly Role[],
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (!isRoleAllowed(user.role, allowed)) {
    throw new ConvexError(AuthzFailure.Forbidden);
  }
  return user;
}

export async function requireSchoolScope(
  ctx: QueryCtx,
  schoolId: Id<"schools">,
): Promise<Doc<"users">> {
  const user = await requireRole(ctx, ["school", "county", "admin"]);
  if (!isInSchoolScope(user, schoolId)) {
    throw new ConvexError(AuthzFailure.OutOfScope);
  }
  return user;
}
