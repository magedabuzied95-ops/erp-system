export default function MarketingMetricCard({ label, value, hint, icon, tone = "slate", size = "default" }) {
  const tones = {
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
    cyan: "border-amber-500/25 bg-amber-500/10 text-amber-500",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-500",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-500",
    slate: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
  };

  return (
    <div className={`${size === "large" ? "min-h-32 p-5" : "p-4"} rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`${size === "large" ? "text-xs" : "text-[11px]"} font-semibold uppercase tracking-[0.18em] text-[var(--muted)]`}>{label}</div>
          <div className={`${size === "large" ? "mt-3 text-4xl" : "mt-2 text-3xl"} font-black text-[var(--text)]`}>{value}</div>
        </div>
        <div className={`flex ${size === "large" ? "h-13 w-13" : "h-11 w-11"} items-center justify-center rounded-[var(--radius-control)] border ${tones[tone] || tones.slate}`}>
          {icon}
        </div>
      </div>
      {hint ? <div className="mt-3 text-sm text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}
