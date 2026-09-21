"use client";

import { api } from "@/convex/_generated/api";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { BUTTON_CLASS, DATE_CLASS, ERROR_CLASS, INPUT_CLASS, MUTED_CLASS, PANEL_CLASS, ROW_CLASS, SECONDARY_BUTTON_CLASS, SECTION_TITLE_CLASS, SMALL_BUTTON_CLASS } from "@/app/components/ui";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FormEvent } from "react";
import { useState } from "react";

const DEFAULT_PRIORITY = 100;
const DEFAULT_PREDICATE = JSON.stringify({ op: "always" });
const DRY_RUN_LOOKBACK_DAYS = 7;
const LABEL_CLASS = "flex flex-col gap-1 text-sm";

type DryRunReport = {
  scanned: number;
  matched: number;
  recipients: number;
  segments: number;
  estimatedCostKes: number;
  pages: number;
  truncated: boolean;
  samples: { eventId: string; maskedMsisdn: string; body: string }[];
};

type Draft = { key: string; eventType: string; predicate: string; en: string; sw: string; priority: number; enabled: boolean };

const EMPTY_DRAFT: Draft = { key: "", eventType: "", predicate: DEFAULT_PREDICATE, en: "", sw: "", priority: DEFAULT_PRIORITY, enabled: true };

// AD-04 / AD-05: rules are rows edited here; the dry run replays the draft
// over the period and sends nothing.
export function RulesPanel() {
  const rules = useQuery(api.admin.listRules);
  const upsert = useMutation(api.admin.upsertRule);
  const setEnabled = useMutation(api.admin.setRuleEnabled);
  const dryRun = useAction(api.admin.dryRunReplay);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [to, setTo] = useState(() => toServiceDate(Date.now()));
  const [from, setFrom] = useState(() => addDays(toServiceDate(Date.now()), -(DRY_RUN_LOOKBACK_DAYS - 1)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      setMessage(await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await run(async () => {
      const result = await upsert({ key: draft.key, eventType: draft.eventType, predicate: draft.predicate, templates: { en: draft.en, sw: draft.sw }, priority: draft.priority, enabled: draft.enabled });
      return `Saved ${draft.key} (template v${result.templateVersion}).`;
    });
  }

  async function replay() {
    await run(async () => {
      const result = await dryRun({ eventType: draft.eventType, predicate: draft.predicate, templates: { en: draft.en, sw: draft.sw }, from, to });
      setReport(result);
      return `Dry run complete — nothing was sent.${result.truncated ? " Period truncated; narrow the dates." : ""}`;
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_TITLE_CLASS}>Notification rules</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {rules?.map((rule) => (
          <li key={rule._id} className={ROW_CLASS}>
            <button type="button" className="cursor-pointer font-mono underline decoration-dotted" onClick={() => setDraft({ key: rule.key, eventType: rule.eventType, predicate: rule.predicate, en: rule.templates.en, sw: rule.templates.sw, priority: rule.priority, enabled: rule.enabled })}>
              {rule.key}
            </button>
            <span className="flex-1 text-ink/60">
              {rule.eventType} · v{rule.templateVersion} · priority {rule.priority}
            </span>
            <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => void setEnabled({ ruleId: rule._id, enabled: !rule.enabled })}>
              {rule.enabled ? "Disable" : "Enable"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={save} className={PANEL_CLASS}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className={LABEL_CLASS}>
            Rule key
            <input required value={draft.key} onChange={(e) => update("key", e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Event type
            <input required value={draft.eventType} onChange={(e) => update("eventType", e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className={`${LABEL_CLASS} md:col-span-2`}>
            Predicate (JSON)
            <input required value={draft.predicate} onChange={(e) => update("predicate", e.target.value)} className={`${INPUT_CLASS} font-mono`} />
          </label>
          <label className={LABEL_CLASS}>
            English template
            <input required value={draft.en} onChange={(e) => update("en", e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Kiswahili template
            <input required value={draft.sw} onChange={(e) => update("sw", e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className={LABEL_CLASS}>
            Priority
            <input type="number" min={0} value={draft.priority} onChange={(e) => update("priority", Number(e.target.value))} className={INPUT_CLASS} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => update("enabled", e.target.checked)} className="size-5 accent-green" />
            Enabled
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={BUTTON_CLASS}>
            Save rule
          </button>
          <input type="date" aria-label="Dry run from" value={from} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
          to
          <input type="date" aria-label="Dry run to" value={to} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
          <button type="button" disabled={busy || !draft.eventType} className={SECONDARY_BUTTON_CLASS} onClick={() => void replay()}>
            Dry run (sends nothing)
          </button>
          <button type="button" className="text-sm underline" onClick={() => setDraft(EMPTY_DRAFT)}>
            Clear
          </button>
        </div>
        {error && <p className={ERROR_CLASS}>{error}</p>}
        {message && <p className={MUTED_CLASS}>{message}</p>}
      </form>
      {report && (
        <div className={PANEL_CLASS}>
          <p className="font-semibold text-green">
            {report.scanned} events scanned · {report.matched} matched · {report.recipients} messages would render · {report.segments} segments · est. KES {report.estimatedCostKes.toFixed(2)}
          </p>
          <p className={MUTED_CLASS}>Policy (quiet hours, daily cap, collapse) is not applied to a dry run.</p>
          <ul className="flex flex-col gap-1 text-sm">
            {report.samples.map((sample) => (
              <li key={`${sample.eventId}:${sample.maskedMsisdn}`} className={ROW_CLASS}>
                <span className="font-mono text-ink/60">{sample.maskedMsisdn}</span>
                <span className="flex-1">{sample.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
