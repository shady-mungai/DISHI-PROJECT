import type { Infer } from "convex/values";
import type { dayAttendance } from "../schema";

export const MAX_DISH_LENGTH = 60;
export const DEFAULT_MIN_DISH_DAYS = 5;
const PERCENT = 100;
const ONE_DECIMAL = 10;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type DayAttendance = Infer<typeof dayAttendance>;

export type InsightDay = {
  schoolId: string;
  serviceDate: string;
  dish: string | null;
  received: number;
  consumed: number;
  attendance: DayAttendance | null;
};

export type DishInsight = {
  dish: string;
  days: number;
  enoughData: boolean;
  uptakePct: number | null;
  leftoverPct: number | null;
  uptakeVsWeekday: number | null;
  leftoverVsWeekday: number | null;
};

export type WeekdayAttendance = {
  weekday: Weekday;
  registerDays: number;
  attendancePct: number | null;
  uptakePct: number | null;
  absent: number;
  missedPresent: number;
  missedSupply: number;
  missedUnknown: number;
};

export function normaliseDish(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function round(value: number): number {
  return Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
}

function percent(part: number, whole: number): number | null {
  return whole > 0 ? round((part / whole) * PERCENT) : null;
}

function mean(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : round(present.reduce((sum, value) => sum + value, 0) / present.length);
}

export function weekdayOf(serviceDate: string): Weekday {
  return WEEKDAYS[new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay()];
}

export function dayUptakePct(day: InsightDay): number | null {
  if (!day.attendance?.registerTaken) {
    return null;
  }
  return percent(day.consumed, day.consumed + day.attendance.missedPresent);
}

export function dayLeftoverPct(day: InsightDay): number | null {
  return percent(day.received - day.consumed, day.received);
}

function difference(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}

function weekdayKey(day: InsightDay): string {
  return `${day.schoolId}:${weekdayOf(day.serviceDate)}`;
}

function versusWeekday(days: ReadonlyArray<InsightDay>, measure: (day: InsightDay) => number | null): (day: InsightDay) => number | null {
  const groups = new Map<string, Array<number | null>>();
  for (const day of days) {
    groups.set(weekdayKey(day), [...(groups.get(weekdayKey(day)) ?? []), measure(day)]);
  }
  const baselines = new Map([...groups].map(([key, values]) => [key, mean(values)]));
  return (day) => difference(measure(day), baselines.get(weekdayKey(day)) ?? null);
}

// The weekday baseline comes from every day of that school, dish or not, so a
// dish served only on sports Fridays is judged against other Fridays.
export function dishInsights(days: ReadonlyArray<InsightDay>, minDays: number): DishInsight[] {
  const uptakeDelta = versusWeekday(days, dayUptakePct);
  const leftoverDelta = versusWeekday(days, dayLeftoverPct);
  const byDish = new Map<string, InsightDay[]>();
  for (const day of days) {
    if (day.dish !== null) {
      byDish.set(day.dish, [...(byDish.get(day.dish) ?? []), day]);
    }
  }
  return [...byDish].map(([dish, served]) => ({
    dish,
    days: served.length,
    enoughData: served.length >= minDays,
    uptakePct: mean(served.map(dayUptakePct)),
    leftoverPct: mean(served.map(dayLeftoverPct)),
    uptakeVsWeekday: mean(served.map(uptakeDelta)),
    leftoverVsWeekday: mean(served.map(leftoverDelta)),
  }));
}

function presentCount(day: InsightDay): number {
  return day.consumed + (day.attendance?.missedPresent ?? 0) + (day.attendance?.missedSupply ?? 0);
}

function total(days: ReadonlyArray<InsightDay>, field: keyof Omit<DayAttendance, "registerTaken">): number {
  return days.reduce((sum, day) => sum + (day.attendance?.[field] ?? 0), 0);
}

export function attendanceByWeekday(days: ReadonlyArray<InsightDay>): WeekdayAttendance[] {
  return WEEKDAYS.map((weekday) => {
    const onWeekday = days.filter((day) => day.attendance !== null && weekdayOf(day.serviceDate) === weekday);
    const registered = onWeekday.filter((day) => day.attendance?.registerTaken);
    const present = registered.reduce((sum, day) => sum + presentCount(day), 0);
    const absent = total(registered, "absent");
    return {
      weekday,
      registerDays: registered.length,
      attendancePct: percent(present, present + absent),
      uptakePct: mean(registered.map(dayUptakePct)),
      absent: total(onWeekday, "absent"),
      missedPresent: total(onWeekday, "missedPresent"),
      missedSupply: total(onWeekday, "missedSupply"),
      missedUnknown: total(onWeekday, "missedUnknown"),
    };
  }).filter((row) => row.registerDays > 0 || row.missedUnknown + row.missedSupply > 0);
}

export type RotationEntry = { dish: string; lastServed: string | null; timesServed: number };

// Rotation spreads every dish across days so the engine can compare them:
// never-served dishes first, then the longest since last served, then the
// least sampled.
export function rotationOrder(menu: ReadonlyArray<string>, served: ReadonlyArray<{ dish: string; serviceDate: string }>): RotationEntry[] {
  const entries = new Map(menu.map((dish) => [dish, { dish, lastServed: null as string | null, timesServed: 0 }]));
  for (const { dish, serviceDate } of served) {
    const entry = entries.get(dish);
    if (!entry) continue;
    entry.timesServed += 1;
    if (entry.lastServed === null || serviceDate > entry.lastServed) entry.lastServed = serviceDate;
  }
  return [...entries.values()].sort(
    (left, right) =>
      (left.lastServed ?? "").localeCompare(right.lastServed ?? "") || left.timesServed - right.timesServed || left.dish.localeCompare(right.dish),
  );
}
