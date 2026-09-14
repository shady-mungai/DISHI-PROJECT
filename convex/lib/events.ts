import type { WithoutSystemFields } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// FR-401: every event is appended here and its rule evaluation is scheduled in
// the same transaction — the write and the evaluation commit together.
export async function recordEvent(
  ctx: MutationCtx,
  event: WithoutSystemFields<Doc<"events">>,
): Promise<Id<"events">> {
  const eventId = await ctx.db.insert("events", event);
  await ctx.scheduler.runAfter(0, internal.rules.evaluate, { eventId });
  return eventId;
}
