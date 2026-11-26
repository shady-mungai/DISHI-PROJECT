"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { SchoolGate } from "@/app/components/SchoolGate";
import { OverridePanel } from "@/app/service-day/OverridePanel";
import { ReaderHealth } from "@/app/service-day/ReaderHealth";
import { RegisterPanel } from "@/app/service-day/RegisterPanel";
import { RosterPanel } from "@/app/service-day/RosterPanel";
import { TastePanel } from "@/app/school/TastePanel";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "@/app/components/DateLink";
import { useUrlDate } from "@/app/components/useUrlDate";
import { SchoolPanel as DeliveryPanel } from "@/app/deliveries/DeliveryWorkflows";
import { useEffect, useState } from "react";
import {
  BUTTON_CLASS,
  DATE_CLASS,
  PAGE_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
} from "@/app/components/ui";

import {
  ActiveDeliveries,
  DeliveryInbox,
  ForecastPanel,
} from "@/app/deliveries/DeliveryOperations";
import { showError } from "@/app/lib/errors";

const FIELD_CLASS =
  "min-h-11 w-24 rounded-control border-2 border-green px-2 py-1";
const DEFAULT_SEED = 1;
const DEFAULT_NO_SHOWS = 3;
const DEFAULT_BATCH_SIZE = 1;

export default function SchoolWorkspace({
  page = "Overview",
}: {
  page?: string;
}) {
  return (
    <SchoolGate>
      {(schoolId) => <ServiceDayPanel schoolId={schoolId} page={page} />}
    </SchoolGate>
  );
}

