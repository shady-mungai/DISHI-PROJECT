const MILLISECONDS_PER_DAY = 86_400_000;
const SATURDAY = 6;
const SUNDAY = 0;

export function addDays(serviceDate: string, days: number): string {
  const shifted = new Date(`${serviceDate}T00:00:00.000Z`).getTime() + days * MILLISECONDS_PER_DAY;
  return new Date(shifted).toISOString().slice(0, 10);
}

export function isWeekend(serviceDate: string): boolean {
  const weekday = new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
  return weekday === SATURDAY || weekday === SUNDAY;
}

export function toServiceDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export const SERVICE_START_UTC = { hour: 9, minute: 30 };

export function serviceStartFor(serviceDate: string): number {
  const hour = String(SERVICE_START_UTC.hour).padStart(2, "0");
  const minute = String(SERVICE_START_UTC.minute).padStart(2, "0");
  return Date.parse(`${serviceDate}T${hour}:${minute}:00.000Z`);
}

const NAIROBI_UTC_OFFSET_HOURS = 3;
const MILLISECONDS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

export function nairobiHour(epochMs: number): number {
  return new Date(epochMs + NAIROBI_UTC_OFFSET_HOURS * MILLISECONDS_PER_HOUR).getUTCHours();
}

export function nairobiDayStart(epochMs: number): number {
  const shifted = epochMs + NAIROBI_UTC_OFFSET_HOURS * MILLISECONDS_PER_HOUR;
  const localMidnight = shifted - (shifted % MILLISECONDS_PER_DAY);
  return localMidnight - NAIROBI_UTC_OFFSET_HOURS * MILLISECONDS_PER_HOUR;
}

export function nextNairobiHour(epochMs: number, hour: number): number {
  const candidate = nairobiDayStart(epochMs) + hour * MILLISECONDS_PER_HOUR;
  return candidate > epochMs ? candidate : candidate + HOURS_PER_DAY * MILLISECONDS_PER_HOUR;
}
