import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireRole } from "./lib/authz";
import { addDays, toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { smsSegments } from "./lib/gsm7";
import { maskMsisdn } from "./lib/mask";
import { p95, spanDurations } from "./lib/metrics";
import { evaluatePredicate, parsePredicate } from "./lib/predicate";
import { assertSingleSegment, renderBody, resolveRecipients, type RuleSeed } from "./rules";
import { eventPayload, localisedTemplates, notificationStatus, settingValue } from "./schema";
import { readNumberSetting, SettingKey } from "./settings";

const ADMIN_ROLES = ["admin"] as const;
const MAX_RULES = 100;
const MAX_DEVICES = 500;
const NOTIFICATION_SCAN_CAP = 5000;
const DRY_RUN_PAGE_SIZE = 200;
const DRY_RUN_MAX_PAGES = 50;
const DRY_RUN_SAMPLE_SIZE = 5;
const TRACE_CAP = 100;
const DEFAULT_COST_PER_SEGMENT_KES = 1;
const DEFAULT_READER_SILENT_HOURS = 20;
const MILLISECONDS_PER_HOUR = 3_600_000;
const PERCENT = 100;
const BILLED_STATUSES = new Set<Doc<"notifications">["status"]>(["sent", "delivered"]);
const ATTEMPTED_STATUSES = new Set<Doc<"notifications">["status"]>(["sent", "delivered", "failed"]);

const SCHEMA_VERSION = 1;
const MAX_SETTINGS = 100;
const AUDIT_CAP = 500;
const METRIC_SAMPLE_CAP = 2000;

export const AdminFailure = {
  InvalidPredicate: "INVALID_PREDICATE",
  RuleNotFound: "RULE_NOT_FOUND",
  DeviceNotFound: "DEVICE_NOT_FOUND",
  SettingNotFound: "SETTING_NOT_FOUND",
} as const;

export const AuditType = {
  RuleChanged: "admin.rule_changed",
  RuleToggled: "admin.rule_toggled",
  SettingChanged: "admin.setting_changed",
  DeviceRevoked: "admin.device_revoked",
  DeviceReprovisioned: "admin.device_reprovisioned",
} as const;

// FR-802 / NFR-405: every administrative action is an event in the
// append-only stream, attributed to the acting user. The retention purge
// skips the admin.* prefix, so this log outlives operational data.
const AUDITED_TYPES = [...Object.values(AuditType), "meal.override_served", "student.deactivated", "student.tag_assigned"] as const;

export async function recordAudit(ctx: MutationCtx, actor: Doc<"users">, type: string, payload: Record<string, string | number | boolean>): Promise<void> {
  const now = Date.now();
  const eventId = `${type}:${actor._id}:${now}`;
  await recordEvent(ctx, {
    eventId,
    type,
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: eventId,
    payload: { actor_id: actor._id, actor_name: actor.displayName, ...payload },
  });
}

type DateRange = { from: string; to: string };

function rangeMs(range: DateRange): { fromMs: number; toMs: number } {
  return { fromMs: Date.parse(`${range.from}T00:00:00.000Z`), toMs: Date.parse(`${addDays(range.to, 1)}T00:00:00.000Z`) };
}

async function notificationsIn(ctx: QueryCtx, range: DateRange): Promise<Doc<"notifications">[]> {
  const { fromMs, toMs } = rangeMs(range);
  return await ctx.db
    .query("notifications")
    .withIndex("by_creation_time", (q) => q.gte("_creationTime", fromMs).lt("_creationTime", toMs))
    .take(NOTIFICATION_SCAN_CAP);
}

// ---------------------------------------------------------------- AD-04 rules

const ruleSpecValidator = v.object({
  key: v.string(),
  eventType: v.string(),
  predicate: v.string(),
  templates: localisedTemplates,
  priority: v.number(),
  enabled: v.boolean(),
});

type RuleSpec = Omit<RuleSeed, "audience" | "channel" | "templateVersion">;

function assertValidRule(spec: RuleSeed): void {
  if (!parsePredicate(spec.predicate)) {
    throw new ConvexError(AdminFailure.InvalidPredicate);
  }
  assertSingleSegment(spec);
}

export const listRules = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("rules"),
      key: v.string(),
      eventType: v.string(),
      predicate: v.string(),
      templates: localisedTemplates,
      templateVersion: v.number(),
      priority: v.number(),
      enabled: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireRole(ctx, ADMIN_ROLES);
    const rules = await ctx.db.query("rules").take(MAX_RULES);
    return rules.map((rule) => ({
      _id: rule._id,
      key: rule.key,
      eventType: rule.eventType,
      predicate: rule.predicate,
      templates: rule.templates,
      templateVersion: rule.templateVersion,
      priority: rule.priority,
      enabled: rule.enabled,
    }));
  },
});

