export const DEFAULT_LIKED_MAX_SKIP_PCT = 10;
export const DEFAULT_DISLIKED_MIN_SKIP_PCT = 30;
export const REPEAT_SKIP_MIN_TIMES = 3;
const PERCENT = 100;
const ONE_DECIMAL = 10;

export type TasteVerdict = "liked" | "neutral" | "disliked";

export type TasteThresholds = { likedMaxSkipPct: number; dislikedMinSkipPct: number };

export type MealOutcome = {
  studentId: string;
  studentName: string;
  className: string;
  dish: string;
  ate: boolean;
};

export type TasteRow = { dish: string; served: number; skipped: number; skipPct: number; verdict: TasteVerdict };

export type StreamTasteRow = TasteRow & { className: string };

export type RepeatSkipper = { studentId: string; studentName: string; className: string; dish: string; served: number; skipped: number; skipPct: number };

export type TasteReport = { dishes: TasteRow[]; streams: StreamTasteRow[]; repeatSkippers: RepeatSkipper[] };

function skipPct(skipped: number, served: number): number {
  return Math.round((skipped / served) * PERCENT * ONE_DECIMAL) / ONE_DECIMAL;
}

export function verdictFor(pct: number, thresholds: TasteThresholds): TasteVerdict {
  if (pct < thresholds.likedMaxSkipPct) return "liked";
  if (pct > thresholds.dislikedMinSkipPct) return "disliked";
  return "neutral";
}

function groupBy(outcomes: ReadonlyArray<MealOutcome>, keyOf: (outcome: MealOutcome) => string): MealOutcome[][] {
  const groups = new Map<string, MealOutcome[]>();
  for (const outcome of outcomes) {
    const key = keyOf(outcome);
    const group = groups.get(key);
    if (group) group.push(outcome);
    else groups.set(key, [outcome]);
  }
  return [...groups.values()];
}

function tally(group: ReadonlyArray<MealOutcome>): { served: number; skipped: number; skipPct: number } {
  const skipped = group.filter((outcome) => !outcome.ate).length;
  return { served: group.length, skipped, skipPct: skipPct(skipped, group.length) };
}

function byDislikeFirst<Row extends { skipPct: number }>(left: Row, right: Row): number {
  return right.skipPct - left.skipPct;
}

export function tasteReport(outcomes: ReadonlyArray<MealOutcome>, thresholds: TasteThresholds): TasteReport {
  const dishes = groupBy(outcomes, (outcome) => outcome.dish).map((group) => {
    const counts = tally(group);
    return { dish: group[0].dish, ...counts, verdict: verdictFor(counts.skipPct, thresholds) };
  });
  const streams = groupBy(outcomes, (outcome) => `${outcome.className}|${outcome.dish}`).map((group) => {
    const counts = tally(group);
    return { className: group[0].className, dish: group[0].dish, ...counts, verdict: verdictFor(counts.skipPct, thresholds) };
  });
  const repeatSkippers = groupBy(outcomes, (outcome) => `${outcome.studentId}|${outcome.dish}`)
    .map((group) => {
      const { studentId, studentName, className, dish } = group[0];
      return { studentId, studentName, className, dish, ...tally(group) };
    })
    .filter((row) => row.skipped >= REPEAT_SKIP_MIN_TIMES && row.skipPct > thresholds.dislikedMinSkipPct);
  return {
    dishes: dishes.sort(byDislikeFirst),
    streams: streams.sort((left, right) => left.className.localeCompare(right.className) || left.dish.localeCompare(right.dish)),
    repeatSkippers: repeatSkippers.sort(byDislikeFirst),
  };
}
