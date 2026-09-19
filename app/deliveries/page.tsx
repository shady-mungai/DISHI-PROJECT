"use client";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { useMutation, useQuery } from "convex/react";
import type { FormEvent } from "react";
import { useState } from "react";

const BUTTON_CLASS = "rounded bg-black px-3 py-2 text-white disabled:opacity-50";
const SECONDARY_BUTTON_CLASS = "rounded border border-zinc-300 px-3 py-2 disabled:opacity-50";
const INPUT_CLASS = "rounded border border-zinc-300 px-3 py-2";
const DATE_CLASS = "rounded border border-zinc-300 px-2 py-1 text-base font-normal";
const ROW_CLASS = "flex flex-wrap gap-3 rounded border border-zinc-200 px-3 py-2";
const STAT_CLASS = "flex flex-col rounded border border-zinc-200 p-4";
const CODE_CLASS = "rounded bg-zinc-100 px-3 py-2 font-mono text-2xl tracking-widest";
const PAYMENT_FILE_LOOKBACK_DAYS = 30;

export default function DeliveriesPage() {
  return <UserGate>{(user) => <RolePanel user={user} />}</UserGate>;
}

function RolePanel({ user }: { user: Doc<"users"> }) {
  if (user.role === "supplier") {
    return <SupplierPanel />;
  }
  if (user.role === "county") {
    return <PaymentFilePanel />;
  }
  if (user.role === "admin") {
    return (
      <div className="flex flex-col">
        <SupplierPanel />
        <PaymentFilePanel />
      </div>
    );
  }
  if (!user.schoolId) {
    return <Centered>Your account isn&apos;t attached to a school yet.</Centered>;
  }
  return <SchoolPanel schoolId={user.schoolId} />;
}

function useTrigger() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function trigger(run: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await run());
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, trigger };
}

