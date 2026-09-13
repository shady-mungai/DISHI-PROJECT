export type SmsMessage = { to: string; body: string };

export type SmsSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "failed"; failureReason: string };

export interface SmsChannel {
  send(message: SmsMessage): Promise<SmsSendResult>;
}
