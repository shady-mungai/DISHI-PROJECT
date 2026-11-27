import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireSchoolScope } from "./lib/authz";
import { DEFAULT_DISLIKED_MIN_SKIP_PCT, DEFAULT_LIKED_MAX_SKIP_PCT, tasteReport, type MealOutcome, type TasteThresholds } from "./lib/taste";
import { readNumberSetting, SettingKey } from "./settings";
import { dishesByDay } from "./supplier";

// MODIFY: one bounded scan of the range; paginate or pre-aggregate per day past ~10k pupil-days.
const MAX_PUPIL_DAYS = 10_000;
const MAX_PUPILS = 2_000;

const verdict = v.union(v.literal("liked"), v.literal("neutral"), v.literal("disliked"));
const tasteCounts = { dish: v.string(), served: v.number(), skipped: v.number(), skipPct: v.number() };

function ateOrSkipped(expectation: Doc<"expectations">): boolean | null {
  if (expectation.status === "fulfilled") return true;
  if (expectation.status === "missed" && expectation.missReason === "present") return false;
  return null;
}

// One school's ate/skipped outcomes per pupil-day on days with a single dish.
export async function schoolMealOutcomes(
  ctx: QueryCtx,
  schoolId: Id<"schools">,
  range: { from: string; to: string },
  maxPupilDays = MAX_PUPIL_DAYS,
): Promise<MealOutcome[]> {
  const dishes = await dishesByDay(ctx, schoolId, range);
  const pupils = await ctx.db
    .query("students")
    .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId))
    .take(MAX_PUPILS);
  const pupilById = new Map(pupils.map((pupil) => [pupil._id, pupil]));
  const expectations = await ctx.db
    .query("expectations")
    .withIndex("by_school_serviceDate_status", (q) => q.eq("schoolId", schoolId).gte("serviceDate", range.from).lte("serviceDate", range.to))
    .take(maxPupilDays);

  const outcomes: MealOutcome[] = [];
  for (const expectation of expectations) {
    const dish = dishes.get(expectation.serviceDate);
    const pupil = pupilById.get(expectation.studentId);
    const ate = ateOrSkipped(expectation);
    if (!dish || !pupil || ate === null) continue;
    outcomes.push({ studentId: pupil._id, studentName: pupil.fullName, className: pupil.className, dish, ate });
  }
  return outcomes;
}

export async function tasteThresholds(ctx: QueryCtx): Promise<TasteThresholds> {
  return {
    likedMaxSkipPct: await readNumberSetting(ctx, SettingKey.TasteLikedMaxSkipPct, DEFAULT_LIKED_MAX_SKIP_PCT),
    dislikedMinSkipPct: await readNumberSetting(ctx, SettingKey.TasteDislikedMinSkipPct, DEFAULT_DISLIKED_MIN_SKIP_PCT),
  };
}

export const report = query({
  args: { schoolId: v.id("schools"), from: v.string(), to: v.string() },
  returns: v.object({
    likedMaxSkipPct: v.number(),
    dislikedMinSkipPct: v.number(),
    dishes: v.array(v.object({ ...tasteCounts, verdict })),
    streams: v.array(v.object({ ...tasteCounts, className: v.string(), verdict })),
    repeatSkippers: v.array(v.object({ ...tasteCounts, studentId: v.string(), studentName: v.string(), className: v.string() })),
  }),
  handler: async (ctx, args) => {
    await requireSchoolScope(ctx, args.schoolId);
    const outcomes = await schoolMealOutcomes(ctx, args.schoolId, args);
    const thresholds = await tasteThresholds(ctx);
    return { ...thresholds, ...tasteReport(outcomes, thresholds) };
  },
});
