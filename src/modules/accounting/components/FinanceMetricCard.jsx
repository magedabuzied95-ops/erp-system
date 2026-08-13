export default function FinanceMetricCard({ label, value, hint, tone = "zinc", icon }) {
  const classes = {
    zinc: "border-[var(--border)] bg-[var(--card)] text-[var(--text)]",
    cyan: "border-primary/20 bg-primary/10 text-primary",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-300",
  };

  return (
    <div className={`theme-card rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        {/* min-w-0: flex items default to min-width:auto, so a long currency value
            (e.g. -2,848,153.00) could not shrink and pushed the icon box outside
            the card in the 6-up KPI grid. shrink-0 keeps the icon its own size so
            the value wraps instead of the icon being squeezed. */}
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
          <div className="mt-2 text-2xl font-black text-[var(--text)]">{value}</div>
          {hint ? <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div> : null}
        </div>
        {icon ? <div className="shrink-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--text)]">{icon}</div> : null}
      </div>
    </div>
  );
}
