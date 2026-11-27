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

// SU-08: volume-weighted absolute error (WAPE) and signed bias of the forecast
// against what was eaten, as a share of total portions eaten. Weighting by
// volume stops one tiny forecast from exploding the figure, and a zero
// forecast on a day pupils ate counts as a full miss instead of vanishing.
// Positive bias = over-forecast. Days with nothing forecast and nothing eaten
// carry no signal and are skipped.
export function forecastAccuracy(pairs: ForecastPair[]): ForecastAccuracy {
  const scored = pairs.filter((pair) => pair.forecast > 0 || pair.actual > 0);
  const eaten = scored.reduce((sum, pair) => sum + pair.actual, 0);
  if (eaten === 0) {
    return { days: 0, meanAbsErrorPct: 0, biasPct: 0 };
  }
  const total = (error: (pair: ForecastPair) => number) => scored.reduce((sum, pair) => sum + error(pair), 0);
  return {
    days: scored.length,
    meanAbsErrorPct: Math.round((total((pair) => Math.abs(pair.forecast - pair.actual)) / eaten) * PERCENT),
    biasPct: Math.round((total((pair) => pair.forecast - pair.actual) / eaten) * PERCENT),
  };
}
