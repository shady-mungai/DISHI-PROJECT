"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toServiceDate } from "@/convex/lib/dates";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  BUTTON_CLASS,
  INPUT_CLASS,
  MUTED_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
} from "@/app/components/ui";
import { showError } from "@/app/lib/errors";

const ALL_CLASSES = "";

function useRegister(schoolId: Id<"schools">) {
  const [serviceDate] = useState(() => toServiceDate(Date.now()));
  const students = useQuery(api.readers.activeStudents, { schoolId });
  const saved = useQuery(api.attendance.forDay, { schoolId, serviceDate });
  const submit = useMutation(api.attendance.submit);
  const [edits, setEdits] = useState<Set<Id<"students">> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const absent = edits ?? new Set(saved?.absentStudentIds ?? []);

  function toggle(studentId: Id<"students">) {
    const next = new Set(absent);
    if (!next.delete(studentId)) next.add(studentId);
    setEdits(next);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await submit({ schoolId, absentStudentIds: [...absent] });
      setEdits(null);
      setMessage(`Register saved for ${result.serviceDate}: ${result.absent} absent, everyone else present.`);
    } catch (caught) {
      setMessage(null);
      showError(caught, "Register not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return { serviceDate, students, saved, absent, toggle, save, busy, message };
}

export function RegisterPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const register = useRegister(schoolId);
  const [className, setClassName] = useState(ALL_CLASSES);
  const classes = [...new Set(register.students?.map((student) => student.className))].sort();
  const shown = register.students?.filter((student) => className === ALL_CLASSES || student.className === className);

  return (
    <section className="flex flex-col gap-3" aria-label="Attendance register">
      <h2 className={SECTION_TITLE_CLASS}>Register for {register.serviceDate}</h2>
      <p className={MUTED_CLASS}>
        Everyone is present unless ticked. Tick only absent pupils, then save
        before the meal cutoff. A pupil who taps for lunch counts as present.
      </p>
      <p role="status" className={MUTED_CLASS}>
        {register.saved
          ? `Last saved ${new Date(register.saved.takenAt).toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi" })}.`
          : "Not taken yet today."}{" "}
        {register.absent.size} marked absent.
      </p>
      <label className="flex flex-col gap-1">
        Class
        <select value={className} onChange={(e) => setClassName(e.target.value)} className={INPUT_CLASS}>
          <option value={ALL_CLASSES}>All classes</option>
          {classes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {!shown ? (
        <p role="status">Loading pupils…</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((student) => (
            <li key={student._id} className={ROW_CLASS}>
              <label className="flex flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={register.absent.has(student._id)}
                  onChange={() => register.toggle(student._id)}
                />
                <span className="flex-1">{student.fullName}</span>
                <span className={MUTED_CLASS}>{student.className}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={register.busy || !register.students} className={BUTTON_CLASS} onClick={() => void register.save()}>
        Save register
      </button>
      {register.message && <p role="status">{register.message}</p>}
    </section>
  );
}
