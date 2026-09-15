import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { nairobiDayStart } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { smsSegments } from "./lib/gsm7";
import { applyPolicy, type PolicyDecision } from "./lib/policy";
import { evaluatePredicate, parsePredicate } from "./lib/predicate";
import { renderTemplate, renderWorstCase } from "./lib/template";
import { readNumberSetting, SettingKey } from "./settings";

const MAX_RULES_PER_EVENT = 50;
const MAX_GUARDIANS_PER_STUDENT = 10;
const ALWAYS = JSON.stringify({ op: "always" });
const DEFAULT_PRIORITY = 100;
const DEFAULT_DAILY_CAP = 3;
const DEFAULT_QUIET_START_HOUR = 21;
const DEFAULT_QUIET_END_HOUR = 6;
const SINGLE_SEGMENT = 1;
const SCHEMA_VERSION = 1;

type RuleSeed = Omit<Doc<"rules">, "_id" | "_creationTime">;

// FR-403 / AD-04: rules are rows, not code. Editing these in the dashboard
// changes behaviour without a deploy.
export const DEMO_RULES: ReadonlyArray<RuleSeed> = [
  {
    key: "guardian.meal_tapped",
    eventType: "meal.tapped",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "Dear {{guardian}}, {{child}} had lunch at {{school}} today ({{date}}).",
      sw: "Mpendwa {{guardian}}, {{child}} amekula chakula cha mchana {{school}} leo ({{date}}).",
    },
    templateVersion: 2,
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.meal_missed",
    eventType: "meal.missed",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "Dear {{guardian}}, {{child}} did not tap for lunch at {{school}} on {{date}}. Please check in.",
      sw: "Mpendwa {{guardian}}, {{child}} hakula chakula cha mchana {{school}} tarehe {{date}}. Tafadhali fuatilia.",
    },
    templateVersion: 2,
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
];

// FR-506 / NFR-603: a template that can exceed one segment fails here, before
// it is ever stored.
export function assertSingleSegment(rule: RuleSeed): void {
  for (const [language, template] of Object.entries(rule.templates)) {
    const segments = smsSegments(renderWorstCase(template));
    if (segments > SINGLE_SEGMENT) {
      throw new Error(`rule ${rule.key} (${language}) can span ${segments} segments`);
    }
  }
}

export async function seedRules(ctx: MutationCtx): Promise<number> {
  let created = 0;
  for (const rule of DEMO_RULES) {
    assertSingleSegment(rule);
    const existing = await ctx.db
      .query("rules")
      .withIndex("by_key", (q) => q.eq("key", rule.key))
      .unique();
    if (!existing) {
      await ctx.db.insert("rules", rule);
      created += 1;
    } else if (existing.templateVersion !== rule.templateVersion) {
      await ctx.db.patch(existing._id, { templates: rule.templates, templateVersion: rule.templateVersion });
    }
  }
  return created;
}

// ponytail: cap is a per-guardian day scan (≤ cap rows); the rate-limiter
// component replaces this if guardians ever get more than a handful a day.
async function countSentToday(ctx: MutationCtx, guardianId: Doc<"guardians">["_id"], now: number): Promise<number> {
  const today = await ctx.db
    .query("notifications")
    .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId).gte("_creationTime", nairobiDayStart(now)))
    .collect();
  return today.filter((row) => row.status !== "suppressed").length;
}

async function decide(ctx: MutationCtx, guardian: Doc<"guardians">, eventType: string, now: number): Promise<PolicyDecision> {
  return applyPolicy({
    eventType,
    optedOutTypes: guardian.optedOutTypes,
    now,
    quietHoursStart: await readNumberSetting(ctx, SettingKey.QuietHoursStartHour, DEFAULT_QUIET_START_HOUR),
    quietHoursEnd: await readNumberSetting(ctx, SettingKey.QuietHoursEndHour, DEFAULT_QUIET_END_HOUR),
    sentTodayCount: await countSentToday(ctx, guardian._id, now),
    dailyCap: await readNumberSetting(ctx, SettingKey.DailyMessageCap, DEFAULT_DAILY_CAP),
  });
}

type Candidate = {
  rule: Doc<"rules">;
  event: Doc<"events">;
  guardian: Doc<"guardians">;
  dedupeKey: string;
  body: string;
};

