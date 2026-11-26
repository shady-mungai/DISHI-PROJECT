"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "@/app/components/DateLink";
import type { FormEvent } from "react";
import { useState } from "react";
import {
  BUTTON_CLASS,
  INPUT_CLASS,
  SECONDARY_BUTTON_CLASS,
  DISCLOSURE_SUMMARY_CLASS,
  SECTION_TITLE_CLASS,
} from "@/app/components/ui";
import { showError } from "@/app/lib/errors";

const DEFAULT_RELATIONSHIP = "guardian";

// SC-06: left / joined here, tag reissue on /reader. All take effect on the
// next day's expectations.
export function RosterPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const students = useQuery(api.readers.activeStudents, { schoolId });
  const deactivate = useMutation(api.roster.deactivate);
  const join = useMutation(api.roster.join);
  const [leavingId, setLeavingId] = useState<Id<"students"> | "">("");
  const [reason, setReason] = useState("");
  const [fullName, setFullName] = useState("");
  const [className, setClassName] = useState("");
  const [guardianMsisdn, setGuardianMsisdn] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      setMessage(await action());
    } catch (caught) {
      setMessage(null);
      showError(caught, "The roster was not changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function markLeft() {
    if (leavingId === "") {
      return;
    }
    if (
      !window.confirm(
        "Mark this pupil as left? They will no longer be expected from tomorrow.",
      )
    )
      return;
    await run(async () => {
      const result = await deactivate({
        schoolId,
        studentId: leavingId,
        reason,
      });
      setLeavingId("");
      setReason("");
      return result === "deactivated"
        ? "Marked as left — no expectation from tomorrow."
        : "Already inactive.";
    });
  }

  async function addStudent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await run(async () => {
      await join({
        schoolId,
        fullName,
        className,
        guardianMsisdn,
        guardianRelationship: DEFAULT_RELATIONSHIP,
      });
      setFullName("");
      setClassName("");
      setGuardianMsisdn("");
      return "Added — expected from tomorrow. Assign a tag on the reader page.";
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_TITLE_CLASS}>Active pupils</h2>
      <p>Roster changes take effect in tomorrow’s expectations.</p>
      <ul className="flex flex-col gap-2">
        {students?.map((student) => (
          <li key={student._id} className="rounded-control bg-cream-light p-3">
            {student.fullName} · {student.className}
          </li>
        ))}
      </ul>
      {students?.length === 0 && <p>No active pupils.</p>}
      <details>
        <summary className={DISCLOSURE_SUMMARY_CLASS}>
          <h2 className={SECTION_TITLE_CLASS}>Roster corrections</h2>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span>Child who left</span>
              <select
                value={leavingId}
                onChange={(e) => setLeavingId(e.target.value as Id<"students">)}
                className={INPUT_CLASS}
              >
                <option value="">Child who left</option>
                {students?.map((student) => (
                  <option key={student._id} value={student._id}>
                    {student.fullName} ({student.className})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>Reason</span>
              <input
                placeholder="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <button
              type="button"
              disabled={busy || leavingId === "" || !reason}
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => void markLeft()}
            >
              Mark as left
            </button>
          </div>
          <form
            onSubmit={addStudent}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <label className="flex flex-col gap-1">
              <span>New child&apos;s name</span>
              <input
                required
                placeholder="New child's name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>Class</span>
              <input
                required
                placeholder="Class"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>Guardian phone</span>
              <input
                required
                placeholder="Guardian phone"
                value={guardianMsisdn}
                onChange={(e) => setGuardianMsisdn(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <button type="submit" disabled={busy} className={BUTTON_CLASS}>
              Add child
            </button>
          </form>
          <p className="text-sm text-ink/80">
            Tag lost or reissued?{" "}
            <Link href="/reader" className="underline">
              Assign a tag on the reader page
            </Link>
            .
          </p>
        </div>
      </details>
      {message && (
        <p role="status" className="text-sm text-ink/80">
          {message}
        </p>
      )}
    </section>
  );
}
