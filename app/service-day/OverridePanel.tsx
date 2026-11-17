"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  BUTTON_CLASS,
  INPUT_CLASS,
  SECTION_TITLE_CLASS,
} from "@/app/components/ui";

const OVER_TOLERANCE_CLASS = "font-medium text-ink";

const REASON_CODES = [
  { value: "forgotten_tag", label: "Forgotten tag" },
  { value: "lost_tag", label: "Lost tag" },
  { value: "damaged_tag", label: "Damaged tag" },
  { value: "reader_down", label: "Reader down" },
] as const;

type ReasonCode = (typeof REASON_CODES)[number]["value"];

// SC-05 / SC-07: pick a child, pick a reason, one tap — and the school's own
// override rate sits next to the form.
export function OverridePanel({
  schoolId,
  serviceDate,
}: {
  schoolId: Id<"schools">;
  serviceDate: string;
}) {
  const students = useQuery(api.readers.activeStudents, { schoolId });
  const rate = useQuery(api.overrides.rateForSchool, {
    schoolId,
    to: serviceDate,
  });
  const serve = useMutation(api.overrides.serve);
  const [studentId, setStudentId] = useState<Id<"students"> | "">("");
  const [reasonCode, setReasonCode] = useState<ReasonCode>("forgotten_tag");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (studentId === "") {
      return;
    }
    setBusy(true);
    try {
      const result = await serve({ schoolId, studentId, reasonCode });
      setMessage(
        result.status === "served"
          ? "Served by override."
          : "Already served today — nothing recorded.",
      );
      setStudentId("");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Override failed");
    } finally {
      setBusy(false);
    }
  }

  const overTolerance = rate !== undefined && rate.ratePct > rate.tolerancePct;

  return (
    <section className="flex flex-col gap-4 rounded-panel border border-primary/20 bg-surface p-5 md:p-6">
      <h2 className={SECTION_TITLE_CLASS}>Record a meal · staff override</h2>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="flex min-w-0 flex-col gap-2">
          Child
          <select
            name="studentId"
            required
            disabled={busy}
            value={studentId}
            onChange={(e) => setStudentId(e.target.value as Id<"students">)}
            className={`${INPUT_CLASS} w-full`}
          >
            <option value="">Choose child</option>
            {students?.map((student) => (
              <option key={student._id} value={student._id}>
                {student.fullName} ({student.className})
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-2">
          Reason
          <select
            name="reasonCode"
            disabled={busy}
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as ReasonCode)}
            className={`${INPUT_CLASS} w-full`}
          >
            {REASON_CODES.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || studentId === ""}
          className={BUTTON_CLASS}
        >
          {busy ? "Recording meal…" : "Record meal"}
        </button>
      </form>
      {message && (
        <p role="status" className="text-sm text-ink/80">
          {message}
        </p>
      )}
      {rate && (
        <p
          className={`text-sm ${overTolerance ? OVER_TOLERANCE_CLASS : "text-ink/80"}`}
        >
          Override rate {rate.ratePct}% ({rate.overrides} of {rate.served}{" "}
          meals, {rate.from} → {rate.to}); tolerance {rate.tolerancePct}%
        </p>
      )}
    </section>
  );
}