function notificationFields(candidate: Candidate) {
  return {
    dedupeKey: candidate.dedupeKey,
    ruleKey: candidate.rule.key,
    eventId: candidate.event._id,
    correlationId: candidate.event.correlationId,
    schoolId: candidate.event.schoolId,
    guardianId: candidate.guardian._id,
    msisdn: candidate.guardian.msisdn,
    channel: candidate.rule.channel,
    body: candidate.body,
    segments: smsSegments(candidate.body),
    templateVersion: candidate.rule.templateVersion,
  };
}

// FR-502: a withheld message is still a row, plus an auditable event.
async function recordSuppressed(ctx: MutationCtx, candidate: Candidate, reason: string, now: number): Promise<void> {
  const notificationId = await ctx.db.insert("notifications", {
    ...notificationFields(candidate),
    status: "suppressed",
    suppressionReason: reason,
  });
  await recordEvent(ctx, {
    eventId: `notification.suppressed:${notificationId}`,
    type: "notification.suppressed",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: candidate.event.correlationId,
    payload: { notification_id: notificationId, suppression_reason: reason, rule_key: candidate.rule.key },
    schoolId: candidate.event.schoolId,
  });
}

async function queueNotification(ctx: MutationCtx, candidate: Candidate, deliverAt: number | undefined): Promise<void> {
  const notificationId = await ctx.db.insert("notifications", {
    ...notificationFields(candidate),
    status: "queued",
    deliverAt,
  });
  if (deliverAt === undefined) {
    await ctx.scheduler.runAfter(0, internal.channels.deliver, { notificationId });
    return;
  }
  await ctx.scheduler.runAt(deliverAt, internal.channels.deliver, { notificationId });
}

async function notifyGuardians(ctx: MutationCtx, rule: Doc<"rules">, event: Doc<"events">): Promise<number> {
  if (!event.studentId) {
    return 0;
  }
  const student = await ctx.db.get(event.studentId);
  if (!student) {
    return 0;
  }
  const school = await ctx.db.get(student.schoolId);
  const templateVars = {
    child: student.fullName,
    school: school?.name ?? "",
    date: event.serviceDate ?? "",
  };

  const links = await ctx.db
    .query("guardianLinks")
    .withIndex("by_student", (q) => q.eq("studentId", student._id))
    .take(MAX_GUARDIANS_PER_STUDENT);

  const now = Date.now();
  let queued = 0;
  for (const link of links.filter((candidate) => candidate.active)) {
    const guardian = await ctx.db.get(link.guardianId);
    if (!guardian) {
      continue;
    }
    const dedupeKey = `${rule.key}:${event.eventId}:${guardian._id}`;
    const duplicate = await ctx.db
      .query("notifications")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .unique();
    if (duplicate) {
      continue;
    }
    const body = renderTemplate(rule.templates[guardian.language], { ...templateVars, guardian: guardian.displayName });
    const candidate: Candidate = { rule, event, guardian, dedupeKey, body };
    const decision = await decide(ctx, guardian, event.type, now);
    if (decision.action === "suppress") {
      await recordSuppressed(ctx, candidate, decision.reason, now);
      continue;
    }
    await queueNotification(ctx, candidate, decision.action === "defer" ? decision.deliverAt : undefined);
    queued += 1;
  }
  return queued;
}

// FR-402 (Event + Absence classes): scheduled by recordEvent for every event.
// Re-running for the same event is a no-op via the notification dedupeKey.
export const evaluate = internalMutation({
  args: { eventId: v.id("events") },
  returns: v.object({ matched: v.number(), queued: v.number() }),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      return { matched: 0, queued: 0 };
    }
    const rules = await ctx.db
      .query("rules")
      .withIndex("by_eventType", (q) => q.eq("eventType", event.type))
      .take(MAX_RULES_PER_EVENT);

    let matched = 0;
    let queued = 0;
    for (const rule of rules.filter((candidate) => candidate.enabled)) {
      const predicate = parsePredicate(rule.predicate);
      if (!predicate || !evaluatePredicate(predicate, event.payload)) {
        continue;
      }
      matched += 1;
      queued += await notifyGuardians(ctx, rule, event);
    }
    return { matched, queued };
  },
});
