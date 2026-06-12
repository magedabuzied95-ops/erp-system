import { memo } from "react";
import { Banknote } from "lucide-react";
import { useTranslation } from "react-i18next";

export const RevenuePulseCard = memo(function RevenuePulseCard({ metrics, salesTrend = [], branchPerformance = [], formatCurrency }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar");
  const copy = {
    title: isArabic ? "نبض الإيرادات" : "Revenue Pulse",
    avgOrder: isArabic ? "متوسط الطلب" : "Avg order",
    orders: isArabic ? "الطلبات" : "Orders",
    peakPeriod: isArabic ? "فترة الذروة" : "Peak period",
    bestBranch: isArabic ? "أفضل فرع" : "Best branch",
    singleBranch: isArabic ? "فرع واحد" : "Single branch",
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
