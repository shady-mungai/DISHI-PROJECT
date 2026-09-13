export type PlannedTap = { eventId: string; tagUid: string; occurredAt: number };

export type ServiceDayPlan = {
  batches: PlannedTap[][];
  noShowTagUids: string[];
};

export type PlanInput = {
  tagUids: string[];
  seed: number;
  serviceDate: string;
  windowStart: number;
  windowMinutes: number;
  noShowCount: number;
  batchSize: number;
};

const MILLISECONDS_PER_MINUTE = 60_000;
const UINT32_RANGE = 4_294_967_296;

// ponytail: mulberry32 — 32-bit, not cryptographic; fine for a regression seed.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

// NFR-805: same input → same plan, byte for byte. Event ids embed seed +
// date + tag, so replaying a plan is idempotent at /ingest.
export function planServiceDay(input: PlanInput): ServiceDayPlan {
  const random = mulberry32(input.seed);
  const order = shuffle([...input.tagUids].sort(), random);
  const noShowTagUids = order.slice(0, Math.max(0, input.noShowCount));
  const windowMilliseconds = input.windowMinutes * MILLISECONDS_PER_MINUTE;

  const taps = order
    .slice(noShowTagUids.length)
    .map((tagUid) => ({
      eventId: `sim:${input.seed}:${input.serviceDate}:${tagUid}`,
      tagUid,
      occurredAt: input.windowStart + Math.floor(random() * windowMilliseconds),
    }))
    .sort((left, right) => left.occurredAt - right.occurredAt);

  return { batches: chunk(taps, Math.max(1, input.batchSize)), noShowTagUids };
}
