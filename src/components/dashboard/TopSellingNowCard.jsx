import { memo } from "react";
import { Flame } from "lucide-react";

export const TopSellingNowCard = memo(function TopSellingNowCard({ products = [], inventory = {}, formatCurrency }) {
  const rows = (products.length ? products : inventory.fastMovingProducts || []).slice(0, 5);
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Flame className="h-4 w-4 text-amber-300" />Top Selling Now</div>
      <div className="space-y-2">
        {rows.length ? rows.map((product, index) => (
          <div key={`${product.id || product.name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2">
            <span className="min-w-0 truncate text-xs font-black text-white">{product.name || product.product_name || "Product"}</span>
            <span className="shrink-0 text-xs font-black text-amber-100">{Number(product.quantity || product.sold || 0).toLocaleString()} · {formatCurrency(product.revenue || 0)}</span>
          </div>
        )) : <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-zinc-500">Top sellers will appear after sales activity.</div>}
      </div>
    </section>
  );
});

export default TopSellingNowCard;
