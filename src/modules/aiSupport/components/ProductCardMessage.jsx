import { memo } from "react";
import { ArrowUpRight, ShoppingBag } from "lucide-react";

import { formatCurrency } from "../../../shared/lib/currency";
import { productPath } from "../../../storefront/lib/paths";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const money = (value) => formatCurrency(value);

const firstText = (...values) => values.map((value) => clean(value)).find(Boolean) || "";

const firstImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const nested = firstImageValue(
        value.secure_url,
        value.cloudinary_url,
        value.image_url,
        value.main_image,
        value.variant_image,
        value.variant_image_url,
        value.color_image,
        value.color_image_url,
        value.thumbnail_url,
        value.media_url,
        value.url,
        value.path,
        value.src,
        value.preview,
        value.image
      );
      if (nested) return nested;
      continue;
    }
    const text = clean(value);
    if (text) return text;
  }
  return "";
};

const absoluteTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const productCardRoute = (productId = "") => {
  const safeId = clean(productId);
  if (!safeId) return "";
  const route = productPath(safeId);
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(route, window.location.origin).toString();
    } catch {
      return route;
    }
  }
  return route;
};

const resolveStorefrontUrl = (card = {}) => {
  const rawUrl = clean(card.storefront_url || card.product_url || card.url || card.share_url || card.shareUrl || "");
  if (rawUrl) return rawUrl;
  return productCardRoute(card.product_id || card.id || card.slug || "");
};

const normalizeProductCard = (card = {}, inherited = {}) => {
  if (!card || typeof card !== "object") return [];
  const nestedCards = asArray(card.items || card.cards || card.products || card.product_cards || card.productCards);
  if (nestedCards.length) {
    const shared = { ...inherited, ...card };
    return nestedCards.flatMap((nestedCard) => normalizeProductCard(nestedCard, shared));
  }

  const merged = { ...inherited, ...card };
  const productId = firstText(merged.product_id, merged.id, merged.productId, merged.matched_product_id);
  const productName = firstText(
    merged.name,
    merged.product_name,
    merged.title,
    merged.display_name,
    merged.label,
    inherited.product_name,
    inherited.name,
    inherited.title,
    "ظ…ظ†طھط¬"
  );
  const storefrontUrl = firstText(
    merged.storefront_url,
    merged.product_url,
    merged.url,
    merged.share_url,
    merged.shareUrl,
    inherited.storefront_url,
    inherited.product_url,
    inherited.url,
    inherited.share_url,
    productCardRoute(productId || merged.slug || inherited.slug || "")
  );
  const imageUrl = firstImageValue(
    merged.image_url,
    merged.image,
    merged.thumbnail_url,
    merged.media_url,
    merged.product_image_url,
    merged.product_image,
    merged.variant_image_url,
    merged.variant_image,
    merged.main_image,
    inherited.image_url,
    inherited.image,
    inherited.thumbnail_url,
    inherited.media_url,
    inherited.product_image_url,
    inherited.variant_image_url,
    inherited.main_image
  );

  return [{
    ...merged,
    id: productId || merged.id || merged.product_id || "",
    product_id: productId || merged.product_id || merged.id || "",
    product_name: productName,
    name: productName,
    title: productName,
    display_name: productName,
    label: merged.label || productName,
    storefront_url: storefrontUrl,
    product_url: storefrontUrl,
    url: storefrontUrl,
    share_url: clean(merged.share_url || merged.shareUrl || ""),
    image_url: imageUrl,
    image: imageUrl,
    thumbnail_url: imageUrl || merged.thumbnail_url || "",
    media_url: clean(merged.media_url || merged.mediaUrl || ""),
  }];
};

const cardImage = (card = {}) =>
  firstImageValue(card.image_url, card.image, card.thumbnail_url, card.media_url, card.product_image_url, card.product_image, card.variant_image_url, card.variant_image, card.main_image);

function ProductCardMessage({ message = {}, cards = [] }) {
  const items = asArray(cards).flatMap((card) => normalizeProductCard(card)).filter(Boolean);
  if (!items.length) return null;
  const deliveryStatus = clean(message.delivery_status || "");

  return (
    <div
      className="rounded-3xl rounded-tr-sm border border-cyan-300/15 bg-cyan-300/10 p-4 shadow-[0_10px_30px_rgba(8,145,178,0.14)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100">
        <ShoppingBag className="h-3.5 w-3.5" />
        <span>ط¥ط±ط³ط§ظ„ ظ…ظ†طھط¬</span>
        {deliveryStatus ? (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] tracking-[0.08em] text-slate-200">
            {deliveryStatus}
          </span>
        ) : null}
        {message.created_at ? <span className="text-slate-500">{absoluteTime(message.created_at)}</span> : null}
        {items.length > 1 ? <span className="text-slate-500">{items.length} ظ…ظ†طھط¬ط§طھ</span> : null}
      </div>

      <div className={`mt-3 grid gap-2 ${items.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {items.slice(0, 4).map((card, index) => {
          const image = cardImage(card);
          const priceValue = Number(card.price ?? card.final_price ?? 0);
          const storefrontUrl = resolveStorefrontUrl(card);
          const cardKey = clean(card.product_id || card.id || card.variant_id || `${index}`);
          return (
            <div
              key={cardKey || index}
              className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70"
            >
              {storefrontUrl ? (
                <a href={storefrontUrl} target="_blank" rel="noreferrer" className="block">
                  {image ? (
                    <img src={image} alt={card.product_name || card.name || card.title || "ظ…ظ†طھط¬"} className="aspect-[16/10] w-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="grid aspect-[16/10] w-full place-items-center bg-white/[0.05]">
                      <ShoppingBag className="h-10 w-10 text-slate-500" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="truncate text-sm font-black text-white">{card.product_name || card.name || card.title || "ظ…ظ†طھط¬"}</div>
                    {priceValue > 0 ? <div className="mt-1 text-xs font-bold text-emerald-100">{money(priceValue)}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                      {card.color ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">ط§ظ„ظ„ظˆظ†: {card.color}</span> : null}
                      {card.size ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">ط§ظ„ظ…ظ‚ط§ط³: {card.size}</span> : null}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[11px] font-black text-cyan-100">
                      ظپطھط­ ط§ظ„ظ…ظ†طھط¬
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </a>
              ) : (
                <div className="p-3">
                  {image ? (
                    <img src={image} alt={card.product_name || card.name || card.title || "ظ…ظ†طھط¬"} className="aspect-[16/10] w-full rounded-xl object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="grid aspect-[16/10] w-full place-items-center rounded-xl bg-white/[0.05]">
                      <ShoppingBag className="h-10 w-10 text-slate-500" />
                    </div>
                  )}
                  <div className="mt-3 truncate text-sm font-black text-white">{card.product_name || card.name || card.title || "ظ…ظ†طھط¬"}</div>
                  {priceValue > 0 ? <div className="mt-1 text-xs font-bold text-emerald-100">{money(priceValue)}</div> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                    {card.color ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">ط§ظ„ظ„ظˆظ†: {card.color}</span> : null}
                    {card.size ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">ط§ظ„ظ…ظ‚ط§ط³: {card.size}</span> : null}
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

export default memo(ProductCardMessage);
