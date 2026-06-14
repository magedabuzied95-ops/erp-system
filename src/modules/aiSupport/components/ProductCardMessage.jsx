import { ArrowUpRight, ShoppingBag } from "lucide-react";

import { formatCurrency } from "../../../shared/lib/currency";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const money = (value) => formatCurrency(value);

const absoluteTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const resolveStorefrontUrl = (card = {}) => {
  const rawUrl = clean(card.storefront_url || card.product_url || card.url || "");
  if (rawUrl) return rawUrl;
  const productId = card.product_id || card.id || "";
  if (!productId) return "";
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(`/shop/product/${encodeURIComponent(productId)}`, window.location.origin).toString();
    } catch {
      return `/shop/product/${encodeURIComponent(productId)}`;
    }
  }
  return `/shop/product/${encodeURIComponent(productId)}`;
};

const cardImage = (card = {}) =>
  clean(card.image_url || card.product_image_url || card.variant_image_url || card.image || card.thumbnail_url || "");

export default function ProductCardMessage({ message = {}, cards = [] }) {
  const items = asArray(cards).filter(Boolean);
  if (!items.length) return null;

  return (
    <div className="rounded-3xl rounded-tr-sm border border-cyan-300/15 bg-cyan-300/10 p-4 shadow-[0_10px_30px_rgba(8,145,178,0.14)]">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">
        <ShoppingBag className="h-3.5 w-3.5" />
        <span>إرسال منتج</span>
        {message.created_at ? <span className="text-slate-500">{absoluteTime(message.created_at)}</span> : null}
        {items.length > 1 ? <span className="text-slate-500">{items.length} منتجات</span> : null}
      </div>

      <div className={`mt-3 grid gap-2 ${items.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {items.slice(0, 4).map((card, index) => {
          const image = cardImage(card);
          const priceValue = Number(card.price ?? card.final_price ?? 0);
          const storefrontUrl = resolveStorefrontUrl(card);
          return (
            <div
              key={`${card.product_id || card.variant_id || card.id || index}`}
              className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70"
            >
              {storefrontUrl ? (
                <a href={storefrontUrl} target="_blank" rel="noreferrer" className="block">
                  {image ? (
                    <img src={image} alt={card.product_name || "منتج"} className="aspect-[16/10] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid aspect-[16/10] w-full place-items-center bg-white/[0.05]">
                      <ShoppingBag className="h-10 w-10 text-slate-500" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="truncate text-sm font-black text-white">{card.product_name || card.name || "منتج"}</div>
                    {priceValue > 0 ? <div className="mt-1 text-xs font-bold text-emerald-100">{money(priceValue)}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                      {card.color ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">اللون: {card.color}</span> : null}
                      {card.size ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">المقاس: {card.size}</span> : null}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[11px] font-black text-cyan-100">
                      فتح المنتج
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </a>
              ) : (
                <div className="p-3">
                  {image ? (
                    <img src={image} alt={card.product_name || "منتج"} className="aspect-[16/10] w-full rounded-xl object-cover" loading="lazy" />
                  ) : (
                    <div className="grid aspect-[16/10] w-full place-items-center rounded-xl bg-white/[0.05]">
                      <ShoppingBag className="h-10 w-10 text-slate-500" />
                    </div>
                  )}
                  <div className="mt-3 truncate text-sm font-black text-white">{card.product_name || card.name || "منتج"}</div>
                  {priceValue > 0 ? <div className="mt-1 text-xs font-bold text-emerald-100">{money(priceValue)}</div> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                    {card.color ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">اللون: {card.color}</span> : null}
                    {card.size ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">المقاس: {card.size}</span> : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