// FR-403 / AD-04: a rule is a row. Editing templates bumps the version so a
// message can always be traced to the wording that produced it.
export const upsertRule = mutation({
  args: ruleSpecValidator,
  returns: v.object({ ruleId: v.id("rules"), templateVersion: v.number() }),
  handler: async (ctx, spec: RuleSpec) => {
    const actor = await requireRole(ctx, ADMIN_ROLES);
    const existing = await ctx.db
      .query("rules")
      .withIndex("by_key", (q) => q.eq("key", spec.key))
      .unique();
    const templatesChanged = existing !== null && JSON.stringify(existing.templates) !== JSON.stringify(spec.templates);
    const templateVersion = existing ? existing.templateVersion + (templatesChanged ? 1 : 0) : 1;
    const row: RuleSeed = { ...spec, audience: "guardian", channel: "sms", templateVersion };
    assertValidRule(row);
    await recordAudit(ctx, actor, AuditType.RuleChanged, { rule_key: spec.key, event_type: spec.eventType, predicate: spec.predicate, template_version: templateVersion, enabled: spec.enabled, created: existing === null });
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { ruleId: existing._id, templateVersion };
    }
    return { ruleId: await ctx.db.insert("rules", row), templateVersion };
  },
});

export const setRuleEnabled = mutation({
  args: { ruleId: v.id("rules"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ADMIN_ROLES);
    const rule = await ctx.db.get(args.ruleId);
    if (!rule) {
      throw new ConvexError(AdminFailure.RuleNotFound);
    }
    await ctx.db.patch(args.ruleId, { enabled: args.enabled });
    await recordAudit(ctx, actor, AuditType.RuleToggled, { rule_key: rule.key, enabled: args.enabled });
    return null;
  },
});

// ------------------------------------------------ settings, revocation, audit

export const listSettings = query({
  args: {},
  returns: v.array(v.object({ key: v.string(), value: settingValue, description: v.string() })),
  handler: async (ctx) => {
    await requireRole(ctx, ADMIN_ROLES);
    const rows = await ctx.db.query("settings").take(MAX_SETTINGS);
    return rows.map((row) => ({ key: row.key, value: row.value, description: row.description })).sort((left, right) => left.key.localeCompare(right.key));
  },
});

// NFR-505 retention periods and every other tolerance live here; changing
// one is an audited admin action, not a deploy.
export const setSetting = mutation({
  args: { key: v.string(), value: settingValue },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ADMIN_ROLES);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!existing) {
      throw new ConvexError(AdminFailure.SettingNotFound);
    }
    await ctx.db.patch(existing._id, { value: args.value });
    await recordAudit(ctx, actor, AuditType.SettingChanged, { key: args.key, previous: existing.value, value: args.value });
    return null;
  },
});

// NFR-406: revocation is a flag the ingest route checks on every request, so
// a lost reader is locked out on its next contact.
export const revokeDevice = mutation({
  args: { deviceRef: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ADMIN_ROLES);
    const device = await ctx.db
      .query("devices")
      .withIndex("by_deviceRef", (q) => q.eq("deviceRef", args.deviceRef))
      .unique();
    if (!device) {
      throw new ConvexError(AdminFailure.DeviceNotFound);
    }
    if (device.revokedAt !== undefined) {
      return null;
    }
    await ctx.db.patch(device._id, { revokedAt: Date.now() });
    await recordAudit(ctx, actor, AuditType.DeviceRevoked, { device_id: device.deviceRef, school_id: device.schoolId });
    return null;
  },
});

type AuditEntry = { _id: Id<"events">; type: string; occurredAt: number; payload: Doc<"events">["payload"] };

export async function auditLog(ctx: QueryCtx, range: DateRange): Promise<AuditEntry[]> {
  const { fromMs, toMs } = rangeMs(range);
  const entries: AuditEntry[] = [];
  for (const type of AUDITED_TYPES) {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_type_occurredAt", (q) => q.eq("type", type).gte("occurredAt", fromMs).lt("occurredAt", toMs))
      .order("desc")
      .take(AUDIT_CAP);
    entries.push(...rows.map((row) => ({ _id: row._id, type: row.type, occurredAt: row.occurredAt, payload: row.payload })));
  }
  return entries.sort((left, right) => right.occurredAt - left.occurredAt).slice(0, AUDIT_CAP);
}

