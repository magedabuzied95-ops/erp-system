import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";

const formatValue = (value) => {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value);
  }
  return String(value);
};

function AnalyticsKpiCard({ label, value, delta, trend = "up", icon: Icon }) {
  const isUp = trend === "up";

  return (
    <div className="theme-card rounded-[28px] p-5 shadow-[0_16px_60px_var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">{label}</p>
          <div className="mt-3 text-3xl font-black tracking-tight text-[var(--text)]">{formatValue(value)}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] text-[var(--primary)]">
          {Icon ? <Icon className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
        </div>
      </div>

      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold">
        {isUp ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" /> : <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />}
        <span className={isUp ? "text-emerald-300" : "text-rose-300"}>
          {isUp ? "+" : ""}
          {Number(delta || 0).toFixed(1)}% vs previous period
        </span>
      </div>
    </div>
  );
}

export default AnalyticsKpiCard;
