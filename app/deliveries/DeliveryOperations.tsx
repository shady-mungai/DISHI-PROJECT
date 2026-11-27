"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { authClient } from "@/app/auth-client";
import { convexSiteUrl } from "@/app/lib/convex-urls";
import { addDays, toServiceDate } from "@/convex/lib/dates";
import {
  ALERT_CLASS,
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
async function photoFetch(query: string, init?: RequestInit) {
  const { data } = await authClient.convex.token({
    fetchOptions: { throw: false },
  });
  if (!data?.token) throw new Error("Sign in again to access delivery photos.");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${data.token}`);
  return await fetch(`${convexSiteUrl}/delivery-photo${query}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export function SupplierDispatch() {
  const schools = useQuery(api.deliveries.listSchools);
  const dispatch = useMutation(api.deliveryWorkflow.dispatch);
  const recentDishes = useQuery(api.supplier.recentDishes);
  const task = useTask();
  const key = useRequestId();
  const [schoolId, setSchool] = useState("");
  const [containers, setContainers] = useState("");
  const [netKg, setNetKg] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [dish, setDish] = useState("");
  const [result, setResult] = useState<{
    reference: string;
    portions: number;
    expectedArrivalAt: number;
  } | null>(null);
  return (
    <section className="flex flex-col gap-4">
      <h1 className={TITLE_CLASS}>Dispatch a delivery</h1>
      <p>
        Arrival is expected within 30 minutes. The school records and confirms
        what it receives.
      </p>
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
              dish,
            };
            const sent = await dispatch({ ...input, requestId: key(input) });
            setResult(sent);
            setContainers("");
            setNetKg("");
            return "Dispatch recorded. School notification queued.";
          });
        }}
      >
        <label className="flex min-w-0 flex-col gap-1">
          School
          <select
            required
            value={schoolId}
            onChange={(e) => setSchool(e.target.value)}
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
          Dish served
          <input
            maxLength={60}
            list="recent-dishes"
            placeholder="e.g. githeri"
            value={dish}
            onChange={(e) => setDish(e.target.value)}
            className={INPUT_CLASS}
          />
          <datalist id="recent-dishes">
            {recentDishes?.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <button
          disabled={task.busy || !schools?.length}
          className={BUTTON_CLASS}
        >
          Dispatch delivery
        </button>
      </form>
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

function ReceiptForm({ delivery }: { delivery: Delivery }) {
  const notify = useContext(DeliveryNotice);
  const submit = useMutation(api.deliveryWorkflow.submitReceipt);
  const requestCode = useMutation(api.deliveryWorkflow.requestCode);
  const task = useTask();
  const key = useRequestId();
  const uploadId = useRef("");
  const [portions, setPortions] = useState(
    delivery.portionsReceived?.toString() ?? "",
  );
  const [problem, setProblem] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [evidenceId, setEvidence] = useState<Id<"deliveryEvidence"> | null>(
    null,
  );
  const [fallback, setFallback] = useState<{
    code: string | null;
    expiresAt: number;
  } | null>(null);
  const [reportProblem, setReportProblem] = useState(false);
  async function record(fallbackOnly: boolean) {
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
    if (fallbackOnly) {
      const result = await requestCode({
        ...input,
        requestId: crypto.randomUUID(),
      });
      setFallback(result);
      return "Quantities recorded. Give this single-use code to the supplier. A new code replaces the previous code.";
    }
    let evidence = evidenceId;
    if (!evidence) {
      if (!file)
        throw new Error(
          "Choose a delivery photo, or request a receipt code below.",
        );
      if (
        file.size > 10 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw new Error(
          "Choose a JPEG, PNG or WebP photo no larger than 10 MB. You can request a code if upload is unavailable.",
        );
      if (!uploadId.current) uploadId.current = crypto.randomUUID();
      const response = await photoFetch("", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Delivery-Id": delivery._id,
          "X-Request-Id": uploadId.current,
        },
        body: file,
      });
      const body = (await response.json()) as {
        error?: string;
        evidenceId?: Id<"deliveryEvidence">;
      };
      if (!response.ok || !body.evidenceId)
        throw new Error(
          body.error ??
            "Upload failed. Retry with the same photo or request a receipt code.",
        );
      evidence = body.evidenceId;
      setEvidence(evidence);
    }
    const result = await submit({
      ...input,
      evidenceId: evidence,
      requestId: key({ ...input, evidence }),
    });
    const message =
      result.status === "confirmed"
        ? "Delivery confirmed. Photo review runs separately."
        : "Receipt recorded. Central admin will resolve the discrepancy or reported problem.";
    notify?.(message);
    return message;
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void task.run(() => record(false));
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
      <label className="flex min-w-0 flex-col gap-1">
        Receipt photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setEvidence(null);
            uploadId.current = "";
          }}
          className={`${INPUT_CLASS} w-full min-w-0`}
          aria-describedby={`photo-help-${delivery._id}`}
        />
      </label>
      <p id={`photo-help-${delivery._id}`} className={MUTED_CLASS}>
        JPEG, PNG or WebP, up to 10 MB. Photograph the delivered food. Avoid
        including children or personal documents.
      </p>
      <button disabled={task.busy} className={BUTTON_CLASS}>
        {reportProblem
          ? "Submit receipt and report problem"
          : "Confirm received quantities"}
      </button>
      <p className={MUTED_CLASS}>
        A quantity difference goes to central admin for resolution. Photo
        assessment does not certify quantity or food safety.
      </p>
      <div className="border-t border-green/30 pt-3">
        <p className="mb-2">Photo upload unavailable?</p>
        <button
          type="button"
          disabled={task.busy}
          className={SECONDARY_BUTTON_CLASS}
          onClick={() => void task.run(() => record(true))}
        >
          {fallback
            ? "Replace receipt code"
            : "Record quantities and request code"}
        </button>
      </div>
      <Feedback task={task} />
      {fallback && (
        <div className={PANEL_CLASS}>
          <p className={CODE_CLASS}>
            {fallback.code ?? "Request a replacement code"}
          </p>
          <p>
            Expires {receiptTime(fallback.expiresAt)} EAT. The supplier enters
            it against this delivery. Missing photo evidence remains open for
            review.
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
function PrivatePhoto({ id }: { id: Id<"deliveryEvidence"> }) {
  const [url, setUrl] = useState("");
  const task = useTask();
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={task.busy}
        className={SECONDARY_BUTTON_CLASS}
        onClick={() =>
          void task.run(async () => {
            const response = await photoFetch(`?id=${encodeURIComponent(id)}`);
            if (!response.ok)
              throw new Error("Photo could not be loaded. Try again.");
            setUrl(URL.createObjectURL(await response.blob()));
            return "Photo loaded.";
          })
        }
      >
        View receipt photo
      </button>
      <Feedback task={task} />
      {url && (
        // Private authenticated blob URLs must stay in this browser.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Food photographed by the receiving school"
          width={640}
          height={480}
          className="max-h-96 w-full rounded-control object-contain"
        />
      )}
    </div>
  );
}
function AdminDecision({ delivery }: { delivery: Delivery }) {
  const notify = useContext(DeliveryNotice);
  const resolve = useMutation(api.deliveryWorkflow.resolve);
  const retry = useMutation(api.deliveryAssessment.retry);
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
        file. Photo flags alone never change eligibility.
      </p>
      <label className="flex flex-col gap-1">
        Decision
        <select
          className={INPUT_CLASS}
          value={decision}
          onChange={(e) => setDecision(e.target.value as typeof decision)}
        >
          <option value="reviewed">
            Close evidence review; keep delivery status
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
      {delivery.photoReview === "failed" && (
        <button
          type="button"
          disabled={task.busy || !reason.trim()}
          className={SECONDARY_BUTTON_CLASS}
          onClick={() =>
            void task.run(async () => {
              await retry({ deliveryId: delivery._id, reason });
              return "Photo assessment queued again.";
            })
          }
        >
          Retry photo assessment
        </button>
      )}
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
      {delivery.evidenceId && role !== "county" && (
        <PrivatePhoto id={delivery.evidenceId} />
      )}
      {delivery.reportedProblem && (
        <p className={ALERT_CLASS}>
          Reported problem: {delivery.reportedProblem}
        </p>
      )}
      {delivery.photoReview && (
        <div>
          <p>
            Photo review: <strong>{delivery.photoReview}</strong> ·{" "}
            {delivery.photoAttempts ?? 0} attempt(s)
          </p>
          <p className={MUTED_CLASS}>
            {delivery.photoModel}
            {delivery.photoAssessedAt
              ? ` · ${receiptTime(delivery.photoAssessedAt)} EAT`
              : ""}
          </p>
          {delivery.photoFindings && (
            <>
              <p>{delivery.photoFindings.description}</p>
              <p>
                Food visible:{" "}
                {delivery.photoFindings.foodVisible ? "yes" : "no"}; clarity:{" "}
                {delivery.photoFindings.clarity}; unrelated content:{" "}
                {delivery.photoFindings.unrelatedContent ? "yes" : "no"}.
              </p>
            </>
          )}
          {delivery.photoError && <p>{delivery.photoError}</p>}
        </div>
      )}
      {detail?.codeExpiresAt && (
        <p>Fallback code expires {receiptTime(detail.codeExpiresAt)} EAT.</p>
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
      {delivery.missingEvidence && (
        <p className={ALERT_CLASS}>
          Photo evidence missing
          {delivery.reviewResolvedAt
            ? " · reviewed by admin"
            : " · review needed"}
        </p>
      )}
      {delivery.photoReview && <p>Photo assessment: {delivery.photoReview}</p>}
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
          Overdue deliveries, quantity disputes, missing photos and failed or
          flagged assessments.
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
      <ul className="flex flex-col gap-3">
        {data?.contacts.map((c) => (
          <li key={c._id} className={`${PANEL_CLASS} [overflow-wrap:anywhere]`}>
            <p>
              {c.name} · {c.msisdn} · {c.recipientKey} ·{" "}
              {c.active ? "Active" : "Inactive"}
            </p>
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
            <p>{f.body}</p>
            <p>
              {f.recipientKey}: {f.failureReason}
            </p>
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
