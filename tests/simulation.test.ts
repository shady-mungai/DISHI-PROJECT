import { describe, expect, test } from "vitest";
import { planServiceDay } from "../convex/lib/simulation";
import { bodyToRecord, parseDeliveryReport } from "../convex/lib/deliveryReport";

const TAGS = Array.from({ length: 30 }, (_, index) => `TAG-${String(index).padStart(2, "0")}`);
const WINDOW_START = Date.parse("2026-09-14T09:30:00.000Z");
const BASE = { tagUids: TAGS, serviceDate: "2026-09-14", windowStart: WINDOW_START, windowMinutes: 90 };

describe("planServiceDay (NFR-805)", () => {
  test("is deterministic for a seed and differs across seeds", () => {
    const first = planServiceDay({ ...BASE, seed: 7, noShowCount: 3, batchSize: 10 });
    const again = planServiceDay({ ...BASE, seed: 7, noShowCount: 3, batchSize: 10 });
    const other = planServiceDay({ ...BASE, seed: 8, noShowCount: 3, batchSize: 10 });

    expect(again).toEqual(first);
    expect(other.noShowTagUids).not.toEqual(first.noShowTagUids);
  });

  test("no-show cohort never taps, everyone else taps once inside the window", () => {
    const plan = planServiceDay({ ...BASE, seed: 1, noShowCount: 5, batchSize: 1 });
    const taps = plan.batches.flat();

    expect(plan.noShowTagUids).toHaveLength(5);
    expect(taps).toHaveLength(TAGS.length - 5);
    expect(plan.batches).toHaveLength(TAGS.length - 5);
    expect(new Set(taps.map((tap) => tap.tagUid)).size).toBe(taps.length);
    expect(taps.some((tap) => plan.noShowTagUids.includes(tap.tagUid))).toBe(false);
    for (const tap of taps) {
      expect(tap.occurredAt).toBeGreaterThanOrEqual(WINDOW_START);
      expect(tap.occurredAt).toBeLessThan(WINDOW_START + 90 * 60_000);
    }
  });

  test("batch size groups taps for the offline-reader scenario", () => {
    const plan = planServiceDay({ ...BASE, seed: 1, noShowCount: 0, batchSize: 200 });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]).toHaveLength(TAGS.length);
  });
});

describe("parseDeliveryReport (FR-507)", () => {
  test("reads json and form bodies with either id/status spelling", () => {
    expect(parseDeliveryReport(bodyToRecord("application/json", '{"messageid":42,"status":"DeliveredToTerminal"}'))).toEqual({
      providerMessageId: "42",
      delivered: true,
      reason: "DeliveredToTerminal",
    });
    expect(parseDeliveryReport(bodyToRecord(null, "message_id=abc&delivery_status=Failed&description=AbsentSubscriber"))).toEqual({
      providerMessageId: "abc",
      delivered: false,
      reason: "AbsentSubscriber",
    });
  });

  test("rejects bodies without an id or status", () => {
    expect(parseDeliveryReport({ status: "Delivered" })).toBeNull();
    expect(parseDeliveryReport("nope")).toBeNull();
  });
});
