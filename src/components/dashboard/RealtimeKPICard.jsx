import { memo, useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const toneClasses = {
  emerald: "from-emerald-300/18 text-emerald-100 shadow-emerald-950/20",
  sky: "from-sky-300/18 text-sky-100 shadow-sky-950/20",
  amber: "from-amber-300/18 text-amber-100 shadow-amber-950/20",
  rose: "from-rose-300/18 text-rose-100 shadow-rose-950/20",
  violet: "from-violet-300/18 text-violet-100 shadow-violet-950/20",
};

export const RealtimeKPICard = memo(function RealtimeKPICard({
  label,
  value,
  displayValue,
  trend = 0,
  icon: Icon,
  tone = "emerald",
  suffix = "",
}) {
  const { t } = useTranslation();
  const previous = useRef(Number(value || 0));
  const [pulse, setPulse] = useState(false);
  const increased = Number(value || 0) > previous.current;

  useEffect(() => {
    if (Number(value || 0) > previous.current) {
      setPulse(true);
      const timer = window.setTimeout(() => setPulse(false), 1200);
      previous.current = Number(value || 0);
      return () => window.clearTimeout(timer);
    }
    previous.current = Number(value || 0);
    return undefined;
  }, [value]);

  const TrendIcon = trend >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br ${toneClasses[tone] || toneClasses.emerald} via-white/[0.045] to-zinc-950/72 p-4 shadow-2xl transition duration-300 ${pulse ? "ring-1 ring-emerald-200/30 motion-safe:animate-[realtime-badge-pop_420ms_ease-out]" : ""}`}>
      <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-current opacity-10 blur-3xl" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
          <div className="mt-2 truncate text-2xl font-black text-white">{displayValue ?? `${Number(value || 0).toLocaleString()}${suffix}`}</div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-zinc-400">
        <span className={increased ? "text-emerald-200" : ""}>{increased ? t("dashboard.realtime.kpi.liveIncrease") : t("dashboard.realtime.kpi.liveMonitor")}</span>
        <span className={`inline-flex items-center gap-1 ${trend >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          {Math.abs(Number(trend || 0)).toFixed(1)}%
        </span>
      </div>
    </div>
  );
});

export default RealtimeKPICard;
