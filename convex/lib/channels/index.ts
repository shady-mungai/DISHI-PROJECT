import { africasTalkingChannel } from "./africasTalking";
import { consoleChannel } from "./console";
import type { SmsChannel } from "./types";

export const SMS_CHANNELS: Record<string, SmsChannel> = {
  console: consoleChannel,
  africastalking: africasTalkingChannel,
};

export function selectSmsChannel(name: string): SmsChannel {
  return SMS_CHANNELS[name] ?? consoleChannel;
}
