import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { countExpectations } from "./expectations";
import { recordEvent } from "./lib/events";
import { runRate } from "./lib/monitor";
import { readNumberSetting, SettingKey } from "./settings";

const SCHEMA_VERSION = 1;
const STALLED_EVENT = "service.stalled";
const DEFAULT_STALLED_THRESHOLD_PCT = 30;

export type StalledCheck = { status: "no_window" | "window_closed" | "on_track" | "stalled" | "already_flagged"; shortfallPct: number };

// FR-607 / SU-04: one intra-day check per school per service day, scheduled
// from startServiceDay at the window midpoint. Emits once; a rerun is a no-op.
export async function checkStalledService(ctx: MutationCtx, args: { schoolId: Id<"schools">; serviceDate: string }): Promise<StalledCheck> {
  const anyExpectation = await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) => q.eq("schoolId", args.schoolId).eq("serviceDate", args.serviceDate))
    .first();
  if (!anyExpectation) {
    return { status: "no_window", shortfallPct: 0 };
  }
  const now = Date.now();
  if (now > anyExpectation.windowEnd) {
    return { status: "window_closed", shortfallPct: 0 };
  }
  const fulfilled = await countExpectations(ctx, { ...args, status: "fulfilled" });
  const pending = await countExpectations(ctx, { ...args, status: "pending" });
  const rate = runRate({ expected: fulfilled + pending, tapsSoFar: fulfilled, windowStart: anyExpectation.windowStart, windowEnd: anyExpectation.windowEnd, now });
  const threshold = await readNumberSetting(ctx, SettingKey.StalledServiceThresholdPct, DEFAULT_STALLED_THRESHOLD_PCT);
  if (rate.shortfallPct < threshold) {
    return { status: "on_track", shortfallPct: rate.shortfallPct };
  }
  const eventId = `${STALLED_EVENT}:${args.schoolId}:${args.serviceDate}`;
  const already = await ctx.db
    .query("events")
    .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
    .unique();
  if (already) {
    return { status: "already_flagged", shortfallPct: rate.shortfallPct };
  }
  await recordEvent(ctx, {
    eventId,
    type: STALLED_EVENT,
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: eventId,
    payload: { school_id: args.schoolId, taps_so_far: fulfilled, expected_run_rate: rate.expectedSoFar, at_time: now, shortfall_pct: rate.shortfallPct },
    schoolId: args.schoolId,
    serviceDate: args.serviceDate,
  });
  return { status: "stalled", shortfallPct: rate.shortfallPct };
}

export const checkStalled = internalMutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.object({
    status: v.union(v.literal("no_window"), v.literal("window_closed"), v.literal("on_track"), v.literal("stalled"), v.literal("already_flagged")),
    shortfallPct: v.number(),
  }),
  handler: async (ctx, args) => await checkStalledService(ctx, args),
});
