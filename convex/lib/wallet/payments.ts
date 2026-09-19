// TODO: wire a real gateway — this is the FR-301 contract its callback adapts into.
// Mirrors wallets.paymentEventValidator; the platform only mirrors balances.
export type PaymentEvent = {
  externalRef: string;
  schoolCode: string;
  studentRef: string;
  amountKes: number;
  newBalanceKes?: number;
  occurredAt?: number;
};

export interface PaymentAdapter {
  parse(body: unknown): PaymentEvent | null;
}

function optionalNumber(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The mock payer posts the contract shape verbatim.
export const mockPayerAdapter: PaymentAdapter = {
  parse(body: unknown): PaymentEvent | null {
    if (typeof body !== "object" || body === null) {
      return null;
    }
    const { externalRef, schoolCode, studentRef, amountKes } = body as Record<string, unknown>;
    if (typeof externalRef !== "string" || typeof schoolCode !== "string" || typeof studentRef !== "string") {
      return null;
    }
    if (typeof amountKes !== "number" || !Number.isFinite(amountKes) || amountKes <= 0) {
      return null;
    }
    const newBalanceKes = optionalNumber((body as Record<string, unknown>).newBalanceKes);
    const occurredAt = optionalNumber((body as Record<string, unknown>).occurredAt);
    if (newBalanceKes === null || occurredAt === null) {
      return null;
    }
    return { externalRef, schoolCode, studentRef, amountKes, newBalanceKes, occurredAt };
  },
};
