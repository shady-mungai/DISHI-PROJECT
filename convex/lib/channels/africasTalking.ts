import type { SmsChannel, SmsMessage, SmsSendResult } from "./types";

const LIVE_URL = "https://api.africastalking.com/version1/messaging";
const SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging";
const SANDBOX_USERNAME = "sandbox";
const ACCEPTED_STATUS_CODES = [100, 101, 102];

type Recipient = { statusCode: number; status: string; messageId: string };
type SendResponse = { SMSMessageData?: { Message?: string; Recipients?: Recipient[] } };

function readCredentials(): { username: string; apiKey: string; senderId?: string } | null {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) {
    return null;
  }
  return { username, apiKey, senderId: process.env.AT_SENDER_ID };
}

export const africasTalkingChannel: SmsChannel = {
  async send(message: SmsMessage): Promise<SmsSendResult> {
    const credentials = readCredentials();
    if (!credentials) {
      return { status: "failed", failureReason: "missing_credentials" };
    }

    const body = new URLSearchParams({
      username: credentials.username,
      to: message.to,
      message: message.body,
    });
    if (credentials.senderId) {
      body.set("from", credentials.senderId);
    }

    const url = credentials.username === SANDBOX_USERNAME ? SANDBOX_URL : LIVE_URL;
    const response = await fetch(url, {
      method: "POST",
      headers: { apiKey: credentials.apiKey, Accept: "application/json" },
      body,
    });
    if (!response.ok) {
      return { status: "failed", failureReason: `http_${response.status}` };
    }

    const parsed = (await response.json()) as SendResponse;
    const recipient = parsed.SMSMessageData?.Recipients?.[0];
    if (!recipient || !ACCEPTED_STATUS_CODES.includes(recipient.statusCode)) {
      return { status: "failed", failureReason: recipient?.status ?? parsed.SMSMessageData?.Message ?? "unknown" };
    }
    return { status: "sent", providerMessageId: recipient.messageId };
  },
};
