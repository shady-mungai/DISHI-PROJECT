"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toCountyCsv } from "@/convex/lib/county";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import { useQuery } from "convex/react";
import { useState } from "react";
import { ALERT_CLASS, BUTTON_CLASS, DATE_CLASS, PAGE_CLASS, ROW_CLASS, SECTION_TITLE_CLASS, TITLE_CLASS } from "@/app/components/ui";

const DRILL_CLASS = "cursor-pointer text-left underline decoration-dotted hover:text-green";
const EVENT_CLASS = `${ROW_CLASS} font-mono text-xs`;
const TABLE_ROW_CLASS = "grid min-h-11 grid-cols-8 items-center gap-2 rounded-control bg-cream-light px-3 py-2";
const DEFAULT_PERIOD_DAYS = 7;
const COUNTY_ROLES = new Set(["county", "admin"]);

const DRILL_TYPES = {
  dispatched: "delivery.dispatched",
  confirmed: "delivery.confirmed",
  consumed: "meal.tapped",
  overrides: "meal.override_served",
  streak: "reconciliation.daily_computed",
} as const;

type Drill = { schoolId: Id<"schools">; schoolCode: string; type: string };

export default function CountyPage() {
  return (
    <UserGate>
      {(user) => (COUNTY_ROLES.has(user.role) ? <CountyPanel /> : <Centered>This screen is for county and admin accounts.</Centered>)}
    </UserGate>
  );
}

function CountyPanel() {
  const [to, setTo] = useState(() => toServiceDate(Date.now()));
  const [from, setFrom] = useState(() => addDays(toServiceDate(Date.now()), -(DEFAULT_PERIOD_DAYS - 1)));
  const [drill, setDrill] = useState<Drill | null>(null);
  const overview = useQuery(api.county.overview, { from, to });

  function download() {
    if (!overview) {
      return;
    }
    const url = URL.createObjectURL(new Blob([toCountyCsv(overview.rows)], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `county-variance-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const alerts = overview
    ? overview.rows.flatMap((row) => [
        ...(row.streakDays >= overview.thresholds.varianceStreakDays
          ? [`${row.schoolCode}: variance outside ±${overview.thresholds.varianceTolerancePct}% for ${row.streakDays} consecutive days`]
          : []),
        ...(row.overrideRatePct > overview.thresholds.overrideTolerancePct
          ? [`${row.schoolCode}: override rate ${row.overrideRatePct}% exceeds ${overview.thresholds.overrideTolerancePct}%`]
          : []),
      ])
    : [];

  return (
    <div className={PAGE_CLASS}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITLE_CLASS}>County — reporting period</h1>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={DATE_CLASS} />
        to
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={DATE_CLASS} />
        <button type="button" disabled={!overview || overview.rows.length === 0} className={BUTTON_CLASS} onClick={download}>
          Export CSV
        </button>
      </div>
      {alerts.map((alert) => (
        <p key={alert} className={ALERT_CLASS}>
          {alert}
        </p>
      ))}
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Variance by school, largest first</h2>
        {overview?.rows.length === 0 && <p className="text-sm text-ink/60">No active schools.</p>}
        <div className="overflow-x-auto">
        <div className="min-w-[720px]">
        <div className="grid grid-cols-8 gap-2 px-3 text-sm text-ink/60">
          <span>School</span>
          <span>Days</span>
          <span>Dispatched</span>
          <span>Confirmed</span>
          <span>Eaten</span>
          <span>Variance</span>
          <span>Streak</span>
          <span>Override rate</span>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {overview?.rows.map((row) => (
            <li key={row.schoolId} className={TABLE_ROW_CLASS}>
              <span className="font-mono">{row.schoolCode}</span>
              <span>{row.days}</span>
              <DrillButton value={row.dispatched} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.dispatched })} />
              <DrillButton value={row.confirmed} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.confirmed })} />
              <DrillButton value={row.consumed} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.consumed })} />
              <span className={Math.abs(row.variancePct) > (overview?.thresholds.varianceTolerancePct ?? 0) ? "font-semibold text-error" : ""}>
                {row.variance} ({row.variancePct}%)
              </span>
              <DrillButton value={`${row.streakDays}d`} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.streak })} />
              <DrillButton value={`${row.overrideRatePct}%`} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.overrides })} />
            </li>
          ))}
        </ul>
        </div>
        </div>
      </section>
      {drill && <DrillPanel drill={drill} from={from} to={to} onClose={() => setDrill(null)} />}
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Programme totals</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Schools active" value={overview?.totals.schoolsActive} />
          <Stat label="Meals served" value={overview?.totals.mealsServed} />
          <Stat label="Guardians reached" value={overview?.totals.guardiansReached} />
          <Stat label="SMS delivered" value={overview ? `${overview.totals.deliverabilityPct}%` : undefined} />
        </div>
      </section>
    </div>
  );
}

function DrillButton({ value, onClick }: { value: number | string; onClick: () => void }) {
  return (
    <button type="button" className={DRILL_CLASS} onClick={onClick}>
      {value}
    </button>
  );
}

// GV-08: the events behind the figure that was clicked.
function DrillPanel({ drill, from, to, onClose }: { drill: Drill; from: string; to: string; onClose: () => void }) {
  const events = useQuery(api.county.eventsFor, { schoolId: drill.schoolId, type: drill.type, from, to });
  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>
        {drill.schoolCode} · {drill.type} · {events?.length ?? "…"} events{" "}
        <button type="button" className="text-sm font-normal text-ink/60 underline" onClick={onClose}>
          close
        </button>
      </h2>
      {events?.length === 0 && <p className="text-sm text-ink/60">No events in this period.</p>}
      <ul className="flex flex-col gap-1">
        {events?.map((event) => (
          <li key={event._id} className={EVENT_CLASS}>
            <span className="text-ink/60">{new Date(event.occurredAt).toLocaleString()}</span>
            <span>{event.eventId}</span>
            <span className="flex-1 text-ink/60">{JSON.stringify(event.payload)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
