import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireSchoolScope } from "./lib/authz";
import { toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { sha256Hex } from "./lib/hmac";
import { normaliseTagUid } from "./lib/tagUid";
import { readNumberSetting, SettingKey } from "./settings";

const PHONE_DEVICE_PREFIX = "PHONE";
const PHONE_DEVICE_FIRMWARE = "pwa-1";
const DEVICE_REF_RANDOM_HEX_LENGTH = 8;
const MAX_ROSTER = 1000;
const MAX_DEVICES = 100;
const MAX_SCHOOLS = 100;
const REASSIGNED = "reassigned";
const SCHEMA_VERSION = 1;
const DEFAULT_READER_SILENT_HOURS = 20;
const MILLISECONDS_PER_HOUR = 3_600_000;
const SILENT_EVENT = "device.heartbeat_missed";

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
  await recordEvent(ctx, {
    eventId: `student.tag_assigned:${studentId}:${now}`,
    type: "student.tag_assigned",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: studentId,
    payload: { student_id: studentId, tag_uid: tagUid, issued_at: now, previous_tag_uid: previousTag?.tagUid ?? "" },
    schoolId,
    studentId,
  });
  return { tagUid };
}

const readerHealthValidator = v.object({
  deviceRef: v.string(),
  firmwareVersion: v.string(),
  lastSeenAt: v.optional(v.number()),
  silentAfterMs: v.number(),
});

// SC-04: the page passes `now` and decides "silent" from lastSeenAt +
// silentAfterMs, so the query stays cacheable and free of wall-clock reads.
export const fleet = query({
  args: { schoolId: v.id("schools") },
  returns: v.array(readerHealthValidator),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const silentAfterMs = (await readNumberSetting(ctx, SettingKey.ReaderSilentHours, DEFAULT_READER_SILENT_HOURS)) * MILLISECONDS_PER_HOUR;
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(MAX_DEVICES);
    return devices.map((device) => ({ deviceRef: device.deviceRef, firmwareVersion: device.firmwareVersion, lastSeenAt: device.lastSeenAt, silentAfterMs }));
  },
});

// Absence class: a reader that has synced before but not within the window.
// Never-seen devices are unprovisioned hardware, not a failure. One event per
// device per service day.
export async function flagSilentReadersForSchool(ctx: MutationCtx, schoolId: Id<"schools">): Promise<number> {
  const now = Date.now();
  const serviceDate = toServiceDate(now);
  const silentAfterMs = (await readNumberSetting(ctx, SettingKey.ReaderSilentHours, DEFAULT_READER_SILENT_HOURS)) * MILLISECONDS_PER_HOUR;
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .take(MAX_DEVICES);
  let flagged = 0;
  for (const device of devices) {
    if (device.lastSeenAt === undefined || now - device.lastSeenAt < silentAfterMs) {
      continue;
    }
    const eventId = `${SILENT_EVENT}:${device.deviceRef}:${serviceDate}`;
    const already = await ctx.db
      .query("events")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (already) {
      continue;
    }
    await recordEvent(ctx, {
      eventId,
      type: SILENT_EVENT,
      occurredAt: now,
      recordedAt: now,
      schemaVersion: SCHEMA_VERSION,
      correlationId: eventId,
      payload: { device_id: device.deviceRef, school_id: schoolId, last_seen: device.lastSeenAt },
      schoolId,
      sourceDeviceRef: device.deviceRef,
      serviceDate,
    });
    flagged += 1;
  }
  return flagged;
}

export const flagSilentReadersFor = internalMutation({
  args: { schoolId: v.id("schools") },
  returns: v.number(),
  handler: async (ctx, args) => await flagSilentReadersForSchool(ctx, args.schoolId),
});

export const flagSilentReaders = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").take(MAX_SCHOOLS);
    let scheduled = 0;
    for (const school of schools.filter((candidate) => candidate.active)) {
      await ctx.scheduler.runAfter(0, internal.readers.flagSilentReadersFor, { schoolId: school._id });
      scheduled += 1;
    }
    return scheduled;
  },
});

async function findActiveTagForStudent(ctx: QueryCtx, studentId: Id<"students">) {
  return await ctx.db
    .query("tags")
    .withIndex("by_student_status", (q) => q.eq("studentId", studentId).eq("status", "active"))
    .first();
}
