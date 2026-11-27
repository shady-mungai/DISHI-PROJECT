import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { QueryCtx } from "../convex/_generated/server";
import { hmacSha256Hex } from "../convex/lib/hmac";
import { assignTagToStudent, provisionReader } from "../convex/readers";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const UPPERCASE_UID = "04:A3:B2:C1:D5:E6:80";
const LOWERCASE_UID = "04:a3:b2:c1:d5:e6:80";

type Harness = ReturnType<typeof convexTest>;

async function seedSchool(t: Harness) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Test School", active: true });
    const firstStudentId = await ctx.db.insert("students", {
      schoolId,
      studentRef: "STU-1",
      fullName: "Jane Doe",
      className: "4A",
      status: "active",
    });
    const secondStudentId = await ctx.db.insert("students", {
      schoolId,
      studentRef: "STU-2",
      fullName: "John Doe",
      className: "4A",
      status: "active",
    });
    return { schoolId, firstStudentId, secondStudentId };
  });
}

async function postSigned(t: Harness, device: { deviceRef: string; signingKeyHex: string }, tagUid: string) {
  const bodyText = JSON.stringify({ events: [{ eventId: `${device.deviceRef}:${tagUid}:1`, tagUid, occurredAt: Date.now() }] });
  const signature = await hmacSha256Hex(device.signingKeyHex, new TextEncoder().encode(bodyText));
  const res = await t.fetch("/ingest", {
    method: "POST",
    headers: { "X-Device-Ref": device.deviceRef, "X-Signature": signature, "content-type": "application/json" },
    body: bodyText,
  });
  return (await res.json()) as { results: Array<{ status: string; reason?: string }> };
}

async function activeTagFor(ctx: QueryCtx, studentId: Id<"students">) {
  return await ctx.db
    .query("tags")
    .withIndex("by_student_status", (q) => q.eq("studentId", studentId).eq("status", "active"))
    .first();
}

describe("phone reader", () => {
  test("a provisioned phone signs a batch /ingest accepts, and UID case never matters", async () => {
    const t = convexTest(schema, modules);
    const { schoolId, firstStudentId } = await seedSchool(t);

    const device = await t.run((ctx) => provisionReader(ctx, schoolId));
    await t.run((ctx) => assignTagToStudent(ctx, schoolId, firstStudentId, UPPERCASE_UID));

    const { results } = await postSigned(t, device, LOWERCASE_UID);
    expect(results[0].status).toBe("accepted");
  });

  test("reassigning a tag revokes the previous holder and the old tag of the new holder", async () => {
    const t = convexTest(schema, modules);
    const { schoolId, firstStudentId, secondStudentId } = await seedSchool(t);

    await t.run((ctx) => assignTagToStudent(ctx, schoolId, firstStudentId, LOWERCASE_UID));
    await t.run((ctx) => assignTagToStudent(ctx, schoolId, secondStudentId, "aa:bb:cc:dd"));
    await t.run((ctx) => assignTagToStudent(ctx, schoolId, secondStudentId, LOWERCASE_UID));

    expect(await t.run((ctx) => activeTagFor(ctx, firstStudentId))).toBeNull();
    expect((await t.run((ctx) => activeTagFor(ctx, secondStudentId)))?.tagUid).toBe(LOWERCASE_UID);

    const device = await t.run((ctx) => provisionReader(ctx, schoolId));
    const { results } = await postSigned(t, device, "aa:bb:cc:dd");
    expect(results[0]).toMatchObject({ status: "rejected", reason: "tag_revoked" });
  });

  test("refuses to assign a tag to a student outside the school", async () => {
    const t = convexTest(schema, modules);
    const { firstStudentId } = await seedSchool(t);
    const otherSchoolId = await t.run((ctx) => ctx.db.insert("schools", { code: "SCH-2", name: "Other", active: true }));

    await expect(t.run((ctx) => assignTagToStudent(ctx, otherSchoolId, firstStudentId, LOWERCASE_UID))).rejects.toThrow();
  });
});
