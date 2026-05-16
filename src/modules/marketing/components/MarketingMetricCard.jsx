export default function MarketingMetricCard({ label, value, hint, icon, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-200",
    slate: "border-white/10 bg-white/5 text-slate-200",
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/10 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-black text-white">{value}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${tones[tone] || tones.slate}`}>
          {icon}
        </div>
      </div>
      {hint ? <div className="mt-3 text-sm text-slate-400">{hint}</div> : null}
    </div>
  );
}
