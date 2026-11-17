"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { normaliseTagUid } from "@/convex/lib/tagUid";
import { useMutation, useQuery } from "convex/react";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { IngestResult, ReaderDevice } from "./useReader";
import { useNfcScanner, useReaderDevice, useTapQueue } from "./useReader";
import {
  BUTTON_CLASS,
  INPUT_CLASS,
  MUTED_CLASS,
  PAGE_CLASS,
  PANEL_CLASS,
  SECONDARY_BUTTON_CLASS,
  TITLE_CLASS,
} from "@/app/components/ui";

type Mode = "serve" | "assign";

export default function ReaderPanel({ schoolId }: { schoolId: Id<"schools"> }) {
  const [device, setDevice] = useReaderDevice();
  const provision = useMutation(api.readers.provision);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  async function register() {
    setRegistering(true);
    try {
      setDevice(await provision({ schoolId }));
    } catch (caught) {
      setProvisionError(
        caught instanceof Error
          ? caught.message
          : "Could not register this phone",
      );
    } finally {
      setRegistering(false);
    }
  }

  if (!device) {
    return (
      <div className={PAGE_CLASS}>
        <h1 className={TITLE_CLASS}>Dishi Reader</h1>
        <p className={MUTED_CLASS}>
          This phone is not registered as a reader for your school yet.
        </p>
        <button type="button" onClick={register} className={BUTTON_CLASS}>
          {registering ? "Registering…" : "Register this phone"}
        </button>
        {provisionError && (
          <p className="text-sm text-error">{provisionError}</p>
        )}
      </div>
    );
  }

  return <Scanner schoolId={schoolId} device={device} />;
}

function Scanner({
  schoolId,
  device,
}: {
  schoolId: Id<"schools">;
  device: ReaderDevice;
}) {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.get("mode") === "assign" ? "assign" : "serve",
  );
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

  const { supported, scanning, scanError, startScanning } =
    useNfcScanner(handleTag);
  const nameByTag = new Map(
    (students ?? []).filter((s) => s.tagUid).map((s) => [s.tagUid, s.fullName]),
  );

  return (
    <div className={PAGE_CLASS}>
      <div className="flex items-center justify-between">
        <h1 className={TITLE_CLASS}>Dishi Reader</h1>
        <span className={MUTED_CLASS}>
          {queue.length > 0 ? `${queue.length} queued` : "synced"}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={mode === "serve"}
          onClick={() => setMode("serve")}
          className={mode === "serve" ? BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
        >
          Serve
        </button>
        <button
          type="button"
          aria-pressed={mode === "assign"}
          onClick={() => setMode("assign")}
          className={mode === "assign" ? BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
        >
          Assign tag
        </button>
      </div>

      <details>
        <summary className="min-h-11">Enter a tag UID manually</summary>
        <ManualUidInput onSubmit={handleTag} />
      </details>
      {supported && !scanning && (
        <button type="button" onClick={startScanning} className={BUTTON_CLASS}>
          Start scanning
        </button>
      )}
      {scanning && (
        <p role="status" className={`${PANEL_CLASS} text-3xl font-semibold`}>
          Hold a tag to the back of the phone
        </p>
      )}
      {scanError && <p className="text-sm text-error">{scanError}</p>}
      {flushError && (
        <p className="border-2 border-orange p-3 text-ink">
          Offline — taps are queued ({flushError})
        </p>
      )}

      {mode === "serve" && (
        <LastResult results={lastResults} nameByTag={nameByTag} />
      )}
      {mode === "assign" && scannedUid && (
        <AssignForm
          schoolId={schoolId}
          tagUid={scannedUid}
          students={students ?? []}
        />
      )}

      <p>
        Queued taps are waiting for server confirmation. They are not yet
        accepted meals.
      </p>
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
      <p className={MUTED_CLASS}>
        Web NFC needs Chrome on Android. Type or paste a tag UID instead.
      </p>
      <label className="flex flex-col gap-1">
        <span>04:a3:b2:c1:d5:e6:80</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="04:a3:b2:c1:d5:e6:80"
          className={INPUT_CLASS}
        />
      </label>
      <button type="submit" className={BUTTON_CLASS}>
        Submit tag
      </button>
    </form>
  );
}

function LastResult({
  results,
  nameByTag,
}: {
  results: IngestResult[];
  nameByTag: Map<string | undefined, string>;
}) {
  const last = results.at(-1);
  if (!last) {
    return null;
  }
  const name = nameByTag.get(last.tagUid) ?? "Unknown tag";
  return (
    <div role="status" aria-live="polite" className={PANEL_CLASS}>
      <p className="text-4xl font-semibold text-green">{last.status}</p>
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
  students: Array<{
    _id: Id<"students">;
    fullName: string;
    className: string;
    tagUid?: string;
  }>;
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
      setMessage(
        `Tag assigned to ${students.find((s) => s._id === studentId)?.fullName}`,
      );
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not assign tag",
      );
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className={PANEL_CLASS}>{tagUid}</p>
      <label className="flex flex-col gap-1">
        <span>Choose a child</span>
        <select
          value={studentId}
          onChange={(event) =>
            setStudentId(event.target.value as Id<"students">)
          }
          className={INPUT_CLASS}
          required
        >
          <option value="">Choose a child</option>
          {students.map((student) => (
            <option key={student._id} value={student._id}>
              {student.fullName} · {student.className}
              {student.tagUid ? " (has tag)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={BUTTON_CLASS}>
        Assign
      </button>
      {message && <p className={MUTED_CLASS}>{message}</p>}
    </form>
  );
}