export const audit = query({
  args: { from: v.string(), to: v.string() },
  returns: v.array(v.object({ _id: v.id("events"), type: v.string(), occurredAt: v.number(), payload: eventPayload })),
  handler: async (ctx, args) => {
    await requireRole(ctx, ADMIN_ROLES);
    return await auditLog(ctx, args);
  },
});

// ------------------------------------------------------------- NFR-803 metrics

export type Metrics = {
  taps: number;
  ingestionLagP95Ms: number;
  enqueueLagP95Ms: number;
  sweepDurationP95Ms: number;
  sweeps: number;
  evaluations: number;
  suppressed: number;
  deliveredPct: number;
};

// Ingestion lag = recordedAt − occurredAt on taps (NFR-102's first hop);
// enqueue lag = notification row creation − its event's recordedAt; sweep
// duration = spread of a school-day's meal.missed rows.
export async function metricsReport(ctx: QueryCtx, range: DateRange): Promise<Metrics> {
  const { fromMs, toMs } = rangeMs(range);
  const taps = await ctx.db
    .query("events")
    .withIndex("by_type_occurredAt", (q) => q.eq("type", "meal.tapped").gte("occurredAt", fromMs).lt("occurredAt", toMs))
    .take(METRIC_SAMPLE_CAP);
  const missed = await ctx.db
    .query("events")
    .withIndex("by_type_occurredAt", (q) => q.eq("type", "meal.missed").gte("occurredAt", fromMs).lt("occurredAt", toMs))
    .take(METRIC_SAMPLE_CAP);
  const evaluated = await ctx.db
    .query("events")
    .withIndex("by_creation_time", (q) => q.gte("_creationTime", fromMs).lt("_creationTime", toMs))
    .take(METRIC_SAMPLE_CAP);
  const notifications = await notificationsIn(ctx, range);
  const enqueueLags: number[] = [];
  const eventRecordedAt = new Map<Id<"events">, number>();
  for (const row of notifications) {
    if (!eventRecordedAt.has(row.eventId)) {
      eventRecordedAt.set(row.eventId, (await ctx.db.get(row.eventId))?.recordedAt ?? row._creationTime);
    }
    enqueueLags.push(row._creationTime - (eventRecordedAt.get(row.eventId) ?? row._creationTime));
  }
  const sweeps = spanDurations(missed.map((row) => ({ key: `${row.schoolId}:${row.serviceDate}`, at: row.recordedAt })));
  const attempted = notifications.filter((row) => ATTEMPTED_STATUSES.has(row.status)).length;
  const delivered = notifications.filter((row) => row.status === "delivered").length;
  return {
    taps: taps.length,
    ingestionLagP95Ms: p95(taps.map((row) => Math.max(0, row.recordedAt - row.occurredAt))),
    enqueueLagP95Ms: p95(enqueueLags),
    sweepDurationP95Ms: p95([...sweeps.values()]),
    sweeps: sweeps.size,
    evaluations: evaluated.length,
    suppressed: notifications.filter((row) => row.status === "suppressed").length,
    deliveredPct: attempted === 0 ? 0 : Math.round((delivered / attempted) * PERCENT),
  };
}

export const metrics = query({
  args: { from: v.string(), to: v.string() },
  returns: v.object({
    taps: v.number(),
    ingestionLagP95Ms: v.number(),
    enqueueLagP95Ms: v.number(),
    sweepDurationP95Ms: v.number(),
    sweeps: v.number(),
    evaluations: v.number(),
    suppressed: v.number(),
    deliveredPct: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, ADMIN_ROLES);
    return await metricsReport(ctx, args);
  },
});

// -------------------------------------------------------- AD-05 dry-run replay

export type DryRunPage = {
  scanned: number;
  matched: number;
  recipients: number;
  segments: number;
  samples: { eventId: string; maskedMsisdn: string; body: string }[];
  continueCursor: string;
  isDone: boolean;
};

type DryRunArgs = { eventType: string; predicate: string; templates: Doc<"rules">["templates"]; from: string; to: string; cursor: string | null };

