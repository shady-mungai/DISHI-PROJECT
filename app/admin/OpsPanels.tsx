"use client";

import { api } from "@/convex/_generated/api";
import { Stat } from "@/app/components/Stat";
import { ERROR_CLASS, INPUT_CLASS, MUTED_CLASS, ROW_CLASS, SECTION_TITLE_CLASS, SMALL_BUTTON_CLASS } from "@/app/components/ui";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

type Range = { from: string; to: string };

// NFR-803: the numbers the NFR pass is judged on, over the selected period.
export function MetricsPanel({ from, to }: Range) {
  const metrics = useQuery(api.admin.metrics, { from, to });
  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>Service levels</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Ingestion lag p95" value={metrics ? `${metrics.ingestionLagP95Ms} ms` : undefined} />
        <Stat label="Enqueue lag p95" value={metrics ? `${metrics.enqueueLagP95Ms} ms` : undefined} />
        <Stat label={`Sweep duration p95 (${metrics?.sweeps ?? "…"} sweeps)`} value={metrics ? `${metrics.sweepDurationP95Ms} ms` : undefined} />
        <Stat label="Delivered" value={metrics ? `${metrics.deliveredPct}%` : undefined} />
        <Stat label="Taps" value={metrics?.taps} />
        <Stat label="Rule evaluations" value={metrics?.evaluations} />
        <Stat label="Suppressed" value={metrics?.suppressed} />
      </div>
    </section>
  );
}

// FR-802: the audit trail is the events stream filtered to administrative types.
export function AuditPanel({ from, to }: Range) {
  const entries = useQuery(api.admin.audit, { from, to });
  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>Audit log</h2>
      {entries?.length === 0 && <p className={MUTED_CLASS}>No administrative actions in this period.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {entries?.map((entry) => (
          <li key={entry._id} className={`${ROW_CLASS} font-mono text-xs`}>
            <span className="text-ink/60">{new Date(entry.occurredAt).toLocaleString()}</span>
            <span>{entry.type}</span>
            <span className="flex-1 text-ink/60">{JSON.stringify(entry.payload)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// NFR-505 and every tolerance: edited in place, each change audited.
export function SettingsPanel() {
  const settings = useQuery(api.admin.listSettings);
  const setSetting = useMutation(api.admin.setSetting);
  const [error, setError] = useState<string | null>(null);

  async function save(key: string, current: string | number | boolean, raw: string) {
    const value = typeof current === "number" ? Number(raw) : typeof current === "boolean" ? raw === "true" : raw;
    if (value === current) {
      return;
    }
    setError(null);
    try {
      await setSetting({ key, value });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save setting");
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className={SECTION_TITLE_CLASS}>Settings and retention</h2>
      {error && <p className={ERROR_CLASS}>{error}</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {settings?.map((setting) => (
          <li key={setting.key} className={ROW_CLASS}>
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono">{setting.key}</span>
              <span className="text-ink/60">{setting.description}</span>
            </label>
            <input
              aria-label={setting.key}
              defaultValue={String(setting.value)}
              inputMode={typeof setting.value === "number" ? "decimal" : undefined}
              onBlur={(e) => void save(setting.key, setting.value, e.target.value)}
              className={`${INPUT_CLASS} w-32 font-mono`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RevokeButton({ deviceRef, revokedAt }: { deviceRef: string; revokedAt?: number }) {
  const revoke = useMutation(api.admin.revokeDevice);
  if (revokedAt !== undefined) {
    return <span className={ERROR_CLASS}>revoked {new Date(revokedAt).toLocaleDateString()}</span>;
  }
  return (
    <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => void revoke({ deviceRef })}>
      Revoke
    </button>
  );
}
