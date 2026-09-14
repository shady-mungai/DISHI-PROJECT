import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { commitRosterRows, type RosterRow } from "../convex/enrolment";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function seedSchool(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => ctx.db.insert("schools", { code: "SCH-1", name: "Test School", active: true }));
}

describe("commitRosterRows (FR-105, FR-106)", () => {
  test("creates a student, guardian, tag, wallet and an audit event per row", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchool(t);

    const rows: RosterRow[] = [
      {
        fullName: "Jane Doe",
        className: "4A",
        guardianMsisdn: "+254700000001",
        guardianRelationship: "mother",
        tagUid: "TAG-1",
        openingBalanceKes: 50,
      },
    ];

    const result = await t.run((ctx) => commitRosterRows(ctx, schoolId, rows));
    expect(result).toEqual({ studentsCreated: 1, guardiansCreated: 1 });

    const counts = await t.run(async (ctx) => ({
      students: (await ctx.db.query("students").collect()).length,
      guardians: (await ctx.db.query("guardians").collect()).length,
      tags: (await ctx.db.query("tags").collect()).length,
      wallets: (await ctx.db.query("wallets").collect()).length,
      enrolledEvents: (
        await ctx.db
          .query("events")
          .withIndex("by_type_occurredAt", (q) => q.eq("type", "student.enrolled"))
          .collect()
      ).length,
    }));
    expect(counts).toEqual({ students: 1, guardians: 1, tags: 1, wallets: 1, enrolledEvents: 1 });
  });

  test("reuses an existing guardian by phone number across siblings (demo message-merging)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchool(t);
    const sharedMsisdn = "+254700000002";

    const rows: RosterRow[] = [
      { fullName: "Sibling One", className: "4A", guardianMsisdn: sharedMsisdn, guardianRelationship: "mother", openingBalanceKes: 0 },
      { fullName: "Sibling Two", className: "3B", guardianMsisdn: sharedMsisdn, guardianRelationship: "mother", openingBalanceKes: 0 },
    ];

    const result = await t.run((ctx) => commitRosterRows(ctx, schoolId, rows));
    expect(result).toEqual({ studentsCreated: 2, guardiansCreated: 1 });

    const guardianLinks = await t.run((ctx) => ctx.db.query("guardianLinks").collect());
    expect(guardianLinks).toHaveLength(2);
    expect(new Set(guardianLinks.map((link) => link.guardianId)).size).toBe(1);
  });

  test("no tagUid means no tag row, but the wallet still opens", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchool(t);

    const rows: RosterRow[] = [
      { fullName: "No Tag Yet", className: "4A", guardianMsisdn: "+254700000003", guardianRelationship: "father", openingBalanceKes: 20 },
    ];

    await t.run((ctx) => commitRosterRows(ctx, schoolId, rows));

    const counts = await t.run(async (ctx) => ({
      tags: (await ctx.db.query("tags").collect()).length,
      wallets: (await ctx.db.query("wallets").collect()).length,
    }));
    expect(counts).toEqual({ tags: 0, wallets: 1 });
  });
});
