import { memo } from "react";
import { Link } from "react-router-dom";
import { ReceiptText } from "lucide-react";
import { useTranslation } from "react-i18next";

const timeAgo = (value, t) => {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return t("dashboard.realtime.liveSalesTicker.secondsAgo", { count: seconds || 1 });
  if (seconds < 3600) return t("dashboard.realtime.liveSalesTicker.minutesAgo", { count: Math.floor(seconds / 60) });
  return t("dashboard.realtime.liveSalesTicker.hoursAgo", { count: Math.floor(seconds / 3600) });
};

export const LiveSalesTicker = memo(function LiveSalesTicker({ sales = [], formatCurrency }) {
  const { t } = useTranslation();
  const copy = {
    eyebrow: t("dashboard.realtime.liveSalesTicker.eyebrow"),
    title: t("dashboard.realtime.liveSalesTicker.title"),
    live: t("dashboard.realtime.liveSalesTicker.live"),
    order: t("dashboard.realtime.liveSalesTicker.order"),
    empty: t("dashboard.realtime.liveSalesTicker.empty"),
  };

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">{copy.eyebrow}</div>
          <h2 className="m1-section-title text-white">{copy.title}</h2>
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black text-emerald-100">{copy.live}</span>
      </div>
      <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
        {sales.length ? sales.map((sale) => {
          const meta = [sale.customer, sale.branch, sale.paymentStatus].filter(Boolean).join(" · ");
          const content = (
            <div className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 rounded-[var(--radius-card)] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition hover:bg-white/[0.065] ${Number(sale.highlightUntil || 0) > Date.now() ? "ring-1 ring-emerald-200/20" : ""}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-200">
                <ReceiptText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">{sale.invoice || copy.order}</div>
                <div className="mt-1 truncate text-xs text-zinc-500">{meta}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-black text-emerald-100">{formatCurrency(sale.amount || 0)}</div>
                <div className="mt-1 text-[10px] font-bold text-zinc-500">{timeAgo(sale.timestamp, t)}</div>
              </div>
            </div>
          );
          return sale.href ? <Link key={`${sale.id}-${sale.timestamp}`} to={sale.href} className="block">{content}</Link> : <div key={`${sale.id}-${sale.timestamp}`}>{content}</div>;
        }) : (
          <div className="rounded-[var(--radius-card)] border border-dashed border-white/[0.08] bg-white/[0.025] p-6 text-center text-sm text-zinc-500">
            {copy.empty}
          </div>
        )}
      </div>
    </section>
  );
});

export default LiveSalesTicker;
