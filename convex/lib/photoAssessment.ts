export type Findings = {
  foodVisible: boolean;
  clarity: "clear" | "unclear";
  unrelatedContent: boolean;
  description: string;
};
export const FINDINGS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    foodVisible: { type: "boolean" },
    clarity: { type: "string", enum: ["clear", "unclear"] },
    unrelatedContent: { type: "boolean" },
    description: { type: "string" },
  },
  required: ["foodVisible", "clarity", "unrelatedContent", "description"],
};
export function parseFindings(value: unknown): Findings {
  if (!value || typeof value !== "object")
    throw new Error("Malformed assessment");
  const r = value as Record<string, unknown>;
  if (
    typeof r.foodVisible !== "boolean" ||
    (r.clarity !== "clear" && r.clarity !== "unclear") ||
    typeof r.unrelatedContent !== "boolean" ||
    typeof r.description !== "string" ||
    r.description.length > 1500 ||
    Object.keys(r).length !== 4
  )
    throw new Error("Malformed assessment");
  return {
    foodVisible: r.foodVisible,
    clarity: r.clarity,
    unrelatedContent: r.unrelatedContent,
    description: r.description,
  };
}
export function assessmentStatus(findings: Findings) {
  return findings.foodVisible &&
    findings.clarity === "clear" &&
    !findings.unrelatedContent
    ? ("clear" as const)
    : ("flagged" as const);
}
