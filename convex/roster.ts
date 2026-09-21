import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { commitRosterRows } from "./enrolment";
import { requireSchoolScope } from "./lib/authz";
import { recordEvent } from "./lib/events";

const SCHEMA_VERSION = 1;
const STUDENT_LEFT = "student_left";

export const RosterFailure = {
  StudentNotInSchool: "student_not_in_school",
} as const;

const joinArgs = {
  schoolId: v.id("schools"),
  fullName: v.string(),
  className: v.string(),
  guardianMsisdn: v.string(),
  guardianName: v.optional(v.string()),
  guardianRelationship: v.string(),
  tagUid: v.optional(v.string()),
};

// SC-06: corrections take effect on the next day's expectations by
// construction — materialisation reads active students, and today's row is
// left as it is. Deactivation also revokes the live tag (ST-05).
export async function deactivateStudent(
  ctx: MutationCtx,
  args: { schoolId: Id<"schools">; studentId: Id<"students">; reason: string },
): Promise<"deactivated" | "already_inactive"> {
  const student = await ctx.db.get(args.studentId);
  if (!student || student.schoolId !== args.schoolId) {
    throw new ConvexError(RosterFailure.StudentNotInSchool);
  }
  if (student.status !== "active") {
    return "already_inactive";
  }
  const now = Date.now();
  await ctx.db.patch(student._id, { status: "deactivated", deactivationReason: args.reason, deactivatedAt: Date.now() });
  const tag = await ctx.db
    .query("tags")
    .withIndex("by_student_status", (q) => q.eq("studentId", student._id).eq("status", "active"))
    .first();
  if (tag) {
    await ctx.db.patch(tag._id, { status: "revoked", revokedAt: now, revocationReason: STUDENT_LEFT });
  }
  await recordEvent(ctx, {
    eventId: `student.deactivated:${student._id}:${now}`,
    type: "student.deactivated",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: student._id,
    payload: { student_id: student._id, reason: args.reason, tag_uid: tag?.tagUid ?? "" },
    schoolId: student.schoolId,
    studentId: student._id,
  });
  return "deactivated";
}

export const deactivate = mutation({
  args: { schoolId: v.id("schools"), studentId: v.id("students"), reason: v.string() },
  returns: v.union(v.literal("deactivated"), v.literal("already_inactive")),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await deactivateStudent(ctx, args);
  },
});

// "Student joined" is a one-row enrolment through the same path as the PDF
// import, so the student.enrolled audit row and guardian linking come free.
export const join = mutation({
  args: joinArgs,
  returns: v.object({ studentsCreated: v.number(), guardiansCreated: v.number() }),
  handler: async (ctx, { schoolId, ...row }) => {
    await requireSchoolScope(ctx, schoolId);
    return await commitRosterRows(ctx, schoolId, [{ ...row, openingBalanceKes: 0 }]);
  },
});
