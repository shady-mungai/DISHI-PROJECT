import type { SmsChannel, SmsMessage, SmsSendResult } from "./types";

const HTTP_OK = 200;
const LEADING_PLUS = /^\+/;

type CelcomRecipient = { "respose-code"?: number; "response-code"?: number; "response-description"?: string; messageid?: number | string };
type CelcomResponse = { responses?: CelcomRecipient[] };

type Credentials = { url: string; apikey: string; partnerID: string; shortcode: string; pass_type?: string };

function readCredentials(): Credentials | null {
  const { CELCOM_URL, CELCOM_API_KEY, CELCOM_PARTNER_ID, CELCOM_SHORTCODE, CELCOM_PASS_TYPE } = process.env;
  if (!CELCOM_URL || !CELCOM_API_KEY || !CELCOM_PARTNER_ID || !CELCOM_SHORTCODE) {
    return null;
  }
  return { url: CELCOM_URL, apikey: CELCOM_API_KEY, partnerID: CELCOM_PARTNER_ID, shortcode: CELCOM_SHORTCODE, pass_type: CELCOM_PASS_TYPE };
}

function readRecipient(parsed: CelcomResponse): { code: number | undefined; messageId: string; description: string } {
  const recipient = parsed.responses?.[0] ?? {};
  return {
    code: recipient["respose-code"] ?? recipient["response-code"],
    messageId: String(recipient.messageid ?? ""),
    description: recipient["response-description"] ?? "unknown",
  };
}

export const celcomChannel: SmsChannel = {
  async send(message: SmsMessage): Promise<SmsSendResult> {
    const credentials = readCredentials();
    if (!credentials) {
      return { status: "failed", failureReason: "missing_credentials" };
    }
    const { url, ...body } = credentials;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, mobile: message.to.replace(LEADING_PLUS, ""), message: message.body }),
      });
    } catch {
      return { status: "failed", failureReason: "gateway_unreachable" };
    }
    if (response.status !== HTTP_OK) {
      return { status: "failed", failureReason: `http_${response.status}` };
    }

    const recipient = readRecipient((await response.json().catch(() => ({}))) as CelcomResponse);
    if (recipient.code !== undefined && recipient.code !== HTTP_OK) {
      return { status: "failed", failureReason: recipient.description };
    }
    return { status: "sent", providerMessageId: recipient.messageId || `celcom-${Date.now()}` };
  },
};