function ServiceDayPanel({
  schoolId,
  page,
}: {
  schoolId: Id<"schools">;
  page: string;
}) {
  const [serviceDate, setServiceDate] = useUrlDate("date", () =>
    toServiceDate(Date.now()),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [today, setToday] = useState(() => toServiceDate(Date.now()));
  useEffect(() => {
    const timer = setInterval(
      () => setToday(toServiceDate(Date.now())),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  const isServicePage = ["Overview", "Meal service"].includes(page);
  const schoolForecast = useQuery(
    api.deliveryDashboard.forecasts,
    isServicePage ? { schoolId, serviceDate: addDays(today, 1) } : "skip",
  );

  const supply = useQuery(
    api.overrides.supplyToday,
    isServicePage ? { schoolId } : "skip",
  );
  const summary = useQuery(
    api.expectations.daySummary,
    isServicePage ? { schoolId, serviceDate } : "skip",
  );
  const notifications = useQuery(
    api.notifications.recentForSchool,
    page === "Communications" ? { schoolId } : "skip",
  );
  const spend = useQuery(
    api.notifications.spendByRuleToday,
    page === "Communications" ? { schoolId } : "skip",
  );
  const runExpectations = useMutation(api.expectations.runExpectationsNow);
  const runSweep = useMutation(api.expectations.runSweepNow);
  const simulate = useAction(api.simulator.runServiceDay);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [noShowCount, setNoShowCount] = useState(DEFAULT_NO_SHOWS);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);

  const expected = summary
    ? summary.pending + summary.fulfilled + summary.missed + summary.absent
    : undefined;

  async function trigger(run: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await run());
    } catch (caught) {
      setMessage(null);
      showError(caught, "That action did not finish. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function describeExpectations(): Promise<string> {
    const result = await runExpectations({ schoolId, serviceDate });
    if (result.status === "not_school_day") {
      return `${serviceDate} is not a school day — nothing generated.`;
    }
    return `Expectations: ${result.created} created, ${result.existing} already existed${result.chained ? " (more pages running)" : ""}.`;
  }

  async function describeSimulation(): Promise<string> {
    const result = await simulate({
      schoolId,
      serviceDate,
      seed,
      noShowCount,
      batchSize,
    });
    return `Simulated: ${result.posted} taps in ${result.batches} batch(es), ${result.accepted} accepted, ${result.duplicate} duplicate, ${result.rejected} rejected, ${result.noShows} no-shows, ${result.elapsedMs} ms.`;
  }

  async function describeSweep(): Promise<string> {
    const result = await runSweep({ schoolId, serviceDate });
    return `Sweep: ${result.missed} marked missed${result.chained ? " (more batches running)" : ""}.`;
  }

  return (
    <div className={PAGE_CLASS}>
      <header className="dashboard-heading">
        <div className="page-heading">
          <p className="dashboard-eyebrow">
            {schoolForecast?.[0]?.schoolName || "School operations"}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            {page}
          </h1>
          <p className="dashboard-description">
            Every meal matters. Keep today’s service moving.
          </p>
        </div>
      </header>
      <label className="dashboard-toolbar font-medium text-primary">
        Service day
        <input
          type="date"
          value={serviceDate}
          onChange={(e) => setServiceDate(e.target.value)}
          className={DATE_CLASS}
        />
      </label>
      {isServicePage && (
        <>
          {supply && !supply.supplied && (
            <p className="service-notice" role="alert">
              <strong>No food delivery received today.</strong> Meal service
              opens once you record the supplier&rsquo;s delivery.{" "}
              <Link href="/school/deliveries">Record delivery</Link>
            </p>
          )}
          {supply?.supplied && supply.portions > 0 && (
            <p className="service-notice" role="status">
              Today&rsquo;s menu: <strong>{supply.dishes.join(", ") || "not named"}</strong>{" "}
              · {supply.portions} portions received.
            </p>
          )}
          {page === "Overview" && summary && summary.missed > 0 && (
            <p className="service-notice" role="status">
              <strong>{summary.missed} missed meals</strong> for {serviceDate}.{" "}
              <Link href={`/school/service?date=${serviceDate}`}>
                Review meal service
              </Link>
            </p>
          )}
          {serviceDate !== today && (
            <p className="service-notice">
              Viewing {serviceDate}. New reader and staff meal records are for
              today, {today}.{" "}
              <Link
                href={`/school${page === "Meal service" ? "/service" : ""}?date=${today}`}
              >
                View today
              </Link>
            </p>
          )}
          <Link
            className={`${BUTTON_CLASS} service-primary`}
            href={
              page === "Overview"
                ? `/school/service?date=${serviceDate}`
                : `/reader?date=${today}`
            }
          >
            {page === "Overview" ? "Serve meals" : "Open tap reader"}
          </Link>
          {page === "Meal service" && (
            <>
              <p className="text-sm text-muted">
                Staff overrides always record a meal for today, even when
                viewing a past service date.
              </p>
              <OverridePanel schoolId={schoolId} serviceDate={serviceDate} />
            </>
          )}
          {!summary ? (
            <p role="status">Loading service counts…</p>
          ) : (
            <section aria-label={`Meal service summary for ${serviceDate}`}>
              <dl className="service-counts">
                <div>
                  <dt>Meals served</dt>
                  <dd>{summary.fulfilled.toLocaleString("en-KE")}</dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>{expected?.toLocaleString("en-KE")}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{summary.pending.toLocaleString("en-KE")}</dd>
                </div>
                <div>
                  <dt>Missed</dt>
                  <dd>{summary.missed.toLocaleString("en-KE")}</dd>
                </div>
                <div>
                  <dt>Absent</dt>
                  <dd>{summary.absent.toLocaleString("en-KE")}</dd>
                </div>
              </dl>
              {expected === 0 && (
                <p className="mt-3 text-sm text-muted">
                  No meal expectations for this date. Check the service date or
                  ask your programme administrator.
                </p>
              )}
            </section>
          )}
        </>
      )}
      {page === "Overview" && (
        <>
          <div className="dashboard-columns">
            <ActiveDeliveries schoolId={schoolId} role="school" />
            <ForecastPanel schoolId={schoolId} />
          </div>
        </>
      )}
      {page === "Attendance register" && <RegisterPanel schoolId={schoolId} />}
      {page === "Taste insights" && <TastePanel schoolId={schoolId} />}
      {page === "Communications" && <DeliveryInbox />}
      {page === "Readers" && (
        <>
          <ReaderHealth schoolId={schoolId} />
          <Link href="/reader">Register or scan with a reader</Link>
        </>
      )}
      {page === "Pupils" && (
        <>
          <div className="flex flex-wrap gap-4">
            <Link href="/enrolment/import">Import enrolment</Link>
            <Link href="/reader?mode=assign">Assign a tag</Link>
          </div>
          <RosterPanel schoolId={schoolId} />
        </>
      )}
      {page === "Operations tools" && (
        <>
          <p className="border-2 border-orange rounded-control p-4">
            These actions process real application data for the selected service
            date. Simulation creates real taps.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              className={BUTTON_CLASS}
              onClick={() => void trigger(describeExpectations)}
            >
              Run expectations now
            </button>
            <button
              type="button"
              disabled={busy}
              className={BUTTON_CLASS}
              onClick={() => void trigger(describeSweep)}
            >
              Run sweep now
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <NumberField label="Seed" value={seed} onChange={setSeed} />
            <NumberField
              label="No-shows"
              value={noShowCount}
              onChange={setNoShowCount}
            />
            <NumberField
              label="Batch size"
              value={batchSize}
              onChange={setBatchSize}
            />
            <button
              type="button"
              disabled={busy}
              className={BUTTON_CLASS}
              onClick={() => void trigger(describeSimulation)}
            >
              Simulate taps
            </button>
          </div>
          {message && (
            <p role="status" className="text-sm text-ink/80">
              {message}
            </p>
          )}
          <DeliveryPanel schoolId={schoolId} toolsOnly />
        </>
      )}
      {page === "Deliveries" && <DeliveryPanel schoolId={schoolId} />}
      {page === "Communications" && (
        <>
          <p>
            Recent notifications and SMS spend today are independent of the
            selected service date. Suppressed messages were intentionally
            withheld by notification policy; failures show the delivery reason.
          </p>
          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>Recent notifications</h2>
            {notifications?.length === 0 && (
              <p className="text-sm text-ink/80">None yet.</p>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {notifications?.map((notification) => (
                <li key={notification._id} className={ROW_CLASS}>
                  <span className="font-sans text-ink/80">
                    {notification.maskedMsisdn}
                  </span>
                  <span className="flex-1">{notification.body}</span>
                  <span className="text-ink/80">
                    {notification.suppressionReason ??
                      notification.failureReason ??
                      notification.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className={SECTION_TITLE_CLASS}>SMS spend today</h2>
            {spend?.length === 0 && (
              <p className="text-sm text-ink/80">Nothing sent yet.</p>
            )}
            {spend && spend.length > 0 && (
              <p className="text-sm text-ink/80">
                {volumeReductionLabel(spend)}
              </p>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {spend?.map((row) => (
                <li key={row.ruleKey} className={ROW_CLASS}>
                  <span className="flex-1 font-sans">{row.ruleKey}</span>
                  <span>{row.sent} sent</span>
                  <span>{row.suppressed} suppressed</span>
                  <span className="text-ink/80">
                    KES {row.costKes.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

type SpendRow = { sent: number; suppressed: number };

// NFR-602: reduction against the naive one-message-per-trigger baseline.
function volumeReductionLabel(rows: SpendRow[]): string {
  const sent = rows.reduce((sum, row) => sum + row.sent, 0);
  const candidates = sent + rows.reduce((sum, row) => sum + row.suppressed, 0);
  if (candidates === 0) {
    return "";
  }
  return `${Math.round((1 - sent / candidates) * 100)}% below the naive per-trigger baseline (${sent} of ${candidates})`;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink/80">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={FIELD_CLASS}
      />
    </label>
  );
}
