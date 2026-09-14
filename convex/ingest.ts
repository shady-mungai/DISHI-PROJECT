import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { fulfilExpectation } from "./expectations";
import { toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { normaliseTagUid } from "./lib/tagUid";
import { readSetting, SettingKey } from "./settings";

const SCHEMA_VERSION = 1;
const DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS = 120;
const MILLISECONDS_PER_SECOND = 1000;
export const MAX_INGEST_BATCH_EVENTS = 200;

export const tapEventInputValidator = v.object({
  eventId: v.string(),
  tagUid: v.string(),
  occurredAt: v.number(),
  correlationId: v.optional(v.string()),
});

const tapResultValidator = v.object({
  eventId: v.string(),
  status: v.union(v.literal("accepted"), v.literal("duplicate"), v.literal("rejected")),
  reason: v.optional(v.string()),
});

export type TapEventInput = {
  eventId: string;
  tagUid: string;
  occurredAt: number;
  correlationId?: string;
};

// Unknown body -> narrow every field before trusting it; this is the one
// place request bytes cross into typed data (NFR-402 trust boundary).
export function parseIngestBody(body: unknown): TapEventInput[] | null {
  if (typeof body !== "object" || body === null || !("events" in body)) {
    return null;
  }
  const rawEvents = (body as { events: unknown }).events;
  if (!Array.isArray(rawEvents)) {
    return null;
  }

  const events: TapEventInput[] = [];
  for (const raw of rawEvents) {
    if (typeof raw !== "object" || raw === null) {
      return null;
    }
    const { eventId, tagUid, occurredAt, correlationId } = raw as Record<string, unknown>;
    if (typeof eventId !== "string" || typeof tagUid !== "string" || typeof occurredAt !== "number") {
      return null;
    }
    if (correlationId !== undefined && typeof correlationId !== "string") {
      return null;
    }
    events.push({ eventId, tagUid, occurredAt, correlationId });
  }
  return events;
}

export const getDeviceSecretHash = internalQuery({
  args: { deviceRef: v.string() },
  returns: v.union(v.null(), v.object({ secretHash: v.string() })),
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_deviceRef", (q) => q.eq("deviceRef", args.deviceRef))
      .unique();
    return device ? { secretHash: device.secretHash } : null;
  },
});

export const recordBatch = internalMutation({
  args: { deviceRef: v.string(), events: v.array(tapEventInputValidator) },
  returns: v.array(tapResultValidator),
  handler: async (ctx, args) => {
    const device = await ctx.db
      .query("devices")
      .withIndex("by_deviceRef", (q) => q.eq("deviceRef", args.deviceRef))
      .unique();
    if (!device) {
      return args.events.map((event) => ({
        eventId: event.eventId,
        status: "rejected" as const,
        reason: "unknown_device",
      }));
    }

    const skewToleranceSeconds = Number(
      (await readSetting(ctx, SettingKey.ClockSkewToleranceSeconds)) ?? DEFAULT_CLOCK_SKEW_TOLERANCE_SECONDS,
    );

    const results = [];
    for (const event of args.events) {
      results.push(await recordTap(ctx, device, event, skewToleranceSeconds));
    }

    await ctx.db.patch(device._id, { lastSeenAt: Date.now() });
    return results;
  },
});

async function recordTap(
  ctx: MutationCtx,
  device: Doc<"devices">,
  event: TapEventInput,
  skewToleranceSeconds: number,
): Promise<{ eventId: string; status: "accepted" | "duplicate" | "rejected"; reason?: string }> {
  const recordedAt = Date.now();

  // NFR-204: replaying the exact same device-generated id is a pure no-op —
  // nothing new is written, so replaying a queue never alters counts.
  const replay = await ctx.db
    .query("events")
    .withIndex("by_eventId", (q) => q.eq("eventId", event.eventId))
    .unique();
  if (replay) {
    return { eventId: event.eventId, status: "duplicate", reason: "replayed_event_id" };
  }

  const tagUid = normaliseTagUid(event.tagUid);
  const tag = await ctx.db
    .query("tags")
    .withIndex("by_tagUid", (q) => q.eq("tagUid", tagUid))
    .unique();
  if (!tag || tag.status !== "active") {
    return { eventId: event.eventId, status: "rejected", reason: tag ? "tag_revoked" : "unknown_tag" };
  }

  const student = await ctx.db.get(tag.studentId);
  if (!student || student.status !== "active") {
    return { eventId: event.eventId, status: "rejected", reason: "student_inactive" };
  }

  const serviceDate = toServiceDate(event.occurredAt);
  const skewSeconds = Math.abs(recordedAt - event.occurredAt) / MILLISECONDS_PER_SECOND;
  const clockSkewFlagged = skewSeconds > skewToleranceSeconds;
  const correlationId = event.correlationId ?? event.eventId;

  // FR-204/ST-04: a second tap on the same student, same service date is a
  // real physical event but not a second countable meal.
  const sameDayTap = await ctx.db
    .query("events")
    .withIndex("by_student_serviceDate_type", (q) =>
      q.eq("studentId", student._id).eq("serviceDate", serviceDate).eq("type", "meal.tapped"),
    )
    .first();

  if (sameDayTap) {
    await recordEvent(ctx, {
      eventId: event.eventId,
      type: "meal.duplicate_rejected",
      occurredAt: event.occurredAt,
      recordedAt,
      schemaVersion: SCHEMA_VERSION,
      correlationId,
      payload: { event_id: event.eventId, original_event_id: sameDayTap.eventId },
      schoolId: device.schoolId,
      sourceDeviceRef: device.deviceRef,
      studentId: student._id,
      serviceDate,
    });
    return { eventId: event.eventId, status: "duplicate", reason: "second_tap_same_day" };
  }

  await recordEvent(ctx, {
    eventId: event.eventId,
    type: "meal.tapped",
    occurredAt: event.occurredAt,
    recordedAt,
    schemaVersion: SCHEMA_VERSION,
    correlationId,
    payload: {
      student_id: student._id,
      tag_uid: tagUid,
      tapped_at: event.occurredAt,
      device_id: device.deviceRef,
      clock_skew_flagged: clockSkewFlagged,
    },
    schoolId: device.schoolId,
    sourceDeviceRef: device.deviceRef,
    studentId: student._id,
    serviceDate,
  });
  await fulfilExpectation(ctx, student._id, serviceDate);

  return {
    eventId: event.eventId,
    status: "accepted",
    reason: clockSkewFlagged ? "clock_skew_flagged" : undefined,
  };
}
