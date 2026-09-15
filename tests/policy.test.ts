import { describe, expect, test } from "vitest";
import { nairobiDayStart, nairobiHour } from "../convex/lib/dates";
import { applyPolicy, type PolicyInput } from "../convex/lib/policy";

const NOON_NAIROBI = Date.parse("2026-09-15T09:00:00.000Z");
const TEN_PM_NAIROBI = Date.parse("2026-09-15T19:00:00.000Z");
const SIX_AM_NEXT_DAY = Date.parse("2026-09-16T03:00:00.000Z");
const HOUR_MS = 3_600_000;

const base: PolicyInput = {
  eventType: "meal.tapped",
  optedOutTypes: [],
  now: NOON_NAIROBI,
  quietHoursStart: 21,
  quietHoursEnd: 6,
  sentTodayCount: 0,
  dailyCap: 3,
};

describe("notification policy (FR-501)", () => {
  test("sends by default", () => {
    expect(applyPolicy(base)).toEqual({ action: "send" });
  });

  test("opt-out wins over everything", () => {
    expect(applyPolicy({ ...base, optedOutTypes: ["meal.tapped"], now: TEN_PM_NAIROBI })).toEqual({
      action: "suppress",
      reason: "opted_out",
    });
  });

  test("quiet hours defer to the end of quiet hours", () => {
    expect(applyPolicy({ ...base, now: TEN_PM_NAIROBI })).toEqual({ action: "defer", deliverAt: SIX_AM_NEXT_DAY });
  });

  test("the cap suppresses rather than defers", () => {
    expect(applyPolicy({ ...base, now: TEN_PM_NAIROBI, sentTodayCount: 3 })).toEqual({
      action: "suppress",
      reason: "daily_cap",
    });
  });

  test("Nairobi clock helpers", () => {
    expect(nairobiHour(NOON_NAIROBI)).toBe(12);
    expect(nairobiDayStart(NOON_NAIROBI)).toBe(NOON_NAIROBI - 12 * HOUR_MS);
    expect(nairobiHour(Date.parse("2026-09-15T22:30:00.000Z"))).toBe(1);
  });
});
