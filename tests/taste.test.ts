import { describe, expect, it } from "vitest";
import { tasteReport, verdictFor, type MealOutcome } from "../convex/lib/taste";

const THRESHOLDS = { likedMaxSkipPct: 10, dislikedMinSkipPct: 30 };

function meals(studentId: string, className: string, dish: string, ateFlags: boolean[]): MealOutcome[] {
  return ateFlags.map((ate) => ({ studentId, studentName: studentId, className, dish, ate }));
}

describe("verdictFor", () => {
  it("labels by skip-rate thresholds", () => {
    expect(verdictFor(5, THRESHOLDS)).toBe("liked");
    expect(verdictFor(10, THRESHOLDS)).toBe("neutral");
    expect(verdictFor(30, THRESHOLDS)).toBe("neutral");
    expect(verdictFor(30.1, THRESHOLDS)).toBe("disliked");
  });
});

describe("tasteReport", () => {
  const outcomes = [
    ...meals("amani", "6A", "githeri", [false, false, false, true]),
    ...meals("zawadi", "6A", "githeri", [true, true, true, true]),
    ...meals("baraka", "6B", "githeri", [true, true, true, true]),
    ...meals("amani", "6A", "pilau", [true, true, true, true]),
  ];
  const report = tasteReport(outcomes, THRESHOLDS);

  it("ranks dishes most skipped first", () => {
    expect(report.dishes.map((row) => [row.dish, row.served, row.skipped, row.skipPct, row.verdict])).toEqual([
      ["githeri", 12, 3, 25, "neutral"],
      ["pilau", 4, 0, 0, "liked"],
    ]);
  });

  it("splits skip rate per stream and dish", () => {
    const githeri = report.streams.filter((row) => row.dish === "githeri");
    expect(githeri.map((row) => [row.className, row.skipPct, row.verdict])).toEqual([
      ["6A", 37.5, "disliked"],
      ["6B", 0, "liked"],
    ]);
  });

  it("flags only pupils who skip a dish repeatedly", () => {
    expect(report.repeatSkippers).toEqual([
      { studentId: "amani", studentName: "amani", className: "6A", dish: "githeri", served: 4, skipped: 3, skipPct: 75 },
    ]);
  });
});
