import { nextNairobiHour, nairobiHour } from "./dates";

export const SuppressionReason = {
  OptedOut: "opted_out",
  DailyCap: "daily_cap",
  Collapsed: "collapsed",
} as const;

export type PolicyDecision =
  | { action: "send" }
  | { action: "defer"; deliverAt: number }
  | { action: "merge" }
  | { action: "suppress"; reason: (typeof SuppressionReason)[keyof typeof SuppressionReason] };

export type PolicyInput = {
  eventType: string;
  optedOutTypes: readonly string[];
  now: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  sentTodayCount: number;
  dailyCap: number;
  hasOpenCollapseWindow: boolean;
  collapseWindowMs: number;
};

function isQuietHour(hour: number, start: number, end: number): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

// FR-501 order: opt-out → quiet hours → dedupe → collapse → priority → cap.
// Dedupe runs before this (idempotent replay guard on dedupeKey). A merge into
// an open window costs no message, so it is decided before the cap (P-06).
// Priority ranking happens at flush, where the merged set is known.
export function applyPolicy(input: PolicyInput): PolicyDecision {
  if (input.optedOutTypes.includes(input.eventType)) {
    return { action: "suppress", reason: SuppressionReason.OptedOut };
  }
  if (input.hasOpenCollapseWindow) {
    return { action: "merge" };
  }
  if (input.sentTodayCount >= input.dailyCap) {
    return { action: "suppress", reason: SuppressionReason.DailyCap };
  }
  const quiet = isQuietHour(nairobiHour(input.now), input.quietHoursStart, input.quietHoursEnd);
  const windowEnd = input.now + input.collapseWindowMs;
  const deliverAt = quiet ? Math.max(windowEnd, nextNairobiHour(input.now, input.quietHoursEnd)) : windowEnd;
  if (deliverAt > input.now) {
    return { action: "defer", deliverAt };
  }
  return { action: "send" };
}
