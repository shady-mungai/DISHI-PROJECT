import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireSchoolScope } from "./lib/authz";
import { toServiceDate } from "./lib/dates";
import { recordEvent } from "./lib/events";
import { readSetting, SettingKey } from "./settings";

const SCHEMA_VERSION = 1;
const MILLISECONDS_PER_MINUTE = 60_000;
const DEFAULT_SERVICE_WINDOW_MINUTES = 90;
const DEFAULT_CUTOFF_OFFSET_MINUTES = 30;
const STUDENT_PAGE_SIZE = 100;
const SWEEP_BATCH_SIZE = 100;
const MAX_SCHOOLS = 100;
const SUMMARY_READ_CAP = 1000;
const STALLED_CHECK_AT_WINDOW_FRACTION = 0.5;

type ServiceWindow = {
  windowStart: number;
  windowEnd: number;
  cutoffAt: number;
};

const serviceWindowValidator = {
  windowStart: v.number(),
  windowEnd: v.number(),
  cutoffAt: v.number(),
};

const materialiseResultValidator = v.object({
  status: v.union(v.literal("materialised"), v.literal("not_school_day")),
  created: v.number(),
  existing: v.number(),
  chained: v.boolean(),
});

type MaterialiseResult = {
  status: "materialised" | "not_school_day";
  created: number;
  existing: number;
  chained: boolean;
};

const sweepResultValidator = v.object({
  missed: v.number(),
  chained: v.boolean(),
});

type SweepResult = { missed: number; chained: boolean };

async function resolveServiceWindow(
  ctx: QueryCtx,
  serviceStartAt: number,
): Promise<ServiceWindow> {
  const windowMinutes = Number(
    (await readSetting(ctx, SettingKey.ServiceWindowMinutes)) ??
      DEFAULT_SERVICE_WINDOW_MINUTES,
  );
  const cutoffOffsetMinutes = Number(
    (await readSetting(ctx, SettingKey.CutoffOffsetMinutes)) ??
      DEFAULT_CUTOFF_OFFSET_MINUTES,
  );
  const windowEnd = serviceStartAt + windowMinutes * MILLISECONDS_PER_MINUTE;
  return {
    windowStart: serviceStartAt,
    windowEnd,
    cutoffAt: windowEnd + cutoffOffsetMinutes * MILLISECONDS_PER_MINUTE,
  };
}

export async function isSchoolDay(
  ctx: QueryCtx,
  serviceDate: string,
): Promise<boolean> {
  if ((await readSetting(ctx, SettingKey.TreatEveryDayAsSchoolDay)) === true) {
    return true;
  }
  const day = await ctx.db
    .query("academicCalendar")
    .withIndex("by_serviceDate", (q) => q.eq("serviceDate", serviceDate))
    .unique();
  return day?.isSchoolDay === true;
}

type MaterialisePageArgs = {
  schoolId: Id<"schools">;
  serviceDate: string;
  cursor: string | null;
  pageSize: number;
} & ServiceWindow;

// FR-207/FR-405: one expectation row per active student. Paged over the
// roster and chained through the scheduler so it survives past demo scale.
async function materialiseStudentsPage(
  ctx: MutationCtx,
  args: MaterialisePageArgs,
): Promise<MaterialiseResult> {
  const page = await ctx.db
    .query("students")
    .withIndex("by_school_status", (q) =>
      q.eq("schoolId", args.schoolId).eq("status", "active"),
    )
    .paginate({ numItems: args.pageSize, cursor: args.cursor });

  let created = 0;
  let existing = 0;
  for (const student of page.page) {
    const outcome = await materialiseStudent(ctx, student, args);
    if (outcome === "created") {
      created += 1;
    } else {
      existing += 1;
    }
  }

  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.expectations.materialisePage, {
      ...args,
      cursor: page.continueCursor,
    });
  }

  return { status: "materialised", created, existing, chained: !page.isDone };
}

