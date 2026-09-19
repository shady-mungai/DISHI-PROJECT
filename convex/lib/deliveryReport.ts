export type DeliveryReport = { providerMessageId: string; delivered: boolean; reason: string };

const MESSAGE_ID_KEYS = ["messageid", "message_id", "messageId", "id"];
const STATUS_KEYS = ["status", "delivery_status", "dlr_status", "deliveryStatus", "description"];
const REASON_KEYS = ["description", "reason", "status_description", "error"];
const DELIVERED_PATTERN = /deliv|success|^200$/i;

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

// Celcom posts { messageid, description, timeTaken, timestamp } with the
// state in description (e.g. DeliveredToTerminal); Africa's Talking uses status.
export function parseDeliveryReport(body: unknown): DeliveryReport | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const providerMessageId = firstString(record, MESSAGE_ID_KEYS);
  const status = firstString(record, STATUS_KEYS);
  if (!providerMessageId || !status) {
    return null;
  }
  return {
    providerMessageId,
    delivered: DELIVERED_PATTERN.test(status),
    reason: firstString(record, REASON_KEYS) ?? status,
  };
}

export function bodyToRecord(contentType: string | null, text: string): unknown {
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}
