"use client";

import { api } from "@/convex/_generated/api";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import { ALERT_CLASS, DATE_CLASS, LINK_CLASS, MUTED_CLASS, PAGE_CLASS, ROW_CLASS, SECTION_TITLE_CLASS, TITLE_CLASS } from "@/app/components/ui";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

const DEFAULT_PERIOD_DAYS = 7;
const SUPPLIER_ROLES = new Set(["supplier", "county", "admin"]);
const TABLE_HEAD_CLASS = "grid grid-cols-7 gap-2 px-3 text-sm text-ink/60";
const TABLE_ROW_CLASS = "grid min-h-11 grid-cols-7 items-center gap-2 rounded-control bg-cream-light px-3 py-2";

export default function SupplierPage() {
  return (
    <UserGate>
      {(user) => (SUPPLIER_ROLES.has(user.role) ? <SupplierPanel /> : <Centered>This screen is for supplier, county and admin accounts.</Centered>)}
    </UserGate>
  );
}

function SupplierPanel() {
  const [to, setTo] = useState(() => toServiceDate(Date.now()));
  const [from, setFrom] = useState(() => addDays(toServiceDate(Date.now()), -(DEFAULT_PERIOD_DAYS - 1)));
  const overview = useQuery(api.supplier.overview, { from, to });

  return (
    <div className={PAGE_CLASS}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITLE_CLASS}>Supplier</h1>
        <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
        to
        <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
        <Link href="/deliveries" className={LINK_CLASS}>
          Declare a dispatch
        </Link>
      </div>

      {overview?.stalled.map((alert) => (
        <p key={alert._id} className={ALERT_CLASS} role="status">
          {alert.schoolCode} stalled on {alert.serviceDate}: {alert.tapsSoFar} taps against {alert.expectedRunRate} expected ({alert.shortfallPct}% behind) at{" "}
          {new Date(alert.occurredAt).toLocaleTimeString()}
        </p>
      ))}
      {overview?.unconfirmed.map((delivery) => (
        <p key={delivery._id} className={ALERT_CLASS} role="status">
          {delivery.schoolCode} has not confirmed docket {delivery.docketRef} ({delivery.portions} portions, {delivery.serviceDate}) — expected by{" "}
          {new Date(delivery.expectedConfirmBy).toLocaleTimeString()}
        </p>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Forecast accuracy, trailing period</h2>
        {overview?.accuracy.length === 0 && <p className={MUTED_CLASS}>No active schools.</p>}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {overview?.accuracy.map((school) => (
            <Stat
              key={school.schoolId}
              label={`${school.schoolCode} · ${school.days} day(s)`}
              value={school.days === 0 ? "—" : `±${school.meanAbsErrorPct}% (${school.biasPct >= 0 ? "+" : ""}${school.biasPct}% bias)`}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Dispatched · confirmed · eaten, per school per day</h2>
        {overview?.rows.length === 0 && <p className={MUTED_CLASS}>Nothing reconciled in this period.</p>}
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className={TABLE_HEAD_CLASS}>
              <span>School</span>
              <span>Day</span>
              <span>Forecast</span>
              <span>Dispatched</span>
              <span>Confirmed</span>
              <span>Eaten</span>
              <span>Variance</span>
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {overview?.rows.map((row) => (
                <li key={`${row.schoolId}:${row.serviceDate}`} className={TABLE_ROW_CLASS}>
                  <span className="font-mono">{row.schoolCode}</span>
                  <span>{row.serviceDate}</span>
                  <span>{row.forecast ?? "—"}</span>
                  <span>{row.dispatched}</span>
                  <span>{row.confirmed}</span>
                  <span>{row.consumed}</span>
                  <span className={row.variancePct !== 0 ? "font-semibold text-orange" : ""}>
                    {row.variance} ({row.variancePct}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <p className={`${ROW_CLASS} ${MUTED_CLASS}`}>Variance is confirmed minus eaten, as a share of confirmed. Forecast accuracy is the mean absolute error of the forecast against what was eaten.</p>
    </div>
  );
}
