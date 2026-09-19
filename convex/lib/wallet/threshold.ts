export type ThresholdInput = {
  previousBalanceKes: number;
  balanceKes: number;
  armed: boolean;
  thresholdKes: number;
  reArmMarginKes: number;
};

export type ThresholdVerdict = { armed: boolean; lowBalance: boolean; depleted: boolean };

// FR-406 / P-03: fires once on the downward crossing, then stays disarmed until
// the balance has recovered above threshold + margin. A wallet hovering at the
// boundary therefore emits exactly one warning.
export function compareThreshold(input: ThresholdInput): ThresholdVerdict {
  const depleted = input.previousBalanceKes > 0 && input.balanceKes <= 0;
  if (input.armed && input.balanceKes <= input.thresholdKes) {
    return { armed: false, lowBalance: true, depleted };
  }
  if (!input.armed && input.balanceKes > input.thresholdKes + input.reArmMarginKes) {
    return { armed: true, lowBalance: false, depleted };
  }
  return { armed: input.armed, lowBalance: false, depleted };
}

export type ForecastInput = {
  balanceKes: number;
  mealPriceKes: number;
  mealsPerSchoolDay: number;
  upcomingSchoolDays: readonly string[];
};

export type Forecast = { mealsRemaining: number; schoolDaysCovered: number; projectedDate: string | null };

// FR-304: burn rate × price → the first upcoming school day the balance no
// longer covers. null when the rate is zero or the date is past the calendar
// horizon we read.
export function projectDepletion(input: ForecastInput): Forecast {
  const mealsRemaining = Math.max(0, Math.floor(input.balanceKes / input.mealPriceKes));
  if (input.mealsPerSchoolDay <= 0) {
    return { mealsRemaining, schoolDaysCovered: Number.POSITIVE_INFINITY, projectedDate: null };
  }
  const schoolDaysCovered = Math.floor(mealsRemaining / input.mealsPerSchoolDay);
  return { mealsRemaining, schoolDaysCovered, projectedDate: input.upcomingSchoolDays[schoolDaysCovered] ?? null };
}
