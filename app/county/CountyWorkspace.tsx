"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toCountyCsv } from "@/convex/lib/county";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { Centered, UserGate } from "@/app/components/SchoolGate";
import { Stat } from "@/app/components/Stat";
import { useQuery } from "convex/react";
import { useUrlDate } from "@/app/components/useUrlDate";
import { useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  ALERT_CLASS,
  BUTTON_CLASS,
  DATE_CLASS,
  PAGE_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
  TITLE_CLASS,
} from "@/app/components/ui";

const DRILL_CLASS =
  "min-h-11 cursor-pointer text-left underline decoration-dotted hover:text-green";
const EVENT_CLASS = `${ROW_CLASS} font-sans text-sm`;
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

export default function CountyWorkspace({
  page = "Overview",
}: {
  page?: string;
}) {
  return (
    <UserGate>
      {(user) =>
        COUNTY_ROLES.has(user.role) ? (
          <CountyPanel page={page} />
        ) : (
          <Centered>This screen is for county and admin accounts.</Centered>
        )
      }
    </UserGate>
  );
}

function CountyPanel({ page }: { page: string }) {
  const [to, setTo] = useUrlDate("to", () => toServiceDate(Date.now()));
  const [from, setFrom] = useUrlDate("from", () =>
    addDays(toServiceDate(Date.now()), -(DEFAULT_PERIOD_DAYS - 1)),
  );
  const params = useSearchParams();
  const drillId = params.get("school");
  const drillType = params.get("event");
  const drill: Drill | null =
    drillId &&
    drillType &&
    Object.values(DRILL_TYPES).includes(
      drillType as (typeof DRILL_TYPES)[keyof typeof DRILL_TYPES],
    )
      ? {
          schoolId: drillId as Id<"schools">,
          schoolCode: params.get("code") ?? "School",
          type: drillType,
        }
      : null;
  function setDrill(value: Drill | null) {
    const url = new URL(window.location.href);
    for (const key of ["school", "code", "event"]) url.searchParams.delete(key);
    if (value) {
      url.searchParams.set("school", value.schoolId);
      url.searchParams.set("code", value.schoolCode);
      url.searchParams.set("event", value.type);
    }
    window.history.pushState(null, "", url);
  }
  const overview = useQuery(api.county.overview, { from, to });

  function download() {
    if (!overview) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([toCountyCsv(overview.rows)], { type: "text/csv" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `county-variance-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const alerts = overview
    ? overview.rows.flatMap((row) => [
        ...(row.streakDays >= overview.thresholds.varianceStreakDays
          ? [
              `${row.schoolCode}: variance outside ±${overview.thresholds.varianceTolerancePct}% for ${row.streakDays} consecutive days`,
            ]
          : []),
        ...(row.overrideRatePct > overview.thresholds.overrideTolerancePct
          ? [
              `${row.schoolCode}: override rate ${row.overrideRatePct}% exceeds ${overview.thresholds.overrideTolerancePct}%`,
            ]
          : []),
      ])
    : [];

  return (
    <div className={PAGE_CLASS}>
      <header className="dashboard-heading">
        <div className="page-heading">
          <p className="dashboard-eyebrow">County operations</p>
          <h1 className={TITLE_CLASS}>{page}</h1>
          <p className="dashboard-description">
            Follow meal coverage and see where schools need support.
          </p>
        </div>
      </header>
      <div className="dashboard-toolbar">
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={DATE_CLASS}
          />
        </label>
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
          disabled={!overview || overview.rows.length === 0}
          className={BUTTON_CLASS}
          onClick={download}
        >
          Export CSV
        </button>
      </div>
      {alerts.map((alert) => (
        <p key={alert} className={ALERT_CLASS}>
          {alert}
        </p>
      ))}
      {page === "Schools" && !drill && (
        <section className="flex flex-col gap-2">
          <h2 className={SECTION_TITLE_CLASS}>
            Variance by school, largest first
          </h2>
          {overview?.rows.length === 0 && (
            <p className="text-sm text-ink/80">No active schools.</p>
          )}
          <figure aria-label="Variance by school">
            <figcaption>
              Confirmed portions minus meals eaten. Bars show absolute variance;
              signed labels show direction.
            </figcaption>
            {overview?.rows.map((row) => (
              <div key={row.schoolId} className="my-3">
                <span>
                  {row.schoolCode}: {row.variancePct > 0 ? "+" : ""}
                  {row.variancePct}%
                </span>
                <div className="h-3 bg-cream-light">
                  <div
                    className="h-3 bg-green"
                    style={{
                      width: `${Math.min(100, Math.abs(row.variancePct))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </figure>
          <table className="record-table">
            <caption className="sr-only">School variance</caption>
            <thead>
              <tr>
                <th scope="col">School</th>
                <th scope="col">Days</th>
                <th scope="col">Dispatched</th>
                <th scope="col">Confirmed</th>
                <th scope="col">Eaten</th>
                <th scope="col">Variance</th>
                <th scope="col">Streak</th>
                <th scope="col">Override rate</th>
              </tr>
            </thead>
            <tbody>
              {overview?.rows.map((row) => (
                <tr key={row.schoolId}>
                  <td data-label="School" className="font-sans">
                    {row.schoolCode}
                  </td>
                  <td data-label="Days">{row.days}</td>
                  <td data-label="Dispatched">
                    <DrillButton
                      value={row.dispatched}
                      onClick={() =>
                        setDrill({
                          schoolId: row.schoolId,
                          schoolCode: row.schoolCode,
                          type: DRILL_TYPES.dispatched,
                        })
                      }
                    />
                  </td>
                  <td data-label="Confirmed">
                    <DrillButton
                      value={row.confirmed}
                      onClick={() =>
                        setDrill({
                          schoolId: row.schoolId,
                          schoolCode: row.schoolCode,
                          type: DRILL_TYPES.confirmed,
                        })
                      }
                    />
                  </td>
                  <td data-label="Eaten">
                    <DrillButton
                      value={row.consumed}
                      onClick={() =>
                        setDrill({
                          schoolId: row.schoolId,
                          schoolCode: row.schoolCode,
                          type: DRILL_TYPES.consumed,
                        })
                      }
                    />
                  </td>
                  <td
                    data-label="Variance"
                    className={
                      Math.abs(row.variancePct) >
                      (overview?.thresholds.varianceTolerancePct ?? 0)
                        ? "font-semibold text-ink"
                        : ""
                    }
                  >
                    {row.variance} ({row.variancePct}%)
                  </td>
                  <td data-label="Streak">
                    <DrillButton
                      value={`${row.streakDays}d`}
                      onClick={() =>
                        setDrill({
                          schoolId: row.schoolId,
                          schoolCode: row.schoolCode,
                          type: DRILL_TYPES.streak,
                        })
                      }
                    />
                  </td>
                  <td data-label="Override rate">
                    <DrillButton
                      value={`${row.overrideRatePct}%`}
                      onClick={() =>
                        setDrill({
                          schoolId: row.schoolId,
                          schoolCode: row.schoolCode,
                          type: DRILL_TYPES.overrides,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {page === "Schools" && drill && (
        <DrillPanel
          drill={drill}
          from={from}
          to={to}
          onClose={() => setDrill(null)}
        />
      )}
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Programme totals</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Schools active" value={overview?.totals.schoolsActive} />
          <Stat label="Meals served" value={overview?.totals.mealsServed} />
          <Stat
            label="Guardians reached"
            value={overview?.totals.guardiansReached}
          />
          <Stat
            label="SMS delivered"
            value={
              overview ? `${overview.totals.deliverabilityPct}%` : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}

function DrillButton({
  value,
  onClick,
}: {
  value: number | string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={DRILL_CLASS} onClick={onClick}>
      {value}
    </button>
  );
}

// GV-08: the events behind the figure that was clicked.
function DrillPanel({
  drill,
  from,
  to,
  onClose,
}: {
  drill: Drill;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [drill.schoolId, drill.type]);
  const events = useQuery(api.county.eventsFor, {
    schoolId: drill.schoolId,
    type: drill.type,
    from,
    to,
  });
  return (
    <section className="flex flex-col gap-2">
      <h2 ref={heading} tabIndex={-1} className={SECTION_TITLE_CLASS}>
        {drill.schoolCode} · {drill.type} · {events?.length ?? "…"} events{" "}
        <button
          type="button"
          className="text-sm font-normal text-ink/80 underline"
          onClick={onClose}
        >
          Return to schools
        </button>
      </h2>
      {events?.length === 0 && (
        <p className="text-sm text-ink/80">No events in this period.</p>
      )}
      <ul className="flex flex-col gap-1">
        {events?.map((event) => (
          <li key={event._id} className={EVENT_CLASS}>
            <span className="text-ink/80">
              {new Date(event.occurredAt).toLocaleString("en-KE", {
                timeZone: "Africa/Nairobi",
              })}
            </span>
            <span>{event.eventId}</span>
            <span className="flex-1 text-ink/80">
              {JSON.stringify(event.payload)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
