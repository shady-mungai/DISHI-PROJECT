import { maskMsisdn } from "../mask";
import type { SmsChannel, SmsMessage, SmsSendResult } from "./types";

export const consoleChannel: SmsChannel = {
  async send(message: SmsMessage): Promise<SmsSendResult> {
    console.log(`[sms:console] to=${maskMsisdn(message.to)} chars=${message.body.length}`);
    return { status: "sent", providerMessageId: `console-${Date.now()}` };
  },
};
