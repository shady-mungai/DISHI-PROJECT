"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Stat } from "@/app/components/Stat";
import { useMutation, useQuery } from "convex/react";
import { useUrlDate } from "@/app/components/useUrlDate";
import { useState } from "react";
import {
  ActiveDeliveries,
  DeliveryHistory,
  DeliveryInbox,
  ForecastPanel,
  SupplierDispatch,
} from "./DeliveryOperations";
import {
  BUTTON_CLASS,
  DATE_CLASS,
  INPUT_CLASS,
  PAGE_CLASS,
  ROW_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
  TITLE_CLASS,
} from "@/app/components/ui";

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

export function SupplierPanel() {
  return (
    <div className={PAGE_CLASS}>
      <SupplierDispatch />
    </div>
  );
}

export function SchoolPanel({
  schoolId,
  toolsOnly = false,
}: {
  schoolId: Id<"schools">;
  toolsOnly?: boolean;
}) {
  const [serviceDate] = useUrlDate("date", () => toServiceDate(Date.now()));
  const tomorrow = addDays(serviceDate, 1);
  const deliveries = useQuery(
    api.deliveries.listForSchoolDay,
    toolsOnly ? "skip" : { schoolId, serviceDate },
  );
  const reconciliation = useQuery(api.deliveries.reconciliationFor, {
    schoolId,
    serviceDate,
  });
  const resolve = useMutation(api.deliveries.resolve);
  const runForecast = useMutation(api.deliveries.runForecastNow);
  const runReconciliation = useMutation(api.deliveries.runReconciliationNow);
  const { busy, message, trigger } = useTrigger();
  const [code, setCode] = useState("");
  const [portionsReceived, setPortionsReceived] = useState(0);
  const [note, setNote] = useState("");

  async function resolveWith(action: "confirm" | "dispute") {
    await trigger(async () => {
      const result = await resolve({
        schoolId,
        code,
        portionsReceived,
        action,
        note: note || undefined,
      });
      setCode("");
      setNote("");
      return `Delivery ${result.status}.`;
    });
  }

  async function describeForecast(): Promise<string> {
    const result = await runForecast({ schoolId, serviceDate: tomorrow });
    return result === "not_school_day"
      ? `${tomorrow} is not a school day.`
      : `Forecast for ${tomorrow}: ${result.portions} portions (${result.confidence}).`;
  }

  async function describeReconciliation(): Promise<string> {
    const result = await runReconciliation({ schoolId, serviceDate });
    return result.status === "chained"
      ? "Reconciliation running…"
      : `Reconciled: ${result.confirmed} confirmed vs ${result.consumed} eaten (${result.variancePct}%).`;
  }

  return (
    <div className={PAGE_CLASS}>
      {!toolsOnly && (
        <>
          <ActiveDeliveries schoolId={schoolId} role="school" />
          <DeliveryInbox />
          <DeliveryHistory schoolId={schoolId} role="school" />
          <details>
            <summary className="min-h-11 cursor-pointer py-3 underline">
              Confirm a historical delivery
            </summary>
            <section className="flex flex-col gap-3">
              <h2 className={SECTION_TITLE_CLASS}>
                Historical delivery confirmation
              </h2>
              <p>
                Use the original supplier code only for deliveries dispatched
                before the new receipt workflow.
              </p>
              <label className="flex flex-col gap-1">
                <span>One-time code</span>
                <input
                  inputMode="numeric"
                  placeholder="One-time code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>Portions received</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Portions received"
                  value={portionsReceived || ""}
                  onChange={(e) => setPortionsReceived(Number(e.target.value))}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>Note (for a dispute)</span>
                <input
                  placeholder="Note (for a dispute)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={busy || !code}
                  className={BUTTON_CLASS}
                  onClick={() => void resolveWith("confirm")}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={busy || !code}
                  className={SECONDARY_BUTTON_CLASS}
                  onClick={() => void resolveWith("dispute")}
                >
                  Dispute
                </button>
              </div>
              {message && (
                <p role="status" className="text-sm text-ink/80">
                  {message}
                </p>
              )}
            </section>
          </details>
          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>Deliveries on {serviceDate}</h2>
            {deliveries?.length === 0 && (
              <p className="text-sm text-ink/80">None declared.</p>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {deliveries?.map((delivery) => (
                <li key={delivery._id} className={ROW_CLASS}>
                  <span className="font-sans">{delivery.docketRef}</span>
                  <span>{delivery.portions} dispatched</span>
                  {delivery.portionsReceived !== undefined && (
                    <span>{delivery.portionsReceived} received</span>
                  )}
                  <span className="flex-1 text-ink/80">{delivery.status}</span>
                  {delivery.note && (
                    <span className="text-ink/80">{delivery.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <ForecastPanel schoolId={schoolId} />
      <section className="flex flex-col gap-2">
        {toolsOnly && (
          <button
            type="button"
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => void trigger(describeForecast)}
          >
            Run forecast now
          </button>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Reconciliation</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Dispatched" value={reconciliation?.dispatched} />
          <Stat label="Received" value={reconciliation?.received} />
          <Stat label="Confirmed" value={reconciliation?.confirmed} />
          <Stat label="Eaten" value={reconciliation?.consumed} />
          <Stat
            label="Variance"
            value={
              reconciliation
                ? `${reconciliation.variance} (${reconciliation.variancePct}%)`
                : undefined
            }
          />
        </div>
        {toolsOnly && (
          <button
            type="button"
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => void trigger(describeReconciliation)}
          >
            Run reconciliation now
          </button>
        )}
        {toolsOnly && message && <p role="status">{message}</p>}
      </section>
    </div>
  );
}

export function PaymentFilePanel() {
  const [to, setTo] = useUrlDate("to", () => toServiceDate(Date.now()));
  const [from, setFrom] = useUrlDate("from", () =>
    addDays(toServiceDate(Date.now()), -6),
  );
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
    <div className={PAGE_CLASS}>
      <h1 className={TITLE_CLASS}>Payment file — confirmed deliveries only</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={DATE_CLASS}
          />
        </label>
        to
        <label className="flex flex-col gap-1">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={DATE_CLASS}
          />
        </label>
        <button
          type="button"
          disabled={!file || file.lines.length === 0}
          className={BUTTON_CLASS}
          onClick={download}
        >
          Download CSV
        </button>
      </div>
      {file?.lines.length === 0 && (
        <p className="text-sm text-ink/80">
          No confirmed deliveries in this range.
        </p>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {file?.lines.map((line) => (
          <li
            key={`${line.schoolCode}:${line.serviceDate}:${line.docketRef}`}
            className={ROW_CLASS}
          >
            <span className="font-sans">{line.schoolCode}</span>
            <span>{line.serviceDate}</span>
            <span className="flex-1 font-sans">{line.docketRef}</span>
            <span>{line.portionsConfirmed} portions</span>
            <span className="text-ink/80">KES {line.amountKes.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      {total !== undefined && total > 0 && (
        <p className="font-semibold text-green">Total KES {total.toFixed(2)}</p>
      )}
    </div>
  );
}
