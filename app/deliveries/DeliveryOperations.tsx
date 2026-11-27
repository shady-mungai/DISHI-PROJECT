"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import { kgFromPortions, portionsFromKg } from "@/convex/lib/portions";
import {
  ACTIVE_BADGE_CLASS,
  ALERT_CLASS,
  INACTIVE_BADGE_CLASS,
  BUTTON_CLASS,
  CODE_CLASS,
  INPUT_CLASS,
  MUTED_CLASS,
  PANEL_CLASS,
  SECONDARY_BUTTON_CLASS,
  DISCLOSURE_SUMMARY_CLASS,
  SECTION_TITLE_CLASS,
  TITLE_CLASS,
} from "@/app/components/ui";
import { showError } from "@/app/lib/errors";

type Delivery = FunctionReturnType<typeof api.deliveryDashboard.active>[number];
const DeliveryNotice = createContext<((message: string) => void) | null>(null);

type Role = "school" | "supplier" | "admin" | "county";
export const receiptTime = (time: number) =>
  new Date(time).toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
function useTask() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(fn: () => Promise<string>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      setMessage(await fn());
    } catch (e) {
      showError(e, "That did not go through. Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, message, run };
}
function Feedback({ task }: { task: ReturnType<typeof useTask> }) {
  return (
    <>
      {task.busy && <p role="status">Saving…</p>}
      {task.message && <p role="status">{task.message}</p>}
    </>
  );
}
function useRequestId() {
  const ref = useRef({ payload: "", id: "" });
  return (payload: unknown) => {
    const value = JSON.stringify(payload);
    if (value !== ref.current.payload || !ref.current.id)
      ref.current = { payload: value, id: crypto.randomUUID() };
    return ref.current.id;
  };
}

export function SupplierDispatch() {
  const schools = useQuery(api.deliveries.listSchools);
  const dispatch = useMutation(api.deliveryWorkflow.dispatch);
  const task = useTask();
  const key = useRequestId();
  const [schoolId, setSchool] = useState("");
  const menu = useQuery(
    api.supplier.menu,
    schoolId ? { schoolId: schoolId as Id<"schools"> } : {},
  );
  const rotation = menu?.filter((item) => item.active);
  const grams = useQuery(api.supplier.portionGrams);
  const [containers, setContainers] = useState("");
  const [netKg, setNetKg] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [dish, setDish] = useState("");
  const [result, setResult] = useState<{
    reference: string;
    portions: number;
    expectedArrivalAt: number;
  } | null>(null);
  const kg = Number(netKg);
  const portions = grams && kg > 0 ? portionsFromKg(kg, grams) : null;
  return (
    <section className="flex flex-col gap-4">
      <h1 className={TITLE_CLASS}>Dispatch a delivery</h1>
      <div
        role="note"
        className="rounded-control border-l-4 border-primary bg-surface px-4 py-3 text-sm"
      >
        <p className="font-semibold">How dispatch works</p>
        <p>
          Weigh the food, then enter the containers and net kilograms. Dishi
          turns kilograms into pupil portions. The school checks the container
          count on arrival, within 30 minutes, and confirms what it received.
          Payment follows confirmed portions.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void task.run(async () => {
              const input = {
                schoolId: schoolId as Id<"schools">,
                containers: Number(containers),
                netKg: Number(netKg),
                vehicle,
                dish: dish || rotation?.[0]?.dish || "",
              };
              const sent = await dispatch({ ...input, requestId: key(input) });
              setResult(sent);
              setContainers("");
              setNetKg("");
              setDish("");
              return "Dispatch recorded. School notification queued.";
            });
          }}
        >
          <label className="flex min-w-0 flex-col gap-1">
            School
            <select
              required
              value={schoolId}
              onChange={(e) => {
                setSchool(e.target.value);
                setDish("");
              }}
              className={INPUT_CLASS}
            >
              <option value="">Choose school</option>
              {schools?.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Containers
            <input
              required
              type="number"
              min="1"
              max="1000"
              step="1"
              value={containers}
              onChange={(e) => setContainers(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            Net food weight (kg, without containers)
            <input
              required
              type="number"
              min="0.1"
              max="100000"
              step="0.1"
              value={netKg}
              onChange={(e) => setNetKg(e.target.value)}
              className={INPUT_CLASS}
            />
            {portions !== null && (
              <span className={`${MUTED_CLASS} lg:hidden`}>
                = {portions} portions
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            Vehicle
            <input
              required
              maxLength={100}
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            Dish from the menu
            <select
              required
              value={dish || rotation?.[0]?.dish || ""}
              onChange={(e) => setDish(e.target.value)}
              className={INPUT_CLASS}
            >
              {rotation?.length === 0 && (
                <option value="">Add dishes on the Menu page first</option>
              )}
              {rotation?.map((item, index) => (
                <option key={item._id} value={item.dish}>
                  {item.dish}
                  {index === 0 ? " — next in rotation" : ""}
                  {item.lastServed ? ` (last ${item.lastServed})` : " (not served yet)"}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={task.busy || !schools?.length}
            className={BUTTON_CLASS}
          >
            Dispatch delivery
          </button>
        </form>
        <PortionCalculator kg={kg} grams={grams} portions={portions} />
      </div>
      <Feedback task={task} />
      {result && (
        <div className={PANEL_CLASS}>
          <p>Delivery reference</p>
          <p className={`${CODE_CLASS} [overflow-wrap:anywhere]`}>
            {result.reference}
          </p>
          <p>Counted as {result.portions} portions.</p>
          <p>Expected by {receiptTime(result.expectedArrivalAt)} EAT.</p>
        </div>
      )}
    </section>
  );
}

function PortionCalculator({
  kg,
  grams,
  portions,
}: {
  kg: number;
  grams: number | undefined;
  portions: number | null;
}) {
  if (grams === undefined)
    return <aside className={PANEL_CLASS}>Loading serving size…</aside>;
  const leftover =
    portions === null ? 0 : Math.round(kg * 1000) - portions * grams;
  return (
    <aside className={PANEL_CLASS} aria-labelledby="calculator-title">
      <h2 id="calculator-title" className={SECTION_TITLE_CLASS}>
        Portion calculator
      </h2>
      <p aria-live="polite" className="text-2xl font-semibold text-green">
        {portions === null
          ? "Enter the net kg"
          : `${kg} kg → ${portions} portions`}
      </p>
      {leftover > 0 && (
        <p className={MUTED_CLASS}>
          {leftover} g left over, less than one plate, so it is not counted.
        </p>
      )}
      <p>
        🍲 One portion is <strong>{grams} g</strong>, one learner&apos;s plate.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {[1, 10, 50].map((example) => (
          <li key={example}>
            {example} kg feeds <strong>{portionsFromKg(example, grams)}</strong>{" "}
            learners
          </li>
        ))}
      </ul>
      <p className={MUTED_CLASS}>
        Weigh the food, not the sufuria: weigh it full, then take away the empty
        weight.
      </p>
    </aside>
  );
}

function ReceiptForm({ delivery }: { delivery: Delivery }) {
  const requestCode = useMutation(api.deliveryWorkflow.requestCode);
  const task = useTask();
  const [portions, setPortions] = useState(
    delivery.portionsReceived?.toString() ?? "",
  );
  const [problem, setProblem] = useState("");
  const [fallback, setFallback] = useState<{
    code: string | null;
    expiresAt: number;
  } | null>(null);
  const [reportProblem, setReportProblem] = useState(false);
  async function record() {
    if (
      !portions ||
      !Number.isSafeInteger(Number(portions)) ||
      Number(portions) < 0
    )
      throw new Error(
        "Enter received portions, including 0 if nothing was received.",
      );
    if (reportProblem && !problem.trim())
      throw new Error("Describe the problem before submitting.");
    const input = {
      deliveryId: delivery._id,
      portionsReceived: Number(portions),
      problem: reportProblem ? problem.trim() : "",
    };
    const result = await requestCode({
      ...input,
      requestId: crypto.randomUUID(),
    });
    setFallback(result);
    return "Quantities recorded. Give this single-use code to the supplier. A new code replaces the previous code.";
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void task.run(() => record());
      }}
    >
      <h3 className={SECTION_TITLE_CLASS}>Record receipt</h3>
      <label className="flex flex-col gap-1">
        Portions received
        <input
          required
          type="number"
          min="0"
          max="1000000"
          step="1"
          value={portions}
          onChange={(e) => setPortions(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={reportProblem}
          onChange={(e) => setReportProblem(e.target.checked)}
          className="h-6 w-6 accent-green"
        />
        Report a delivery problem
      </label>
      {reportProblem && (
        <label className="flex flex-col gap-1">
          Describe the problem
          <textarea
            required
            maxLength={500}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      )}
      <button disabled={task.busy} className={BUTTON_CLASS}>
        {fallback
          ? "Replace receipt code"
          : "Record quantities and get receipt code"}
      </button>
      <p className={MUTED_CLASS}>
        Give the code to the supplier. Delivery is confirmed when they enter it.
        A quantity difference goes to central admin for resolution.
      </p>
      <Feedback task={task} />
      {fallback && (
        <div className={PANEL_CLASS}>
          <p className={CODE_CLASS}>
            {fallback.code ?? "Request a replacement code"}
          </p>
          <p>
            Expires {receiptTime(fallback.expiresAt)} EAT. The supplier enters
            it against this delivery.
          </p>
        </div>
      )}
    </form>
  );
}
function RedeemForm({ delivery }: { delivery: Delivery }) {
  const redeem = useMutation(api.deliveryWorkflow.redeemCode);
  const task = useTask();
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void task.run(async () => {
          const result = await redeem({
            deliveryId: delivery._id,
            code,
            requestId: crypto.randomUUID(),
          });
          return result.status === "confirmed" || result.status === "disputed"
            ? `Receipt ${result.status}.`
            : result.status;
        });
      }}
    >
      <label className="flex flex-col gap-1">
        School-issued receipt code
        <input
          required
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <button disabled={task.busy} className={BUTTON_CLASS}>
        Redeem receipt code
      </button>
      <Feedback task={task} />
    </form>
  );
}
function AdminDecision({ delivery }: { delivery: Delivery }) {
  const notify = useContext(DeliveryNotice);
  const resolve = useMutation(api.deliveryWorkflow.resolve);
  const task = useTask();
  const key = useRequestId();
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"confirm" | "dispute" | "reviewed">(
    "reviewed",
  );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void task.run(async () => {
          const input = { deliveryId: delivery._id, decision, reason };
          await resolve({ ...input, requestId: key(input) });
          notify?.("Resolution recorded in the delivery audit trail.");
          return "Resolution recorded in the delivery audit trail.";
        });
      }}
    >
      <h3 className={SECTION_TITLE_CLASS}>Resolve review</h3>
      <p>
        Confirming makes recorded received portions eligible for the payment
        file.
      </p>
      <label className="flex flex-col gap-1">
        Decision
        <select
          className={INPUT_CLASS}
          value={decision}
          onChange={(e) => setDecision(e.target.value as typeof decision)}
        >
          <option value="reviewed">
            Close review; keep delivery status
          </option>
          <option value="confirm">Confirm received portions</option>
          <option value="dispute">Keep delivery disputed</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Reason (required)
        <textarea
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <button disabled={task.busy || !reason.trim()} className={BUTTON_CLASS}>
        Record resolution
      </button>
      <Feedback task={task} />
    </form>
  );
}
function DeliveryDetail({
  delivery,
  role,
}: {
  delivery: Delivery;
  role: Role;
}) {
  const detail = useQuery(api.deliveryDashboard.detail, {
    deliveryId: delivery._id,
  });
  const open =
    delivery.workflowVersion === 2 &&
    !["confirmed", "disputed"].includes(delivery.status);
  return (
    <div className="mt-4 flex flex-col gap-5 border-t border-green/30 pt-4">
      {role === "school" && open && <ReceiptForm delivery={delivery} />}
      {role === "supplier" && open && <RedeemForm delivery={delivery} />}
      {delivery.workflowVersion === 1 && (
        <p>
          Historical delivery: the school can use its original confirmation code
          in the historical confirmation form.
        </p>
      )}
      {delivery.reportedProblem && (
        <p className={ALERT_CLASS}>
          Reported problem: {delivery.reportedProblem}
        </p>
      )}
      {detail?.codeExpiresAt && (
        <p>Receipt code expires {receiptTime(detail.codeExpiresAt)} EAT.</p>
      )}
      {detail?.cooldownUntil && (
        <p>
          Code attempts locked until {receiptTime(detail.cooldownUntil)} EAT.
        </p>
      )}
      {role === "admin" && <AdminDecision delivery={delivery} />}
      <div>
        <h3 className={SECTION_TITLE_CLASS}>Delivery timeline</h3>
        {detail === undefined && <p role="status">Loading timeline…</p>}
        <ol className="mt-3 flex flex-col gap-3">
          {detail?.timeline.map((event) => (
            <li key={event._id} className="border-l-2 border-green pl-3">
              <p>{event.detail}</p>
              <p className={MUTED_CLASS}>
                {receiptTime(event.at)} EAT · {event.type}
                {event.actorId ? ` · ${event.actorId}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </div>
      {!!detail?.sms.length && (
        <ul>
          {detail.sms.map((sms) => (
            <li key={sms._id}>
              SMS to {sms.recipientKey}: {sms.status}
              {sms.failureReason ? ` — ${sms.failureReason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function DeliveryCard({
  delivery,
  role,
}: {
  delivery: Delivery;
  role: Role;
}) {
  const [expanded, setExpanded] = useState(false);
  const overdue =
    delivery.overdueAt !== undefined &&
    delivery.receiptRecordedAt === undefined;
  return (
    <article className={`${PANEL_CLASS} min-w-0 [overflow-wrap:anywhere]`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {delivery.schoolName} · {delivery.reference}
          </h3>
          {delivery.docketRef !== delivery.reference && (
            <p className={MUTED_CLASS}>Supplier docket {delivery.docketRef}</p>
          )}
        </div>
        <span className={overdue ? ALERT_CLASS : "font-medium text-green"}>
          {overdue
            ? "Overdue — receipt needed"
            : delivery.status === "declared"
              ? delivery.receiptRecordedAt
                ? "Receipt recorded — awaiting code"
                : "Incoming"
              : delivery.status}
        </span>
      </div>
      <p className="text-3xl font-semibold text-green">
        {delivery.portions}{" "}
        <span className="text-base font-normal">dispatched</span>
      </p>
      {delivery.containers !== undefined && (
        <p>
          In {delivery.containers} containers · {delivery.netKg} kg net. Check
          the container count on arrival.
        </p>
      )}
      <p>
        Received: {delivery.portionsReceived ?? "Not recorded"} · Served for
        school day: {delivery.servedForDay ?? "Not reconciled"}
      </p>
      <p>
        Dispatched {receiptTime(delivery.dispatchedAt)} · expected by{" "}
        {receiptTime(delivery.expectedArrivalAt)} EAT.
      </p>
      <button
        type="button"
        aria-expanded={expanded}
        className={SECONDARY_BUTTON_CLASS}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? "Close delivery details"
          : role === "school" &&
              !["confirmed", "disputed"].includes(delivery.status)
            ? "Record receipt and view details"
            : "Open delivery details"}
      </button>
      {expanded && <DeliveryDetail delivery={delivery} role={role} />}
    </article>
  );
}
export function ActiveDeliveries({
  schoolId,
  role,
}: {
  schoolId?: Id<"schools">;
  role: Role;
}) {
  const [notice, setNotice] = useState("");
  const rows = useQuery(api.deliveryDashboard.active, { schoolId });
  return (
    <DeliveryNotice.Provider value={setNotice}>
      <section className="flex flex-col gap-4">
        {notice && <p role="status">{notice}</p>}
        <h2 className={SECTION_TITLE_CLASS}>
          Active deliveries · overdue first
        </h2>
        {rows === undefined && (
          <p role="status">Loading incoming deliveries…</p>
        )}
        {rows?.length === 0 && <p>No deliveries awaiting receipt.</p>}
        {rows?.map((row) => (
          <DeliveryCard key={row._id} delivery={row} role={role} />
        ))}
        {rows && rows.length >= 100 && (
          <p>
            Showing the first active deliveries. Use history filters for older
            records.
          </p>
        )}
      </section>
    </DeliveryNotice.Provider>
  );
}
export function DeliveryHistory({
  schoolId,
  role,
}: {
  schoolId?: Id<"schools">;
  role: Role;
}) {
  const [from, setFrom] = useState(() =>
    addDays(toServiceDate(Date.now()), -6),
  );
  const [to, setTo] = useState(() => toServiceDate(Date.now()));
  const [filter, setFilter] = useState("");
  const schools = useQuery(
    api.deliveries.listSchools,
    role === "school" ? "skip" : {},
  );
  const result = usePaginatedQuery(
    api.deliveryDashboard.history,
    {
      schoolId: schoolId ?? (filter ? (filter as Id<"schools">) : undefined),
      from,
      to,
    },
    { initialNumItems: 10 },
  );
  return (
    <details>
      <summary className={DISCLOSURE_SUMMARY_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Delivery history</h2>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          {!schoolId && (
            <label className="flex min-w-0 flex-col gap-1">
              School filter
              <select
                className={INPUT_CLASS}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All pilot schools</option>
                {schools?.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            History from
            <input
              type="date"
              className={INPUT_CLASS}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            History to
            <input
              type="date"
              className={INPUT_CLASS}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {result.status === "LoadingFirstPage" && (
          <p role="status">Loading history…</p>
        )}
        {result.status !== "LoadingFirstPage" && !result.results.length && (
          <p>No deliveries in this period.</p>
        )}
        {result.results.map((row) => (
          <DeliveryCard key={row._id} delivery={row} role={role} />
        ))}
        {result.status !== "Exhausted" && (
          <button
            type="button"
            disabled={result.status !== "CanLoadMore"}
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => result.loadMore(10)}
          >
            Load more deliveries
          </button>
        )}
      </div>
    </details>
  );
}
export function ForecastPanel({ schoolId }: { schoolId?: Id<"schools"> }) {
  const [date, setDate] = useState(() => addDays(toServiceDate(Date.now()), 1));
  useEffect(() => {
    const timer = setInterval(
      () => setDate(addDays(toServiceDate(Date.now()), 1)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  const rows = useQuery(api.deliveryDashboard.forecasts, {
    schoolId,
    serviceDate: date,
  });
  // Supplier view only: portionGrams is supplier-gated, schools pass a schoolId.
  const grams = useQuery(api.supplier.portionGrams, schoolId ? "skip" : {});
  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_TITLE_CLASS}>Tomorrow’s forecast · {date}</h2>
      {rows === undefined && <p role="status">Loading forecasts…</p>}
      {rows?.length === 0 && <p>No active pilot schools.</p>}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        {rows?.map((row) => (
          <li key={row.schoolId} className={PANEL_CLASS}>
            <h3 className="font-medium">{row.schoolName}</h3>
            <p className="text-3xl font-semibold text-green">
              {row.state === "not_school_day"
                ? "Not a school day"
                : row.state === "unavailable"
                  ? "Forecast unavailable"
                  : `${row.portions} portions`}
            </p>
            {row.state === "available" && grams && (
              <p className="font-medium">
                Cook {kgFromPortions(row.portions!, grams)} kg net food
                <span className={MUTED_CLASS}> · {grams} g per portion</span>
              </p>
            )}
            {row.state === "available" && (
              <p>
                {row.confidence} confidence · updated{" "}
                {receiptTime(row.computedAt!)} EAT
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
export function DeliveryInbox() {
  const rows = useQuery(api.deliveryNotifications.inbox);
  const mark = useMutation(api.deliveryNotifications.markRead);
  const task = useTask();
  const unread = rows?.filter((row) => !row.readAt).length ?? 0;
  return (
    <details>
      <summary className={DISCLOSURE_SUMMARY_CLASS}>
        <h2 className={SECTION_TITLE_CLASS}>Delivery inbox</h2>
        {unread > 0 && (
          <span className={`${MUTED_CLASS} ml-2`}>{unread} unread</span>
        )}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {rows === undefined && <p role="status">Loading notifications…</p>}
        {rows?.length === 0 && <p>No delivery notifications.</p>}
        <ul className="flex flex-col gap-3">
          {rows?.map((row) => (
            <li
              key={row._id}
              className={`${PANEL_CLASS} [overflow-wrap:anywhere]`}
            >
              <p>{row.body}</p>
              <p className={MUTED_CLASS}>
                {receiptTime(row._creationTime)} EAT ·{" "}
                {row.readAt ? "Read" : "Unread"}
              </p>
              {!row.readAt && (
                <button
                  disabled={task.busy}
                  className={SECONDARY_BUTTON_CLASS}
                  onClick={() =>
                    void task.run(async () => {
                      await mark({ id: row._id });
                      return "Notification marked read.";
                    })
                  }
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
        <Feedback task={task} />
      </div>
    </details>
  );
}
export function AdminDeliveryReview() {
  const [notice, setNotice] = useState("");
  const result = usePaginatedQuery(
    api.deliveryDashboard.reviewQueue,
    {},
    { initialNumItems: 10 },
  );
  return (
    <DeliveryNotice.Provider value={setNotice}>
      <section className="flex flex-col gap-4">
        {notice && <p role="status">{notice}</p>}
        <h2 className={SECTION_TITLE_CLASS}>Delivery resolution queue</h2>
        <p>
          Overdue deliveries and quantity disputes.
        </p>
        {result.status === "LoadingFirstPage" && (
          <p role="status">Loading review queue…</p>
        )}
        {!result.results.length && result.status !== "LoadingFirstPage" && (
          <p>No deliveries need review.</p>
        )}
        {result.results.map((row) => (
          <DeliveryCard key={row._id} delivery={row} role="admin" />
        ))}
        {result.status !== "Exhausted" && (
          <button
            disabled={result.status !== "CanLoadMore"}
            onClick={() => result.loadMore(10)}
            className={SECONDARY_BUTTON_CLASS}
          >
            Load more reviews
          </button>
        )}
      </section>
    </DeliveryNotice.Provider>
  );
}
export function OperationalContacts() {
  const data = useQuery(api.deliveryNotifications.contacts);
  const schools = useQuery(api.deliveries.listSchools);
  const failures = useQuery(api.deliveryNotifications.failures);
  const save = useMutation(api.deliveryNotifications.saveContact);
  const retry = useMutation(api.deliveryNotifications.retry);
  const task = useTask();
  const [target, setTarget] = useState("admin");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const audienceLabel = (recipientKey: string) => {
    if (recipientKey === "admin") return "Central admin";
    const [kind, id] = recipientKey.split(":");
    if (kind === "school")
      return schools?.find((s) => s._id === id)?.name ?? "School";
    const supplier = data?.suppliers.find((s) => s._id === id);
    return `Supplier · ${supplier?.displayName ?? "Unknown"}`;
  };
  return (
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_TITLE_CLASS}>Delivery SMS contacts</h2>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void task.run(async () => {
            await save({
              name,
              msisdn: phone,
              active: true,
              schoolId: target.startsWith("school:")
                ? (target.slice(7) as Id<"schools">)
                : undefined,
              supplierId: target.startsWith("supplier:")
                ? (target.slice(9) as Id<"users">)
                : undefined,
            });
            return "Operational contact saved.";
          });
        }}
      >
        <label className="flex flex-col gap-1">
          Audience
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="admin">Central admin</option>
            {schools?.map((s) => (
              <option key={s._id} value={`school:${s._id}`}>
                {s.name}
              </option>
            ))}
            {data?.suppliers.map((s) => (
              <option key={s._id} value={`supplier:${s._id}`}>
                Supplier: {s.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Contact name
          <input
            required
            maxLength={100}
            className={INPUT_CLASS}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          Phone (+254…)
          <input
            type="tel"
            required
            className={INPUT_CLASS}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <button disabled={task.busy} className={BUTTON_CLASS}>
          Save contact
        </button>
      </form>
      <ul className="grid gap-3 md:grid-cols-2">
        {data?.contacts.map((c) => (
          <li
            key={c._id}
            className={`${PANEL_CLASS} flex flex-col gap-3 [overflow-wrap:anywhere]`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold">{c.name}</p>
                <p className={MUTED_CLASS}>{audienceLabel(c.recipientKey)}</p>
              </div>
              <span
                className={c.active ? ACTIVE_BADGE_CLASS : INACTIVE_BADGE_CLASS}
              >
                <span aria-hidden className="size-2 rounded-full bg-current" />
                {c.active ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="font-mono">{c.msisdn}</p>
            <button
              className={SECONDARY_BUTTON_CLASS}
              disabled={task.busy}
              onClick={() =>
                void task.run(async () => {
                  await save({
                    name: c.name,
                    msisdn: c.msisdn,
                    active: !c.active,
                    schoolId: c.recipientKey.startsWith("school:")
                      ? (c.recipientKey.slice(7) as Id<"schools">)
                      : undefined,
                    supplierId: c.recipientKey.startsWith("supplier:")
                      ? (c.recipientKey.slice(9) as Id<"users">)
                      : undefined,
                  });
                  return "Contact updated.";
                })
              }
            >
              {c.active ? "Deactivate contact" : "Activate contact"}
            </button>
          </li>
        ))}
      </ul>
      <h3 className={SECTION_TITLE_CLASS}>SMS send failures</h3>
      {failures?.length === 0 && <p>No failed delivery messages.</p>}
      <ul className="flex flex-col gap-3">
        {failures?.map((f) => (
          <li key={f._id} className={`${PANEL_CLASS} [overflow-wrap:anywhere]`}>
            <p className="font-semibold">{audienceLabel(f.recipientKey)}</p>
            <p>{f.body}</p>
            <p className="text-sm font-medium text-error">{f.failureReason}</p>
            <button
              disabled={task.busy}
              className={SECONDARY_BUTTON_CLASS}
              onClick={() =>
                void task.run(async () => {
                  await retry({ smsId: f._id });
                  return "SMS retry queued.";
                })
              }
            >
              Retry SMS
            </button>
          </li>
        ))}
      </ul>
      <Feedback task={task} />
    </section>
  );
}
