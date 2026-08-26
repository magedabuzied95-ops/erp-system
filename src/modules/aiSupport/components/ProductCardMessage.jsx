import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ShoppingBag } from "lucide-react";

import { formatCurrency } from "../../../shared/lib/currency";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import DeliveryTicks, { deliveryStatusLabel, isTickableDeliveryStatus } from "./DeliveryTicks.jsx";

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

const absoluteTime = (value, language = "ar") => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString(language === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const productCardRoute = (productId = "") => {
  const safeId = clean(productId);
  if (!safeId) return "";
  const route = `/shop/product/${encodeURIComponent(safeId)}`;
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
    inherited.title
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
  const imageUrl = resolveProductImageUrl(firstImageValue(
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
  ));

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
  resolveProductImageUrl(firstImageValue(card.image_url, card.image, card.thumbnail_url, card.media_url, card.product_image_url, card.product_image, card.variant_image_url, card.variant_image, card.main_image));

function ProductCardMessage({ message = {}, cards = [], compact = false }) {
  const { t, i18n } = useTranslation();
  const items = asArray(cards).flatMap((card) => normalizeProductCard(card)).filter(Boolean);
  if (!items.length) return null;
  const deliveryStatus = clean(message.delivery_status || "");

  return (
    <div
      data-ai-product-card-density={compact ? "compact" : "default"}
      className={`${compact ? "w-full max-w-[520px] rounded-2xl p-2.5" : "rounded-3xl p-4"} rounded-tr-sm border border-cyan-300/15 bg-cyan-300/10 shadow-[0_10px_30px_rgba(8,145,178,0.14)]`}
      style={{ contentVisibility: "auto", containIntrinsicSize: compact ? "260px" : "360px" }}
    >
      <div className={`flex flex-wrap items-center font-black uppercase text-cyan-100 ${compact ? "gap-1.5 text-[10px] tracking-[0.1em]" : "gap-2 text-[11px] tracking-[0.14em]"}`}>
        <ShoppingBag className="h-3.5 w-3.5" />
        <span>{t("aiSupport.inbox.productCard.sentProduct")}</span>
        {deliveryStatus ? (
          isTickableDeliveryStatus(deliveryStatus)
            ? <DeliveryTicks status={deliveryStatus} />
            : (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] tracking-[0.08em] text-slate-200">
                {deliveryStatusLabel(t, deliveryStatus)}
              </span>
            )
        ) : null}
        {message.created_at ? <span className="text-slate-500">{absoluteTime(message.created_at, i18n.resolvedLanguage)}</span> : null}
        {items.length > 1 ? <span className="text-slate-500">{t("aiSupport.inbox.productCard.productCount", { count: items.length })}</span> : null}
      </div>

      {/* Multi-card renders as the same horizontal swipe strip WhatsApp shows the customer —
          the transcript's job here is to mirror what actually left, card for card. */}
      <div className={items.length > 1
        ? `${compact ? "mt-2 gap-1.5" : "mt-3 gap-2"} flex snap-x snap-mandatory overflow-x-auto pb-1`
        : `${compact ? "mt-2 gap-1.5" : "mt-3 gap-2"} grid`}>
        {items.map((card, index) => {
          const image = cardImage(card);
          const priceValue = Number(card.price ?? card.final_price ?? 0);
          const storefrontUrl = resolveStorefrontUrl(card);
          const cardKey = clean(card.product_id || card.id || card.variant_id || `${index}`);
          return (
            <div
              key={cardKey || index}
              className={`overflow-hidden border border-white/10 bg-slate-950/70 ${compact ? "rounded-xl" : "rounded-2xl"} ${items.length > 1 ? "w-52 shrink-0 snap-start" : ""}`}
            >
              {storefrontUrl ? (
                <a href={storefrontUrl} target="_blank" rel="noreferrer" className="block">
                  {image ? (
                    <img src={image} alt={card.product_name || card.name || card.title || t("aiSupport.inbox.productCard.product")} className={compact ? "aspect-square w-full bg-white object-contain" : "aspect-square w-full bg-white object-contain"} loading="lazy" decoding="async" />
                  ) : (
                    <div className={`grid w-full place-items-center bg-white/[0.05] aspect-square`}>
                      <ShoppingBag className={`${compact ? "h-7 w-7" : "h-10 w-10"} text-slate-500`} />
                    </div>
                  )}
                  <div className={compact ? "p-2.5" : "p-3"}>
                    <div className={`truncate font-black text-white ${compact ? "text-xs" : "text-sm"}`}>{card.product_name || card.name || card.title || t("aiSupport.inbox.productCard.product")}</div>
                    {priceValue > 0 ? <div className="mt-1 text-xs font-bold text-emerald-100">{money(priceValue)}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                      {card.color ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{t("aiSupport.inbox.productCard.colorValue", { color: card.color })}</span> : null}
                      {card.size ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{t("aiSupport.inbox.productCard.sizeValue", { size: card.size })}</span> : null}
                    </div>
                    <div className={`${compact ? "mt-2 rounded-lg px-2.5 py-1.5 text-[10px]" : "mt-3 rounded-xl px-3 py-2 text-[11px]"} inline-flex items-center gap-1.5 border border-cyan-300/20 bg-cyan-300/10 font-black text-cyan-100`}>
                      {card.color && (card.variant_id || card.id) ? t("aiSupport.inbox.productCard.chooseColorButton") : t("aiSupport.inbox.productCard.openProduct")}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </a>
              ) : (
                <div className={compact ? "p-2.5" : "p-3"}>
                  {image ? (
                    <img src={image} alt={card.product_name || card.name || card.title || t("aiSupport.inbox.productCard.product")} className={compact ? "aspect-square w-full rounded-lg bg-white object-contain" : "aspect-square w-full rounded-xl bg-white object-contain"} loading="lazy" decoding="async" />
                  ) : (
                    <div className={`grid w-full place-items-center bg-white/[0.05] ${compact ? "aspect-square rounded-lg" : "aspect-square rounded-xl"}`}>
                      <ShoppingBag className={`${compact ? "h-7 w-7" : "h-10 w-10"} text-slate-500`} />
                    </div>
                  )}
                  <div className={`${compact ? "mt-2 text-xs" : "mt-3 text-sm"} truncate font-black text-white`}>{card.product_name || card.name || card.title || t("aiSupport.inbox.productCard.product")}</div>
                  {priceValue > 0 ? <div className="mt-1 text-xs font-bold text-emerald-100">{money(priceValue)}</div> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-300">
                    {card.color ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{t("aiSupport.inbox.productCard.colorValue", { color: card.color })}</span> : null}
                    {card.size ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{t("aiSupport.inbox.productCard.sizeValue", { size: card.size })}</span> : null}
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
