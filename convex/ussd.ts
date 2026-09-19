import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { msisdnVariants, renderUssd } from "./lib/ussd";
import type { UssdChild, UssdEffect, UssdGuardian } from "./lib/ussd";

const SCHEMA_VERSION = 1;
const HISTORY_ROWS = 6;

async function findGuardian(ctx: MutationCtx, msisdn: string): Promise<Doc<"guardians"> | null> {
  for (const variant of msisdnVariants(msisdn)) {
    const guardian = await ctx.db
      .query("guardians")
      .withIndex("by_msisdn", (q) => q.eq("msisdn", variant))
      .unique();
    if (guardian) {
      return guardian;
    }
  }
  return null;
}

async function loadChild(ctx: MutationCtx, studentId: Id<"students">, today: string): Promise<UssdChild | null> {
  const student = await ctx.db.get(studentId);
  if (!student || student.status !== "active") {
    return null;
  }
  const wallet = await ctx.db
    .query("wallets")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .unique();
  const expectations = await ctx.db
    .query("expectations")
    .withIndex("by_student_serviceDate", (q) => q.eq("studentId", studentId).lte("serviceDate", today))
    .order("desc")
    .take(HISTORY_ROWS);
  const todayRow = expectations.find((row) => row.serviceDate === today);
  return {
    name: student.fullName,
    balanceKes: wallet?.balanceKes ?? 0,
    today: todayRow?.status ?? null,
    history: expectations
      .filter((row) => row.serviceDate !== today)
      .map((row) => ({ serviceDate: row.serviceDate, status: row.status })),
  };
}

async function loadGuardianSnapshot(ctx: MutationCtx, guardian: Doc<"guardians">, today: string): Promise<UssdGuardian> {
  const links = await ctx.db
    .query("guardianLinks")
    .withIndex("by_guardian", (q) => q.eq("guardianId", guardian._id))
    .filter((q) => q.eq(q.field("active"), true))
    .collect();
  const children: UssdChild[] = [];
  for (const link of links) {
    const child = await loadChild(ctx, link.studentId, today);
    if (child) {
      children.push(child);
    }
  }
  return { language: guardian.language, optedOutTypes: guardian.optedOutTypes, children };
}

async function alreadyApplied(ctx: MutationCtx, eventId: string): Promise<boolean> {
  const existing = await ctx.db
    .query("events")
    .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
    .unique();
  return existing !== null;
}

// The gateway may replay a GET; the eventId carries the session so a replayed
// END screen does not flip a preference back or double-audit a number change.
async function applyEffect(ctx: MutationCtx, guardian: Doc<"guardians">, effect: UssdEffect, sessionId: string): Promise<void> {
  const now = Date.now();
  if (effect.kind === "toggleOptOut") {
    const eventId = `guardian.preferences_updated:${sessionId}:${effect.eventType}`;
    if (await alreadyApplied(ctx, eventId)) {
      return;
    }
    const optedOut = guardian.optedOutTypes.includes(effect.eventType);
    const optedOutTypes = optedOut
      ? guardian.optedOutTypes.filter((type) => type !== effect.eventType)
      : [...guardian.optedOutTypes, effect.eventType];
    await ctx.db.patch(guardian._id, { optedOutTypes });
    await recordEvent(ctx, {
      eventId,
      type: "guardian.preferences_updated",
      occurredAt: now,
      recordedAt: now,
      schemaVersion: SCHEMA_VERSION,
      correlationId: sessionId,
      payload: { guardian_id: guardian._id, notification_type: effect.eventType, opted_out: !optedOut, channel: "ussd" },
    });
    return;
  }
  const eventId = `guardian.contact_updated:${sessionId}`;
  if (await alreadyApplied(ctx, eventId)) {
    return;
  }
  await ctx.db.patch(guardian._id, { msisdn: effect.msisdn });
  await recordEvent(ctx, {
    eventId,
    type: "guardian.contact_updated",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: sessionId,
    payload: { guardian_id: guardian._id, msisdn: effect.msisdn, previous_msisdn: guardian.msisdn, channel: "ussd" },
  });
}

export const step = internalMutation({
  args: { sessionId: v.string(), msisdn: v.string(), inputs: v.array(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const guardian = await findGuardian(ctx, args.msisdn);
    const snapshot = guardian ? await loadGuardianSnapshot(ctx, guardian, toServiceDate(Date.now())) : null;
    const reply = renderUssd(snapshot, args.inputs);
    if (guardian && reply.effect) {
      await applyEffect(ctx, guardian, reply.effect, args.sessionId);
    }
    return reply.text;
  },
});
