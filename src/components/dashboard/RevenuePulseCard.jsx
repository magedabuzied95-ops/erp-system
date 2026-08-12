import { memo } from "react";
import { Banknote } from "lucide-react";
import { useTranslation } from "react-i18next";

export const RevenuePulseCard = memo(function RevenuePulseCard({ metrics, salesTrend = [], branchPerformance = [], formatCurrency }) {
  const { t } = useTranslation();  const copy = {
    title: t("dashboard.realtime.revenuePulse.title"),
    avgOrder: t("dashboard.realtime.revenuePulse.avgOrder"),
    orders: t("dashboard.realtime.revenuePulse.orders"),
    peakPeriod: t("dashboard.realtime.revenuePulse.peakPeriod"),
    bestBranch: t("dashboard.realtime.revenuePulse.bestBranch"),
    singleBranch: t("dashboard.realtime.revenuePulse.singleBranch"),
  };
  const bestBranch = [...branchPerformance].sort((a, b) => Number(b.sales || 0) - Number(a.sales || 0))[0];
  const peakHour = [...salesTrend].sort((a, b) => Number(b.revenue || b.sales || 0) - Number(a.revenue || a.sales || 0))[0];
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Banknote className="h-4 w-4 text-emerald-300" />{copy.title}</div>
      <div className="text-3xl font-black text-white">{formatCurrency(metrics.todaySales)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tiny label={copy.avgOrder} value={formatCurrency(metrics.averageOrderValue)} />
        <Tiny label={copy.orders} value={metrics.todayOrders} />
        <Tiny label={copy.peakPeriod} value={peakHour?.hourLabel || peakHour?.label || "-"} />
        <Tiny label={copy.bestBranch} value={bestBranch?.branch || bestBranch?.name || copy.singleBranch} />
      </div>
    </section>
  );
});

function Tiny({ label, value }) {
  return <div className="rounded-xl bg-white/[0.035] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div><div className="mt-1 truncate text-sm font-black text-white">{value}</div></div>;
}

export default RevenuePulseCard;
