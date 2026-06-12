import { memo } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

export const InventoryPulseCard = memo(function InventoryPulseCard({ lowStock = [], inventory = {} }) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar");
  const copy = {
    title: isArabic ? "نبض المخزون" : "Inventory Pulse",
    pressure: isArabic ? "حالات حرجة" : "pressure",
    healthy: isArabic ? "سليم" : "Healthy",
    product: isArabic ? "منتج" : "Product",
    empty: isArabic ? "لا توجد ضغوط حرجة على المخزون حاليًا." : "No critical stock pressure right now.",
    fastMovers: isArabic ? "الأصناف الأسرع حركة" : "Fast movers",
    pendingTransfers: isArabic ? "التحويلات المعلقة" : "Pending transfers",
  };
  const rows = lowStock.slice(0, 4);
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black text-white"><AlertTriangle className="h-4 w-4 text-amber-300" />{copy.title}</div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${rows.length ? "bg-amber-400/10 text-amber-100" : "bg-emerald-400/10 text-emerald-100"}`}>{rows.length ? `${rows.length} ${copy.pressure}` : copy.healthy}</span>
      </div>
      <div className="space-y-2">
        {rows.map((item) => (
          <div key={`${item.id}-${item.sku}-${item.name}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2">
            <span className="min-w-0 truncate text-xs font-black text-white">{item.name || item.sku || copy.product}</span>
            <span className="shrink-0 text-xs font-black text-amber-100">{Number(item.stock || 0)} / {Number(item.threshold || item.low_stock_alert || 0)}</span>
          </div>
        ))}
        {!rows.length ? <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-zinc-500">{copy.empty}</div> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tiny label={copy.fastMovers} value={(inventory.fastMovingProducts || []).length} />
        <Tiny label={copy.pendingTransfers} value={inventory.pendingTransfers} />
      </div>
    </section>
  );
});

function Tiny({ label, value }) {
  return <div className="rounded-xl bg-white/[0.03] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div><div className="mt-1 text-base font-black text-white">{Number(value || 0).toLocaleString()}</div></div>;
}

export default InventoryPulseCard;
