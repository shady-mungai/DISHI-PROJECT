"use client";

import { api } from "@/convex/_generated/api";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import {
  ALERT_CLASS,
  DATE_CLASS,
  LINK_CLASS,
  MUTED_CLASS,
  PAGE_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
  TITLE_CLASS,
} from "@/app/components/ui";
import { useQuery } from "convex/react";
import Link from "@/app/components/DateLink";
import { useUrlDate } from "@/app/components/useUrlDate";
import { InsightsPanel } from "@/app/supplier/InsightsPanel";

import {
  ActiveDeliveries,
  DeliveryHistory,
  DeliveryInbox,
  ForecastPanel,
} from "@/app/deliveries/DeliveryOperations";

const DEFAULT_PERIOD_DAYS = 7;
const SUPPLIER_ROLES = new Set(["supplier", "county", "admin"]);

export default function SupplierWorkspace({
  page = "Overview",
}: {
  page?: string;
}) {
  return (
    <UserGate>
      {(user) =>
        SUPPLIER_ROLES.has(user.role) ? (
          <SupplierPanel
            page={page}
            role={user.role as "supplier" | "admin" | "county"}
          />
        ) : (
          <Centered>
            This screen is for supplier, county and admin accounts.
          </Centered>
        )
      }
    </UserGate>
  );
}

function SupplierPanel({
  page,
  role,
}: {
  page: string;
  role: "supplier" | "admin" | "county";
}) {
  const [to, setTo] = useUrlDate("to", () => toServiceDate(Date.now()));
  const [from, setFrom] = useUrlDate("from", () =>
    addDays(toServiceDate(Date.now()), -(DEFAULT_PERIOD_DAYS - 1)),
  );
  const overview = useQuery(api.supplier.overview, { from, to });

  return (
    <div className={PAGE_CLASS}>
      <header className="dashboard-heading">
        <div className="page-heading">
          <p className="dashboard-eyebrow">Supplier operations</p>
          <h1 className={TITLE_CLASS}>{page}</h1>
          <p className="dashboard-description">
            Plan the next delivery. Follow every portion through to service.
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
        <Link href="/supplier/dispatch" className={LINK_CLASS}>
          Declare a dispatch
        </Link>
      </div>

      {page === "Overview" &&
        overview?.stalled.map((alert) => (
          <p key={alert._id} className={ALERT_CLASS} role="status">
            {alert.schoolCode} stalled on {alert.serviceDate}: {alert.tapsSoFar}{" "}
            taps against {alert.expectedRunRate} expected ({alert.shortfallPct}%
            behind) at{" "}
            {new Date(alert.occurredAt).toLocaleTimeString("en-KE", {
              timeZone: "Africa/Nairobi",
            })}
          </p>
        ))}
      {page === "Overview" &&
        overview?.unconfirmed.map((delivery) => (
          <p key={delivery._id} className={ALERT_CLASS} role="status">
            {delivery.schoolCode} has not confirmed delivery {delivery.docketRef}{" "}
            ({delivery.portions} portions, {delivery.serviceDate}) — expected by{" "}
            {new Date(delivery.expectedConfirmBy).toLocaleTimeString("en-KE", {
              timeZone: "Africa/Nairobi",
            })}
          </p>
        ))}

      {page === "Overview" && (
        <>
          <div className="dashboard-columns">
            <ActiveDeliveries role={role} />
            <ForecastPanel />
          </div>
          <DeliveryHistory role={role} />
          {role !== "county" && <DeliveryInbox />}
        </>
      )}

      {page === "Forecast accuracy" && (
        <section className="flex flex-col gap-2">
          <h2 className={SECTION_TITLE_CLASS}>
            Forecast accuracy, trailing period
          </h2>
          {overview?.accuracy.length === 0 && (
            <p className={MUTED_CLASS}>No active schools.</p>
          )}
          <div className="forecast-accuracy-grid">
            {overview?.accuracy.map((school) => (
              <Stat
                key={school.schoolId}
                label={`${school.schoolCode} · ${school.days} day(s)`}
                value={school.days === 0 ? "—" : `±${school.meanAbsErrorPct}%`}
                detail={
                  school.days === 0
                    ? undefined
                    : `${school.biasPct >= 0 ? "+" : ""}${school.biasPct}% bias`
                }
              />
            ))}
          </div>
        </section>
      )}

      {page === "Dish and attendance insights" && <InsightsPanel from={from} to={to} />}

      {page === "Reconciliation" && (
        <section className="flex flex-col gap-2">
          <h2 className={SECTION_TITLE_CLASS}>
            Dispatched · received · served, per school per day
          </h2>
          {overview?.rows.length === 0 && (
            <p className={MUTED_CLASS}>Nothing reconciled in this period.</p>
          )}
          <table className="record-table">
            <caption className="sr-only">School reconciliation</caption>
            <thead>
              <tr>
                <th scope="col">School</th>
                <th scope="col">Day</th>
                <th scope="col">Forecast</th>
                <th scope="col">Dispatched</th>
                <th scope="col">Received</th>
                <th scope="col">Confirmed</th>
                <th scope="col">Eaten</th>
                <th scope="col">Variance</th>
              </tr>
            </thead>
            <tbody>
              {overview?.rows.map((row) => (
                <tr key={`${row.schoolId}:${row.serviceDate}`}>
                  <td data-label="School" className="font-sans">
                    {row.schoolCode}
                  </td>
                  <td data-label="Day">{row.serviceDate}</td>
                  <td data-label="Forecast">{row.forecast ?? "—"}</td>
                  <td data-label="Dispatched">{row.dispatched}</td>
                  <td data-label="Received">
                    {row.received ?? "Not recorded"}
                  </td>
                  <td data-label="Confirmed">{row.confirmed}</td>
                  <td data-label="Eaten">{row.consumed}</td>
                  <td
                    data-label="Variance"
                    className={
                      row.variancePct !== 0
                        ? "font-semibold text-ink border-l-2 border-orange pl-2"
                        : ""
                    }
                  >
                    {row.variance} ({row.variancePct}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className={`${ROW_CLASS} ${MUTED_CLASS}`}>
        Variance is confirmed minus eaten, as a share of confirmed. Forecast
        accuracy is the mean absolute error of the forecast against what was
        eaten.
      </p>
    </div>
  );
}
