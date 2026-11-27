import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { addDays, toServiceDate } from "../convex/lib/dates";
import { overrideRate, serveByOverride } from "../convex/overrides";
import { flagSilentReadersForSchool } from "../convex/readers";
import { deactivateStudent } from "../convex/roster";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const DAYS_AHEAD = 7;
const SCHOOL_DAY = addDays(toServiceDate(Date.now()), DAYS_AHEAD);
const NEXT_DAY = addDays(SCHOOL_DAY, 1);
const NOW = Date.parse(`${SCHOOL_DAY}T09:30:00.000Z`);
const DEVICE_REF = "READER-01";
const TAG_UID = "tag-001";
const MILLISECONDS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const SILENT_HOURS = 20;

type Harness = ReturnType<typeof convexTest>;
type World = { schoolId: Id<"schools">; studentId: Id<"students">; staff: Doc<"users"> };

afterEach(() => {
  vi.useRealTimers();
});

async function seedWorld(t: Harness): Promise<World> {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const world = await t.run(async (ctx) => {
    await ctx.db.insert("settings", { key: "collapseWindowMinutes", value: 0, description: "test" });
    await ctx.db.insert("settings", { key: "readerSilentHours", value: SILENT_HOURS, description: "test" });
    for (const day of [SCHOOL_DAY, NEXT_DAY]) {
      await ctx.db.insert("academicCalendar", { serviceDate: day, isSchoolDay: true, dayType: "full" });
    }
    await ctx.db.insert("settings", { key: "serviceRequiresSupply", value: false, description: "supply gate is covered in supplyGate.test.ts" });
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    const staffId = await ctx.db.insert("users", { authUserId: "auth-staff", displayName: "Head cook", role: "school", schoolId });
    const studentId = await ctx.db.insert("students", { schoolId, studentRef: "STU-1", fullName: "Amina Njeri", className: "4A", status: "active" });
    await ctx.db.insert("tags", { tagUid: TAG_UID, studentId, status: "active", issuedAt: NOW });
    await ctx.db.insert("wallets", { studentId, balanceKes: 100 });
    return { schoolId, studentId, staff: (await ctx.db.get(staffId))! };
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId: world.schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: SCHOOL_DAY, serviceStartAt: NOW });
  return world;
}

async function override(t: Harness, world: World) {
  return await t.run(async (ctx) => await serveByOverride(ctx, { actor: world.staff, schoolId: world.schoolId, studentId: world.studentId, reasonCode: "forgotten_tag" }));
}

async function tap(t: Harness, eventId: string) {
  const [result] = await t.mutation(internal.ingest.recordBatch, { deviceRef: DEVICE_REF, events: [{ eventId, tagUid: TAG_UID, occurredAt: Date.now() }] });
  return result;
}

async function eventsOfType(t: Harness, type: string): Promise<Doc<"events">[]> {
  const rows = await t.run(async (ctx) => await ctx.db.query("events").collect());
  return rows.filter((row) => row.type === type);
}

async function expectationStatus(t: Harness, world: World, serviceDate: string) {
  const rows = await t.run(async (ctx) => await ctx.db.query("expectations").collect());
  return rows.find((row) => row.studentId === world.studentId && row.serviceDate === serviceDate)?.status;
}

async function rate(t: Harness, world: World) {
  return await t.run(async (ctx) => await overrideRate(ctx, { schoolId: world.schoolId, to: SCHOOL_DAY }));
}

async function deactivate(t: Harness, world: World) {
  return await t.run(async (ctx) => await deactivateStudent(ctx, { schoolId: world.schoolId, studentId: world.studentId, reason: "transferred" }));
}

async function flagSilent(t: Harness, world: World) {
  return await t.run(async (ctx) => await flagSilentReadersForSchool(ctx, world.schoolId));
}

describe("school dashboard: override, roster corrections, reader silence (D11)", () => {
  test("an override is one countable meal with reason and staff id; a later tap is a duplicate (FR-205, ST-03, ST-04, NFR-405)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    expect(await override(t, world)).toEqual({ status: "served", serviceDate: SCHOOL_DAY });
    expect(await override(t, world)).toEqual({ status: "already_served", serviceDate: SCHOOL_DAY });
    expect(await expectationStatus(t, world, SCHOOL_DAY)).toBe("fulfilled");
    const [served] = await eventsOfType(t, "meal.override_served");
    expect(served.payload).toEqual({ student_id: world.studentId, reason_code: "forgotten_tag", staff_id: world.staff._id });
    expect(await eventsOfType(t, "wallet.debited")).toHaveLength(1);
    expect((await tap(t, "tap-after-override")).status).toBe("duplicate");
    expect(await rate(t, world)).toMatchObject({ overrides: 1, served: 1, ratePct: 100, tolerancePct: 15 });
  });

  test("a tap first makes the override a no-op, and the rate counts both (SC-05)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    expect((await tap(t, "tap-1")).status).toBe("accepted");
    expect((await override(t, world)).status).toBe("already_served");
    expect(await rate(t, world)).toMatchObject({ overrides: 0, served: 1, ratePct: 0 });
  });

  test("deactivation revokes the tag, leaves today's row, and drops the child from tomorrow's expectations (SC-06, ST-05)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    expect(await deactivate(t, world)).toBe("deactivated");
    expect(await deactivate(t, world)).toBe("already_inactive");
    expect((await tap(t, "tap-after-leaving")).reason).toBe("tag_revoked");
    expect(await expectationStatus(t, world, SCHOOL_DAY)).toBe("pending");
    const tomorrow = await t.mutation(internal.expectations.startSchoolDay, { schoolId: world.schoolId, serviceDate: NEXT_DAY, serviceStartAt: NOW + HOURS_PER_DAY * MILLISECONDS_PER_HOUR });
    expect(tomorrow.created).toBe(0);
    expect(await eventsOfType(t, "student.deactivated")).toHaveLength(1);
  });

  test("a reader that has not synced within the window is flagged once per day; never-seen devices are not (SC-04)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    expect(await flagSilent(t, world)).toBe(0);
    await tap(t, "tap-1");
    vi.setSystemTime(NOW + (SILENT_HOURS + 1) * MILLISECONDS_PER_HOUR);
    expect(await flagSilent(t, world)).toBe(1);
    expect(await flagSilent(t, world)).toBe(0);
    const [flagged] = await eventsOfType(t, "device.heartbeat_missed");
    expect(flagged.payload.device_id).toBe(DEVICE_REF);
  });
});
