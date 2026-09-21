import { toCsv } from "./supply";

export type SchoolVarianceRow = {
  schoolCode: string;
  schoolName: string;
  days: number;
  dispatched: number;
  confirmed: number;
  consumed: number;
  variance: number;
  variancePct: number;
  streakDays: number;
  overrideRatePct: number;
};

// GV-03: consecutive reconciled days, newest first, outside tolerance.
export function varianceStreak(variancePctsNewestFirst: number[], tolerancePct: number): number {
  let streak = 0;
  for (const variancePct of variancePctsNewestFirst) {
    if (Math.abs(variancePct) <= tolerancePct) {
      return streak;
    }
    streak += 1;
  }
  return streak;
}

// GV-02 / FR-702: exceptions first — biggest variance share at the top.
export function rankByVariance<Row extends { variancePct: number }>(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => Math.abs(right.variancePct) - Math.abs(left.variancePct));
}

const COUNTY_CSV_HEADER = [
  "school_code",
  "school_name",
  "days",
  "dispatched",
  "confirmed",
  "consumed",
  "variance",
  "variance_pct",
  "streak_days",
  "override_rate_pct",
];

export function toCountyCsv(rows: SchoolVarianceRow[]): string {
  return toCsv(
    COUNTY_CSV_HEADER,
    rows.map((row) => [
      row.schoolCode,
      row.schoolName,
      row.days,
      row.dispatched,
      row.confirmed,
      row.consumed,
      row.variance,
      row.variancePct,
      row.streakDays,
      row.overrideRatePct,
    ]),
  );
}
