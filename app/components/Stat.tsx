import { STAT_CLASS } from "@/app/components/ui";

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  detail?: string;
  value: number | string | undefined;
}) {
  return (
    <div className={STAT_CLASS}>
      <span className="stat-label text-sm text-muted">{label}</span>
      <span className="stat-value font-semibold tracking-tight tabular-nums text-green">
        {typeof value === "number"
          ? value.toLocaleString("en-KE")
          : (value ?? "…")}
      </span>
      {detail && <span className="text-sm text-muted">{detail}</span>}
    </div>
  );
}
