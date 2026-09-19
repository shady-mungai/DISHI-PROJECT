import { afterEach, describe, expect, test, vi } from "vitest";
import { celcomChannel } from "../convex/lib/channels/celcom";

const MESSAGE = { to: "+254700000123", body: "hello" };
const ENV = {
  CELCOM_URL: "https://gateway.example/sms",
  CELCOM_API_KEY: "k",
  CELCOM_PARTNER_ID: "p",
  CELCOM_SHORTCODE: "DISHI",
};

function stubFetch(status: number, json: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("celcomChannel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("fails without credentials and never calls the gateway", async () => {
    const fetchMock = stubFetch(200, {});
    expect(await celcomChannel.send(MESSAGE)).toEqual({ status: "failed", failureReason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("posts the Celcom JSON body and maps a 200 to sent", async () => {
    Object.entries(ENV).forEach(([key, value]) => vi.stubEnv(key, value));
    const fetchMock = stubFetch(200, { responses: [{ "respose-code": 200, messageid: 42 }] });

    const result = await celcomChannel.send(MESSAGE);

    expect(result).toEqual({ status: "sent", providerMessageId: "42" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENV.CELCOM_URL);
    expect(JSON.parse(String(init.body))).toEqual({
      apikey: "k",
      partnerID: "p",
      shortcode: "DISHI",
      mobile: "254700000123",
      message: MESSAGE.body,
    });
  });

  test("surfaces gateway-level rejection and http failures", async () => {
    Object.entries(ENV).forEach(([key, value]) => vi.stubEnv(key, value));
    stubFetch(200, { responses: [{ "respose-code": 1004, "response-description": "Low credit units" }] });
    expect(await celcomChannel.send(MESSAGE)).toEqual({ status: "failed", failureReason: "Low credit units" });

    stubFetch(500, {});
    expect(await celcomChannel.send(MESSAGE)).toEqual({ status: "failed", failureReason: "http_500" });
  });
});
