import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireRole, requireSchoolScope, requireUser } from "./lib/authz";
import { accessDelivery } from "./lib/deliveryWorkflow";
import { readSetting, SettingKey } from "./settings";

export function publicDelivery(row: Doc<"deliveries">) {
  return {
    _id: row._id,
    schoolId: row.schoolId,
    serviceDate: row.serviceDate,
    portions: row.portions,
    portionsReceived: row.portionsReceived,
    docketRef: row.docketRef,
    vehicle: row.vehicle,
    reference: row.reference ?? row.docketRef,
    status: row.status,
    workflowVersion: row.workflowVersion ?? 1,
    dispatchedAt: row.dispatchedAt,
    expectedArrivalAt: row.expectedArrivalAt ?? row.expectedConfirmBy,
    overdueAt: row.overdueAt,
    receiptRecordedAt: row.receiptRecordedAt,
    receiptConfirmedAt: row.receiptConfirmedAt,
    receiptMethod: row.receiptMethod,
    reportedProblem: row.reportedProblem,
    note: row.note,
    evidenceId: row.evidenceId,
    missingEvidence: row.missingEvidence,
    reviewRequired: row.reviewRequired,
    reviewResolvedAt: row.reviewResolvedAt,
  };
}
async function enrich(ctx: QueryCtx, rows: Doc<"deliveries">[]) {
  return await Promise.all(
    rows.map(async (row) => {
      const school = await ctx.db.get(row.schoolId);
      const reconciliation = await ctx.db
        .query("reconciliations")
        .withIndex("by_school_serviceDate", (q) =>
          q.eq("schoolId", row.schoolId).eq("serviceDate", row.serviceDate),
        )
        .unique();
      return {
        ...publicDelivery(row),
        schoolName: school?.name ?? "Unknown school",
        schoolCode: school?.code ?? "",
        servedForDay: reconciliation?.consumed ?? null,
      };
    }),
  );
}
export const active = query({
  args: { schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    if (actor.role === "school" && args.schoolId !== actor.schoolId)
      throw new ConvexError("School access denied.");
    if (args.schoolId) await requireSchoolScope(ctx, args.schoolId);
    const rows: Doc<"deliveries">[] = [];
    for (const status of ["unconfirmed", "declared"] as const) {
      const query = ctx.db.query("deliveries");
      const selected = args.schoolId
        ? query.withIndex("by_schoolId_and_status", (q) =>
            q.eq("schoolId", args.schoolId!).eq("status", status),
          )
        : actor.role === "supplier"
          ? query.withIndex("by_declaredBy_and_status", (q) =>
              q.eq("declaredBy", actor._id).eq("status", status),
            )
          : query.withIndex("by_status_serviceDate", (q) =>
              q.eq("status", status),
            );
      rows.push(...(await selected.order("desc").take(100)));
    }
    rows.sort(
      (a, b) =>
        Number(b.overdueAt !== undefined) - Number(a.overdueAt !== undefined) ||
        a.dispatchedAt - b.dispatchedAt,
    );
    return await enrich(ctx, rows);
  },
});
export const history = query({
  args: {
    schoolId: v.optional(v.id("schools")),
    from: v.string(),
    to: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const schoolId = actor.role === "school" ? actor.schoolId : args.schoolId;
    if (
      actor.role === "school" &&
      (!schoolId || (args.schoolId && args.schoolId !== schoolId))
    )
      throw new ConvexError("School access denied.");
    const base = ctx.db.query("deliveries");
    const scoped = schoolId
      ? base.withIndex("by_school_serviceDate", (q) =>
          q
            .eq("schoolId", schoolId)
            .gte("serviceDate", args.from)
            .lte("serviceDate", args.to),
        )
      : actor.role === "supplier"
        ? base.withIndex("by_declaredBy_and_serviceDate", (q) =>
            q
              .eq("declaredBy", actor._id)
              .gte("serviceDate", args.from)
              .lte("serviceDate", args.to),
          )
        : base.withIndex("by_serviceDate", (q) =>
            q.gte("serviceDate", args.from).lte("serviceDate", args.to),
          );
    const page = await (
      actor.role === "supplier" && schoolId
        ? scoped.filter((q) => q.eq(q.field("declaredBy"), actor._id))
        : scoped
    )
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...page, page: await enrich(ctx, page.page) };
  },
});
export const reviewQueue = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const page = await ctx.db
      .query("deliveries")
      .withIndex("by_reviewRequired", (q) => q.eq("reviewRequired", true))
      .order("asc")
      .paginate(args.paginationOpts);
    return { ...page, page: await enrich(ctx, page.page) };
  },
});
export const detail = query({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    const { actor, delivery } = await accessDelivery(ctx, args.deliveryId);
    const entries = await ctx.db
      .query("deliveryTimeline")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
      .order("desc")
      .take(100);
    const sms =
      actor.role === "admin"
        ? await ctx.db
            .query("deliverySms")
            .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
            .take(100)
        : [];
    const code = await ctx.db
      .query("receiptCodes")
      .withIndex("by_deliveryId", (q) => q.eq("deliveryId", delivery._id))
      .unique();
    return {
      delivery: publicDelivery(delivery),
      timeline: entries,
      sms: sms.map((row) => ({
        _id: row._id,
        recipientKey: row.recipientKey,
        status: row.status,
        failureReason: row.failureReason,
      })),
      codeExpiresAt: code && !code.usedAt ? code.expiresAt : null,
      cooldownUntil: code?.cooldownUntil ?? null,
    };
  },
});
async function forecast(
  ctx: QueryCtx,
  schoolId: Id<"schools">,
  serviceDate: string,
) {
  const calendar = await ctx.db
    .query("academicCalendar")
    .withIndex("by_serviceDate", (q) => q.eq("serviceDate", serviceDate))
    .unique();
  const schoolDay =
    (await readSetting(ctx, SettingKey.TreatEveryDayAsSchoolDay)) === true ||
    calendar?.isSchoolDay !== false;
  const row = schoolDay
    ? await ctx.db
        .query("forecasts")
        .withIndex("by_school_serviceDate", (q) =>
          q.eq("schoolId", schoolId).eq("serviceDate", serviceDate),
        )
        .unique()
    : null;
  return {
    schoolId,
    serviceDate,
    state: !schoolDay
      ? ("not_school_day" as const)
      : row
        ? ("available" as const)
        : ("unavailable" as const),
    portions: row?.portions ?? null,
    confidence: row?.confidence ?? null,
    computedAt: row?.computedAt ?? null,
  };
}
export const forecasts = query({
  args: { serviceDate: v.string(), schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    if (
      actor.role === "school" &&
      (!args.schoolId || actor.schoolId !== args.schoolId)
    )
      throw new ConvexError("School access denied.");
    if (args.schoolId) {
      const school = await ctx.db.get(args.schoolId);
      return [
        {
          ...(await forecast(ctx, args.schoolId, args.serviceDate)),
          schoolName: school?.name ?? "",
          schoolCode: school?.code ?? "",
        },
      ];
    }
    const schools = (await ctx.db.query("schools").take(100)).filter(
      (s) => s.active,
    );
    return await Promise.all(
      schools.map(async (school) => ({
        ...(await forecast(ctx, school._id, args.serviceDate)),
        schoolName: school.name,
        schoolCode: school.code,
      })),
    );
  },
});
