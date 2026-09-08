/**
 * A product card as the customer's own app draws it.
 *
 * It used to be one house card everywhere: a cyan panel captioned "منتج مُرسل"
 * with the full send timestamp, wrapping a dark tile per product. Nothing on a
 * customer's phone looks like that. WhatsApp shows the card as part of the
 * outgoing bubble — photo, caption, then a link row under a hairline — while
 * Meta's generic template is a white card that sits on the transcript
 * background, outside any bubble, with its button in the platform's blue.
 *
 * The shapes come from `platformChrome`, so the transcript mirrors what actually
 * left the building, platform for platform.
 */
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ShoppingBag } from "lucide-react";

import { formatCurrency } from "../../../shared/lib/currency";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { platformChrome, resolveMessagePlatform } from "./messagePlatform.js";

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

const cardSubtitle = (card = {}, t, priceValue) => {
  const parts = [];
  if (priceValue > 0) parts.push(money(priceValue));
  if (clean(card.color)) parts.push(t("aiSupport.inbox.productCard.colorValue", { color: clean(card.color) }));
  if (clean(card.size)) parts.push(t("aiSupport.inbox.productCard.sizeValue", { size: clean(card.size) }));
  return parts.join(" · ");
};

function ProductCardMessage({
  message = {},
  cards = [],
  compact = false,
  platform: platformProp = "",
  variant = "desktop",
  chrome: chromeProp = null,
}) {
  const { t } = useTranslation();
  const items = asArray(cards).flatMap((card) => normalizeProductCard(card)).filter(Boolean);
  if (!items.length) return null;

  const platform = clean(platformProp) || resolveMessagePlatform(message);
  const chrome = chromeProp || platformChrome(platform, variant);
  // Meta draws a generic template as a white card on the conversation background.
  // WhatsApp draws the same product as part of the bubble it was sent in, so the
  // card there inherits the bubble instead of sitting on top of one.
  const standalone = chrome.cardMode === "standalone";
  const strip = items.length > 1;

  const renderCard = (card, index) => {
    const image = cardImage(card);
    const priceValue = Number(card.price ?? card.final_price ?? 0);
    const storefrontUrl = resolveStorefrontUrl(card);
    const name = card.product_name || card.name || card.title || t("aiSupport.inbox.productCard.product");
    const subtitle = cardSubtitle(card, t, priceValue);
    const action = card.color && (card.variant_id || card.id)
      ? t("aiSupport.inbox.productCard.chooseColorButton")
      : t("aiSupport.inbox.productCard.openProduct");
    // Every card of a colour carousel carries the SAME product_id, and an abandoned cart can
    // hold one product in two sizes — the product identity alone is not unique inside a strip,
    // so the position completes the key.
    const cardKey = `${clean(card.product_id || card.id)}:${clean(card.variant_id)}:${index}`;

    const picture = image ? (
      <img
        src={image}
        alt={name}
        loading="lazy"
        decoding="async"
        className={`aspect-square w-full object-contain ${chrome.cardImageBg}`}
      />
    ) : (
      <div className={`grid aspect-square w-full place-items-center ${chrome.cardImageBg}`}>
        <ShoppingBag className={`h-8 w-8 ${chrome.cardMuted}`} />
      </div>
    );

    if (standalone) {
      return (
        <article
          key={cardKey}
          className={`${chrome.cardWidth} ${strip ? "shrink-0 snap-start" : ""} overflow-hidden ${chrome.cardRadius} ${chrome.cardSurface} shadow-[0_1px_3px_rgba(0,0,0,0.25)]`}
        >
          {picture}
          <div className="px-3 py-2.5" dir="auto">
            <p className={`truncate text-[14px] font-semibold leading-5 ${chrome.cardTitle}`}>{name}</p>
            {subtitle ? <p className={`mt-0.5 truncate text-[12.5px] leading-4 ${chrome.cardMuted}`}>{subtitle}</p> : null}
          </div>
          {storefrontUrl ? (
            <>
              <span aria-hidden="true" className={`block h-px w-full ${chrome.cardHairline}`} />
              <a
                href={storefrontUrl}
                target="_blank"
                rel="noreferrer"
                className={`block px-3 py-2.5 text-center text-[14px] font-semibold ${chrome.cardAction}`}
              >
                {action}
              </a>
            </>
          ) : null}
        </article>
      );
    }

    return (
      /* Inside a bubble the strip has to fit the bubble, not the transcript, so a
         colour carousel is a row of narrower cards rather than one card the
         bubble crops. */
      <div key={cardKey} className={strip ? "w-[190px] shrink-0 snap-start" : "w-full"}>
        <div className="overflow-hidden rounded-[8px]">{picture}</div>
        <div className="px-0.5 pt-1.5" dir="auto">
          <p className={`text-[14px] font-semibold leading-5 ${chrome.cardTitle}`}>{name}</p>
          {subtitle ? <p className={`mt-0.5 text-[12.5px] leading-4 ${chrome.cardMuted}`}>{subtitle}</p> : null}
        </div>
        {storefrontUrl ? (
          <>
            <span aria-hidden="true" className={`my-1.5 block h-px w-full ${chrome.cardHairline}`} />
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center justify-center gap-1.5 py-1 text-[13.5px] font-semibold ${chrome.cardAction}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {action}
            </a>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div
      data-ai-product-card-density={compact ? "compact" : "default"}
      data-ai-product-card-platform={platform}
      /* Multi-card renders as the same horizontal swipe strip the customer gets —
         the transcript's job here is to mirror what actually left, card for card. */
      className={strip ? "flex max-w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-1" : "max-w-full"}
      style={{ contentVisibility: "auto", containIntrinsicSize: compact ? "260px" : "360px" }}
    >
      {items.map(renderCard)}
    </div>
  );
}

export default memo(ProductCardMessage);
