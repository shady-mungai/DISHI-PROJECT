"use client";

import { api } from "@/convex/_generated/api";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import {
  MetricsPanel,
  RevokeButton,
  SettingsPanel,
} from "@/app/admin/OpsPanels";
import { RulesPanel } from "@/app/admin/RulesPanel";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import {
  ALERT_CLASS,
  DATE_CLASS,
  MUTED_CLASS,
  PAGE_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
  TITLE_CLASS,
} from "@/app/components/ui";
import { useQuery } from "convex/react";
import { useUrlDate } from "@/app/components/useUrlDate";
import { useEffect, useState } from "react";

import {
  AdminDeliveryReview,
  DeliveryHistory,
  DeliveryInbox,
  OperationalContacts,
} from "@/app/deliveries/DeliveryOperations";

const DEFAULT_PERIOD_DAYS = 7;
const CLOCK_TICK_MS = 60_000;
const OVER_CLASS = "font-semibold text-error";

export default function AdminWorkspace({
  page = "Overview",
}: {
  page?: string;
}) {
  return (
    <UserGate>
      {(user) =>
        user.role === "admin" ? (
          <AdminPanel page={page} />
        ) : (
          <Centered>This screen is for admin accounts.</Centered>
        )
      }
    </UserGate>
  );
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function AdminPanel({ page }: { page: string }) {
  const [to, setTo] = useUrlDate("to", () => toServiceDate(Date.now()));
  const [from, setFrom] = useUrlDate("from", () =>
    addDays(toServiceDate(Date.now()), -(DEFAULT_PERIOD_DAYS - 1)),
  );
  const report = useQuery(
    api.admin.deliverability,
    page === "Communications and spend" ? { from, to } : "skip",
  );
  const totalSpend = report?.spendByRule.reduce(
    (sum, row) => sum + row.costKes,
    0,
  );

  return (
    <div className={PAGE_CLASS}>
      <header className="dashboard-heading">
        <div className="page-heading">
          <p className="dashboard-eyebrow">Admin operations</p>
          <h1 className={TITLE_CLASS}>{page}</h1>
          <p className="dashboard-description">
            Keep delivery reviews, communications and service health in view.
          </p>
        </div>
      </header>
      <div className="dashboard-toolbar">
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            aria-label="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={DATE_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input
            type="date"
            aria-label="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={DATE_CLASS}
          />
        </label>
      </div>

      {page === "Overview" && (
        <>
          <div className="dashboard-columns">
            <AdminDeliveryReview />
            <DeliveryInbox />
          </div>
          <DeliveryHistory role="admin" />
          <MetricsPanel from={from} to={to} />
        </>
      )}

      {page === "Communications and spend" && <OperationalContacts />}
      {page === "Communications and spend" && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>Deliverability by day</h2>
            {report?.byDay.length === 0 && (
              <p className={MUTED_CLASS}>No notifications in this period.</p>
            )}
            {report && report.byDay.length >= 4 && (
              <figure>
                <figcaption>Daily SMS delivery rate (%)</figcaption>
                <svg
                  viewBox="0 0 600 140"
                  role="img"
                  aria-label="Delivery rate over the selected period; exact daily values are in the table below"
                >
                  <polyline
                    fill="none"
                    stroke="var(--color-green)"
                    strokeWidth="3"
                    points={report.byDay
                      .map(
                        (day, index) =>
                          `${20 + (index * 560) / Math.max(1, report.byDay.length - 1)},${120 - day.deliveredPct}`,
                      )
                      .join(" ")}
                  />
                  <text x="5" y="14" fontSize="14">
                    100%
                  </text>
                  <text x="5" y="138" fontSize="14">
                    0%
                  </text>
                </svg>
              </figure>
            )}
            <table className="record-table">
              <caption className="sr-only">Daily deliverability</caption>
              <thead>
                <tr>
                  {[
                    "Day",
                    "Delivered",
                    "Sent",
                    "Failed",
                    "Suppressed",
                    "Queued",
                    "Delivery rate",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report?.byDay.map((day) => (
                  <tr key={day.day}>
                    <td data-label="Day" className="font-sans">
                      {day.day}
                    </td>
                    <td data-label="Delivered">{day.delivered} delivered</td>
                    <td data-label="Sent">{day.sent} sent</td>
                    <td
                      data-label="Failed"
                      className={day.failed > 0 ? OVER_CLASS : ""}
                    >
                      {day.failed} failed
                    </td>
                    <td data-label="Suppressed">{day.suppressed} suppressed</td>
                    <td data-label="Queued">{day.queued} queued</td>
                    <td
                      data-label="Delivery rate"
                      className="flex-1 text-right font-semibold text-green"
                    >
                      {day.deliveredPct}% delivered
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report && report.byFailureReason.length > 0 && (
              <p className={MUTED_CLASS}>
                Failures:{" "}
                {report.byFailureReason
                  .map((row) => `${row.reason} ×${row.count}`)
                  .join(" · ")}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>
              Undeliverable numbers — for the school to correct
            </h2>
            {report?.undeliverable.length === 0 && (
              <p className={MUTED_CLASS}>Queue is empty.</p>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {report?.undeliverable.map((entry) => (
                <li key={entry.guardianId} className={ALERT_CLASS}>
                  <span className="font-sans">{entry.maskedMsisdn}</span> ·{" "}
                  {entry.schoolCode} · {entry.failures} failure(s) ·{" "}
                  {entry.lastReason} · last{" "}
                  {new Date(entry.lastFailedAt).toLocaleString("en-KE", {
                    timeZone: "Africa/Nairobi",
                  })}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>Spend by trigger type</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat
                label="Total KES"
                value={
                  totalSpend === undefined ? undefined : totalSpend.toFixed(2)
                }
              />
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {report?.spendByRule.map((row) => (
                <li key={row.ruleKey} className={ROW_CLASS}>
                  <span className="flex-1 font-sans">{row.ruleKey}</span>
                  <span>{row.sent} sent</span>
                  <span>{row.suppressed} suppressed</span>
                  <span>{row.segments} segments</span>
                  <span className="text-ink/80">
                    KES {row.costKes.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {page === "Device fleet" && <FleetPanel />}
      {page === "Notification rules" && <RulesPanel />}
      {page === "Settings and retention" && <SettingsPanel />}
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
      {fleet?.length === 0 && (
        <p className={MUTED_CLASS}>No devices provisioned.</p>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {fleet?.map((device) => {
          const silent =
            device.lastSeenAt !== undefined &&
            now - device.lastSeenAt > device.silentAfterMs;
          const skewed =
            Math.abs(device.clockSkewSeconds) > device.skewToleranceSeconds;
          return (
            <li key={device.deviceRef} className={ROW_CLASS}>
              <span className="font-sans">{device.deviceRef}</span>
              <span>{device.schoolCode}</span>
              <span className="text-ink/80">{device.firmwareVersion}</span>
              <span>queue {device.queueDepth}</span>
              <span className={skewed ? OVER_CLASS : ""}>
                skew {device.clockSkewSeconds}s
              </span>
              <span
                className={`flex-1 text-right ${silent ? OVER_CLASS : "text-ink/80"}`}
              >
                {device.lastSeenAt === undefined
                  ? "never synced"
                  : `seen ${new Date(device.lastSeenAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`}
              </span>
              <RevokeButton
                deviceRef={device.deviceRef}
                revokedAt={device.revokedAt}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

