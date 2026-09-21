"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { SchoolGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import { OverridePanel } from "@/app/service-day/OverridePanel";
import { ReaderHealth } from "@/app/service-day/ReaderHealth";
import { RosterPanel } from "@/app/service-day/RosterPanel";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { BUTTON_CLASS, DATE_CLASS, PAGE_CLASS, ROW_CLASS, SECTION_TITLE_CLASS } from "@/app/components/ui";

const FIELD_CLASS = "w-24 rounded border border-green/40 px-2 py-1";
const DEFAULT_SEED = 1;
const DEFAULT_NO_SHOWS = 3;
const DEFAULT_BATCH_SIZE = 1;

export default function ServiceDayPage() {
  return <SchoolGate>{(schoolId) => <ServiceDayPanel schoolId={schoolId} />}</SchoolGate>;
}

function ServiceDayPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const [serviceDate, setServiceDate] = useState(() => toServiceDate(Date.now()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const summary = useQuery(api.expectations.daySummary, { schoolId, serviceDate });
  const forecast = useQuery(api.deliveries.forecastFor, { schoolId, serviceDate: addDays(serviceDate, 1) });
  const deliveries = useQuery(api.deliveries.listForSchoolDay, { schoolId, serviceDate });
  const notifications = useQuery(api.notifications.recentForSchool, { schoolId });
  const spend = useQuery(api.notifications.spendByRuleToday, { schoolId });
  const runExpectations = useMutation(api.expectations.runExpectationsNow);
  const runSweep = useMutation(api.expectations.runSweepNow);
  const simulate = useAction(api.simulator.runServiceDay);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [noShowCount, setNoShowCount] = useState(DEFAULT_NO_SHOWS);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);

  const expected = summary ? summary.pending + summary.fulfilled + summary.missed : undefined;

  async function trigger(run: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await run());
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Trigger failed");
    } finally {
      setBusy(false);
    }
  }

  async function describeExpectations(): Promise<string> {
    const result = await runExpectations({ schoolId, serviceDate });
    if (result.status === "not_school_day") {
      return `${serviceDate} is not a school day — nothing generated.`;
    }
    return `Expectations: ${result.created} created, ${result.existing} already existed${result.chained ? " (more pages running)" : ""}.`;
  }

  async function describeSimulation(): Promise<string> {
    const result = await simulate({ schoolId, serviceDate, seed, noShowCount, batchSize });
    return `Simulated: ${result.posted} taps in ${result.batches} batch(es), ${result.accepted} accepted, ${result.duplicate} duplicate, ${result.rejected} rejected, ${result.noShows} no-shows, ${result.elapsedMs} ms.`;
  }

  async function describeSweep(): Promise<string> {
    const result = await runSweep({ schoolId, serviceDate });
    return `Sweep: ${result.missed} marked missed${result.chained ? " (more batches running)" : ""}.`;
  }

  return (
    <div className={PAGE_CLASS}>
      <label className="flex items-center gap-3 text-lg font-semibold text-green">
        Service day
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={DATE_CLASS} />
      </label>
      <p className="text-5xl font-semibold text-green">
        {summary?.fulfilled ?? "…"} <span className="text-2xl text-ink/60">/ {expected ?? "…"} served</span>
      </p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Pending" value={summary?.pending} />
        <Stat label="Served" value={summary?.fulfilled} />
        <Stat label="Missed" value={summary?.missed} />
        <Stat label={`Forecast ${addDays(serviceDate, 1)}`} value={forecast ? `${forecast.portions} (${forecast.confidence})` : "—"} />
      </div>
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>
          Deliveries today · <Link href="/deliveries" className="underline">confirm or dispute</Link>
        </h2>
        {deliveries?.length === 0 && <p className="text-sm text-ink/60">None declared.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {deliveries?.map((delivery) => (
            <li key={delivery._id} className={ROW_CLASS}>
              <span className="font-mono">{delivery.docketRef}</span>
              <span className="flex-1">{delivery.portions} portions</span>
              <span className="text-ink/60">{delivery.status}</span>
            </li>
          ))}
        </ul>
      </section>
      <OverridePanel schoolId={schoolId} serviceDate={serviceDate} />
      <ReaderHealth schoolId={schoolId} />
      <RosterPanel schoolId={schoolId} />
      <div className="flex gap-3">
        <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={() => void trigger(describeExpectations)}>
          Run expectations now
        </button>
        <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={() => void trigger(describeSweep)}>
          Run sweep now
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <NumberField label="Seed" value={seed} onChange={setSeed} />
        <NumberField label="No-shows" value={noShowCount} onChange={setNoShowCount} />
        <NumberField label="Batch size" value={batchSize} onChange={setBatchSize} />
        <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={() => void trigger(describeSimulation)}>
          Simulate taps
        </button>
      </div>
      {message && <p className="text-sm text-ink/70">{message}</p>}
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Recent notifications</h2>
        {notifications?.length === 0 && <p className="text-sm text-ink/60">None yet.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {notifications?.map((notification) => (
            <li key={notification._id} className={ROW_CLASS}>
              <span className="font-mono text-ink/60">{notification.maskedMsisdn}</span>
              <span className="flex-1">{notification.body}</span>
              <span className="text-ink/60">
                {notification.suppressionReason ?? notification.failureReason ?? notification.status}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>SMS spend today</h2>
        {spend?.length === 0 && <p className="text-sm text-ink/60">Nothing sent yet.</p>}
        {spend && spend.length > 0 && <p className="text-sm text-ink/60">{volumeReductionLabel(spend)}</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {spend?.map((row) => (
            <li key={row.ruleKey} className={ROW_CLASS}>
              <span className="flex-1 font-mono">{row.ruleKey}</span>
              <span>{row.sent} sent</span>
              <span>{row.suppressed} suppressed</span>
              <span className="text-ink/60">KES {row.costKes.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type SpendRow = { sent: number; suppressed: number };

// NFR-602: reduction against the naive one-message-per-trigger baseline.
function volumeReductionLabel(rows: SpendRow[]): string {
  const sent = rows.reduce((sum, row) => sum + row.sent, 0);
  const candidates = sent + rows.reduce((sum, row) => sum + row.suppressed, 0);
  if (candidates === 0) {
    return "";
  }
  return `${Math.round((1 - sent / candidates) * 100)}% below the naive per-trigger baseline (${sent} of ${candidates})`;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink/60">{label}</span>
      <input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} className={FIELD_CLASS} />
    </label>
  );
}
