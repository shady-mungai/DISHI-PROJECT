import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { addDays, isWeekend } from "./lib/dates";
import { commitRosterRows, type RosterRow } from "./enrolment";
import { seedRules } from "./rules";
import { DEMO_SETTINGS } from "./settings";

export const PILOT_SCHOOL_CODE = "NRB-PILOT-01";
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
    rulesCreated: v.number(),
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
      rulesCreated: await seedRules(ctx),
    };
  },
});

const PILOT_FAMILIES = [
  { student: "Amani Mungai", guardian: "Mary Mungai", msisdn: "254700574770" },
  { student: "Zawadi Otieno", guardian: "Peter Otieno", msisdn: "254755770777" },
  { student: "Baraka Wanjiru", guardian: "Grace Wanjiru", msisdn: "254702259662" },
  { student: "Imani Kiprop", guardian: "Daniel Kiprop", msisdn: "254722737170" },
  { student: "Neema Achieng", guardian: "Faith Achieng", msisdn: "254700300631" },
] as const;
const PILOT_CLASS_NAME = "Grade 6B";
const PILOT_OPENING_BALANCE_KES = 100;
const ROSTER_TABLES = [
  "tags",
  "wallets",
  "expectations",
  "notifications",
  "guardianLinks",
  "guardians",
  "students",
] as const;

export const resetPilotRoster = internalMutation({
  args: {},
  returns: v.object({ studentsCreated: v.number(), guardiansCreated: v.number() }),
  handler: async (ctx) => {
    const school = await ctx.db
      .query("schools")
      .withIndex("by_code", (q) => q.eq("code", PILOT_SCHOOL_CODE))
      .unique();
    if (!school) {
      throw new Error(`Run seedDemo first: school ${PILOT_SCHOOL_CODE} missing`);
    }

    for (const table of ROSTER_TABLES) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id);
      }
    }

    const rows: RosterRow[] = PILOT_FAMILIES.map((family) => ({
      fullName: family.student,
      className: PILOT_CLASS_NAME,
      guardianMsisdn: family.msisdn,
      guardianName: family.guardian,
      guardianRelationship: "guardian",
      openingBalanceKes: PILOT_OPENING_BALANCE_KES,
    }));
    return await commitRosterRows(ctx, school._id, rows);
  },
});
