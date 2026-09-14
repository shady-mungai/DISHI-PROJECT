import { describe, expect, test } from "vitest";
import { parseRosterText, type ParsedStudentGuess } from "../convex/lib/enrolmentParser";

function stripRawLine({ rawLine, ...guess }: ParsedStudentGuess): Omit<ParsedStudentGuess, "rawLine"> {
  expect(rawLine).toBeTruthy();
  return guess;
}

const NO_EXTRAS = { guardianMsisdn: "", guardianRelationship: "", tagUid: "", openingBalanceKes: 0 };

describe("parseRosterText", () => {
  test("strips numbering, skips blank lines and a standalone header word", () => {
    const text = ["Name", "1. Jane Doe          4A", "2) John Smith        4A", "", "- Mary Ann Wanjiru"].join(
      "\n",
    );

    expect(parseRosterText(text)).toEqual([
      { rawLine: "1. Jane Doe          4A", fullName: "Jane Doe", className: "4A", ...NO_EXTRAS },
      { rawLine: "2) John Smith        4A", fullName: "John Smith", className: "4A", ...NO_EXTRAS },
      { rawLine: "- Mary Ann Wanjiru", fullName: "Mary Ann Wanjiru", className: "", ...NO_EXTRAS },
    ]);
  });

  test("keeps a bare name line with no class column", () => {
    expect(parseRosterText("Jane Doe")).toEqual([
      { rawLine: "Jane Doe", fullName: "Jane Doe", className: "", ...NO_EXTRAS },
    ]);
  });

  test("drops lines with no letters at all", () => {
    expect(parseRosterText("12345\n---\n")).toEqual([]);
  });
});

describe("parseRosterText on tab-separated table rows", () => {
  test("drops the index column, skips the header row, takes name then class", () => {
    const text = [
      "#\tFull Name\tClass\tGuardian MSISDN",
      "1\tElvis Mutua\tPP1\t254764641923\tMother\t04:01:AA:42:86:52:E2\t400",
      "12\tFaith Barasa\tGrade 1A\t254781234567\tFather\t04:28:96:B9:62:23:17\t150",
    ].join("\n");

    expect(parseRosterText(text).map(stripRawLine)).toEqual([
      {
        fullName: "Elvis Mutua",
        className: "PP1",
        guardianMsisdn: "254764641923",
        guardianRelationship: "mother",
        tagUid: "04:01:AA:42:86:52:E2",
        openingBalanceKes: 400,
      },
      {
        fullName: "Faith Barasa",
        className: "Grade 1A",
        guardianMsisdn: "254781234567",
        guardianRelationship: "father",
        tagUid: "04:28:96:B9:62:23:17",
        openingBalanceKes: 150,
      },
    ]);
  });
});
