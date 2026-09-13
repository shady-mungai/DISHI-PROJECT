const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => vars[name] ?? match);
}
