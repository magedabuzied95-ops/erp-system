export default function MarketingMetricCard({ label, value, hint, icon, tone = "slate", size = "default" }) {
  const tones = {
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    cyan: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    violet: "border-violet-500/20 bg-violet-500/10 text-violet-200",
    slate: "border-white/10 bg-white/5 text-slate-200",
  };

  return (
    <div className={`${size === "large" ? "min-h-32 rounded-[1.65rem] p-5" : "rounded-2xl p-4"} border border-white/10 bg-[#1b1c1a] shadow-xl shadow-black/15`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`${size === "large" ? "text-xs" : "text-[11px]"} font-semibold uppercase tracking-[0.18em] text-slate-300`}>{label}</div>
          <div className={`${size === "large" ? "mt-3 text-4xl" : "mt-2 text-3xl"} font-black text-white`}>{value}</div>
        </div>
        <div className={`flex ${size === "large" ? "h-13 w-13 rounded-2xl" : "h-11 w-11 rounded-xl"} items-center justify-center border ${tones[tone] || tones.slate}`}>
          {icon}
        </div>
      </div>
      {hint ? <div className="mt-3 text-sm text-slate-400">{hint}</div> : null}
    </div>
  );
}
