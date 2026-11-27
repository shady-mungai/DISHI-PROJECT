import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { AuditType, recordAudit } from "./admin";
import { requireSchoolScope } from "./lib/authz";
import { serviceStartFor, toServiceDate } from "./lib/dates";
import { hmacSha256Hex, sha256Hex } from "./lib/hmac";
import { planServiceDay } from "./lib/simulation";
import { readSetting, SettingKey } from "./settings";

const SIM_DEVICE_REF = "SIM-READER-01";
const SIM_DEVICE_FIRMWARE = "sim-1.0.0";
const MAX_ROSTER = 1000;
const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_NO_SHOW_COUNT = 0;
const DEFAULT_SERVICE_WINDOW_MINUTES = 90;
const INGEST_PATH = "/ingest";

const simulationArgs = {
  schoolId: v.id("schools"),
  serviceDate: v.string(),
  seed: v.number(),
  noShowCount: v.optional(v.number()),
  batchSize: v.optional(v.number()),
};

const ingestResultCounts = { accepted: v.number(), duplicate: v.number(), rejected: v.number() };

type IngestResultCounts = { accepted: number; duplicate: number; rejected: number };

type PreparedSchool = {
  deviceRef: string;
  signingKeyHex: string;
  tagUids: string[];
  windowMinutes: number;
  portionsReceived: number | null;
};

// FR-804: the simulator uses a real registered reader so its taps go through
// the same HMAC gate as hardware. The device secret is derived from the
// deployment's own signing material, never typed by a human.
export const prepare = internalMutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.object({
    deviceRef: v.string(),
    signingKeyHex: v.string(),
    tagUids: v.array(v.string()),
    windowMinutes: v.number(),
    portionsReceived: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args): Promise<PreparedSchool> => {
    const actor = await requireSchoolScope(ctx, args.schoolId);

    const deviceRef = `${SIM_DEVICE_REF}:${args.schoolId}`;
    const freshSecretHash = () => sha256Hex(`${deviceRef}:${crypto.randomUUID()}`);
    let device = await ctx.db
      .query("devices")
      .withIndex("by_deviceRef", (q) => q.eq("deviceRef", deviceRef))
      .unique();
    if (!device) {
      const deviceId = await ctx.db.insert("devices", {
        deviceRef,
        schoolId: args.schoolId,
        secretHash: await freshSecretHash(),
        firmwareVersion: SIM_DEVICE_FIRMWARE,
        queueDepth: 0,
        clockSkewSeconds: 0,
      });
      device = (await ctx.db.get(deviceId))!;
    } else if (device.revokedAt !== undefined) {
      await ctx.db.patch(device._id, { secretHash: await freshSecretHash(), revokedAt: undefined });
      await recordAudit(ctx, actor, AuditType.DeviceReprovisioned, { device_id: deviceRef, school_id: args.schoolId });
      device = (await ctx.db.get(device._id))!;
    }

    const students = await ctx.db
      .query("students")
      .withIndex("by_school_status", (q) => q.eq("schoolId", args.schoolId).eq("status", "active"))
      .take(MAX_ROSTER);
    const tagUids: string[] = [];
    for (const student of students) {
      const tag = await ctx.db
        .query("tags")
        .withIndex("by_student_status", (q) => q.eq("studentId", student._id).eq("status", "active"))
        .first();
      if (tag) {
        tagUids.push(tag.tagUid);
      }
    }

    const windowMinutes = Number(
      (await readSetting(ctx, SettingKey.ServiceWindowMinutes)) ?? DEFAULT_SERVICE_WINDOW_MINUTES,
    );
    // Children can only eat food that arrived: with a delivery on record the
    // day's taps are capped at portions received. No delivery = uncapped.
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
      .collect();
    const portionsReceived =
      deliveries.length > 0 ? deliveries.reduce((sum, row) => sum + (row.portionsReceived ?? 0), 0) : null;

    return { deviceRef, signingKeyHex: device.secretHash, tagUids, windowMinutes, portionsReceived };
  },
});

async function postBatch(
  prepared: PreparedSchool,
  events: ReadonlyArray<{ eventId: string; tagUid: string; occurredAt: number }>,
): Promise<IngestResultCounts> {
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ events }));
  const response = await fetch(`${process.env.CONVEX_SITE_URL}${INGEST_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Ref": prepared.deviceRef,
      "X-Signature": await hmacSha256Hex(prepared.signingKeyHex, bodyBytes),
    },
    body: bodyBytes,
  });
  if (!response.ok) {
    throw new Error(`ingest_http_${response.status}`);
  }
  const { results } = (await response.json()) as { results: Array<{ status: keyof IngestResultCounts }> };
  const counts: IngestResultCounts = { accepted: 0, duplicate: 0, rejected: 0 };
  for (const result of results) {
    counts[result.status] += 1;
  }
  return counts;
}

// Scenarios: `noShowCount` = cohort that never taps (absence path);
// `batchSize` 1 = live reader, roster-sized = offline reader flushing its queue.
// Taps for a day other than today are stamped inside that day's real window,
// so ingest files them under the picked serviceDate (clock-skew flagged, accepted).
export const runServiceDay = action({
  args: simulationArgs,
  returns: v.object({
    ...ingestResultCounts,
    posted: v.number(),
    batches: v.number(),
    noShows: v.number(),
    elapsedMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const prepared = await ctx.runMutation(internal.simulator.prepare, {
      schoolId: args.schoolId,
      serviceDate: args.serviceDate,
    });
    const isToday = toServiceDate(startedAt) === args.serviceDate;
    const requestedNoShows = args.noShowCount ?? DEFAULT_NO_SHOW_COUNT;
    const noShowCount =
      prepared.portionsReceived === null
        ? requestedNoShows
        : Math.max(requestedNoShows, prepared.tagUids.length - prepared.portionsReceived);
    const plan = planServiceDay({
      tagUids: prepared.tagUids,
      seed: args.seed,
      serviceDate: args.serviceDate,
      windowStart: isToday ? startedAt : serviceStartFor(args.serviceDate),
      windowMinutes: prepared.windowMinutes,
      noShowCount,
      batchSize: args.batchSize ?? DEFAULT_BATCH_SIZE,
    });

    const totals: IngestResultCounts = { accepted: 0, duplicate: 0, rejected: 0 };
    let posted = 0;
    for (const batch of plan.batches) {
      const counts = await postBatch(prepared, batch);
      totals.accepted += counts.accepted;
      totals.duplicate += counts.duplicate;
      totals.rejected += counts.rejected;
      posted += batch.length;
    }

    return {
      ...totals,
      posted,
      batches: plan.batches.length,
      noShows: plan.noShowTagUids.length,
      elapsedMs: Date.now() - startedAt,
    };
  },
});
