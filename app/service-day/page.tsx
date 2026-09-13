"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toServiceDate } from "@/convex/lib/dates";
import { SchoolGate } from "@/app/components/SchoolGate";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

const BUTTON_CLASS = "rounded bg-black px-3 py-2 text-white disabled:opacity-50";
const DATE_CLASS = "rounded border border-zinc-300 px-2 py-1 text-base font-normal";
const STAT_CLASS = "flex flex-col rounded border border-zinc-200 p-4";

export default function ServiceDayPage() {
  return <SchoolGate>{(schoolId) => <ServiceDayPanel schoolId={schoolId} />}</SchoolGate>;
}

function ServiceDayPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const [serviceDate, setServiceDate] = useState(() => toServiceDate(Date.now()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const summary = useQuery(api.expectations.daySummary, { schoolId, serviceDate });
  const runExpectations = useMutation(api.expectations.runExpectationsNow);
  const runSweep = useMutation(api.expectations.runSweepNow);

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

  async function describeSweep(): Promise<string> {
    const result = await runSweep({ schoolId, serviceDate });
    return `Sweep: ${result.missed} marked missed${result.chained ? " (more batches running)" : ""}.`;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <label className="flex items-center gap-3 text-lg font-semibold">
        Service day
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={DATE_CLASS} />
      </label>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Pending" value={summary?.pending} />
        <Stat label="Served" value={summary?.fulfilled} />
        <Stat label="Missed" value={summary?.missed} />
      </div>
      <div className="flex gap-3">
        <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={() => void trigger(describeExpectations)}>
          Run expectations now
        </button>
        <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={() => void trigger(describeSweep)}>
          Run sweep now
        </button>
      </div>
      {message && <p className="text-sm text-zinc-600">{message}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={STAT_CLASS}>
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-3xl font-semibold">{value ?? "…"}</span>
    </div>
  );
}
