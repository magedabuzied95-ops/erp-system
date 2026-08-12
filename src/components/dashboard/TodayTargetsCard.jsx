import { memo } from "react";
import { Target } from "lucide-react";
import { useTranslation } from "react-i18next";

export const TodayTargetsCard = memo(function TodayTargetsCard({ metrics, target = 0, formatCurrency }) {
  const { t } = useTranslation();  const copy = {
    title: t("dashboard.realtime.todayTargets.title"),
    of: t("dashboard.realtime.todayTargets.of"),
    noTarget: t("dashboard.realtime.todayTargets.noTarget"),
    conversion: t("dashboard.realtime.todayTargets.conversion"),
    aov: t("dashboard.realtime.todayTargets.aov"),
  };
  const progress = target ? Math.min(100, (metrics.todaySales / target) * 100) : 0;
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Target className="h-4 w-4 text-emerald-300" />{copy.title}</div>
      <div className="text-sm text-zinc-400">{target ? `${formatCurrency(metrics.todaySales)} ${copy.of} ${formatCurrency(target)}` : copy.noTarget}</div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-emerald-300 transition-all duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tiny label={copy.conversion} value={`${metrics.conversionRate.toFixed(1)}%`} />
        <Tiny label={copy.aov} value={formatCurrency(metrics.averageOrderValue)} />
      </div>
    </section>
  );
});

function Tiny({ label, value }) {
  return <div className="rounded-xl bg-white/[0.035] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div><div className="mt-1 text-sm font-black text-white">{value}</div></div>;
}

export default TodayTargetsCard;
