"use client";

import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { TasteVerdict } from "@/convex/lib/taste";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { useQuery } from "convex/react";
import { MUTED_CLASS, PANEL_CLASS, SECTION_TITLE_CLASS } from "@/app/components/ui";

const PERIOD_DAYS = 92;
const NOT_SERVED = "—";

const VERDICT_CLASS: Record<TasteVerdict, string> = {
  liked: "rounded-control bg-primary/10 px-2 py-0.5 font-medium text-primary",
  neutral: "rounded-control px-2 py-0.5 text-muted",
  disliked: "rounded-control bg-warning-surface px-2 py-0.5 font-semibold text-error",
};

const VERDICT_LABEL: Record<TasteVerdict, string> = { liked: "Liked", neutral: "Neutral", disliked: "Disliked" };

function Verdict({ verdict, children }: { verdict: TasteVerdict; children: ReactNode }) {
  return <span className={VERDICT_CLASS[verdict]}>{children}</span>;
}

function tastePeriod(): { from: string; to: string } {
  const to = toServiceDate(Date.now());
  return { from: addDays(to, -(PERIOD_DAYS - 1)), to };
}

export function TastePanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const report = useQuery(api.taste.report, { schoolId, ...tastePeriod() });
  if (!report) return <p role="status">Loading taste insights…</p>;
  if (report.dishes.length === 0) {
    return <p className={MUTED_CLASS}>No meals with a recorded dish in the last {PERIOD_DAYS} days.</p>;
  }
  const dishes = report.dishes.map((row) => row.dish);
  const streams = [...new Set(report.streams.map((row) => row.className))];
  const cell = new Map(report.streams.map((row) => [`${row.className}|${row.dish}`, row]));

  return (
    <>
      <section className={PANEL_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Dishes, most skipped first</h2>
        <table className="record-table">
          <caption className="sr-only">Skip rate per dish</caption>
          <thead>
            <tr>
              <th scope="col">Dish</th>
              <th scope="col">Pupils served</th>
              <th scope="col">Present, did not eat</th>
              <th scope="col">Skip rate</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report.dishes.map((row) => (
              <tr key={row.dish}>
                <td data-label="Dish" className="font-sans">{row.dish}</td>
                <td data-label="Pupils served">{row.served}</td>
                <td data-label="Present, did not eat">{row.skipped}</td>
                <td data-label="Skip rate">{row.skipPct}%</td>
                <td data-label="Verdict"><Verdict verdict={row.verdict}>{VERDICT_LABEL[row.verdict]}</Verdict></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={PANEL_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Skip rate by stream</h2>
        <table className="record-table">
          <caption className="sr-only">Skip rate per stream and dish</caption>
          <thead>
            <tr>
              <th scope="col">Stream</th>
              {dishes.map((dish) => <th key={dish} scope="col">{dish}</th>)}
            </tr>
          </thead>
          <tbody>
            {streams.map((stream) => (
              <tr key={stream}>
                <th scope="row" className="font-sans">{stream}</th>
                {dishes.map((dish) => {
                  const row = cell.get(`${stream}|${dish}`);
                  return (
                    <td key={dish} data-label={dish}>
                      {row ? <Verdict verdict={row.verdict}>{row.skipPct}%</Verdict> : NOT_SERVED}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={PANEL_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Pupils who keep skipping a dish</h2>
        {report.repeatSkippers.length === 0 ? (
          <p className={MUTED_CLASS}>No pupil repeatedly skips a dish.</p>
        ) : (
          <table className="record-table">
            <caption className="sr-only">Pupils who repeatedly skip a dish</caption>
            <thead>
              <tr>
                <th scope="col">Pupil</th>
                <th scope="col">Stream</th>
                <th scope="col">Dish</th>
                <th scope="col">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {report.repeatSkippers.map((row) => (
                <tr key={`${row.studentId}|${row.dish}`}>
                  <td data-label="Pupil" className="font-sans">{row.studentName}</td>
                  <td data-label="Stream">{row.className}</td>
                  <td data-label="Dish">{row.dish}</td>
                  <td data-label="Skipped">{row.skipped} of {row.served} ({row.skipPct}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className={MUTED_CLASS}>
        Skip rate is pupils marked present who did not collect the meal, out of
        all present pupils served that dish, over the last {PERIOD_DAYS} days.
        Absent pupils are left out. Below {report.likedMaxSkipPct}% is liked;
        above {report.dislikedMinSkipPct}% is disliked.
      </p>
    </>
  );
}
