import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../convex/_generated/api";
import { hmacSha256Hex, sha256Hex } from "../convex/lib/hmac";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const DEVICE_REF = "READER-01";
const DEVICE_SECRET = "demo-device-secret";
const TAG_UID = "tag-001";
const TEN_MINUTES_MS = 10 * 60 * 1000;

type IngestTapInput = { eventId: string; tagUid: string; occurredAt: number; correlationId?: string };

async function seedSchoolWithTaggedStudent(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Test School", active: true });
    const studentId = await ctx.db.insert("students", {
      schoolId,
      studentRef: "STU-1",
      fullName: "Jane Doe",
      className: "4A",
      status: "active",
    });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId, status: "active", issuedAt: Date.now() });
    return schoolId;
  });
}

async function registerDevice(t: ReturnType<typeof convexTest>, schoolId: Awaited<ReturnType<typeof seedSchoolWithTaggedStudent>>) {
  await t.mutation(internal.devices.registerDevice, {
    deviceRef: DEVICE_REF,
    schoolId,
    secret: DEVICE_SECRET,
    firmwareVersion: "1.0.0",
  });
}

async function postIngest(t: ReturnType<typeof convexTest>, deviceRef: string, secret: string, events: IngestTapInput[]) {
  const bodyText = JSON.stringify({ events });
  const bodyBytes = new TextEncoder().encode(bodyText);
  const secretHash = await sha256Hex(secret);
  const signature = await hmacSha256Hex(secretHash, bodyBytes);
  return await t.fetch("/ingest", {
    method: "POST",
    headers: { "X-Device-Ref": deviceRef, "X-Signature": signature, "content-type": "application/json" },
    body: bodyText,
  });
}

describe("POST /ingest", () => {
  test("rejects an unregistered device (NFR-402)", async () => {
    const t = convexTest(schema, modules);
    const res = await postIngest(t, "UNKNOWN-DEVICE", "whatever", []);
    expect(res.status).toBe(401);
  });

  test("rejects a signature made with the wrong secret (NFR-402)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchoolWithTaggedStudent(t);
    await registerDevice(t, schoolId);

    const res = await postIngest(t, DEVICE_REF, "wrong-secret", [
      { eventId: "e1", tagUid: TAG_UID, occurredAt: Date.now() },
    ]);
    expect(res.status).toBe(401);
  });

  test("accepts a first tap, rejects a same-day second tap as a duplicate (FR-204, ST-04)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchoolWithTaggedStudent(t);
    await registerDevice(t, schoolId);

    const now = Date.now();
    const res = await postIngest(t, DEVICE_REF, DEVICE_SECRET, [
      { eventId: "e1", tagUid: TAG_UID, occurredAt: now },
      { eventId: "e2", tagUid: TAG_UID, occurredAt: now + 1000 },
    ]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { eventId: "e1", status: "accepted" },
      { eventId: "e2", status: "duplicate", reason: "second_tap_same_day" },
    ]);

    const tappedCount = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("events")
          .withIndex("by_type_occurredAt", (q) => q.eq("type", "meal.tapped"))
          .collect()
      ).length,
    );
    expect(tappedCount).toBe(1);
  });

  test("replaying the exact same eventId is a pure no-op (NFR-204)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchoolWithTaggedStudent(t);
    await registerDevice(t, schoolId);

    const now = Date.now();
    await postIngest(t, DEVICE_REF, DEVICE_SECRET, [{ eventId: "e1", tagUid: TAG_UID, occurredAt: now }]);
    const replayRes = await postIngest(t, DEVICE_REF, DEVICE_SECRET, [{ eventId: "e1", tagUid: TAG_UID, occurredAt: now }]);

    const replayBody = await replayRes.json();
    expect(replayBody.results).toEqual([{ eventId: "e1", status: "duplicate", reason: "replayed_event_id" }]);

    const totalEventsForId = await t.run(async (ctx) =>
      (await ctx.db.query("events").withIndex("by_eventId", (q) => q.eq("eventId", "e1")).collect()).length,
    );
    expect(totalEventsForId).toBe(1);
  });

  test("flags clock skew beyond tolerance but still accepts the tap (FR-206)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchoolWithTaggedStudent(t);
    await registerDevice(t, schoolId);

    const skewedOccurredAt = Date.now() - TEN_MINUTES_MS;
    const res = await postIngest(t, DEVICE_REF, DEVICE_SECRET, [
      { eventId: "e1", tagUid: TAG_UID, occurredAt: skewedOccurredAt },
    ]);

    const body = await res.json();
    expect(body.results).toEqual([{ eventId: "e1", status: "accepted", reason: "clock_skew_flagged" }]);
  });

  test("rejects a tap against an unknown tag", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedSchoolWithTaggedStudent(t);
    await registerDevice(t, schoolId);

    const res = await postIngest(t, DEVICE_REF, DEVICE_SECRET, [
      { eventId: "e1", tagUid: "NEVER-ISSUED", occurredAt: Date.now() },
    ]);
    const body = await res.json();
    expect(body.results).toEqual([{ eventId: "e1", status: "rejected", reason: "unknown_tag" }]);
  });
});
