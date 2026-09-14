export type Scalar = string | number | boolean;

const COMPARISON_OPS = ["eq", "ne", "gt", "gte", "lt", "lte"] as const;
type ComparisonOp = (typeof COMPARISON_OPS)[number];

export type Predicate =
  | { op: "always" }
  | { op: ComparisonOp; field: string; value: Scalar }
  | { op: "and" | "or"; of: Predicate[] }
  | { op: "not"; of: Predicate };

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isComparisonOp(op: unknown): op is ComparisonOp {
  return typeof op === "string" && (COMPARISON_OPS as readonly string[]).includes(op);
}

function validate(raw: unknown): Predicate | null {
  if (typeof raw !== "object" || raw === null || !("op" in raw)) {
    return null;
  }
  const node = raw as Record<string, unknown>;
  if (node.op === "always") {
    return { op: "always" };
  }
  if (isComparisonOp(node.op)) {
    if (typeof node.field !== "string" || !isScalar(node.value)) {
      return null;
    }
    return { op: node.op, field: node.field, value: node.value };
  }
  if (node.op === "not") {
    const inner = validate(node.of);
    return inner ? { op: "not", of: inner } : null;
  }
  if (node.op === "and" || node.op === "or") {
    if (!Array.isArray(node.of)) {
      return null;
    }
    const children = node.of.map(validate);
    if (children.some((child) => child === null)) {
      return null;
    }
    return { op: node.op, of: children as Predicate[] };
  }
  return null;
}

export function parsePredicate(json: string): Predicate | null {
  try {
    return validate(JSON.parse(json));
  } catch {
    return null;
  }
}

function compare(op: ComparisonOp, actual: Scalar | undefined, expected: Scalar): boolean {
  if (op === "eq") {
    return actual === expected;
  }
  if (op === "ne") {
    return actual !== expected;
  }
  if (typeof actual !== "number" || typeof expected !== "number") {
    return false;
  }
  if (op === "gt") return actual > expected;
  if (op === "gte") return actual >= expected;
  if (op === "lt") return actual < expected;
  return actual <= expected;
}

export function evaluatePredicate(predicate: Predicate, payload: Record<string, Scalar>): boolean {
  switch (predicate.op) {
    case "always":
      return true;
    case "not":
      return !evaluatePredicate(predicate.of, payload);
    case "and":
      return predicate.of.every((child) => evaluatePredicate(child, payload));
    case "or":
      return predicate.of.some((child) => evaluatePredicate(child, payload));
    default:
      return compare(predicate.op, payload[predicate.field], predicate.value);
  }
}
