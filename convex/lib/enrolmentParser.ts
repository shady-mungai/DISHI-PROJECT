// Best-effort guess at roster rows from a PDF's extracted text. A human
// confirms or corrects every row before it becomes a student record, so this
// only needs to be a reasonable starting point, not an exact parse.
// Swap this function to change reader (e.g. OCR) without touching the confirm
// screen or the commit mutation — the parser sits behind this one seam.

const MIN_NAME_LENGTH = 3;
const ENUMERATION_PREFIX = /^(?:\d+[.)]|[-*•])\s*/;
const COLUMN_SPLIT = /\t|\s{2,}/;
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
]);

export type ParsedStudentGuess = {
  rawLine: string;
  fullName: string;
  className: string;
};

export function parseRosterText(text: string): ParsedStudentGuess[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isLikelyNameLine)
    .map(toGuess);
}

function isLikelyNameLine(line: string): boolean {
  const stripped = line.replace(ENUMERATION_PREFIX, "").trim();
  if (stripped.length < MIN_NAME_LENGTH) {
    return false;
  }
  if (HEADER_WORDS.has(stripped.toLowerCase())) {
    return false;
  }
  return /[a-zA-Z]/.test(stripped);
}

function toGuess(line: string): ParsedStudentGuess {
  const stripped = line.replace(ENUMERATION_PREFIX, "").trim();
  const columns = stripped
    .split(COLUMN_SPLIT)
    .map((column) => column.trim())
    .filter(Boolean);

  return {
    rawLine: line,
    fullName: columns[0] ?? stripped,
    className: columns.length > 1 ? columns[columns.length - 1] : "",
  };
}
