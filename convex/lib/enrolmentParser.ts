// Best-effort guess at roster rows from a PDF's extracted text. A human
// confirms or corrects every row before it becomes a student record, so this
// only needs to be a reasonable starting point, not an exact parse.
// Swap this function to change reader (e.g. OCR) without touching the confirm
// screen or the commit mutation — the parser sits behind this one seam.

const MIN_NAME_LENGTH = 3;
const ENUMERATION_PREFIX = /^(?:\d+[.)]|[-*•])\s*/;
const COLUMN_SPLIT = /\t|\s{2,}/;
const INDEX_COLUMN = /^(?:#|\d+)$/;
const MSISDN_COLUMN = /^\+?\d{9,15}$/;
const TAG_UID_COLUMN = /^[0-9a-f]{2}(?::[0-9a-f]{2}){3,}$/i;
const AMOUNT_COLUMN = /^\d+(?:\.\d+)?$/;
const WORD_COLUMN = /^[a-z][a-z ]*$/i;
const HEADER_WORDS = new Set([
  "name",
  "names",
  "no",
  "no.",
  "adm no",
  "admno",
  "class",
  "student",
  "students",
  "full name",
  "guardian",
  "relationship",
  "nfc tag uid",
  "tag uid",
]);

export type ParsedStudentGuess = {
  rawLine: string;
  fullName: string;
  className: string;
  guardianMsisdn: string;
  guardianRelationship: string;
  tagUid: string;
  openingBalanceKes: number;
};

export function parseRosterText(text: string): ParsedStudentGuess[] {
  return text
    .split(/\r?\n/)
    .map((line) => ({ rawLine: line.trim(), columns: toColumns(line) }))
    .filter(({ columns }) => isLikelyNameRow(columns))
    .map(({ rawLine, columns }) => toGuess(rawLine, columns));
}

function toGuess(rawLine: string, columns: string[]): ParsedStudentGuess {
  const [fullName, className = "", ...extraColumns] = columns;
  const guardianMsisdn = extraColumns.find((column) => MSISDN_COLUMN.test(column)) ?? "";
  const amounts = extraColumns.filter((column) => AMOUNT_COLUMN.test(column) && column !== guardianMsisdn);
  return {
    rawLine,
    fullName,
    className,
    guardianMsisdn,
    guardianRelationship: extraColumns.find((column) => WORD_COLUMN.test(column))?.toLowerCase() ?? "",
    tagUid: extraColumns.find((column) => TAG_UID_COLUMN.test(column)) ?? "",
    openingBalanceKes: Number(amounts.at(-1) ?? 0),
  };
}

function toColumns(line: string): string[] {
  const columns = line
    .trim()
    .replace(ENUMERATION_PREFIX, "")
    .split(COLUMN_SPLIT)
    .map((column) => column.trim())
    .filter(Boolean);
  return INDEX_COLUMN.test(columns[0] ?? "") ? columns.slice(1) : columns;
}

function isLikelyNameRow(columns: string[]): boolean {
  const [first] = columns;
  if (!first || first.length < MIN_NAME_LENGTH) {
    return false;
  }
  if (HEADER_WORDS.has(first.toLowerCase())) {
    return false;
  }
  return /[a-zA-Z]/.test(first);
}
