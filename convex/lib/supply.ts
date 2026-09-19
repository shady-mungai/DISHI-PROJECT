const CONFIRM_CODE_DIGITS = 6;
const HIGH_CONFIDENCE_SAMPLES = 3;
const PERCENT = 100;
const CSV_SEPARATOR = ",";
const CSV_LINE_BREAK = "\n";

export type DayConsumption = { serviceDate: string; expected: number; fulfilled: number };

export type ForecastInput = {
  activeStudents: number;
  history: DayConsumption[];
  serviceDate: string;
};

export type Forecast = { portions: number; confidence: "low" | "medium" | "high" };

function weekdayOf(serviceDate: string): number {
  return new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
}

function fulfilmentRate(days: DayConsumption[]): number | null {
  const expected = days.reduce((sum, day) => sum + day.expected, 0);
  if (expected === 0) {
    return null;
  }
  return days.reduce((sum, day) => sum + day.fulfilled, 0) / expected;
}

// FR-602: same-weekday history first, any history second, the roster last.
export function forecastPortions(input: ForecastInput): Forecast {
  const weekday = weekdayOf(input.serviceDate);
  const sameWeekday = input.history.filter((day) => weekdayOf(day.serviceDate) === weekday && day.expected > 0);
  const sameWeekdayRate = fulfilmentRate(sameWeekday);
  if (sameWeekdayRate !== null) {
    const confidence = sameWeekday.length >= HIGH_CONFIDENCE_SAMPLES ? "high" : "medium";
    return { portions: Math.ceil(input.activeStudents * sameWeekdayRate), confidence };
  }
  const anyRate = fulfilmentRate(input.history);
  if (anyRate !== null) {
    return { portions: Math.ceil(input.activeStudents * anyRate), confidence: "medium" };
  }
  return { portions: input.activeStudents, confidence: "low" };
}

export type Variance = { variance: number; variancePct: number };

// FR-606: variance is portions confirmed received minus portions eaten, as a
// share of what was confirmed. Nothing confirmed and nothing eaten is 0%.
export function computeVariance(confirmed: number, consumed: number): Variance {
  const variance = confirmed - consumed;
  if (confirmed === 0) {
    return { variance, variancePct: consumed === 0 ? 0 : -PERCENT };
  }
  return { variance, variancePct: Math.round((variance / confirmed) * PERCENT) };
}

export function mintConfirmCode(): string {
  const digits = new Uint8Array(CONFIRM_CODE_DIGITS);
  crypto.getRandomValues(digits);
  return Array.from(digits, (byte) => String(byte % 10)).join("");
}

export function normaliseConfirmCode(code: string): string {
  return code.replace(/\D/g, "");
}

export type PaymentLine = {
  schoolCode: string;
  serviceDate: string;
  docketRef: string;
  portionsConfirmed: number;
  rateKes: number;
  amountKes: number;
};

const PAYMENT_FILE_HEADER = ["school_code", "service_date", "docket_ref", "portions_confirmed", "rate_kes", "amount_kes"];

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toPaymentCsv(lines: PaymentLine[]): string {
  const rows = lines.map((line) =>
    [line.schoolCode, line.serviceDate, line.docketRef, line.portionsConfirmed, line.rateKes, line.amountKes].map(csvCell).join(CSV_SEPARATOR),
  );
  return [PAYMENT_FILE_HEADER.join(CSV_SEPARATOR), ...rows].join(CSV_LINE_BREAK);
}
