import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { addDays, isWeekend, serviceStartFor } from "./lib/dates";
import { mulberry32 } from "./lib/simulation";
import { computeVariance } from "./lib/supply";
import { commitRosterRows, type RosterRow } from "./enrolment";
import { PILOT_SCHOOL_CODE, ROSTER_TABLES } from "./seed";


const STREAMS = ["Grade 6A", "Grade 6B", "Grade 6C", "Grade 6D"] as const;
type Stream = (typeof STREAMS)[number];

const GUARDIANS = [
  { msisdn: "254700574770", name: "Mary Mungai" },
  { msisdn: "254722737130", name: "Daniel Kiprop" },
  { msisdn: "254700300631", name: "Faith Achieng" },
  { msisdn: "254702259662", name: "Grace Wanjiru" },
  { msisdn: "254722324008", name: "John Kamau" },
] as const;

const PUPIL_NAMES = [
  "Amani Mungai", "Zawadi Otieno", "Baraka Wanjiru", "Imani Kiprop", "Neema Achieng",
  "Juma Kamau", "Wanjiku Njoroge", "Kevin Ochieng", "Faith Chebet", "Brian Mutua",
  "Achieng Odhiambo", "Kipchoge Rotich", "Mercy Wambui", "Daudi Omondi", "Nyokabi Kariuki",
  "Hassan Abdi", "Akinyi Owino", "Kimani Githinji", "Shiro Muthoni", "Otieno Okoth",
  "Jebet Kiplagat", "Mwangi Ndungu", "Halima Yusuf", "Wekesa Simiyu", "Njeri Gathoni",
  "Kibet Langat", "Atieno Adhiambo", "Musyoka Kilonzo", "Wairimu Kamande", "Onyango Ouma",
  "Chepkoech Sang", "Maina Kinyua", "Nafula Wafula", "Ruto Kiprono", "Waithera Mbugua",
  "Ali Mohamed", "Kerubo Nyaboke", "Mutiso Muli", "Wangari Njeri", "Odera Opiyo",
] as const;

type MenuItem = { dish: string; skipChance: number; streamSkipChance?: Partial<Record<Stream, number>> };

const MENU: readonly MenuItem[] = [
  { dish: "pilau with kachumbari", skipChance: 0.04 },
  { dish: "chapati and bean stew", skipChance: 0.06 },
  { dish: "ugali, sukuma wiki and beef stew", skipChance: 0.09, streamSkipChance: { "Grade 6A": 0.22 } },
  { dish: "rice and ndengu", skipChance: 0.14, streamSkipChance: { "Grade 6D": 0.36 } },
  { dish: "matoke and beef stew", skipChance: 0.24, streamSkipChance: { "Grade 6B": 0.42 } },
  { dish: "githeri", skipChance: 0.38, streamSkipChance: { "Grade 6C": 0.12 } },
];

const STRONG_AVERSIONS: ReadonlyMap<number, string> = new Map([
  [3, "rice and ndengu"],
  [12, "githeri"],
  [21, "matoke and beef stew"],
  [30, "ugali, sukuma wiki and beef stew"],
]);

const STRONG_AVERSION_SKIP_CHANCE = 0.85;
const PICKINESS_MIN = 0.6;
const PICKINESS_SPREAD = 0.9;
const ABSENCE_CHANCE = 0.06;
const FRIDAY_ABSENCE_CHANCE = 0.12;
const FRIDAY = 5;
const DEFAULT_SCHOOL_DAYS = 30;
const DEFAULT_SEED = 2026;
const OPENING_BALANCE_KES = 100;
const SERVICE_WINDOW_MS = 90 * 60_000;
const DISPATCH_LEAD_MS = 2 * 60 * 60_000;
const SEED_DOCKET_PREFIX = "SEED-";
const SEED_CONFIRM_HASH = "seeded";
const MAX_ROWS_CLEARED = 4_000;
const MAX_USERS_SCANNED = 1_000;
const MAX_DELIVERIES_PER_DAY = 10;

type Pupil = { id: Id<"students">; stream: Stream; index: number; pickiness: number };
type SeedActors = { schoolId: Id<"schools">; supplierId: Id<"users">; schoolUserId: Id<"users"> };
type DayOutcome = { absent: Id<"students">[]; ate: Id<"students">[]; skipped: Id<"students">[] };

function schoolDaysEndingOn(endDate: string, count: number): string[] {
  const days: string[] = [];
  for (let date = endDate; days.length < count; date = addDays(date, -1)) {
    if (!isWeekend(date)) days.unshift(date);
  }
  return days;
}

