import { describe, expect, test } from "vitest";
import { bodyToRecord, parseDeliveryReport } from "../convex/lib/deliveryReport";

describe("parseDeliveryReport", () => {
  test("reads Celcom's live callback shape", () => {
    const body = bodyToRecord(
      "application/json",
      JSON.stringify({ messageid: "MzItQsNb7wTxZBRk", description: "DeliveredToTerminal", timeTaken: 3, timestamp: "2026-09-15 21:13:07" }),
    );
    expect(parseDeliveryReport(body)).toEqual({ providerMessageId: "MzItQsNb7wTxZBRk", delivered: true, reason: "DeliveredToTerminal" });
  });

  test("maps a non-delivered description to failed with the reason", () => {
    expect(parseDeliveryReport({ messageid: 1, description: "AbsentSubscriber" })).toEqual({
      providerMessageId: "1",
      delivered: false,
      reason: "AbsentSubscriber",
    });
  });

  test("rejects a body without a message id", () => {
    expect(parseDeliveryReport({ description: "DeliveredToTerminal" })).toBeNull();
  });
});
