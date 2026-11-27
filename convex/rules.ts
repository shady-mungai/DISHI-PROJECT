import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { nairobiDayStart } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { smsSegments } from "./lib/gsm7";
import { applyPolicy, SuppressionReason, type PolicyDecision } from "./lib/policy";
import { evaluatePredicate, parsePredicate } from "./lib/predicate";
import { GREETINGS, renderGreeting, renderTemplate, renderWorstCase } from "./lib/template";
import { readNumberSetting, SettingKey } from "./settings";

const MAX_RULES_PER_EVENT = 50;
const MAX_GUARDIANS_PER_STUDENT = 10;
const ALWAYS = JSON.stringify({ op: "always" });
const DEFAULT_PRIORITY = 100;
const MISSED_PRIORITY = 200;
const WALLET_WARNING_PRIORITY = 150;
const DEFAULT_DAILY_CAP = 3;
const DEFAULT_QUIET_START_HOUR = 21;
const DEFAULT_QUIET_END_HOUR = 6;
const DEFAULT_COLLAPSE_WINDOW_MINUTES = 10;
const MILLISECONDS_PER_MINUTE = 60_000;
const SINGLE_SEGMENT = 1;
const SCHEMA_VERSION = 1;
const SENTENCE_SEPARATOR = " ";
export const WEEKLY_DIGEST_EVENT = "digest.weekly";

export type RuleSeed = Omit<Doc<"rules">, "_id" | "_creationTime">;

// FR-403 / AD-04: rules are rows, not code. Editing these in the dashboard
// changes behaviour without a deploy.
export const DEMO_RULES: ReadonlyArray<RuleSeed> = [
  {
    key: "guardian.meal_tapped",
    eventType: "meal.tapped",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "{{child}} had lunch at {{school}} today ({{date}}).",
      sw: "{{child}} amekula chakula cha mchana {{school}} leo ({{date}}).",
    },
    templateVersion: 3,
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.meal_override_served",
    eventType: "meal.override_served",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "{{child}} had lunch at {{school}} today ({{date}}).",
      sw: "{{child}} amekula chakula cha mchana {{school}} leo ({{date}}).",
    },
    templateVersion: 1,
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
      en: "{{child}} did not tap for lunch at {{school}} on {{date}}. Please check in.",
      sw: "{{child}} hakula chakula cha mchana {{school}} tarehe {{date}}. Tafadhali fuatilia.",
    },
    templateVersion: 3,
    channel: "sms",
    priority: MISSED_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.marked_absent",
    eventType: "meal.absent",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "{{child}} was marked absent at {{school}} on {{date}}. Please check in.",
      sw: "{{child}} ameandikwa hayupo {{school}} tarehe {{date}}. Tafadhali fuatilia.",
    },
    templateVersion: 1,
    channel: "sms",
    priority: MISSED_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.wallet_topped_up",
    eventType: "wallet.topped_up",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "KES {{amount}} added for {{child}}. Meal balance KES {{new_balance}}.",
      sw: "KES {{amount}} imeongezwa kwa {{child}}. Salio la chakula KES {{new_balance}}.",
    },
    templateVersion: 1,
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.wallet_low_balance",
    eventType: "wallet.low_balance",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "{{child}}'s meal balance is low: KES {{balance}}. Please top up.",
      sw: "Salio la chakula la {{child}} liko chini: KES {{balance}}. Tafadhali ongeza.",
    },
    templateVersion: 1,
    channel: "sms",
    priority: WALLET_WARNING_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.wallet_depleted",
    eventType: "wallet.depleted",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "{{child}}'s meal balance is used up. Meals continue; please top up.",
      sw: "Salio la chakula la {{child}} limeisha. Chakula kinaendelea; tafadhali ongeza.",
    },
    templateVersion: 1,
    channel: "sms",
    priority: MISSED_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.wallet_depletion_forecast",
    eventType: "wallet.depletion_forecast",
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "{{child}}'s balance covers {{meals_remaining}} more meals and runs out on {{projected_date}}. Please top up.",
      sw: "Salio la {{child}} linatosha chakula {{meals_remaining}} zaidi na litaisha {{projected_date}}. Tafadhali ongeza.",
    },
    templateVersion: 1,
    channel: "sms",
    priority: WALLET_WARNING_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.weekly_digest",
    eventType: WEEKLY_DIGEST_EVENT,
    predicate: ALWAYS,
    audience: "guardian",
    templates: {
      en: "This week: {{summary}}.",
      sw: "Wiki hii: {{summary}}.",
    },
    templateVersion: 1,
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
];

