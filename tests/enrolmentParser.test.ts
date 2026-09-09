import { describe, expect, test } from "vitest";
import { parseRosterText } from "../convex/lib/enrolmentParser";

describe("parseRosterText", () => {
  test("strips numbering, skips blank lines and a standalone header word", () => {
    const text = ["Name", "1. Jane Doe          4A", "2) John Smith        4A", "", "- Mary Ann Wanjiru"].join(
      "\n",
    );

    expect(parseRosterText(text)).toEqual([
      { rawLine: "1. Jane Doe          4A", fullName: "Jane Doe", className: "4A" },
      { rawLine: "2) John Smith        4A", fullName: "John Smith", className: "4A" },
      { rawLine: "- Mary Ann Wanjiru", fullName: "Mary Ann Wanjiru", className: "" },
    ]);
  });

  test("keeps a bare name line with no class column", () => {
    expect(parseRosterText("Jane Doe")).toEqual([{ rawLine: "Jane Doe", fullName: "Jane Doe", className: "" }]);
  });

  test("drops lines with no letters at all", () => {
    expect(parseRosterText("12345\n---\n")).toEqual([]);
  });
});
