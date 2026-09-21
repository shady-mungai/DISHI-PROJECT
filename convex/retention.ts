import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { readNumberSetting, SettingKey } from "./settings";

const MILLISECONDS_PER_DAY = 86_400_000;
const PURGE_BATCH = 100;
const STUDENT_SCAN_CAP = 1000;
const GUARDIAN_LINK_CAP = 20;
const DEFAULT_EVENT_DAYS = 365;
const DEFAULT_NOTIFICATION_DAYS = 90;
const DEFAULT_STUDENT_DAYS = 365;
const AUDIT_PREFIX = "admin.";
const DEIDENTIFIED_PREFIX = "Student ";

type PurgeResult = { events: number; notifications: number; studentsDeidentified: number; chained: boolean };

function cutoffFor(days: number, now: number): number {
  return now - days * MILLISECONDS_PER_DAY;
}

// NFR-505: operational rows are deleted after their class's retention;
// audit events (FR-802) are kept. ponytail: one batch per class per run,
// chained until nothing is left — good for a nightly cron at pilot scale.
async function purgeEvents(ctx: MutationCtx, cutoff: number): Promise<number> {
  const rows = await ctx.db
    .query("events")
    .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
    .take(PURGE_BATCH);
  let deleted = 0;
  for (const row of rows) {
    if (row.type.startsWith(AUDIT_PREFIX)) {
      continue;
    }
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return deleted;
}

async function purgeNotifications(ctx: MutationCtx, cutoff: number): Promise<number> {
  const rows = await ctx.db
    .query("notifications")
    .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
    .take(PURGE_BATCH);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

// A deactivated child past retention keeps the row (counts stay true) but
// loses the name and the guardian links.
async function deidentifyStudents(ctx: MutationCtx, cutoff: number): Promise<number> {
  const students = await ctx.db.query("students").take(STUDENT_SCAN_CAP);
  let changed = 0;
  for (const student of students) {
    const expired = student.status === "deactivated" && student.deactivatedAt !== undefined && student.deactivatedAt < cutoff;
    if (!expired || student.fullName.startsWith(DEIDENTIFIED_PREFIX)) {
      continue;
    }
    await ctx.db.patch(student._id, { fullName: `${DEIDENTIFIED_PREFIX}${student.studentRef}` });
    const links = await ctx.db
      .query("guardianLinks")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .take(GUARDIAN_LINK_CAP);
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    changed += 1;
  }
  return changed;
}

export async function purgeExpiredOnce(ctx: MutationCtx): Promise<PurgeResult> {
  const now = Date.now();
  const events = await purgeEvents(ctx, cutoffFor(await readNumberSetting(ctx, SettingKey.RetentionEventDays, DEFAULT_EVENT_DAYS), now));
  const notifications = await purgeNotifications(ctx, cutoffFor(await readNumberSetting(ctx, SettingKey.RetentionNotificationDays, DEFAULT_NOTIFICATION_DAYS), now));
  const studentsDeidentified = await deidentifyStudents(ctx, cutoffFor(await readNumberSetting(ctx, SettingKey.RetentionStudentDays, DEFAULT_STUDENT_DAYS), now));
  const chained = events === PURGE_BATCH || notifications === PURGE_BATCH;
  if (chained) {
    await ctx.scheduler.runAfter(0, internal.retention.purgeExpired, {});
  }
  return { events, notifications, studentsDeidentified, chained };
}

export const purgeExpired = internalMutation({
  args: {},
  returns: v.object({ events: v.number(), notifications: v.number(), studentsDeidentified: v.number(), chained: v.boolean() }),
  handler: async (ctx) => await purgeExpiredOnce(ctx),
});
