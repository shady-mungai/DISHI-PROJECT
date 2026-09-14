import { africasTalkingChannel } from "./africasTalking";
import { celcomChannel } from "./celcom";
import { consoleChannel } from "./console";
import type { SmsChannel } from "./types";

export const SMS_CHANNELS: Record<string, SmsChannel> = {
  console: consoleChannel,
  africastalking: africasTalkingChannel,
  celcom: celcomChannel,
};

export function selectSmsChannel(name: string): SmsChannel {
  return SMS_CHANNELS[name] ?? consoleChannel;
}
