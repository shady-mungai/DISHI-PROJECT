import { describe, expect, test } from "vitest";
import { smsSegments } from "../convex/lib/gsm7";
import { renderWorstCase } from "../convex/lib/template";
import { assertSingleSegment, DEMO_RULES } from "../convex/rules";

describe("GSM-7 segment counting (FR-506)", () => {
  test("counts basic, extended and UCS-2 text", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments(`${"a".repeat(158)}{}`)).toBe(2);
    expect(smsSegments("😀".repeat(70))).toBe(1);
    expect(smsSegments("😀".repeat(71))).toBe(2);
  });

  test("every demo template fits one segment at worst-case widths", () => {
    for (const rule of DEMO_RULES) {
      expect(() => assertSingleSegment(rule)).not.toThrow();
      for (const template of Object.values(rule.templates)) {
        expect(smsSegments(renderWorstCase(template))).toBe(1);
      }
    }
  });

  test("an over-long template fails at authoring time", () => {
    const rule = { ...DEMO_RULES[0], templates: { en: "{{child}} ".repeat(20), sw: "ok" } };
    expect(() => assertSingleSegment(rule)).toThrow(/segments/);
  });
});
