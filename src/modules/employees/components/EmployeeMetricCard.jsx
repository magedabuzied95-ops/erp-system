export default function EmployeeMetricCard({ label, value, hint, tone = "emerald", isRtl = false }) {
  const tones = {
    emerald: "m1-metric-neutral",
    cyan: "m1-metric-neutral",
    amber: "m1-metric-primary",
    rose: "m1-metric-neutral",
  };

  return (
    <div className={`m1-analytics-metric rounded-3xl border p-5 shadow-[0_12px_32px_rgba(0,0,0,0.12)] ${tones[tone] || tones.emerald}`}>
      <div className={isRtl ? "text-xs font-bold leading-5 text-white/60" : "text-xs uppercase tracking-[0.22em] text-white/60"}>{label}</div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      {hint ? <div className="mt-2 text-sm text-white/70">{hint}</div> : null}
    </div>
  );
}
