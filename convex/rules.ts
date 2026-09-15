import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { evaluatePredicate, parsePredicate } from "./lib/predicate";
import { renderTemplate } from "./lib/template";

const MAX_RULES_PER_EVENT = 50;
const MAX_GUARDIANS_PER_STUDENT = 10;
const ALWAYS = JSON.stringify({ op: "always" });
const DEFAULT_PRIORITY = 100;

type RuleSeed = Omit<Doc<"rules">, "_id" | "_creationTime">;

// FR-403 / AD-04: rules are rows, not code. Editing these in the dashboard
// changes behaviour without a deploy.
export const DEMO_RULES: ReadonlyArray<RuleSeed> = [
  {
    key: "guardian.meal_tapped",
    eventType: "meal.tapped",
    predicate: ALWAYS,
    audience: "guardian",
    template: "Dear {{guardian}}, {{child}} had lunch at {{school}} today ({{date}}).",
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
  {
    key: "guardian.meal_missed",
    eventType: "meal.missed",
    predicate: ALWAYS,
    audience: "guardian",
    template: "Dear {{guardian}}, {{child}} did not tap for lunch at {{school}} on {{date}}. Please check in.",
    channel: "sms",
    priority: DEFAULT_PRIORITY,
    enabled: true,
  },
];

export async function seedRules(ctx: MutationCtx): Promise<number> {
  let created = 0;
  for (const rule of DEMO_RULES) {
    const existing = await ctx.db
      .query("rules")
      .withIndex("by_key", (q) => q.eq("key", rule.key))
      .unique();
    if (!existing) {
      await ctx.db.insert("rules", rule);
      created += 1;
    } else if (existing.template !== rule.template) {
      await ctx.db.patch(existing._id, { template: rule.template });
    }
  }
  return created;
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
    const body = renderTemplate(rule.template, { ...templateVars, guardian: guardian.displayName });
    const notificationId = await ctx.db.insert("notifications", {
      dedupeKey,
      ruleKey: rule.key,
      eventId: event._id,
      correlationId: event.correlationId,
      schoolId: event.schoolId,
      guardianId: guardian._id,
      msisdn: guardian.msisdn,
      channel: rule.channel,
      body,
      status: "queued",
    });
    await ctx.scheduler.runAfter(0, internal.channels.deliver, { notificationId });
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
