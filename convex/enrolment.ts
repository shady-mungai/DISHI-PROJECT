import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole, requireSchoolScope } from "./lib/authz";
import { normaliseTagUid } from "./lib/tagUid";

const IMPORT_ROLES = ["school", "admin"] as const;
const SCHEMA_VERSION = 1;

const rosterRowValidator = v.object({
  fullName: v.string(),
  className: v.string(),
  guardianMsisdn: v.string(),
  guardianName: v.optional(v.string()),
  guardianRelationship: v.string(),
  tagUid: v.optional(v.string()),
  openingBalanceKes: v.number(),
});

export type RosterRow = {
  fullName: string;
  className: string;
  guardianMsisdn: string;
  guardianName?: string;
  guardianRelationship: string;
  tagUid?: string;
  openingBalanceKes: number;
};

export const requestUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireRole(ctx, IMPORT_ROLES);
    return await ctx.storage.generateUploadUrl();
  },
});

// Called from the Node action that extracts PDF text — actions have no
// ctx.db, so the role check happens here and the action just awaits it.
export const assertImportRole = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireRole(ctx, IMPORT_ROLES);
    return null;
  },
});

export const commitRoster = mutation({
  args: { schoolId: v.id("schools"), rows: v.array(rosterRowValidator) },
  returns: v.object({ studentsCreated: v.number(), guardiansCreated: v.number() }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    return await commitRosterRows(ctx, args.schoolId, args.rows);
  },
});

// Split from the `mutation` wrapper above so it's testable without faking a
// Better Auth session — same split as convex/lib/roles.ts vs authz.ts.
export async function commitRosterRows(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  rows: readonly RosterRow[],
): Promise<{ studentsCreated: number; guardiansCreated: number }> {
  let guardiansCreated = 0;
  const importedAt = Date.now();

  for (const [index, row] of rows.entries()) {
    const studentId = await ctx.db.insert("students", {
      schoolId,
      studentRef: `STU-${importedAt.toString(36)}-${index}`,
      fullName: row.fullName,
      className: row.className,
      status: "active",
    });

    const guardian = await findOrCreateGuardian(ctx, row.guardianMsisdn);
    if (guardian.created) {
      guardiansCreated += 1;
    }
    if (row.guardianName) {
      await ctx.db.patch(guardian.id, { displayName: row.guardianName });
    }

    await ctx.db.insert("guardianLinks", {
      guardianId: guardian.id,
      studentId,
      relationship: row.guardianRelationship,
      active: true,
    });

    if (row.tagUid) {
      await ctx.db.insert("tags", {
        tagUid: normaliseTagUid(row.tagUid),
        studentId,
        status: "active",
        issuedAt: importedAt,
      });
    }

    await ctx.db.insert("wallets", { studentId, balanceKes: row.openingBalanceKes });

    // FR-105's audit trail: the append-only events table, not a separate log.
    await ctx.db.insert("events", {
      eventId: crypto.randomUUID(),
      type: "student.enrolled",
      occurredAt: importedAt,
      recordedAt: importedAt,
      schemaVersion: SCHEMA_VERSION,
      correlationId: crypto.randomUUID(),
      payload: { student_id: studentId, school_id: schoolId, class: row.className },
      schoolId,
      studentId,
    });
  }

  return { studentsCreated: rows.length, guardiansCreated };
}

export async function findOrCreateGuardian(
  ctx: MutationCtx,
  msisdn: string,
): Promise<{ id: Id<"guardians">; created: boolean }> {
  const existing = await ctx.db
    .query("guardians")
    .withIndex("by_msisdn", (q) => q.eq("msisdn", msisdn))
    .unique();
  if (existing) {
    return { id: existing._id, created: false };
  }

  const id = await ctx.db.insert("guardians", {
    msisdn,
    displayName: msisdn,
    language: "en",
    optedOutTypes: [],
  });
  return { id, created: true };
}
