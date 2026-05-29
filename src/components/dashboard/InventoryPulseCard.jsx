import { memo } from "react";
import { AlertTriangle } from "lucide-react";

export const InventoryPulseCard = memo(function InventoryPulseCard({ lowStock = [], inventory = {} }) {
  const rows = lowStock.slice(0, 4);
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-black text-white"><AlertTriangle className="h-4 w-4 text-amber-300" />Inventory Pulse</div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${rows.length ? "bg-amber-400/10 text-amber-100" : "bg-emerald-400/10 text-emerald-100"}`}>{rows.length ? `${rows.length} pressure` : "Healthy"}</span>
      </div>
      <div className="space-y-2">
        {rows.map((item) => (
          <div key={`${item.id}-${item.sku}-${item.name}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2">
            <span className="min-w-0 truncate text-xs font-black text-white">{item.name || item.sku || "Product"}</span>
            <span className="shrink-0 text-xs font-black text-amber-100">{Number(item.stock || 0)} / {Number(item.threshold || item.low_stock_alert || 0)}</span>
          </div>
        ))}
        {!rows.length ? <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-zinc-500">No critical stock pressure right now.</div> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tiny label="Fast movers" value={(inventory.fastMovingProducts || []).length} />
        <Tiny label="Pending transfers" value={inventory.pendingTransfers} />
      </div>
    </section>
  );
});

function Tiny({ label, value }) {
  return <div className="rounded-xl bg-white/[0.03] px-3 py-2"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</div><div className="mt-1 text-base font-black text-white">{Number(value || 0).toLocaleString()}</div></div>;
}

export default InventoryPulseCard;
