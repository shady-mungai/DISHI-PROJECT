"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { normaliseTagUid } from "@/convex/lib/tagUid";
import { useMutation, useQuery } from "convex/react";
import type { FormEvent } from "react";
import { useCallback, useState } from "react";
import type { IngestResult, ReaderDevice } from "./useReader";
import { useNfcScanner, useReaderDevice, useTapQueue } from "./useReader";

const PAGE_CLASS = "flex flex-1 flex-col gap-4 p-4 max-w-md mx-auto w-full";
const FILLED_CLASS = "bg-black text-white dark:bg-white dark:text-black";
const PRIMARY_BUTTON_CLASS = `rounded px-4 py-3 text-lg disabled:opacity-50 ${FILLED_CLASS}`;
const SECONDARY_BUTTON_CLASS = "rounded border border-zinc-300 px-3 py-2 text-zinc-500 dark:border-zinc-700";
const ACTIVE_TAB_CLASS = `rounded px-3 py-2 ${FILLED_CLASS}`;
const INPUT_CLASS = "rounded border border-zinc-300 px-3 py-2 w-full";
const RESULT_CLASS = "rounded border border-zinc-200 p-4 text-center";
const MUTED_CLASS = "text-sm text-zinc-500";

type Mode = "serve" | "assign";

export default function ReaderPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const [device, setDevice] = useReaderDevice();
  const provision = useMutation(api.readers.provision);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  async function register() {
    try {
      setDevice(await provision({ schoolId }));
    } catch (caught) {
      setProvisionError(caught instanceof Error ? caught.message : "Could not register this phone");
    }
  }

  if (!device) {
    return (
      <div className={PAGE_CLASS}>
        <h1 className="text-xl font-semibold">Dishi Reader</h1>
        <p className={MUTED_CLASS}>This phone is not registered as a reader for your school yet.</p>
        <button type="button" onClick={register} className={PRIMARY_BUTTON_CLASS}>
          Register this phone
        </button>
        {provisionError && <p className="text-sm text-red-600">{provisionError}</p>}
      </div>
    );
  }

  return <Scanner schoolId={schoolId} device={device} />;
}

function Scanner({ schoolId, device }: { schoolId: Id<"schools">; device: ReaderDevice }) {
  const [mode, setMode] = useState<Mode>("serve");
  const [scannedUid, setScannedUid] = useState<string | null>(null);
  const students = useQuery(api.readers.activeStudents, { schoolId });
  const { queue, lastResults, flushError, enqueue } = useTapQueue(device);

  const handleTag = useCallback(
    (rawUid: string) => {
      const tagUid = normaliseTagUid(rawUid);
      setScannedUid(tagUid);
      if (mode === "serve") {
        enqueue(tagUid);
      }
    },
    [mode, enqueue],
  );

  const { supported, scanning, scanError, startScanning } = useNfcScanner(handleTag);
  const nameByTag = new Map((students ?? []).filter((s) => s.tagUid).map((s) => [s.tagUid, s.fullName]));

  return (
    <div className={PAGE_CLASS}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dishi Reader</h1>
        <span className={MUTED_CLASS}>{queue.length > 0 ? `${queue.length} queued` : "synced"}</span>
      </div>

      <div className="flex gap-2">
        <button type="button" aria-pressed={mode === "serve"} onClick={() => setMode("serve")} className={mode === "serve" ? ACTIVE_TAB_CLASS : SECONDARY_BUTTON_CLASS}>
          Serve
        </button>
        <button type="button" aria-pressed={mode === "assign"} onClick={() => setMode("assign")} className={mode === "assign" ? ACTIVE_TAB_CLASS : SECONDARY_BUTTON_CLASS}>
          Assign tag
        </button>
      </div>

      {!supported && <ManualUidInput onSubmit={handleTag} />}
      {supported && !scanning && (
        <button type="button" onClick={startScanning} className={PRIMARY_BUTTON_CLASS}>
          Start scanning
        </button>
      )}
      {scanning && <p className={RESULT_CLASS}>Hold a tag to the back of the phone</p>}
      {scanError && <p className="text-sm text-red-600">{scanError}</p>}
      {flushError && <p className="text-sm text-amber-600">Offline — taps are queued ({flushError})</p>}

      {mode === "serve" && <LastResult results={lastResults} nameByTag={nameByTag} />}
      {mode === "assign" && scannedUid && (
        <AssignForm schoolId={schoolId} tagUid={scannedUid} students={students ?? []} />
      )}

      <p className={MUTED_CLASS}>Reader {device.deviceRef.split(":")[0]}</p>
    </div>
  );
}

function ManualUidInput({ onSubmit }: { onSubmit: (uid: string) => void }) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(value);
    setValue("");
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className={MUTED_CLASS}>Web NFC needs Chrome on Android. Type or paste a tag UID instead.</p>
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="04:a3:b2:c1:d5:e6:80" className={INPUT_CLASS} />
      <button type="submit" className={PRIMARY_BUTTON_CLASS}>
        Submit tag
      </button>
    </form>
  );
}

function LastResult({ results, nameByTag }: { results: IngestResult[]; nameByTag: Map<string | undefined, string> }) {
  const last = results.at(-1);
  if (!last) {
    return null;
  }
  const name = nameByTag.get(last.tagUid) ?? "Unknown tag";
  return (
    <div className={RESULT_CLASS}>
      <p className="text-2xl font-semibold">{last.status}</p>
      <p>{name}</p>
      {last.reason && <p className={MUTED_CLASS}>{last.reason}</p>}
    </div>
  );
}

function AssignForm({
  schoolId,
  tagUid,
  students,
}: {
  schoolId: Id<"schools">;
  tagUid: string;
  students: Array<{ _id: Id<"students">; fullName: string; className: string; tagUid?: string }>;
}) {
  const assignTag = useMutation(api.readers.assignTag);
  const [studentId, setStudentId] = useState<Id<"students"> | "">("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId) {
      return;
    }
    try {
      await assignTag({ schoolId, studentId, tagUid });
      setMessage(`Tag assigned to ${students.find((s) => s._id === studentId)?.fullName}`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not assign tag");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className={RESULT_CLASS}>{tagUid}</p>
      <select value={studentId} onChange={(event) => setStudentId(event.target.value as Id<"students">)} className={INPUT_CLASS} required>
        <option value="">Choose a child</option>
        {students.map((student) => (
          <option key={student._id} value={student._id}>
            {student.fullName} · {student.className}
            {student.tagUid ? " (has tag)" : ""}
          </option>
        ))}
      </select>
      <button type="submit" className={PRIMARY_BUTTON_CLASS}>
        Assign
      </button>
      {message && <p className={MUTED_CLASS}>{message}</p>}
    </form>
  );
}
