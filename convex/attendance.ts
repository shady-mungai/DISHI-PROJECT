import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireSchoolScope } from "./lib/authz";
import { toServiceDate } from "./lib/dates";
import type { DayAttendance } from "./lib/dishInsights";

const MAX_REGISTER_SIZE = 5000;
const SUMMARY_READ_CAP = 1000;

export const RegisterFailure = {
  Closed: "The register for today closed at the meal cutoff.",
  TooLarge: "Too many pupils in one register.",
  NotInSchool: "A pupil in the register is not active at this school.",
} as const;

export async function registerFor(ctx: QueryCtx, schoolId: Id<"schools">, serviceDate: string): Promise<Doc<"registers"> | null> {
  return await ctx.db
    .query("registers")
    .withIndex("by_schoolId_and_serviceDate", (q) => q.eq("schoolId", schoolId).eq("serviceDate", serviceDate))
    .unique();
}

// ponytail: capped reads per status, same ceiling as countExpectations; move to
// @convex-dev/aggregate once a school passes SUMMARY_READ_CAP pupils.
async function expectationsWith(ctx: QueryCtx, key: { schoolId: Id<"schools">; serviceDate: string; status: Doc<"expectations">["status"] }) {
  return await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) => q.eq("schoolId", key.schoolId).eq("serviceDate", key.serviceDate).eq("status", key.status))
    .take(SUMMARY_READ_CAP);
}

export async function dayAttendanceSummary(ctx: QueryCtx, day: { schoolId: Id<"schools">; serviceDate: string }): Promise<DayAttendance> {
  const missed = await expectationsWith(ctx, { ...day, status: "missed" });
  const missedWith = (reason: Doc<"expectations">["missReason"]) => missed.filter((row) => (row.missReason ?? "unknown") === reason).length;
  return {
    registerTaken: (await registerFor(ctx, day.schoolId, day.serviceDate)) !== null,
    absent: (await expectationsWith(ctx, { ...day, status: "absent" })).length,
    missedPresent: missedWith("present"),
    missedSupply: missedWith("supply"),
    missedUnknown: missedWith("unknown"),
  };
}

async function assertRegisterOpen(ctx: QueryCtx, schoolId: Id<"schools">, serviceDate: string, now: number): Promise<void> {
  const anyExpectation = await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) => q.eq("schoolId", schoolId).eq("serviceDate", serviceDate))
    .first();
  if (anyExpectation && now >= anyExpectation.cutoffAt) {
    throw new ConvexError(RegisterFailure.Closed);
  }
}

async function assertActivePupils(ctx: QueryCtx, schoolId: Id<"schools">, studentIds: ReadonlyArray<Id<"students">>): Promise<void> {
  for (const studentId of studentIds) {
    const student = await ctx.db.get(studentId);
    if (student?.schoolId !== schoolId || student.status !== "active") {
      throw new ConvexError(RegisterFailure.NotInSchool);
    }
  }
}

// Everyone not listed is present. Resubmitting replaces today's list; a tap
// still wins over an absent mark because the sweep only touches pending rows.
export async function submitRegister(
  ctx: MutationCtx,
  args: { actor: Doc<"users">; schoolId: Id<"schools">; absentStudentIds: ReadonlyArray<Id<"students">> },
): Promise<{ serviceDate: string; absent: number }> {
  const now = Date.now();
  const serviceDate = toServiceDate(now);
  const absentStudentIds = [...new Set(args.absentStudentIds)];
  if (absentStudentIds.length > MAX_REGISTER_SIZE) {
    throw new ConvexError(RegisterFailure.TooLarge);
  }
  await assertRegisterOpen(ctx, args.schoolId, serviceDate, now);
  await assertActivePupils(ctx, args.schoolId, absentStudentIds);
  const register = { absentStudentIds, takenBy: args.actor._id, takenAt: now };
  const existing = await registerFor(ctx, args.schoolId, serviceDate);
  if (existing) {
    await ctx.db.patch(existing._id, register);
  } else {
    await ctx.db.insert("registers", { schoolId: args.schoolId, serviceDate, ...register });
  }
  return { serviceDate, absent: absentStudentIds.length };
}

export const submit = mutation({
  args: { schoolId: v.id("schools"), absentStudentIds: v.array(v.id("students")) },
  returns: v.object({ serviceDate: v.string(), absent: v.number() }),
  handler: async (ctx, args) => {
    const actor = await requireSchoolScope(ctx, args.schoolId);
    return await submitRegister(ctx, { actor, ...args });
  },
});

export const forDay = query({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.union(v.null(), v.object({ absentStudentIds: v.array(v.id("students")), takenAt: v.number() })),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const register = await registerFor(ctx, args.schoolId, args.serviceDate);
    return register ? { absentStudentIds: register.absentStudentIds, takenAt: register.takenAt } : null;
  },
});
