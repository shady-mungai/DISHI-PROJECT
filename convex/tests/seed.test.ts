import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../{seed,settings}.ts");

const START_DATE = "2026-09-14";
const CALENDAR_DAYS = 7;
const WEEKDAYS_IN_WINDOW = 5;

describe("seedDemo", () => {
  test("creates settings, the pilot school and calendar days", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.seed.seedDemo, {
      startDate: START_DATE,
      calendarDays: CALENDAR_DAYS,
    });

    expect(result.schoolCreated).toBe(true);
    expect(result.settingsCreated).toBeGreaterThan(0);
    expect(result.calendarDaysCreated).toBe(CALENDAR_DAYS);
  });

  test("is idempotent — a second run creates nothing", async () => {
    const t = convexTest(schema, modules);
    const args = { startDate: START_DATE, calendarDays: CALENDAR_DAYS };

    await t.mutation(internal.seed.seedDemo, args);
    const second = await t.mutation(internal.seed.seedDemo, args);

    expect(second.settingsCreated).toBe(0);
    expect(second.schoolCreated).toBe(false);
    expect(second.calendarDaysCreated).toBe(0);
  });

  test("marks weekends as non-school days (P-02)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedDemo, {
      startDate: START_DATE,
      calendarDays: CALENDAR_DAYS,
    });

    const schoolDays = await t.run(async (ctx) => {
      const days = await ctx.db.query("academicCalendar").collect();
      return days.filter((day) => day.isSchoolDay).length;
    });

    expect(schoolDays).toBe(WEEKDAYS_IN_WINDOW);
  });
});