// FR-404: renders exactly what evaluate would render, against the same
// recipients, and writes nothing. Policy (quiet hours, cap, collapse) is
// not applied — the report is "would match and render", not "would deliver".
export async function dryRunPage(ctx: QueryCtx, args: DryRunArgs): Promise<DryRunPage> {
  const predicate = parsePredicate(args.predicate);
  if (!predicate) {
    throw new ConvexError(AdminFailure.InvalidPredicate);
  }
  const { fromMs, toMs } = rangeMs(args);
  const page = await ctx.db
    .query("events")
    .withIndex("by_type_occurredAt", (q) => q.eq("type", args.eventType).gte("occurredAt", fromMs).lt("occurredAt", toMs))
    .paginate({ numItems: DRY_RUN_PAGE_SIZE, cursor: args.cursor });
  const report: DryRunPage = { scanned: page.page.length, matched: 0, recipients: 0, segments: 0, samples: [], continueCursor: page.continueCursor, isDone: page.isDone };
  for (const event of page.page) {
    if (!evaluatePredicate(predicate, event.payload)) {
      continue;
    }
    report.matched += 1;
    const { guardians, vars } = await resolveRecipients(ctx, event);
    for (const guardian of guardians) {
      const body = renderBody({ templates: args.templates }, guardian, vars);
      report.recipients += 1;
      report.segments += smsSegments(body);
      if (report.samples.length < DRY_RUN_SAMPLE_SIZE) {
        report.samples.push({ eventId: event.eventId, maskedMsisdn: maskMsisdn(guardian.msisdn), body });
      }
    }
  }
  return report;
}

const dryRunPageValidator = v.object({
  scanned: v.number(),
  matched: v.number(),
  recipients: v.number(),
  segments: v.number(),
  samples: v.array(v.object({ eventId: v.string(), maskedMsisdn: v.string(), body: v.string() })),
  continueCursor: v.string(),
  isDone: v.boolean(),
});

export const dryRunPageFor = internalQuery({
  args: { eventType: v.string(), predicate: v.string(), templates: localisedTemplates, from: v.string(), to: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: dryRunPageValidator,
  handler: async (ctx, args) => await dryRunPage(ctx, args),
});

const dryRunReportValidator = v.object({
  scanned: v.number(),
  matched: v.number(),
  recipients: v.number(),
  segments: v.number(),
  estimatedCostKes: v.number(),
  pages: v.number(),
  truncated: v.boolean(),
  samples: v.array(v.object({ eventId: v.string(), maskedMsisdn: v.string(), body: v.string() })),
});

type DryRunReport = {
  scanned: number;
  matched: number;
  recipients: number;
  segments: number;
  estimatedCostKes: number;
  pages: number;
  truncated: boolean;
  samples: DryRunPage["samples"];
};

// Paged action: walks the period one read-only page at a time and sends
// nothing. ponytail: capped at DRY_RUN_MAX_PAGES; narrow the range past that.
export const dryRunReplay = action({
  args: { eventType: v.string(), predicate: v.string(), templates: localisedTemplates, from: v.string(), to: v.string() },
  returns: dryRunReportValidator,
  handler: async (ctx, args): Promise<DryRunReport> => {
    await ctx.runQuery(internal.admin.requireAdmin, {});
    const costPerSegment: number = await ctx.runQuery(internal.admin.costPerSegment, {});
    const report: DryRunReport = { scanned: 0, matched: 0, recipients: 0, segments: 0, estimatedCostKes: 0, pages: 0, truncated: false, samples: [] };
    let cursor: string | null = null;
    while (report.pages < DRY_RUN_MAX_PAGES) {
      const page: DryRunPage = await ctx.runQuery(internal.admin.dryRunPageFor, { ...args, cursor });
      report.pages += 1;
      report.scanned += page.scanned;
      report.matched += page.matched;
      report.recipients += page.recipients;
      report.segments += page.segments;
      report.samples.push(...page.samples.slice(0, DRY_RUN_SAMPLE_SIZE - report.samples.length));
      if (page.isDone) {
        report.estimatedCostKes = report.segments * costPerSegment;
        return report;
      }
      cursor = page.continueCursor;
    }
    report.truncated = true;
    report.estimatedCostKes = report.segments * costPerSegment;
    return report;
  },
});

export const requireAdmin = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireRole(ctx, ADMIN_ROLES);
    return null;
  },
});

export const costPerSegment = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await readNumberSetting(ctx, SettingKey.SmsCostPerSegmentKes, DEFAULT_COST_PER_SEGMENT_KES),
});

// ------------------------------------------- AD-02 / AD-03 / AD-06 deliverability

