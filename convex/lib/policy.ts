import { nextNairobiHour, nairobiHour } from "./dates";

export const SuppressionReason = {
  OptedOut: "opted_out",
  DailyCap: "daily_cap",
} as const;

export type PolicyDecision =
  | { action: "send" }
  | { action: "defer"; deliverAt: number }
  | { action: "suppress"; reason: (typeof SuppressionReason)[keyof typeof SuppressionReason] };

export type PolicyInput = {
  eventType: string;
  optedOutTypes: readonly string[];
  now: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  sentTodayCount: number;
  dailyCap: number;
};

function isQuietHour(hour: number, start: number, end: number): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

// FR-501 order: opt-out → quiet hours → dedupe → collapse → priority → cap.
// Dedupe runs before this (idempotent replay guard on dedupeKey); collapse and
// priority ranking arrive with D7's scheduled flush.
export function applyPolicy(input: PolicyInput): PolicyDecision {
  if (input.optedOutTypes.includes(input.eventType)) {
    return { action: "suppress", reason: SuppressionReason.OptedOut };
  }
  const quiet = isQuietHour(nairobiHour(input.now), input.quietHoursStart, input.quietHoursEnd);
  if (input.sentTodayCount >= input.dailyCap) {
    return { action: "suppress", reason: SuppressionReason.DailyCap };
  }
  if (quiet) {
    return { action: "defer", deliverAt: nextNairobiHour(input.now, input.quietHoursEnd) };
  }
  return { action: "send" };
}
