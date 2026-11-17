const P95 = 0.95;

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function p95(values: number[]): number {
  return percentile(values, P95);
}

export type Span = { key: string; at: number };

// Duration of each batch job: spread of its rows' recordedAt, grouped by key.
export function spanDurations(rows: Span[]): Map<string, number> {
  const bounds = new Map<string, { min: number; max: number }>();
  for (const row of rows) {
    const current = bounds.get(row.key);
    bounds.set(row.key, { min: Math.min(current?.min ?? row.at, row.at), max: Math.max(current?.max ?? row.at, row.at) });
  }
  return new Map([...bounds.entries()].map(([key, bound]) => [key, bound.max - bound.min]));
}