type DayDeliverability = { day: string; queued: number; sent: number; delivered: number; failed: number; suppressed: number; deliveredPct: number };

type FailureCount = { reason: string; count: number };

type UndeliverableEntry = { guardianId: Id<"guardians">; maskedMsisdn: string; schoolCode: string; failures: number; lastReason: string; lastFailedAt: number };

type RuleSpend = { ruleKey: string; sent: number; suppressed: number; segments: number; costKes: number };

export type Deliverability = { byDay: DayDeliverability[]; byFailureReason: FailureCount[]; undeliverable: UndeliverableEntry[]; spendByRule: RuleSpend[] };

function emptyDay(day: string): DayDeliverability {
  return { day, queued: 0, sent: 0, delivered: 0, failed: 0, suppressed: 0, deliveredPct: 0 };
}

export async function deliverabilityReport(ctx: QueryCtx, range: DateRange): Promise<Deliverability> {
  const rows = await notificationsIn(ctx, range);
  const costPerSegment = await readNumberSetting(ctx, SettingKey.SmsCostPerSegmentKes, DEFAULT_COST_PER_SEGMENT_KES);
  const byDay = new Map<string, DayDeliverability>();
  const byReason = new Map<string, number>();
  const byGuardian = new Map<Id<"guardians">, UndeliverableEntry>();
  const bySchool = new Map<Id<"schools">, string>();
  const byRule = new Map<string, RuleSpend>();
  for (const row of rows) {
    const day = toServiceDate(row._creationTime);
    const dayRow = byDay.get(day) ?? emptyDay(day);
    dayRow[row.status] += 1;
    byDay.set(day, dayRow);
    const spend = byRule.get(row.ruleKey) ?? { ruleKey: row.ruleKey, sent: 0, suppressed: 0, segments: 0, costKes: 0 };
    if (row.status === "suppressed") {
      spend.suppressed += 1;
    } else if (BILLED_STATUSES.has(row.status)) {
      spend.sent += 1;
      spend.segments += row.segments;
      spend.costKes += row.segments * costPerSegment;
    }
    byRule.set(row.ruleKey, spend);
    if (row.status !== "failed") {
      continue;
    }
    const reason = row.failureReason ?? "unknown";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    if (row.schoolId && !bySchool.has(row.schoolId)) {
      bySchool.set(row.schoolId, (await ctx.db.get(row.schoolId))?.code ?? "");
    }
    const entry = byGuardian.get(row.guardianId) ?? { guardianId: row.guardianId, maskedMsisdn: maskMsisdn(row.msisdn), schoolCode: "", failures: 0, lastReason: reason, lastFailedAt: 0 };
    entry.failures += 1;
    entry.schoolCode = (row.schoolId && bySchool.get(row.schoolId)) || entry.schoolCode;
    if (row._creationTime >= entry.lastFailedAt) {
      entry.lastFailedAt = row._creationTime;
      entry.lastReason = reason;
    }
    byGuardian.set(row.guardianId, entry);
  }
  for (const dayRow of byDay.values()) {
    const attempted = dayRow.sent + dayRow.delivered + dayRow.failed;
    dayRow.deliveredPct = attempted === 0 ? 0 : Math.round((dayRow.delivered / attempted) * PERCENT);
  }
  return {
    byDay: [...byDay.values()].sort((left, right) => right.day.localeCompare(left.day)),
    byFailureReason: [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count),
    undeliverable: [...byGuardian.values()].sort((left, right) => right.failures - left.failures),
    spendByRule: [...byRule.values()].sort((left, right) => right.costKes - left.costKes),
  };
}

export const deliverability = query({
  args: { from: v.string(), to: v.string() },
  returns: v.object({
    byDay: v.array(v.object({ day: v.string(), queued: v.number(), sent: v.number(), delivered: v.number(), failed: v.number(), suppressed: v.number(), deliveredPct: v.number() })),
    byFailureReason: v.array(v.object({ reason: v.string(), count: v.number() })),
    undeliverable: v.array(
      v.object({ guardianId: v.id("guardians"), maskedMsisdn: v.string(), schoolCode: v.string(), failures: v.number(), lastReason: v.string(), lastFailedAt: v.number() }),
    ),
    spendByRule: v.array(v.object({ ruleKey: v.string(), sent: v.number(), suppressed: v.number(), segments: v.number(), costKes: v.number() })),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, ADMIN_ROLES);
    return await deliverabilityReport(ctx, args);
  },
});