async function materialiseStudent(
  ctx: MutationCtx,
  student: Doc<"students">,
  day: { serviceDate: string } & ServiceWindow,
): Promise<"created" | "existing"> {
  const existing = await ctx.db
    .query("expectations")
    .withIndex("by_student_serviceDate", (q) =>
      q.eq("studentId", student._id).eq("serviceDate", day.serviceDate),
    )
    .unique();
  if (existing) {
    return "existing";
  }

  const tappedAlready = await ctx.db
    .query("events")
    .withIndex("by_student_serviceDate_type", (q) =>
      q
        .eq("studentId", student._id)
        .eq("serviceDate", day.serviceDate)
        .eq("type", "meal.tapped"),
    )
    .first();

  const expectationId = await ctx.db.insert("expectations", {
    schoolId: student.schoolId,
    studentId: student._id,
    serviceDate: day.serviceDate,
    windowStart: day.windowStart,
    windowEnd: day.windowEnd,
    cutoffAt: day.cutoffAt,
    status: tappedAlready ? "fulfilled" : "pending",
  });

  const now = Date.now();
  await recordEvent(ctx, {
    eventId: `meal.expectation_created:${expectationId}`,
    type: "meal.expectation_created",
    occurredAt: now,
    recordedAt: now,
    schemaVersion: SCHEMA_VERSION,
    correlationId: expectationId,
    payload: {
      student_id: student._id,
      service_date: day.serviceDate,
      window_start: day.windowStart,
      window_end: day.windowEnd,
      expectation_id: expectationId,
    },
    schoolId: student.schoolId,
    studentId: student._id,
    serviceDate: day.serviceDate,
  });

  return "created";
}

async function startServiceDay(
  ctx: MutationCtx,
  args: {
    schoolId: Id<"schools">;
    serviceDate: string;
    serviceStartAt: number;
    pageSize?: number;
  },
): Promise<MaterialiseResult> {
  if (!(await isSchoolDay(ctx, args.serviceDate))) {
    return {
      status: "not_school_day",
      created: 0,
      existing: 0,
      chained: false,
    };
  }

  const window = await resolveServiceWindow(ctx, args.serviceStartAt);
  const day = { schoolId: args.schoolId, serviceDate: args.serviceDate };
  await ctx.scheduler.runAt(
    window.cutoffAt,
    internal.expectations.sweepMissed,
    day,
  );
  const stalledCheckAt =
    window.windowStart +
    (window.windowEnd - window.windowStart) * STALLED_CHECK_AT_WINDOW_FRACTION;
  await ctx.scheduler.runAt(stalledCheckAt, internal.monitor.checkStalled, day);

  return await materialiseStudentsPage(ctx, {
    schoolId: args.schoolId,
    serviceDate: args.serviceDate,
    cursor: null,
    pageSize: args.pageSize ?? STUDENT_PAGE_SIZE,
    ...window,
  });
}

// FR-208: every expectation still pending at the cutoff becomes meal.missed.
// Swept rows leave the "pending" index range, so a fresh take() is the next
// batch — no cursor needed.
async function sweepPage(
  ctx: MutationCtx,
  args: { schoolId: Id<"schools">; serviceDate: string },
): Promise<SweepResult> {
  const pending = await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) =>
      q
        .eq("schoolId", args.schoolId)
        .eq("serviceDate", args.serviceDate)
        .eq("status", "pending"),
    )
    .take(SWEEP_BATCH_SIZE);

  const now = Date.now();
  for (const expectation of pending) {
    await ctx.db.patch(expectation._id, { status: "missed" });
    await recordEvent(ctx, {
      eventId: `meal.missed:${expectation._id}`,
      type: "meal.missed",
      occurredAt: now,
      recordedAt: now,
      schemaVersion: SCHEMA_VERSION,
      correlationId: expectation._id,
      payload: {
        student_id: expectation.studentId,
        service_date: expectation.serviceDate,
        expectation_id: expectation._id,
      },
      schoolId: expectation.schoolId,
      studentId: expectation.studentId,
      serviceDate: expectation.serviceDate,
    });
  }

  const chained = pending.length === SWEEP_BATCH_SIZE;
  if (chained) {
    await ctx.scheduler.runAfter(0, internal.expectations.sweepMissed, args);
  }
  return { missed: pending.length, chained };
}

