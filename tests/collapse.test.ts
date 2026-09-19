import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { addDays, toServiceDate } from "../convex/lib/dates";
import { seedRules } from "../convex/rules";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

// A Friday at least a week ahead: convex-test fires past-due schedules at
// once, so a fixed date turns into a sweep-before-taps time bomb.
const DAYS_AHEAD = 7;
const FRIDAY = 5;
const DAYS_PER_WEEK = 7;
const WEEKDAYS_PER_WEEK = 5;
function nextFridayFrom(serviceDate: string): string {
  const weekday = new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
  return addDays(serviceDate, (FRIDAY - weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK);
}
const SCHOOL_DAY = nextFridayFrom(addDays(toServiceDate(Date.now()), DAYS_AHEAD));
const WEEK_DAYS = Array.from({ length: WEEKDAYS_PER_WEEK }, (_, index) => addDays(SCHOOL_DAY, index - (WEEKDAYS_PER_WEEK - 1)));
const SERVICE_START_AT = Date.parse(`${SCHOOL_DAY}T09:30:00.000Z`);
const DEVICE_REF = "READER-01";
const GUARDIAN_COUNT = 4;
const CHILDREN_PER_GUARDIAN = 3;
const NO_SHOW_TAGS = ["tag-0-2", "tag-3-2"];
const REQUIRED_REDUCTION = 0.55;
const OPENING_BALANCE_KES = 80;

type Harness = ReturnType<typeof convexTest>;

async function seedFamilies(t: Harness): Promise<Id<"schools">> {
  const schoolId = await t.run(async (ctx) => {
    await seedRules(ctx);
    for (const day of WEEK_DAYS) {
      await ctx.db.insert("academicCalendar", { serviceDate: day, isSchoolDay: true, dayType: "full" });
    }
    const schoolId = await ctx.db.insert("schools", { code: "SCH-1", name: "Pilot Primary", active: true });
    for (let g = 0; g < GUARDIAN_COUNT; g += 1) {
      const guardianId = await ctx.db.insert("guardians", {
        msisdn: `+2547000000${g}`,
        displayName: `Guardian ${g}`,
        language: "en",
        optedOutTypes: [],
      });
      for (let c = 0; c < CHILDREN_PER_GUARDIAN; c += 1) {
        const studentId = await ctx.db.insert("students", {
          schoolId,
          studentRef: `STU-${g}-${c}`,
          fullName: `Child${g}${c} Njeri`,
          className: "4A",
          status: "active",
        });
        await ctx.db.insert("guardianLinks", { guardianId, studentId, relationship: "mother", active: true });
        await ctx.db.insert("tags", { tagUid: `tag-${g}-${c}`, studentId, status: "active", issuedAt: Date.now() });
        await ctx.db.insert("wallets", { studentId, balanceKes: OPENING_BALANCE_KES });
      }
    }
    return schoolId;
  });
  await t.mutation(internal.devices.registerDevice, { deviceRef: DEVICE_REF, schoolId, secret: "demo-device-secret", firmwareVersion: "1.0.0" });
  return schoolId;
}

async function runScheduled(t: Harness): Promise<void> {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

async function notifications(t: Harness) {
  return await t.run(async (ctx) => await ctx.db.query("notifications").collect());
}

describe("collapse window and digest (D7)", () => {
  test("a service day through the policy layer cuts volume by ≥55% with no lost missed-meal alert (NFR-602, FR-504, P-11)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedFamilies(t);
    await t.mutation(internal.expectations.startSchoolDay, { schoolId, serviceDate: SCHOOL_DAY, serviceStartAt: SERVICE_START_AT });

    const tags = Array.from({ length: GUARDIAN_COUNT }, (_, g) => Array.from({ length: CHILDREN_PER_GUARDIAN }, (_, c) => `tag-${g}-${c}`)).flat();
    const tapped = tags.filter((tag) => !NO_SHOW_TAGS.includes(tag));
    await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: tapped.map((tag) => ({ eventId: `tap-${tag}`, tagUid: tag, occurredAt: SERVICE_START_AT })),
    });
    await t.mutation(internal.expectations.sweepMissed, { schoolId, serviceDate: SCHOOL_DAY });
    await runScheduled(t);

    const rows = await notifications(t);
    const candidates = rows.length;
    const sent = rows.filter((row) => row.status === "sent");
    expect(candidates).toBe(GUARDIAN_COUNT * CHILDREN_PER_GUARDIAN);
    expect(sent).toHaveLength(GUARDIAN_COUNT);
    expect(1 - sent.length / candidates).toBeGreaterThanOrEqual(REQUIRED_REDUCTION);

    const merged = rows.filter((row) => row.suppressionReason === "collapsed");
    expect(merged.every((row) => row.collapsedInto !== undefined)).toBe(true);
    const bodies = sent.map((row) => row.body);
    expect(bodies.filter((body) => body.includes("did not tap"))).toHaveLength(NO_SHOW_TAGS.length);
    expect(bodies.find((body) => body.includes("Child02"))).toMatch(/^Dear Guardian 0, Child02 Njeri did not tap .* Child00 Njeri had lunch/);
    expect(bodies.every((body) => body.split("Dear ").length === 2)).toBe(true);
  });

  test("a second event outside the window starts a new one", async () => {
    const t = convexTest(schema, modules);
    await seedFamilies(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", { key: "collapseWindowMinutes", value: 0, description: "test" });
    });
    await t.mutation(internal.ingest.recordBatch, {
      deviceRef: DEVICE_REF,
      events: [
        { eventId: "tap-a", tagUid: "tag-0-0", occurredAt: SERVICE_START_AT },
        { eventId: "tap-b", tagUid: "tag-0-1", occurredAt: SERVICE_START_AT },
      ],
    });
    await runScheduled(t);
    expect((await notifications(t)).map((row) => row.status)).toEqual(["sent", "sent"]);
  });

  test("the weekly digest states meals taken out of possible and the closing balance (P-05)", async () => {
    const t = convexTest(schema, modules);
    const schoolId = await seedFamilies(t);
    await t.run(async (ctx) => {
      const student = (await ctx.db.query("students").first())!;
      const window = { windowStart: SERVICE_START_AT, windowEnd: SERVICE_START_AT, cutoffAt: SERVICE_START_AT };
      await ctx.db.insert("expectations", { schoolId, studentId: student._id, serviceDate: WEEK_DAYS[0], status: "fulfilled", ...window });
      await ctx.db.insert("expectations", { schoolId, studentId: student._id, serviceDate: WEEK_DAYS[1], status: "missed", ...window });
      await ctx.db.insert("expectations", { schoolId, studentId: student._id, serviceDate: WEEK_DAYS[2], status: "fulfilled", ...window });
    });

    const emitted = await t.mutation(internal.digest.sendWeeklyDigest, { serviceDate: SCHOOL_DAY });
    const again = await t.mutation(internal.digest.sendWeeklyDigest, { serviceDate: SCHOOL_DAY });
    await runScheduled(t);

    expect(emitted).toBe(GUARDIAN_COUNT);
    expect(again).toBe(0);
    const rows = await notifications(t);
    expect(rows).toHaveLength(GUARDIAN_COUNT);
    const first = rows.find((row) => row.body.includes("Child00"))!;
    expect(first.status).toBe("sent");
    expect(first.body).toContain("Dear Guardian 0, This week: Child00 2/3 meals, KES 80; Child01 0/0 meals, KES 80; Child02 0/0 meals, KES 80.");
  });
});
