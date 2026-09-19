"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

const ROW_CLASS = "flex flex-wrap gap-3 rounded border border-zinc-200 px-3 py-2";
const SILENT_CLASS = "font-semibold text-red-600";
const CLOCK_TICK_MS = 60_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// SC-04: silence is decided here from lastSeenAt + the server's window, so
// the query stays cacheable; the cron emits the event before the window opens.
export function ReaderHealth({ schoolId }: { schoolId: Id<"schools"> }) {
  const readers = useQuery(api.readers.fleet, { schoolId });
  const now = useNow();
  const silent = readers?.filter((reader) => reader.lastSeenAt !== undefined && now - reader.lastSeenAt > reader.silentAfterMs) ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Readers</h2>
      {silent.length > 0 && <p className={SILENT_CLASS}>{silent.length} reader(s) have stopped reporting.</p>}
      {readers?.length === 0 && <p className="text-sm text-zinc-500">No readers provisioned.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {readers?.map((reader) => (
          <li key={reader.deviceRef} className={ROW_CLASS}>
            <span className="flex-1 font-mono">{reader.deviceRef}</span>
            <span className="text-zinc-500">{reader.firmwareVersion}</span>
            <span className={silent.includes(reader) ? SILENT_CLASS : "text-zinc-500"}>
              {reader.lastSeenAt === undefined ? "never synced" : `seen ${new Date(reader.lastSeenAt).toLocaleString()}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
