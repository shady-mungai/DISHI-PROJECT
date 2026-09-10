import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { addDays, isWeekend } from "./lib/dates";
import { DEMO_SETTINGS } from "./settings";

const PILOT_SCHOOL_CODE = "NRB-PILOT-01";
const PILOT_SCHOOL_NAME = "Pilot Primary School";
const CALENDAR_DAYS = 30;

export const seedDemo = internalMutation({
  args: {
    startDate: v.string(),
    calendarDays: v.optional(v.number()),
  },
  returns: v.object({
    settingsCreated: v.number(),
    schoolCreated: v.boolean(),
    calendarDaysCreated: v.number(),
  }),
  handler: async (ctx, args) => {
    let settingsCreated = 0;
    for (const setting of DEMO_SETTINGS) {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", setting.key))
        .unique();
      if (!existing) {
        await ctx.db.insert("settings", setting);
        settingsCreated += 1;
      }
    }

    const existingSchool = await ctx.db
      .query("schools")
      .withIndex("by_code", (q) => q.eq("code", PILOT_SCHOOL_CODE))
      .unique();
    if (!existingSchool) {
      await ctx.db.insert("schools", {
        code: PILOT_SCHOOL_CODE,
        name: PILOT_SCHOOL_NAME,
        active: true,
      });
    }

    const totalDays = args.calendarDays ?? CALENDAR_DAYS;
    let calendarDaysCreated = 0;
    for (let offset = 0; offset < totalDays; offset += 1) {
      const serviceDate = addDays(args.startDate, offset);
      const existingDay = await ctx.db
        .query("academicCalendar")
        .withIndex("by_serviceDate", (q) => q.eq("serviceDate", serviceDate))
        .unique();
      if (existingDay) {
        continue;
      }

      const schoolDay = !isWeekend(serviceDate);
      await ctx.db.insert("academicCalendar", {
        serviceDate,
        isSchoolDay: schoolDay,
        dayType: schoolDay ? "full" : "holiday",
      });
      calendarDaysCreated += 1;
    }

    return {
      settingsCreated,
      schoolCreated: !existingSchool,
      calendarDaysCreated,
    };
  },
});
