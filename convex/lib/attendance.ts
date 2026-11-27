import type { Infer } from "convex/values";
import type { missReason } from "../schema";

export type MissReason = Infer<typeof missReason>;

export type ServiceDayContext = { registerTaken: boolean; portionsAvailable: number; mealsServed: number };

export function foodRanOut(day: Pick<ServiceDayContext, "portionsAvailable" | "mealsServed">): boolean {
  return day.mealsServed >= day.portionsAvailable;
}

export function classifyMiss(day: ServiceDayContext): MissReason {
  if (foodRanOut(day)) {
    return "supply";
  }
  return day.registerTaken ? "present" : "unknown";
}
