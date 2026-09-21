const TRANSIENT_REASONS = new Set(["gateway_unreachable", "missing_credentials"]);
const SERVER_ERROR_PREFIX = "http_5";
const MILLISECONDS_PER_SECOND = 1000;

// NFR-205: only gateway-side failures are worth another try; a rejected
// number is final on the first answer.
export function isTransientFailure(reason: string): boolean {
  return TRANSIENT_REASONS.has(reason) || reason.startsWith(SERVER_ERROR_PREFIX);
}

export function retryDelayMs(attempt: number, baseSeconds: number): number {
  return baseSeconds * MILLISECONDS_PER_SECOND * 2 ** Math.max(0, attempt - 1);
}
