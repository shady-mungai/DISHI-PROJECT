import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { addDays, toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { WEEKLY_DIGEST_EVENT } from "./rules";

const SCHEMA_VERSION = 1;
const DAYS_PER_WEEK = 7;
const MONDAY_OFFSET = 6;
const MAX_STUDENTS_PER_SCHOOL = 500;
const MAX_LINKS_PER_STUDENT = 10;
const LINE_SEPARATOR = "; ";

function mondayOf(serviceDate: string): string {
  const weekday = new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
  return addDays(serviceDate, -((weekday + MONDAY_OFFSET) % DAYS_PER_WEEK));
}

// P-05: "<first name> <taken>/<possible> meals, KES <closing balance>".
async function studentLine(ctx: MutationCtx, student: Doc<"students">, weekStart: string, weekEnd: string): Promise<string> {
  const expectations = await ctx.db
    .query("expectations")
    .withIndex("by_student_serviceDate", (q) => q.eq("studentId", student._id).gte("serviceDate", weekStart).lte("serviceDate", weekEnd))
    .collect();
  const taken = expectations.filter((row) => row.status === "fulfilled").length;
  const wallet = await ctx.db
    .query("wallets")
    .withIndex("by_student", (q) => q.eq("studentId", student._id))
    .unique();
  const firstName = student.fullName.split(" ")[0];
  return `${firstName} ${taken}/${expectations.length} meals, KES ${wallet?.balanceKes ?? 0}`;
}

async function collectLines(ctx: MutationCtx, weekStart: string, weekEnd: string): Promise<Map<Id<"guardians">, { schoolId: Id<"schools">; lines: string[] }>> {
  const byGuardian = new Map<Id<"guardians">, { schoolId: Id<"schools">; lines: string[] }>();
  // ponytail: one transaction over every active student; page per school when a school outgrows the read budget
  const schools = await ctx.db.query("schools").collect();
  for (const school of schools.filter((row) => row.active)) {
    const students = await ctx.db
      .query("students")
      .withIndex("by_school_status", (q) => q.eq("schoolId", school._id).eq("status", "active"))
      .take(MAX_STUDENTS_PER_SCHOOL);
    for (const student of students) {
      const line = await studentLine(ctx, student, weekStart, weekEnd);
      const links = await ctx.db
        .query("guardianLinks")
        .withIndex("by_student", (q) => q.eq("studentId", student._id))
        .take(MAX_LINKS_PER_STUDENT);
      for (const link of links.filter((row) => row.active)) {
        const entry = byGuardian.get(link.guardianId) ?? { schoolId: school._id, lines: [] };
        entry.lines.push(line);
        byGuardian.set(link.guardianId, entry);
      }
    }
  }
  return byGuardian;
}

// P-05 / FR-402 (Window class): one guardian-addressed event per guardian; the
// rules engine renders, applies policy and sends like any other event.
export const sendWeeklyDigest = internalMutation({
  args: { serviceDate: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const weekEnd = args.serviceDate ?? toServiceDate(now);
    const weekStart = mondayOf(weekEnd);
    const byGuardian = await collectLines(ctx, weekStart, weekEnd);
    let emitted = 0;
    for (const [guardianId, entry] of byGuardian) {
      const eventId = `${WEEKLY_DIGEST_EVENT}:${guardianId}:${weekEnd}`;
      const existing = await ctx.db
        .query("events")
        .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
        .unique();
      if (existing) {
        continue;
      }
      await recordEvent(ctx, {
        eventId,
        type: WEEKLY_DIGEST_EVENT,
        occurredAt: now,
        recordedAt: now,
        schemaVersion: SCHEMA_VERSION,
        correlationId: eventId,
        payload: { guardian_id: guardianId, summary: entry.lines.join(LINE_SEPARATOR), week_start: weekStart, week_end: weekEnd },
        schoolId: entry.schoolId,
      });
      emitted += 1;
    }
    return emitted;
  },
});
