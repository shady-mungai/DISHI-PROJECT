const PERCENT = 100;

export type RunRateInput = { expected: number; tapsSoFar: number; windowStart: number; windowEnd: number; now: number };

export type RunRate = { expectedSoFar: number; shortfallPct: number; elapsedPct: number };

// FR-607: the expected run rate is linear across the window; the shortfall is
// how far behind that line the school is at `now`.
export function runRate(input: RunRateInput): RunRate {
  const span = input.windowEnd - input.windowStart;
  const elapsed = span <= 0 ? 1 : Math.min(1, Math.max(0, (input.now - input.windowStart) / span));
  const expectedSoFar = Math.round(input.expected * elapsed);
  const shortfallPct = expectedSoFar === 0 ? 0 : Math.max(0, Math.round(((expectedSoFar - input.tapsSoFar) / expectedSoFar) * PERCENT));
  return { expectedSoFar, shortfallPct, elapsedPct: Math.round(elapsed * PERCENT) };
}

export type ForecastPair = { forecast: number; actual: number };

export type ForecastAccuracy = { days: number; meanAbsErrorPct: number; biasPct: number };

// SU-08: mean absolute error and signed bias of the forecast against what was
// eaten, as a share of the forecast. Positive bias = over-forecast.
export function forecastAccuracy(pairs: ForecastPair[]): ForecastAccuracy {
  const scored = pairs.filter((pair) => pair.forecast > 0);
  if (scored.length === 0) {
    return { days: 0, meanAbsErrorPct: 0, biasPct: 0 };
  }
  const errors = scored.map((pair) => (pair.forecast - pair.actual) / pair.forecast);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    days: scored.length,
    meanAbsErrorPct: Math.round(mean(errors.map(Math.abs)) * PERCENT),
    biasPct: Math.round(mean(errors) * PERCENT),
  };
}
