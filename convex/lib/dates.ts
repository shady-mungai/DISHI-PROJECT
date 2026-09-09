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
