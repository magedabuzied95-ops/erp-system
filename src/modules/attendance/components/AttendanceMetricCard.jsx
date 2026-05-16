export default function AttendanceMetricCard({ label, value, hint, tone = "emerald" }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-200",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-100",
    zinc: "border-white/10 bg-white/5 text-white",
  };

  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${tones[tone] || tones.zinc}`}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-black text-white">{value}</div>
      {hint ? <div className="mt-2 text-xs text-zinc-300">{hint}</div> : null}
    </div>
  );
}
