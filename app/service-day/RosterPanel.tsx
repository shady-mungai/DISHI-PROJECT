"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

const BUTTON_CLASS = "rounded bg-black px-3 py-2 text-white disabled:opacity-50";
const SECONDARY_BUTTON_CLASS = "rounded border border-zinc-300 px-3 py-2 disabled:opacity-50";
const INPUT_CLASS = "rounded border border-zinc-300 px-3 py-2";
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
      setMessage(caught instanceof Error ? caught.message : "Roster change failed");
    } finally {
      setBusy(false);
    }
  }

  async function markLeft() {
    if (leavingId === "") {
      return;
    }
    await run(async () => {
      const result = await deactivate({ schoolId, studentId: leavingId, reason });
      setLeavingId("");
      setReason("");
      return result === "deactivated" ? "Marked as left — no expectation from tomorrow." : "Already inactive.";
    });
  }

  async function addStudent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await run(async () => {
      await join({ schoolId, fullName, className, guardianMsisdn, guardianRelationship: DEFAULT_RELATIONSHIP });
      setFullName("");
      setClassName("");
      setGuardianMsisdn("");
      return "Added — expected from tomorrow. Assign a tag on the reader page.";
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Roster corrections</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={leavingId} onChange={(e) => setLeavingId(e.target.value as Id<"students">)} className={INPUT_CLASS}>
          <option value="">Child who left</option>
          {students?.map((student) => (
            <option key={student._id} value={student._id}>
              {student.fullName} ({student.className})
            </option>
          ))}
        </select>
        <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT_CLASS} />
        <button type="button" disabled={busy || leavingId === "" || !reason} className={SECONDARY_BUTTON_CLASS} onClick={() => void markLeft()}>
          Mark as left
        </button>
      </div>
      <form onSubmit={addStudent} className="flex flex-wrap items-center gap-3 text-sm">
        <input required placeholder="New child's name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={INPUT_CLASS} />
        <input required placeholder="Class" value={className} onChange={(e) => setClassName(e.target.value)} className={INPUT_CLASS} />
        <input required placeholder="Guardian phone" value={guardianMsisdn} onChange={(e) => setGuardianMsisdn(e.target.value)} className={INPUT_CLASS} />
        <button type="submit" disabled={busy} className={BUTTON_CLASS}>
          Add child
        </button>
      </form>
      <p className="text-sm text-zinc-500">
        Tag lost or reissued? <Link href="/reader" className="underline">Assign a tag on the reader page</Link>.
      </p>
      {message && <p className="text-sm text-zinc-600">{message}</p>}
    </section>
  );
}