// FR-506 / NFR-603: a template that can exceed one segment fails here, before
// it is ever stored.
export function assertSingleSegment(rule: RuleSeed): void {
  for (const [language, template] of Object.entries(rule.templates)) {
    const segments = smsSegments(renderWorstCase(GREETINGS[language as keyof typeof GREETINGS] + template));
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
async function todaysRows(ctx: MutationCtx, guardianId: Id<"guardians">, now: number): Promise<Doc<"notifications">[]> {
  return await ctx.db
    .query("notifications")
    .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId).gte("_creationTime", nairobiDayStart(now)))
    .collect();
}

// FR-503: a queued row whose deliverAt is still ahead is the open collapse
// window for this guardian — the pending message *is* the window.
function openCarrier(rows: Doc<"notifications">[], now: number): Doc<"notifications"> | undefined {
  return rows.find((row) => row.status === "queued" && row.collapsedInto === undefined && (row.deliverAt ?? 0) > now);
}

async function decide(
  ctx: MutationCtx,
  guardian: Doc<"guardians">,
  eventType: string,
  now: number,
): Promise<{ decision: PolicyDecision; carrier?: Doc<"notifications"> }> {
  const rows = await todaysRows(ctx, guardian._id, now);
  const carrier = openCarrier(rows, now);
  const collapseWindowMinutes = await readNumberSetting(ctx, SettingKey.CollapseWindowMinutes, DEFAULT_COLLAPSE_WINDOW_MINUTES);
  const decision = applyPolicy({
    eventType,
    optedOutTypes: guardian.optedOutTypes,
    now,
    quietHoursStart: await readNumberSetting(ctx, SettingKey.QuietHoursStartHour, DEFAULT_QUIET_START_HOUR),
    quietHoursEnd: await readNumberSetting(ctx, SettingKey.QuietHoursEndHour, DEFAULT_QUIET_END_HOUR),
    sentTodayCount: rows.filter((row) => row.status !== "suppressed").length,
    dailyCap: await readNumberSetting(ctx, SettingKey.DailyMessageCap, DEFAULT_DAILY_CAP),
    hasOpenCollapseWindow: carrier !== undefined,
    collapseWindowMs: collapseWindowMinutes * MILLISECONDS_PER_MINUTE,
  });
  return { decision, carrier };
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
  await ctx.scheduler.runAt(deliverAt, internal.rules.flushCollapsed, { notificationId });
}

// FR-503/FR-504: the merged row is kept for audit (status suppressed, reason
// collapsed) and its sentence is composed into the carrier at flush.
async function mergeIntoCarrier(ctx: MutationCtx, candidate: Candidate, carrier: Doc<"notifications">, now: number): Promise<void> {
  const notificationId = await ctx.db.insert("notifications", {
    ...notificationFields(candidate),
    status: "suppressed",
    suppressionReason: SuppressionReason.Collapsed,
    collapsedInto: carrier._id,
  });
  await recordEvent(ctx, {
    eventId: `notification.suppressed:${notificationId}`,
    type: "notification.suppressed",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: candidate.event.correlationId,
    payload: { notification_id: notificationId, suppression_reason: SuppressionReason.Collapsed, rule_key: candidate.rule.key, collapsed_into: carrier._id },
    schoolId: candidate.event.schoolId,
  });
}

export type Recipients = { guardians: Doc<"guardians">[]; vars: Record<string, string> };

function payloadVars(event: Doc<"events">): Record<string, string> {
  return Object.fromEntries(
    Object.entries(event.payload)
      .filter((entry): entry is [string, string | number] => typeof entry[1] !== "boolean")
      .map(([key, value]) => [key, String(value)]),
  );
}

