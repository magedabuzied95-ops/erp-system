export default function AttendanceMetricCard({ label, value, hint, tone = "emerald", isRtl = false }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    blue: "border-primary/20 bg-primary/10 text-primary",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    zinc: "border-white/10 bg-white/5 text-white",
  };

  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${tones[tone] || tones.zinc}`}>
      <div className={isRtl ? "text-[11px] font-bold leading-5 text-zinc-400" : "text-[11px] uppercase tracking-[0.2em] text-zinc-400"}>{label}</div>
      <div className="mt-2 text-3xl font-black text-white">{value}</div>
      {hint ? <div className="mt-2 text-xs text-zinc-300">{hint}</div> : null}
    </div>
  );
}
