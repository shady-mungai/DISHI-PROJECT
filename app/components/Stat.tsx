const STAT_CLASS = "flex flex-col rounded border border-zinc-200 p-4";

export function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className={STAT_CLASS}>
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-3xl font-semibold">{value ?? "…"}</span>
    </div>
  );
}
