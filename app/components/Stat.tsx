import { STAT_CLASS } from "@/app/components/ui";

export function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className={STAT_CLASS}>
      <span className="text-sm text-ink/60">{label}</span>
      <span className="text-3xl font-semibold text-green">{value ?? "…"}</span>
    </div>
  );
}