function tagUidFor(index: number): string {
  return `5e:ed:00:${index.toString(16).padStart(2, "0")}`;
}

function rosterRows(): RosterRow[] {
  return PUPIL_NAMES.map((fullName, index) => {
    const guardian = GUARDIANS[index % GUARDIANS.length];
    return {
      fullName,
      className: STREAMS[index % STREAMS.length],
      guardianMsisdn: guardian.msisdn,
      guardianName: guardian.name,
      guardianRelationship: "guardian",
      openingBalanceKes: OPENING_BALANCE_KES,
      tagUid: tagUidFor(index),
    };
  });
}

function skipChance(item: MenuItem, pupil: Pupil): number {
  if (STRONG_AVERSIONS.get(pupil.index) === item.dish) return STRONG_AVERSION_SKIP_CHANCE;
  const base = item.streamSkipChance?.[pupil.stream] ?? item.skipChance;
  return Math.min(1, base * pupil.pickiness);
}

function absenceChance(serviceDate: string): number {
  return new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay() === FRIDAY ? FRIDAY_ABSENCE_CHANCE : ABSENCE_CHANCE;
}

function simulateDay(pupils: readonly Pupil[], item: MenuItem, serviceDate: string, random: () => number): DayOutcome {
  const outcome: DayOutcome = { absent: [], ate: [], skipped: [] };
  for (const pupil of pupils) {
    if (random() < absenceChance(serviceDate)) outcome.absent.push(pupil.id);
    else if (random() < skipChance(item, pupil)) outcome.skipped.push(pupil.id);
    else outcome.ate.push(pupil.id);
  }
  return outcome;
}

async function clearRoster(ctx: MutationCtx): Promise<void> {
  for (const table of ROSTER_TABLES) {
    for (const row of await ctx.db.query(table).take(MAX_ROWS_CLEARED)) {
      await ctx.db.delete(row._id);
    }
  }
}

async function seedActors(ctx: MutationCtx): Promise<SeedActors> {
  const school = await ctx.db
    .query("schools")
    .withIndex("by_code", (q) => q.eq("code", PILOT_SCHOOL_CODE))
    .unique();
  if (!school) throw new Error(`Run seedDemo first: school ${PILOT_SCHOOL_CODE} missing`);
  const users = await ctx.db.query("users").take(MAX_USERS_SCANNED);
  const supplier = users.find((user) => user.role === "supplier");
  const schoolUser = users.find((user) => user.role === "school" && user.schoolId === school._id);
  if (!supplier || !schoolUser) throw new Error("Seed needs a supplier user and a school user for the pilot school");
  return { schoolId: school._id, supplierId: supplier._id, schoolUserId: schoolUser._id };
}

async function ensureSchoolDay(ctx: MutationCtx, serviceDate: string): Promise<void> {
  const existing = await ctx.db
    .query("academicCalendar")
    .withIndex("by_serviceDate", (q) => q.eq("serviceDate", serviceDate))
    .unique();
  const fullDay = { serviceDate, isSchoolDay: true, dayType: "full" as const };
  if (existing) await ctx.db.patch(existing._id, fullDay);
  else await ctx.db.insert("academicCalendar", fullDay);
}

async function upsertDelivery(ctx: MutationCtx, actors: SeedActors, serviceDate: string, dish: string, portions: number): Promise<number> {
  const existing = await ctx.db
    .query("deliveries")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", actors.schoolId).eq("serviceDate", serviceDate))
    .take(MAX_DELIVERIES_PER_DAY);
  for (const delivery of existing) await ctx.db.patch(delivery._id, { dish });
  if (existing.length > 0) return existing.reduce((sum, delivery) => sum + (delivery.portionsReceived ?? delivery.portions), 0);
  await ctx.db.insert("deliveries", {
    schoolId: actors.schoolId,
    serviceDate,
    portions,
    docketRef: `${SEED_DOCKET_PREFIX}${serviceDate}`,
    dispatchedAt: serviceStartFor(serviceDate) - DISPATCH_LEAD_MS,
    declaredBy: actors.supplierId,
    confirmCodeHash: SEED_CONFIRM_HASH,
    expectedConfirmBy: serviceStartFor(serviceDate),
    status: "confirmed",
    portionsReceived: portions,
    dish,
  });
  return portions;
}

