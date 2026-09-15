const PLACEHOLDER = /\{\{(\w+)\}\}/g;
const WORST_CASE_NAME = "W".repeat(24);
const WORST_CASE_SCHOOL = "W".repeat(30);
const WORST_CASE_DATE = "2026-09-15";
const WORST_CASE_OTHER = "W".repeat(12);
const WORST_CASE_VARS: Record<string, string> = {
  guardian: WORST_CASE_NAME,
  child: WORST_CASE_NAME,
  school: WORST_CASE_SCHOOL,
  date: WORST_CASE_DATE,
};

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => vars[name] ?? match);
}

export function renderWorstCase(template: string): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => WORST_CASE_VARS[name] ?? WORST_CASE_OTHER);
}