// Called from ingest on every accepted tap. A tap after the sweep stays
// "missed" — the guardian has already been told.
export async function fulfilExpectation(
  ctx: MutationCtx,
  studentId: Id<"students">,
  serviceDate: string,
): Promise<void> {
  const expectation = await ctx.db
    .query("expectations")
    .withIndex("by_student_serviceDate", (q) =>
      q.eq("studentId", studentId).eq("serviceDate", serviceDate),
    )
    .unique();
  if (!expectation || expectation.status !== "pending") {
    return;
  }
  await ctx.db.patch(expectation._id, { status: "fulfilled" });
}

export const startSchoolDay = internalMutation({
  args: {
    schoolId: v.id("schools"),
    serviceDate: v.string(),
    serviceStartAt: v.number(),
    pageSize: v.optional(v.number()),
  },
  returns: materialiseResultValidator,
  handler: async (ctx, args) => await startServiceDay(ctx, args),
});

export const materialisePage = internalMutation({
  args: {
    schoolId: v.id("schools"),
    serviceDate: v.string(),
    cursor: v.union(v.string(), v.null()),
    pageSize: v.number(),
    ...serviceWindowValidator,
  },
  returns: materialiseResultValidator,
  handler: async (ctx, args) => await materialiseStudentsPage(ctx, args),
});

export const sweepMissed = internalMutation({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: sweepResultValidator,
  handler: async (ctx, args) => await sweepPage(ctx, args),
});

// Cron entry: fires at real service start for every active school.
// ponytail: schools scanned with take(); add an index on `active` past ~100 schools.
export const startServiceDayForAllSchools = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const serviceDate = toServiceDate(now);
    const schools = await ctx.db.query("schools").take(MAX_SCHOOLS);
    let started = 0;
    for (const school of schools.filter((candidate) => candidate.active)) {
      await ctx.scheduler.runAfter(0, internal.expectations.startSchoolDay, {
        schoolId: school._id,
        serviceDate,
        serviceStartAt: now,
      });
      started += 1;
    }
    return started;
  },
});

export const runExpectationsNow = mutation({
  args: { schoolId: v.id("schools"), serviceDate: v.optional(v.string()) },
  returns: materialiseResultValidator,
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const now = Date.now();
    return await startServiceDay(ctx, {
      schoolId: args.schoolId,
      serviceDate: args.serviceDate ?? toServiceDate(now),
      serviceStartAt: now,
    });
  },
});

export const runSweepNow = mutation({
  args: { schoolId: v.id("schools"), serviceDate: v.optional(v.string()) },
  returns: sweepResultValidator,
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await sweepPage(ctx, {
      schoolId: args.schoolId,
      serviceDate: args.serviceDate ?? toServiceDate(Date.now()),
    });
  },
});

// ponytail: counts are computed on read, capped at SUMMARY_READ_CAP rows per
// status; move to @convex-dev/aggregate once a school exceeds that.
export async function countExpectations(
  ctx: QueryCtx,
  key: {
    schoolId: Id<"schools">;
    serviceDate: string;
    status: Doc<"expectations">["status"];
  },
): Promise<number> {
  const rows = await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) =>
      q
        .eq("schoolId", key.schoolId)
        .eq("serviceDate", key.serviceDate)
        .eq("status", key.status),
    )
    .take(SUMMARY_READ_CAP);
  return rows.length;
}

export const daySummary = query({
  args: { schoolId: v.id("schools"), serviceDate: v.string() },
  returns: v.object({
    pending: v.number(),
    fulfilled: v.number(),
    missed: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return {
      pending: await countExpectations(ctx, { ...args, status: "pending" }),
      fulfilled: await countExpectations(ctx, { ...args, status: "fulfilled" }),
      missed: await countExpectations(ctx, { ...args, status: "missed" }),
    };
  },
});