// A student event fans out to the linked guardians; a guardian-addressed event
// (weekly digest) names its recipient. Payload fields are template vars either way.
export async function resolveRecipients(ctx: QueryCtx, event: Doc<"events">): Promise<Recipients> {
  const vars = payloadVars(event);
  if (event.studentId) {
    const student = await ctx.db.get(event.studentId);
    if (!student) {
      return { guardians: [], vars: {} };
    }
    const school = await ctx.db.get(student.schoolId);
    const links = await ctx.db
      .query("guardianLinks")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .take(MAX_GUARDIANS_PER_STUDENT);
    const guardians: Doc<"guardians">[] = [];
    for (const link of links.filter((candidate) => candidate.active)) {
      const guardian = await ctx.db.get(link.guardianId);
      if (guardian) {
        guardians.push(guardian);
      }
    }
    return { guardians, vars: { ...vars, child: student.fullName, school: school?.name ?? "", date: event.serviceDate ?? "" } };
  }
  const guardianId = typeof event.payload.guardian_id === "string" ? ctx.db.normalizeId("guardians", event.payload.guardian_id) : null;
  const guardian = guardianId ? await ctx.db.get(guardianId) : null;
  return { guardians: guardian ? [guardian] : [], vars };
}

export function renderBody(rule: Pick<Doc<"rules">, "templates">, guardian: Doc<"guardians">, vars: Record<string, string>): string {
  return renderGreeting(guardian.language, guardian.displayName) + renderTemplate(rule.templates[guardian.language], vars);
}

async function notifyGuardians(ctx: MutationCtx, rule: Doc<"rules">, event: Doc<"events">): Promise<number> {
  const { guardians, vars } = await resolveRecipients(ctx, event);
  const now = Date.now();
  let queued = 0;
  for (const guardian of guardians) {
    const dedupeKey = `${rule.key}:${event.eventId}:${guardian._id}`;
    const duplicate = await ctx.db
      .query("notifications")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .unique();
    if (duplicate) {
      continue;
    }
    const body = renderBody(rule, guardian, vars);
    const candidate: Candidate = { rule, event, guardian, dedupeKey, body };
    const { decision, carrier } = await decide(ctx, guardian, event.type, now);
    if (decision.action === "suppress") {
      await recordSuppressed(ctx, candidate, decision.reason, now);
      continue;
    }
    if (decision.action === "merge" && carrier) {
      await mergeIntoCarrier(ctx, candidate, carrier, now);
      continue;
    }
    await queueNotification(ctx, candidate, decision.action === "defer" ? decision.deliverAt : undefined);
    queued += 1;
  }
  return queued;
}

function stripGreeting(row: Doc<"notifications">, greeting: string): string {
  return row.body.startsWith(greeting) ? row.body.slice(greeting.length) : row.body;
}

async function rulePriority(ctx: MutationCtx, ruleKey: string): Promise<number> {
  const rule = await ctx.db
    .query("rules")
    .withIndex("by_key", (q) => q.eq("key", ruleKey))
    .unique();
  return rule?.priority ?? DEFAULT_PRIORITY;
}

// FR-503/FR-504/P-11: at window end, compose the carrier and everything merged
// into it into one message, highest rule priority first, then hand to deliver.
export const flushCollapsed = internalMutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const carrier = await ctx.db.get(args.notificationId);
    if (!carrier || carrier.status !== "queued") {
      return null;
    }
    const merged = await ctx.db
      .query("notifications")
      .withIndex("by_collapsedInto", (q) => q.eq("collapsedInto", carrier._id))
      .collect();
    if (merged.length > 0) {
      const guardian = await ctx.db.get(carrier.guardianId);
      const greeting = guardian ? renderGreeting(guardian.language, guardian.displayName) : "";
      const ranked = await Promise.all(
        [carrier, ...merged].map(async (row) => ({ sentence: stripGreeting(row, greeting), priority: await rulePriority(ctx, row.ruleKey) })),
      );
      ranked.sort((a, b) => b.priority - a.priority);
      const body = greeting + ranked.map((entry) => entry.sentence).join(SENTENCE_SEPARATOR);
      await ctx.db.patch(carrier._id, { body, segments: smsSegments(body) });
    }
    await ctx.scheduler.runAfter(0, internal.channels.deliver, { notificationId: carrier._id });
    return null;
  },
});

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
