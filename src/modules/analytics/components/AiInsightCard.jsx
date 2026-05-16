import { BrainCircuit, Sparkles } from "lucide-react";

function AiInsightCard({ title, insight, tone = "cyan" }) {
  const tones = {
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-100",
  };

  return (
    <div className={`theme-card rounded-[24px] border p-5 shadow-[0_16px_60px_var(--shadow)] ${tones[tone] || tones.cyan}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">AI insight</div>
          <h3 className="mt-1 text-lg font-black text-[var(--text)]">{title}</h3>
        </div>
      </div>

      <p className="mt-4 text-sm leading-7 text-[var(--text)]/85">{insight}</p>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold text-[var(--text)]">
        <Sparkles className="h-3.5 w-3.5" />
        Generated from sales, stock, and customer patterns
      </div>
    </div>
  );
}

export default AiInsightCard;
