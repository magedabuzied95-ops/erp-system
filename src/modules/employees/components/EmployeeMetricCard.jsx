export default function EmployeeMetricCard({ label, value, hint, tone = "emerald" }) {
  const tones = {
    emerald: "from-emerald-500/20 to-emerald-500/5 border-emerald-400/20 text-emerald-300",
    cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-400/20 text-cyan-300",
    amber: "from-amber-500/20 to-amber-500/5 border-amber-400/20 text-amber-300",
    rose: "from-rose-500/20 to-rose-500/5 border-rose-400/20 text-rose-300",
  };

  return (
    <div className={`rounded-3xl border bg-gradient-to-br p-5 shadow-[0_16px_40px_rgba(0,0,0,0.18)] ${tones[tone] || tones.emerald}`}>
      <div className="text-xs uppercase tracking-[0.22em] text-white/60">{label}</div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      {hint ? <div className="mt-2 text-sm text-white/70">{hint}</div> : null}
    </div>
  );
}
