"use client";

import { hmacSha256Hex } from "@/convex/lib/hmac";
import { normaliseTagUid } from "@/convex/lib/tagUid";
import { convexSiteUrl } from "@/app/lib/convex-urls";
import { useCallback, useEffect, useRef, useState } from "react";
import { showError, userMessage } from "@/app/lib/errors";

const DEVICE_STORAGE_KEY = "dishi.reader.device";
const QUEUE_STORAGE_KEY = "dishi.reader.queue";
const INGEST_PATH = "/ingest";

export type ReaderDevice = { deviceRef: string; signingKeyHex: string };
export type QueuedTap = { eventId: string; tagUid: string; occurredAt: number };
type IngestVerdict = { eventId: string; status: "accepted" | "duplicate" | "rejected"; reason?: string };
export type IngestResult = IngestVerdict & { tagUid: string };

type NdefReadingEvent = { serialNumber: string };
type NdefReader = {
  scan(): Promise<void>;
  addEventListener(type: "reading", listener: (event: NdefReadingEvent) => void): void;
};
type NdefReaderConstructor = new () => NdefReader;

function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ponytail: storage unavailable (private mode) — state lives in memory for the session
  }
}

// Every hook here reads window APIs in a lazy initialiser, so the panel that
// uses them must be loaded with `ssr: false` (see page.tsx).
export function useReaderDevice(): [ReaderDevice | null, (device: ReaderDevice) => void] {
  const [device, setDeviceState] = useState<ReaderDevice | null>(() => readStorage<ReaderDevice>(DEVICE_STORAGE_KEY));
  const setDevice = useCallback((next: ReaderDevice) => {
    writeStorage(DEVICE_STORAGE_KEY, next);
    setDeviceState(next);
  }, []);
  return [device, setDevice];
}

async function postSignedBatch(device: ReaderDevice, events: QueuedTap[]): Promise<IngestVerdict[]> {
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ events }));
  const response = await fetch(`${convexSiteUrl}${INGEST_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Ref": device.deviceRef,
      "X-Signature": await hmacSha256Hex(device.signingKeyHex, bodyBytes),
    },
    body: bodyBytes,
  });
  if (!response.ok) {
    throw new Error(`ingest_http_${response.status}`);
  }
  const { results } = (await response.json()) as { results: IngestVerdict[] };
  return results;
}

// Queue survives reloads and airplane mode; only a network failure keeps
// items, every server verdict (accepted/duplicate/rejected) drains them.
export function useTapQueue(device: ReaderDevice | null) {
  const [queue, setQueue] = useState<QueuedTap[]>(() => readStorage<QueuedTap[]>(QUEUE_STORAGE_KEY) ?? []);
  const [lastResults, setLastResults] = useState<IngestResult[]>([]);
  const [flushError, setFlushError] = useState<string | null>(null);
  const queueRef = useRef<QueuedTap[]>(queue);
  const flushing = useRef(false);

  const persist = useCallback((next: QueuedTap[]) => {
    queueRef.current = next;
    writeStorage(QUEUE_STORAGE_KEY, next);
    setQueue(next);
  }, []);

  const flush = useCallback(async () => {
    if (!device || flushing.current || queueRef.current.length === 0) {
      return;
    }
    flushing.current = true;
    const batch = queueRef.current;
    try {
      const tagByEvent = new Map(batch.map((tap) => [tap.eventId, tap.tagUid]));
      const results = (await postSignedBatch(device, batch)).map((verdict) => ({
        ...verdict,
        tagUid: tagByEvent.get(verdict.eventId) ?? "",
      }));
      setLastResults(results);
      setFlushError(null);
      const settled = new Set(results.map((result) => result.eventId));
      persist(queueRef.current.filter((tap) => !settled.has(tap.eventId)));
    } catch (caught) {
      setFlushError(userMessage(caught, "no connection"));
    } finally {
      flushing.current = false;
    }
  }, [device, persist]);

  const enqueue = useCallback(
    (rawTagUid: string) => {
      if (!device) {
        return;
      }
      const tagUid = normaliseTagUid(rawTagUid);
      const occurredAt = Date.now();
      persist([...queueRef.current, { eventId: `${device.deviceRef}:${tagUid}:${occurredAt}`, tagUid, occurredAt }]);
      void flush();
    },
    [device, persist, flush],
  );

  useEffect(() => {
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  return { queue, lastResults, flushError, enqueue, flush };
}

export function useNfcScanner(onTag: (tagUid: string) => void) {
  const [supported] = useState(() => "NDEFReader" in window);
  const [scanning, setScanning] = useState(false);
  const onTagRef = useRef(onTag);

  useEffect(() => {
    onTagRef.current = onTag;
  }, [onTag]);

  const startScanning = useCallback(async () => {
    const Reader = (window as unknown as { NDEFReader?: NdefReaderConstructor }).NDEFReader;
    if (!Reader) {
      return;
    }
    try {
      const reader = new Reader();
      reader.addEventListener("reading", (event) => onTagRef.current(event.serialNumber));
      await reader.scan();
      setScanning(true);
    } catch (caught) {
      showError(caught, "NFC scanning could not start. Check that NFC is on and allowed for this site.");
    }
  }, []);

  return { supported, scanning, startScanning };
}