// ------------------------------------------------------------- AD-01 fleet

export const fleet = query({
  args: {},
  returns: v.array(
    v.object({
      deviceRef: v.string(),
      schoolCode: v.string(),
      firmwareVersion: v.string(),
      queueDepth: v.number(),
      clockSkewSeconds: v.number(),
      lastSeenAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      silentAfterMs: v.number(),
      skewToleranceSeconds: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireRole(ctx, ADMIN_ROLES);
    const silentAfterMs = (await readNumberSetting(ctx, SettingKey.ReaderSilentHours, DEFAULT_READER_SILENT_HOURS)) * MILLISECONDS_PER_HOUR;
    const skewToleranceSeconds = await readNumberSetting(ctx, SettingKey.ClockSkewToleranceSeconds, 0);
    const devices = await ctx.db.query("devices").take(MAX_DEVICES);
    const codes = new Map<Id<"schools">, string>();
    const rows = [];
    for (const device of devices) {
      if (!codes.has(device.schoolId)) {
        codes.set(device.schoolId, (await ctx.db.get(device.schoolId))?.code ?? "");
      }
      rows.push({
        deviceRef: device.deviceRef,
        schoolCode: codes.get(device.schoolId) ?? "",
        firmwareVersion: device.firmwareVersion,
        queueDepth: device.queueDepth,
        clockSkewSeconds: device.clockSkewSeconds,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
        silentAfterMs,
        skewToleranceSeconds,
      });
    }
    return rows;
  },
});

// ------------------------------------------------------------- AD-07 trace

export type Trace = {
  correlationId: string;
  events: { _id: Id<"events">; eventId: string; type: string; occurredAt: number; payload: Doc<"events">["payload"] }[];
  notifications: { _id: Id<"notifications">; ruleKey: string; maskedMsisdn: string; status: Doc<"notifications">["status"]; body: string; failureReason?: string; suppressionReason?: string; providerMessageId?: string; createdAt: number }[];
};

// NFR-802 / AD-07: one identifier resolves the whole chain. A notification id
// or provider message id is first mapped to its correlation id.
export async function traceChain(ctx: QueryCtx, identifier: string): Promise<Trace> {
  const correlationId = await resolveCorrelationId(ctx, identifier.trim());
  const events = await ctx.db
    .query("events")
    .withIndex("by_correlationId", (q) => q.eq("correlationId", correlationId))
    .take(TRACE_CAP);
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_correlationId", (q) => q.eq("correlationId", correlationId))
    .take(TRACE_CAP);
  return {
    correlationId,
    events: events.map((row) => ({ _id: row._id, eventId: row.eventId, type: row.type, occurredAt: row.occurredAt, payload: row.payload })),
    notifications: notifications.map((row) => ({
      _id: row._id,
      ruleKey: row.ruleKey,
      maskedMsisdn: maskMsisdn(row.msisdn),
      status: row.status,
      body: row.body,
      failureReason: row.failureReason,
      suppressionReason: row.suppressionReason,
      providerMessageId: row.providerMessageId,
      createdAt: row._creationTime,
    })),
  };
}

async function resolveCorrelationId(ctx: QueryCtx, identifier: string): Promise<string> {
  const notificationId = ctx.db.normalizeId("notifications", identifier);
  if (notificationId) {
    const notification = await ctx.db.get(notificationId);
    if (notification) {
      return notification.correlationId;
    }
  }
  const byProvider = await ctx.db
    .query("notifications")
    .withIndex("by_providerMessageId", (q) => q.eq("providerMessageId", identifier))
    .first();
  if (byProvider) {
    return byProvider.correlationId;
  }
  const byEventId = await ctx.db
    .query("events")
    .withIndex("by_eventId", (q) => q.eq("eventId", identifier))
    .unique();
  return byEventId?.correlationId ?? identifier;
}

export const trace = query({
  args: { identifier: v.string() },
  returns: v.object({
    correlationId: v.string(),
    events: v.array(v.object({ _id: v.id("events"), eventId: v.string(), type: v.string(), occurredAt: v.number(), payload: eventPayload })),
    notifications: v.array(
      v.object({
        _id: v.id("notifications"),
        ruleKey: v.string(),
        maskedMsisdn: v.string(),
        status: notificationStatus,
        body: v.string(),
        failureReason: v.optional(v.string()),
        suppressionReason: v.optional(v.string()),
        providerMessageId: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, ADMIN_ROLES);
    return await traceChain(ctx, args.identifier);
  },
});
