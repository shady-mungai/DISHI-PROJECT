"use client";

import { api } from "@/convex/_generated/api";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { AuditPanel, MetricsPanel, RevokeButton, SettingsPanel } from "@/app/admin/OpsPanels";
import { RulesPanel } from "@/app/admin/RulesPanel";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import { ALERT_CLASS, BUTTON_CLASS, DATE_CLASS, INPUT_CLASS, MUTED_CLASS, PAGE_CLASS, ROW_CLASS, SECTION_TITLE_CLASS, TITLE_CLASS } from "@/app/components/ui";
import { useQuery } from "convex/react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

const DEFAULT_PERIOD_DAYS = 7;
const CLOCK_TICK_MS = 60_000;
const OVER_CLASS = "font-semibold text-error";

export default function AdminPage() {
  return <UserGate>{(user) => (user.role === "admin" ? <AdminPanel /> : <Centered>This screen is for admin accounts.</Centered>)}</UserGate>;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function AdminPanel() {
  const [to, setTo] = useState(() => toServiceDate(Date.now()));
  const [from, setFrom] = useState(() => addDays(toServiceDate(Date.now()), -(DEFAULT_PERIOD_DAYS - 1)));
  const report = useQuery(api.admin.deliverability, { from, to });
  const totalSpend = report?.spendByRule.reduce((sum, row) => sum + row.costKes, 0);

  return (
    <div className={PAGE_CLASS}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITLE_CLASS}>Admin</h1>
        <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
        to
        <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
      </div>

      <MetricsPanel from={from} to={to} />

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Deliverability by day</h2>
        {report?.byDay.length === 0 && <p className={MUTED_CLASS}>No notifications in this period.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {report?.byDay.map((day) => (
            <li key={day.day} className={ROW_CLASS}>
              <span className="font-mono">{day.day}</span>
              <span>{day.delivered} delivered</span>
              <span>{day.sent} sent</span>
              <span className={day.failed > 0 ? OVER_CLASS : ""}>{day.failed} failed</span>
              <span>{day.suppressed} suppressed</span>
              <span>{day.queued} queued</span>
              <span className="flex-1 text-right font-semibold text-green">{day.deliveredPct}% delivered</span>
            </li>
          ))}
        </ul>
        {report && report.byFailureReason.length > 0 && (
          <p className={MUTED_CLASS}>Failures: {report.byFailureReason.map((row) => `${row.reason} ×${row.count}`).join(" · ")}</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Undeliverable numbers — for the school to correct</h2>
        {report?.undeliverable.length === 0 && <p className={MUTED_CLASS}>Queue is empty.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {report?.undeliverable.map((entry) => (
            <li key={entry.guardianId} className={ALERT_CLASS}>
              <span className="font-mono">{entry.maskedMsisdn}</span> · {entry.schoolCode} · {entry.failures} failure(s) · {entry.lastReason} · last {new Date(entry.lastFailedAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Spend by trigger type</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Total KES" value={totalSpend === undefined ? undefined : totalSpend.toFixed(2)} />
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {report?.spendByRule.map((row) => (
            <li key={row.ruleKey} className={ROW_CLASS}>
              <span className="flex-1 font-mono">{row.ruleKey}</span>
              <span>{row.sent} sent</span>
              <span>{row.suppressed} suppressed</span>
              <span>{row.segments} segments</span>
              <span className="text-ink/60">KES {row.costKes.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </section>

      <FleetPanel />
      <RulesPanel />
      <TracePanel />
      <AuditPanel from={from} to={to} />
      <SettingsPanel />
    </div>
  );
}

// AD-01: silence and skew are judged here against the server's tolerances.
function FleetPanel() {
  const fleet = useQuery(api.admin.fleet);
  const now = useNow();
  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>Device fleet</h2>
      {fleet?.length === 0 && <p className={MUTED_CLASS}>No devices provisioned.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {fleet?.map((device) => {
          const silent = device.lastSeenAt !== undefined && now - device.lastSeenAt > device.silentAfterMs;
          const skewed = Math.abs(device.clockSkewSeconds) > device.skewToleranceSeconds;
          return (
            <li key={device.deviceRef} className={ROW_CLASS}>
              <span className="font-mono">{device.deviceRef}</span>
              <span>{device.schoolCode}</span>
              <span className="text-ink/60">{device.firmwareVersion}</span>
              <span>queue {device.queueDepth}</span>
              <span className={skewed ? OVER_CLASS : ""}>skew {device.clockSkewSeconds}s</span>
              <span className={`flex-1 text-right ${silent ? OVER_CLASS : "text-ink/60"}`}>
                {device.lastSeenAt === undefined ? "never synced" : `seen ${new Date(device.lastSeenAt).toLocaleString()}`}
              </span>
              <RevokeButton deviceRef={device.deviceRef} revokedAt={device.revokedAt} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// AD-07: one identifier in, the whole chain out.
function TracePanel() {
  const [input, setInput] = useState("");
  const [identifier, setIdentifier] = useState<string | null>(null);
  const trace = useQuery(api.admin.trace, identifier ? { identifier } : "skip");

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setIdentifier(input.trim() || null);
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>Trace a message</h2>
      <form onSubmit={submit} className="flex flex-wrap gap-3">
        <input aria-label="Notification id, provider message id, event id or correlation id" placeholder="Notification, provider, event or correlation id" value={input} onChange={(e) => setInput(e.target.value)} className={`${INPUT_CLASS} flex-1 font-mono`} />
        <button type="submit" className={BUTTON_CLASS}>
          Trace
        </button>
      </form>
      {trace && (
        <div className="flex flex-col gap-2 text-sm">
          <p className={MUTED_CLASS}>
            Correlation id <span className="font-mono">{trace.correlationId}</span> · {trace.events.length} event(s) · {trace.notifications.length} notification(s)
          </p>
          <ul className="flex flex-col gap-1">
            {trace.events.map((event) => (
              <li key={event._id} className={`${ROW_CLASS} font-mono text-xs`}>
                <span className="text-ink/60">{new Date(event.occurredAt).toLocaleString()}</span>
                <span>{event.type}</span>
                <span className="flex-1 text-ink/60">{JSON.stringify(event.payload)}</span>
              </li>
            ))}
            {trace.notifications.map((notification) => (
              <li key={notification._id} className={ROW_CLASS}>
                <span className="font-mono text-ink/60">{notification.maskedMsisdn}</span>
                <span className="font-mono">{notification.ruleKey}</span>
                <span className="flex-1">{notification.body}</span>
                <span className="text-ink/60">{notification.suppressionReason ?? notification.failureReason ?? notification.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
