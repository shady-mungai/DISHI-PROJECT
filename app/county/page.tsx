"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toCountyCsv } from "@/convex/lib/county";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import { useQuery } from "convex/react";
import { useState } from "react";

const BUTTON_CLASS = "rounded bg-black px-3 py-2 text-white disabled:opacity-50";
const DATE_CLASS = "rounded border border-zinc-300 px-2 py-1 text-base font-normal";
const ROW_CLASS = "grid grid-cols-8 gap-2 rounded border border-zinc-200 px-3 py-2";
const ALERT_CLASS = "rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700";
const DRILL_CLASS = "text-left underline decoration-dotted hover:text-black";
const EVENT_CLASS = "flex flex-wrap gap-3 rounded border border-zinc-200 px-3 py-2 font-mono text-xs";
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
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">County — reporting period</h1>
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
        <h2 className="font-semibold">Variance by school, largest first</h2>
        {overview?.rows.length === 0 && <p className="text-sm text-zinc-500">No active schools.</p>}
        <div className={`${ROW_CLASS} border-0 text-sm text-zinc-500`}>
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
            <li key={row.schoolId} className={ROW_CLASS}>
              <span className="font-mono">{row.schoolCode}</span>
              <span>{row.days}</span>
              <DrillButton value={row.dispatched} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.dispatched })} />
              <DrillButton value={row.confirmed} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.confirmed })} />
              <DrillButton value={row.consumed} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.consumed })} />
              <span className={Math.abs(row.variancePct) > (overview?.thresholds.varianceTolerancePct ?? 0) ? "font-semibold text-red-600" : ""}>
                {row.variance} ({row.variancePct}%)
              </span>
              <DrillButton value={`${row.streakDays}d`} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.streak })} />
              <DrillButton value={`${row.overrideRatePct}%`} onClick={() => setDrill({ schoolId: row.schoolId, schoolCode: row.schoolCode, type: DRILL_TYPES.overrides })} />
            </li>
          ))}
        </ul>
      </section>
      {drill && <DrillPanel drill={drill} from={from} to={to} onClose={() => setDrill(null)} />}
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Programme totals</h2>
        <div className="grid grid-cols-4 gap-4">
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
      <h2 className="font-semibold">
        {drill.schoolCode} · {drill.type} · {events?.length ?? "…"} events{" "}
        <button type="button" className="text-sm font-normal text-zinc-500 underline" onClick={onClose}>
          close
        </button>
      </h2>
      {events?.length === 0 && <p className="text-sm text-zinc-500">No events in this period.</p>}
      <ul className="flex flex-col gap-1">
        {events?.map((event) => (
          <li key={event._id} className={EVENT_CLASS}>
            <span className="text-zinc-500">{new Date(event.occurredAt).toLocaleString()}</span>
            <span>{event.eventId}</span>
            <span className="flex-1 text-zinc-500">{JSON.stringify(event.payload)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
