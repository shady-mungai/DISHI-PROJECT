import { getFunctionName, type FunctionReference } from "convex/server";
import { useSyncExternalStore } from "react";
let version = 0;
const listeners = new Set<() => void>();
export const calls: { name: string; args: Record<string, unknown> }[] = [];
export const row = {
  _id: "delivery-test",
  schoolId: "school-test",
  schoolName: "Pilot Primary School",
  schoolCode: "PILOT",
  reference: "DLV-12345678901234567890123456789012",
  docketRef: "DK-100",
  vehicle: "KAA 100A",
  workflowVersion: 2,
  portions: 400,
  portionsReceived: undefined as number | undefined,
  servedForDay: null,
  status: "declared",
  serviceDate: "2026-11-04",
  dispatchedAt: Date.now(),
  expectedArrivalAt: Date.now() + 1800000,
};
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useQuery(ref: FunctionReference<"query">, args?: unknown) {
  useSyncExternalStore(subscribe, () => version);
  if (args === "skip") return undefined;
  switch (getFunctionName(ref)) {
    case "deliveryDashboard:active":
      return [row];
    case "deliveries:listSchools":
      return [{ _id: "school-test", name: row.schoolName, code: "PILOT" }];
    case "deliveryDashboard:detail":
      return {
        delivery: row,
        timeline: [
          {
            _id: "event-1",
            at: row.dispatchedAt,
            type: "dispatched",
            detail: "400 portions dispatched.",
          },
        ],
        sms: [],
        codeExpiresAt: null,
        cooldownUntil: null,
      };
    case "deliveryDashboard:forecasts":
      return [
        {
          schoolId: "one",
          schoolName: "School One",
          state: "available",
          portions: 0,
          confidence: "low",
          computedAt: row.dispatchedAt,
        },
        {
          schoolId: "two",
          schoolName: "School Two",
          state: "unavailable",
          portions: null,
        },
        {
          schoolId: "three",
          schoolName: "School Three",
          state: "not_school_day",
          portions: null,
        },
      ];
    case "deliveryNotifications:inbox":
      return [];
    default:
      return undefined;
  }
}
export function useMutation(ref: FunctionReference<"mutation">) {
  return async (args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    let result: unknown = {};
    if (name === "deliveryWorkflow:dispatch")
      result = {
        reference: row.reference,
        expectedArrivalAt: row.expectedArrivalAt,
      };
    if (name === "deliveryWorkflow:requestCode") {
      row.portionsReceived = Number(args.portionsReceived);
      result = { code: "123456", expiresAt: Date.now() + 1800000 };
    }
    if (name === "deliveryWorkflow:redeemCode")
      result = { status: "confirmed" };
    version++;
    listeners.forEach((fn) => fn());
    return result;
  };
}
export function usePaginatedQuery() {
  return { results: [], status: "Exhausted", loadMore: () => {} };
}
Object.assign(window, { deliveryFixture: { calls, row } });
