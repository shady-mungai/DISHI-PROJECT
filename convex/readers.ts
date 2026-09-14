import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireSchoolScope } from "./lib/authz";
import { sha256Hex } from "./lib/hmac";
import { normaliseTagUid } from "./lib/tagUid";

const PHONE_DEVICE_PREFIX = "PHONE";
const PHONE_DEVICE_FIRMWARE = "pwa-1";
const DEVICE_REF_RANDOM_HEX_LENGTH = 8;
const MAX_ROSTER = 1000;
const REASSIGNED = "reassigned";

export const ReaderFailure = {
  StudentNotInSchool: "student_not_in_school",
} as const;

const studentWithTagValidator = v.object({
  _id: v.id("students"),
  fullName: v.string(),
  className: v.string(),
  tagUid: v.optional(v.string()),
});

export type StudentWithTag = {
  _id: Id<"students">;
  fullName: string;
  className: string;
  tagUid?: string;
};

// Same trust model as simulator.prepare: the secret is minted server-side and
// handed back exactly once; only its hash is stored (NFR-402).
export const provision = mutation({
  args: { schoolId: v.id("schools") },
  returns: v.object({ deviceRef: v.string(), signingKeyHex: v.string() }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await provisionReader(ctx, args.schoolId);
  },
});

export const activeStudents = query({
  args: { schoolId: v.id("schools") },
  returns: v.array(studentWithTagValidator),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await listActiveStudentsWithTags(ctx, args.schoolId);
  },
});

export const assignTag = mutation({
  args: { schoolId: v.id("schools"), studentId: v.id("students"), tagUid: v.string() },
  returns: v.object({ tagUid: v.string() }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await assignTagToStudent(ctx, args.schoolId, args.studentId, args.tagUid);
  },
});

// Split from the wrappers so tests run without a Better Auth session, same as
// enrolment.commitRosterRows.
export async function provisionReader(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
): Promise<{ deviceRef: string; signingKeyHex: string }> {
  const randomHex = crypto.randomUUID().replace(/-/g, "").slice(0, DEVICE_REF_RANDOM_HEX_LENGTH);
  const deviceRef = `${PHONE_DEVICE_PREFIX}-${randomHex}:${schoolId}`;
  const signingKeyHex = await sha256Hex(`${deviceRef}:${crypto.randomUUID()}`);
  await ctx.db.insert("devices", {
    deviceRef,
    schoolId,
    secretHash: signingKeyHex,
    firmwareVersion: PHONE_DEVICE_FIRMWARE,
    queueDepth: 0,
    clockSkewSeconds: 0,
  });
  return { deviceRef, signingKeyHex };
}

export async function listActiveStudentsWithTags(
  ctx: QueryCtx,
  schoolId: Id<"schools">,
): Promise<StudentWithTag[]> {
  const students = await ctx.db
    .query("students")
    .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "active"))
    .take(MAX_ROSTER);

  const result: StudentWithTag[] = [];
  for (const student of students) {
    const tag = await findActiveTagForStudent(ctx, student._id);
    result.push({
      _id: student._id,
      fullName: student.fullName,
      className: student.className,
      tagUid: tag?.tagUid,
    });
  }
  return result;
}

export async function assignTagToStudent(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  studentId: Id<"students">,
  rawTagUid: string,
): Promise<{ tagUid: string }> {
  const student = await ctx.db.get(studentId);
  if (!student || student.schoolId !== schoolId) {
    throw new ConvexError(ReaderFailure.StudentNotInSchool);
  }

  const tagUid = normaliseTagUid(rawTagUid);
  const now = Date.now();

  const existingHolder = await ctx.db
    .query("tags")
    .withIndex("by_tagUid", (q) => q.eq("tagUid", tagUid))
    .unique();
  if (existingHolder?.studentId === studentId && existingHolder.status === "active") {
    return { tagUid };
  }
  if (existingHolder) {
    await ctx.db.delete(existingHolder._id);
  }

  const previousTag = await findActiveTagForStudent(ctx, studentId);
  if (previousTag) {
    await ctx.db.patch(previousTag._id, { status: "revoked", revokedAt: now, revocationReason: REASSIGNED });
  }

  await ctx.db.insert("tags", { tagUid, studentId, status: "active", issuedAt: now });
  return { tagUid };
}

async function findActiveTagForStudent(ctx: QueryCtx, studentId: Id<"students">) {
  return await ctx.db
    .query("tags")
    .withIndex("by_student_status", (q) => q.eq("studentId", studentId).eq("status", "active"))
    .first();
}
