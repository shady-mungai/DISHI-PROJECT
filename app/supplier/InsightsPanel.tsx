"use client";

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { MUTED_CLASS, SECTION_TITLE_CLASS } from "@/app/components/ui";

const NOT_AVAILABLE = "—";
const FLAGGED_CELL_CLASS = "font-semibold text-ink border-l-2 border-orange pl-2";

function percent(value: number | null): string {
  return value === null ? NOT_AVAILABLE : `${value}%`;
}

function points(value: number | null): string {
  if (value === null) return NOT_AVAILABLE;
  return `${value > 0 ? "+" : ""}${value} pts`;
}

export function InsightsPanel({ from, to }: { from: string; to: string }) {
  const insights = useQuery(api.supplier.insights, { from, to });
  if (!insights) {
    return <p role="status">Loading insights…</p>;
  }
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Dishes, most left over first</h2>
        {insights.dishes.length === 0 && (
          <p className={MUTED_CLASS}>No dish has been recorded on a dispatch in this period.</p>
        )}
        <table className="record-table">
          <caption className="sr-only">Uptake and leftovers per dish</caption>
          <thead>
            <tr>
              <th scope="col">Dish</th>
              <th scope="col">Days</th>
              <th scope="col">Uptake</th>
              <th scope="col">vs same weekday</th>
              <th scope="col">Left over</th>
              <th scope="col">vs same weekday</th>
              <th scope="col">Skipped by present pupils</th>
              <th scope="col">Children&rsquo;s verdict</th>
            </tr>
          </thead>
          <tbody>
            {insights.dishes.map((row) => (
              <tr key={row.dish} className={row.enoughData ? "" : "text-muted"}>
                <td data-label="Dish" className="font-sans">
                  {row.dish}
                  {!row.enoughData && ` (needs ${insights.minDays} days)`}
                </td>
                <td data-label="Days">{row.days}</td>
                <td data-label="Uptake">{percent(row.uptakePct)}</td>
                <td data-label="Uptake vs same weekday">{points(row.uptakeVsWeekday)}</td>
                <td data-label="Left over">{percent(row.leftoverPct)}</td>
                <td data-label="Left over vs same weekday" className={row.enoughData && (row.leftoverVsWeekday ?? 0) > 0 ? FLAGGED_CELL_CLASS : ""}>
                  {points(row.leftoverVsWeekday)}
                </td>
                <td data-label="Skipped by present pupils">{percent(row.skipPct)}</td>
                <td data-label="Children’s verdict" className={row.verdict === "disliked" ? FLAGGED_CELL_CLASS : ""}>
                  {row.verdict ?? NOT_AVAILABLE}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={SECTION_TITLE_CLASS}>Attendance and missed meals by weekday</h2>
        {insights.weekdays.length === 0 && (
          <p className={MUTED_CLASS}>No reconciled school days in this period.</p>
        )}
        <table className="record-table">
          <caption className="sr-only">Attendance and missed-meal reasons per weekday</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Register days</th>
              <th scope="col">Attendance</th>
              <th scope="col">Uptake</th>
              <th scope="col">Absent</th>
              <th scope="col">Present, did not eat</th>
              <th scope="col">Food ran short</th>
              <th scope="col">No register</th>
            </tr>
          </thead>
          <tbody>
            {insights.weekdays.map((row) => (
              <tr key={row.weekday}>
                <td data-label="Day" className="font-sans">{row.weekday}</td>
                <td data-label="Register days">{row.registerDays}</td>
                <td data-label="Attendance">{percent(row.attendancePct)}</td>
                <td data-label="Uptake">{percent(row.uptakePct)}</td>
                <td data-label="Absent">{row.absent}</td>
                <td data-label="Present, did not eat">{row.missedPresent}</td>
                <td data-label="Food ran short">{row.missedSupply}</td>
                <td data-label="No register">{row.missedUnknown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className={MUTED_CLASS}>
        Uptake is pupils who ate out of pupils present and not short of food, on
        days the register was taken. Left over is received portions not
        collected; plate waste is not measured. “vs same weekday” compares a
        dish with that school’s other days on the same weekday, so a sports
        Friday is compared with other Fridays. Only full school days with a
        single dish count. Skipped is the share of present pupils who did not
        eat that dish, across all schools; the verdict is liked, neutral or
        disliked from the taste thresholds. Rotate dishes on the Menu page so
        each one is seen on several weekdays.
      </p>
    </>
  );
}
