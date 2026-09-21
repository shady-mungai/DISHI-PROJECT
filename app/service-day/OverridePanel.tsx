"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { BUTTON_CLASS, INPUT_CLASS, SECTION_TITLE_CLASS } from "@/app/components/ui";

const OVER_TOLERANCE_CLASS = "text-error";

const REASON_CODES = [
  { value: "forgotten_tag", label: "Forgotten tag" },
  { value: "lost_tag", label: "Lost tag" },
  { value: "damaged_tag", label: "Damaged tag" },
  { value: "reader_down", label: "Reader down" },
] as const;

type ReasonCode = (typeof REASON_CODES)[number]["value"];

// SC-05 / SC-07: pick a child, pick a reason, one tap — and the school's own
// override rate sits next to the form.
export function OverridePanel({ schoolId, serviceDate }: { schoolId: Id<"schools">; serviceDate: string }) {
  const students = useQuery(api.readers.activeStudents, { schoolId });
  const rate = useQuery(api.overrides.rateForSchool, { schoolId, to: serviceDate });
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
      setMessage(result.status === "served" ? "Served by override." : "Already served today — nothing recorded.");
      setStudentId("");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Override failed");
    } finally {
      setBusy(false);
    }
  }

  const overTolerance = rate !== undefined && rate.ratePct > rate.tolerancePct;

  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>Staff override</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={studentId} onChange={(e) => setStudentId(e.target.value as Id<"students">)} className={INPUT_CLASS}>
          <option value="">Choose child</option>
          {students?.map((student) => (
            <option key={student._id} value={student._id}>
              {student.fullName} ({student.className})
            </option>
          ))}
        </select>
        <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ReasonCode)} className={INPUT_CLASS}>
          {REASON_CODES.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy || studentId === ""} className={BUTTON_CLASS} onClick={() => void submit()}>
          Serve
        </button>
      </div>
      {message && <p className="text-sm text-ink/70">{message}</p>}
      {rate && (
        <p className={`text-sm ${overTolerance ? OVER_TOLERANCE_CLASS : "text-ink/60"}`}>
          Override rate {rate.ratePct}% ({rate.overrides} of {rate.served} meals, {rate.from} → {rate.to}); tolerance {rate.tolerancePct}%
        </p>
      )}
    </section>
  );
}