function SupplierPanel() {
  const schools = useQuery(api.deliveries.listSchools);
  const declare = useMutation(api.deliveries.declare);
  const { busy, message, trigger } = useTrigger();
  const [schoolId, setSchoolId] = useState<Id<"schools"> | "">("");
  const [serviceDate, setServiceDate] = useState(() => toServiceDate(Date.now()));
  const [portions, setPortions] = useState(0);
  const [vehicle, setVehicle] = useState("");
  const [docketRef, setDocketRef] = useState("");
  const [confirmCode, setConfirmCode] = useState<string | null>(null);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (schoolId === "") {
      return;
    }
    await trigger(async () => {
      const result = await declare({ schoolId, serviceDate, portions, vehicle: vehicle || undefined, docketRef });
      setConfirmCode(result.confirmCode);
      setDocketRef("");
      setPortions(0);
      return "Dispatch declared. Give the school this one-time code to confirm delivery.";
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">Declare a dispatch</h1>
      <select required value={schoolId} onChange={(e) => setSchoolId(e.target.value as Id<"schools">)} className={INPUT_CLASS}>
        <option value="">Choose school</option>
        {schools?.map((school) => (
          <option key={school._id} value={school._id}>
            {school.name} ({school.code})
          </option>
        ))}
      </select>
      <label className="flex items-center gap-3">
        Service day
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={DATE_CLASS} />
      </label>
      <input type="number" required min={1} placeholder="Portions" value={portions || ""} onChange={(e) => setPortions(Number(e.target.value))} className={INPUT_CLASS} />
      <input required placeholder="Docket reference" value={docketRef} onChange={(e) => setDocketRef(e.target.value)} className={INPUT_CLASS} />
      <input placeholder="Vehicle (optional)" value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={INPUT_CLASS} />
      <button type="submit" disabled={busy} className={BUTTON_CLASS}>
        Declare dispatch
      </button>
      {message && <p className="text-sm text-zinc-600">{message}</p>}
      {confirmCode && <p className={CODE_CLASS}>{confirmCode}</p>}
    </form>
  );
}

function SchoolPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const [serviceDate, setServiceDate] = useState(() => toServiceDate(Date.now()));
  const tomorrow = addDays(serviceDate, 1);
  const deliveries = useQuery(api.deliveries.listForSchoolDay, { schoolId, serviceDate });
  const forecast = useQuery(api.deliveries.forecastFor, { schoolId, serviceDate: tomorrow });
  const reconciliation = useQuery(api.deliveries.reconciliationFor, { schoolId, serviceDate });
  const resolve = useMutation(api.deliveries.resolve);
  const runForecast = useMutation(api.deliveries.runForecastNow);
  const runReconciliation = useMutation(api.deliveries.runReconciliationNow);
  const { busy, message, trigger } = useTrigger();
  const [code, setCode] = useState("");
  const [portionsReceived, setPortionsReceived] = useState(0);
  const [note, setNote] = useState("");

  async function resolveWith(action: "confirm" | "dispute") {
    await trigger(async () => {
      const result = await resolve({ schoolId, code, portionsReceived, action, note: note || undefined });
      setCode("");
      setNote("");
      return `Delivery ${result.status}.`;
    });
  }

  async function describeForecast(): Promise<string> {
    const result = await runForecast({ schoolId, serviceDate: tomorrow });
    return result === "not_school_day" ? `${tomorrow} is not a school day.` : `Forecast for ${tomorrow}: ${result.portions} portions (${result.confidence}).`;
  }

  async function describeReconciliation(): Promise<string> {
    const result = await runReconciliation({ schoolId, serviceDate });
    return result.status === "chained" ? "Reconciliation running…" : `Reconciled: ${result.confirmed} confirmed vs ${result.consumed} eaten (${result.variancePct}%).`;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <label className="flex items-center gap-3 text-lg font-semibold">
        Service day
        <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={DATE_CLASS} />
      </label>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Confirm a delivery</h2>
        <input inputMode="numeric" placeholder="One-time code" value={code} onChange={(e) => setCode(e.target.value)} className={INPUT_CLASS} />
        <input type="number" min={0} placeholder="Portions received" value={portionsReceived || ""} onChange={(e) => setPortionsReceived(Number(e.target.value))} className={INPUT_CLASS} />
        <input placeholder="Note (for a dispute)" value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
        <div className="flex gap-3">
          <button type="button" disabled={busy || !code} className={BUTTON_CLASS} onClick={() => void resolveWith("confirm")}>
            Confirm
          </button>
          <button type="button" disabled={busy || !code} className={SECONDARY_BUTTON_CLASS} onClick={() => void resolveWith("dispute")}>
            Dispute
          </button>
        </div>
        {message && <p className="text-sm text-zinc-600">{message}</p>}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Deliveries on {serviceDate}</h2>
        {deliveries?.length === 0 && <p className="text-sm text-zinc-500">None declared.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {deliveries?.map((delivery) => (
            <li key={delivery._id} className={ROW_CLASS}>
              <span className="font-mono">{delivery.docketRef}</span>
              <span>{delivery.portions} dispatched</span>
              {delivery.portionsReceived !== undefined && <span>{delivery.portionsReceived} received</span>}
              <span className="flex-1 text-zinc-500">{delivery.status}</span>
              {delivery.note && <span className="text-zinc-500">{delivery.note}</span>}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Tomorrow&apos;s forecast ({tomorrow})</h2>
        <p className="text-3xl font-semibold">
          {forecast ? `${forecast.portions} portions` : "—"} {forecast && <span className="text-base text-zinc-500">{forecast.confidence} confidence</span>}
        </p>
        <button type="button" disabled={busy} className={SECONDARY_BUTTON_CLASS} onClick={() => void trigger(describeForecast)}>
          Run forecast now
        </button>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Reconciliation</h2>
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Dispatched" value={reconciliation?.dispatched} />
          <Stat label="Confirmed" value={reconciliation?.confirmed} />
          <Stat label="Eaten" value={reconciliation?.consumed} />
          <Stat label="Variance" value={reconciliation ? `${reconciliation.variance} (${reconciliation.variancePct}%)` : undefined} />
        </div>
        <button type="button" disabled={busy} className={SECONDARY_BUTTON_CLASS} onClick={() => void trigger(describeReconciliation)}>
          Run reconciliation now
        </button>
      </section>
    </div>
  );
}

function PaymentFilePanel() {
  const [to, setTo] = useState(() => toServiceDate(Date.now()));
  const [from, setFrom] = useState(() => addDays(toServiceDate(Date.now()), -PAYMENT_FILE_LOOKBACK_DAYS));
  const file = useQuery(api.deliveries.paymentFile, { from, to });
  const total = file?.lines.reduce((sum, line) => sum + line.amountKes, 0);

  function download() {
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payment-file-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">Payment file — confirmed deliveries only</h1>
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
        to
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
        <button type="button" disabled={!file || file.lines.length === 0} className={BUTTON_CLASS} onClick={download}>
          Download CSV
        </button>
      </div>
      {file?.lines.length === 0 && <p className="text-sm text-zinc-500">No confirmed deliveries in this range.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {file?.lines.map((line) => (
          <li key={`${line.schoolCode}:${line.serviceDate}:${line.docketRef}`} className={ROW_CLASS}>
            <span className="font-mono">{line.schoolCode}</span>
            <span>{line.serviceDate}</span>
            <span className="flex-1 font-mono">{line.docketRef}</span>
            <span>{line.portionsConfirmed} portions</span>
            <span className="text-zinc-500">KES {line.amountKes.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      {total !== undefined && total > 0 && <p className="font-semibold">Total KES {total.toFixed(2)}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className={STAT_CLASS}>
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-3xl font-semibold">{value ?? "…"}</span>
    </div>
  );
}