async function writeExpectations(ctx: MutationCtx, schoolId: Id<"schools">, serviceDate: string, outcome: DayOutcome): Promise<void> {
  const windowStart = serviceStartFor(serviceDate);
  const windowEnd = windowStart + SERVICE_WINDOW_MS;
  const window = { schoolId, serviceDate, windowStart, windowEnd, cutoffAt: windowEnd };
  for (const studentId of outcome.ate) await ctx.db.insert("expectations", { ...window, studentId, status: "fulfilled" });
  for (const studentId of outcome.skipped) await ctx.db.insert("expectations", { ...window, studentId, status: "missed", missReason: "present" });
  for (const studentId of outcome.absent) await ctx.db.insert("expectations", { ...window, studentId, status: "absent" });
}

async function writeRegister(ctx: MutationCtx, actors: SeedActors, serviceDate: string, absent: Id<"students">[]): Promise<void> {
  const existing = await ctx.db
    .query("registers")
    .withIndex("by_schoolId_and_serviceDate", (q) => q.eq("schoolId", actors.schoolId).eq("serviceDate", serviceDate))
    .unique();
  const register = { schoolId: actors.schoolId, serviceDate, absentStudentIds: absent, takenBy: actors.schoolUserId, takenAt: serviceStartFor(serviceDate) };
  if (existing) await ctx.db.patch(existing._id, register);
  else await ctx.db.insert("registers", register);
}

async function writeReconciliation(ctx: MutationCtx, schoolId: Id<"schools">, serviceDate: string, received: number, outcome: DayOutcome): Promise<void> {
  const consumed = outcome.ate.length;
  const totals: Omit<Doc<"reconciliations">, "_id" | "_creationTime"> = {
    schoolId,
    serviceDate,
    dispatched: received,
    confirmed: received,
    received,
    consumed,
    ...computeVariance(received, consumed),
    computedAt: Date.now(),
    attendance: { registerTaken: true, absent: outcome.absent.length, missedPresent: outcome.skipped.length, missedSupply: 0, missedUnknown: 0 },
  };
  const existing = await ctx.db
    .query("reconciliations")
    .withIndex("by_school_serviceDate", (q) => q.eq("schoolId", schoolId).eq("serviceDate", serviceDate))
    .unique();
  if (existing) await ctx.db.patch(existing._id, totals);
  else await ctx.db.insert("reconciliations", totals);
}

async function enrolPupils(ctx: MutationCtx, schoolId: Id<"schools">, random: () => number): Promise<Pupil[]> {
  await clearRoster(ctx);
  await commitRosterRows(ctx, schoolId, rosterRows());
  const students = await ctx.db
    .query("students")
    .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "active"))
    .take(PUPIL_NAMES.length);
  const indexByName = new Map<string, number>(PUPIL_NAMES.map((name, index) => [name, index]));
  return students
    .map((student) => ({ student, index: indexByName.get(student.fullName) ?? 0 }))
    .sort((left, right) => left.index - right.index)
    .map(({ student, index }) => ({ id: student._id, stream: student.className as Stream, index, pickiness: PICKINESS_MIN + random() * PICKINESS_SPREAD }));
}

export const seedTasteDemo = internalMutation({
  args: { endDate: v.string(), schoolDays: v.optional(v.number()), seed: v.optional(v.number()) },
  returns: v.object({ pupils: v.number(), guardians: v.number(), schoolDays: v.number(), firstDate: v.string(), lastDate: v.string() }),
  handler: async (ctx, args) => {
    const actors = await seedActors(ctx);
    const random = mulberry32(args.seed ?? DEFAULT_SEED);
    const pupils = await enrolPupils(ctx, actors.schoolId, random);
    const days = schoolDaysEndingOn(args.endDate, args.schoolDays ?? DEFAULT_SCHOOL_DAYS);
    for (const [dayIndex, serviceDate] of days.entries()) {
      const item = MENU[dayIndex % MENU.length];
      const outcome = simulateDay(pupils, item, serviceDate, random);
      await ensureSchoolDay(ctx, serviceDate);
      const received = await upsertDelivery(ctx, actors, serviceDate, item.dish, pupils.length);
      await writeExpectations(ctx, actors.schoolId, serviceDate, outcome);
      await writeRegister(ctx, actors, serviceDate, outcome.absent);
      await writeReconciliation(ctx, actors.schoolId, serviceDate, received, outcome);
    }
    return { pupils: pupils.length, guardians: GUARDIANS.length, schoolDays: days.length, firstDate: days[0], lastDate: days[days.length - 1] };
  },
});
