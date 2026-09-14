import { describe, expect, test } from "vitest";
import { evaluatePredicate, parsePredicate } from "../convex/lib/predicate";
import { renderTemplate } from "../convex/lib/template";

const payload = { clock_skew_flagged: false, portions: 42, device_id: "READER-01" };

describe("predicate interpreter", () => {
  test("parses and evaluates comparisons and boolean combinators", () => {
    const predicate = parsePredicate(
      JSON.stringify({
        op: "and",
        of: [
          { op: "eq", field: "clock_skew_flagged", value: false },
          { op: "gte", field: "portions", value: 40 },
          { op: "not", of: { op: "eq", field: "device_id", value: "READER-99" } },
        ],
      }),
    );
    expect(predicate).not.toBeNull();
    expect(evaluatePredicate(predicate!, payload)).toBe(true);
    expect(evaluatePredicate(predicate!, { ...payload, portions: 10 })).toBe(false);
  });

  test("rejects malformed predicates instead of guessing", () => {
    expect(parsePredicate("not json")).toBeNull();
    expect(parsePredicate(JSON.stringify({ op: "eq", field: "x" }))).toBeNull();
    expect(parsePredicate(JSON.stringify({ op: "and", of: [{ op: "bogus" }] }))).toBeNull();
    expect(parsePredicate(JSON.stringify({ op: "drop", table: "events" }))).toBeNull();
  });

  test("ordering comparisons on non-numbers are false, missing fields never match eq", () => {
    expect(evaluatePredicate({ op: "gt", field: "device_id", value: 1 }, payload)).toBe(false);
    expect(evaluatePredicate({ op: "eq", field: "missing", value: "x" }, payload)).toBe(false);
    expect(evaluatePredicate({ op: "ne", field: "missing", value: "x" }, payload)).toBe(true);
  });
});

describe("renderTemplate", () => {
  test("substitutes known placeholders and leaves unknown ones visible", () => {
    expect(renderTemplate("{{child}} ate on {{date}} {{nope}}", { child: "Amina", date: "2026-09-14" })).toBe(
      "Amina ate on 2026-09-14 {{nope}}",
    );
  });
});
