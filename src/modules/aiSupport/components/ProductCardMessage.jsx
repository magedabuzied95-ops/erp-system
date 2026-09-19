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
import { memo, useContext } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Reply, ShoppingBag } from "lucide-react";

import { formatCurrency } from "../../../shared/lib/currency";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { chromeModeFor, mirrorsCustomerCarousel, platformChrome, resolveMessagePlatform } from "./messagePlatform.js";
import { ThemeContext } from "../../../theme/themeContext";

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

/*
 * THE WORDS THE CUSTOMER ACTUALLY READS.
 *
 * A Messenger/Instagram colour carousel does not show the product name and an "EGP 900.00 ·
 * Colour: Bige" line — that was the inbox describing the card in its own voice. What leaves the
 * building is buildMetaCarouselElement (metaIntegrationService): the colour and the price as the
 * bold title, the sizes under their own label, and one button. This is that function read back,
 * so the operator sees the card the customer is looking at. The strings are the customer's copy,
 * Arabic on every ERP language — they are not interface text and must not be translated.
 */
const metaTemplateCopy = (card = {}) => {
  const priceValue = Number(card.price ?? card.final_price ?? 0);
  const priceText = priceValue > 0 ? `${priceValue.toLocaleString("en-US")} جنيه` : "";
  const title = [firstText(card.color, card.product_name, card.name, card.title), priceText].filter(Boolean).join(" — ");
  const sizes = [...new Set([...asArray(card.available_sizes), ...asArray(card.sizes), ...asArray(card.size_options)].map(clean).filter(Boolean))];
  const selectedSize = clean(card.size || card.selected_size);
  const subtitle = selectedSize
    ? `المقاس: ${selectedSize}`
    : sizes.length
      ? `المقاسات المتاحة:
${sizes.join(" · ")}`
      : "";
  const button = clean(card.variant_id || card.price_variant_id) ? "اطلب اللون ده ✅" : "عرض المنتج";
  return { title, subtitle, button };
};

/*
 * The same, for WhatsApp. The Evolution carousel card (sendWhatsAppCloudReply,
 * aiChannelAdapterService) is three plain lines — colour, price, "المقاسات: 41 / 42" capped at
 * six — over one button: a reply button when the card knows its variant, a link when it does not.
 */
const whatsappCarouselCopy = (card = {}) => {
  const priceValue = Number(card.price ?? card.final_price ?? 0);
  const priceText = clean(card.price_text) || (priceValue > 0 ? `${Math.round(priceValue).toLocaleString("en-US")} جنيه` : "");
  const sizes = [...new Set([...asArray(card.sizes), ...asArray(card.available_sizes)].map(clean).filter(Boolean))];
  const lines = [
    firstText(card.color, card.product_name, card.name, card.title),
    priceText,
    sizes.length ? `المقاسات: ${sizes.slice(0, 6).join(" / ")}` : "",
  ].filter(Boolean);
  const isReply = Boolean(clean(card.variant_id || card.price_variant_id));
  return { lines, isReply, button: isReply ? "اطلب اللون ده ✅" : "شوف المنتج 🛒" };
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
  const themeMode = useContext(ThemeContext)?.theme?.mode;
  const items = asArray(cards).flatMap((card) => normalizeProductCard(card)).filter(Boolean);
  if (!items.length) return null;

  const platform = clean(platformProp) || resolveMessagePlatform(message);
  // The transcript hands its own chrome down; this fallback only fires when the
  // card is rendered on its own.
  const chrome = chromeProp || platformChrome(platform, chromeModeFor(variant, themeMode));
  // Meta draws a generic template as a white card on the conversation background.
  // WhatsApp draws the same product as part of the bubble it was sent in, so the
  // card there inherits the bubble instead of sitting on top of one.
  const standalone = chrome.cardMode === "standalone";
  const strip = items.length > 1;
  // Only the carousel leaves as this template; a single card goes out in another shape.
  const mirrorsCarousel = mirrorsCustomerCarousel(platform, items.length);
  // A colour the operator picked on its own leaves Messenger/Instagram as that same template
  // card, alone (send_scope, set by the picker and kept on the stored card).
  const pickedOneColorTemplate =
    items.length === 1 &&
    ["instagram", "messenger"].includes(platform) &&
    ["color", "color_size"].includes(clean(items[0]?.send_scope));
  const mirrorsMetaTemplate = (mirrorsCarousel && platform !== "whatsapp") || pickedOneColorTemplate;
  const mirrorsWhatsappCarousel = mirrorsCarousel && platform === "whatsapp";

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
        style={{ background: chrome.cardImageBg }}
        className="aspect-square w-full object-contain"
      />
    ) : (
      <div style={{ background: chrome.cardImageBg }} className="grid aspect-square w-full place-items-center">
        <ShoppingBag style={{ color: chrome.cardMuted }} className="h-8 w-8" />
      </div>
    );

    if (mirrorsWhatsappCarousel) {
      const copy = whatsappCarouselCopy(card);
      const ButtonIcon = copy.isReply ? Reply : ArrowUpRight;
      return (
        <article
          key={cardKey}
          style={{ width: "236px", background: chrome.cardBg, color: chrome.cardInk, borderRadius: "12px" }}
          className="shrink-0 snap-start overflow-hidden p-1 shadow-[0_1px_1px_rgba(0,0,0,0.13)]"
        >
          <div className="overflow-hidden rounded-[9px]">{picture}</div>
          <div className="px-1.5 pb-1.5 pt-1.5" dir="auto">
            {copy.lines.map((line, lineIndex) => (
              <p key={lineIndex} style={{ color: chrome.cardInk }} className="text-[14px] leading-[19px]">{line}</p>
            ))}
          </div>
          <span aria-hidden="true" style={{ background: chrome.cardLine }} className="block h-px w-full" />
          <a
            href={copy.isReply ? undefined : storefrontUrl || undefined}
            target="_blank"
            rel="noreferrer"
            style={{ color: chrome.cardAction }}
            className="flex items-center justify-center gap-1.5 py-2 text-[14px] font-medium"
          >
            <ButtonIcon className="h-4 w-4" />
            {copy.button}
          </a>
        </article>
      );
    }

    if (mirrorsMetaTemplate) {
      const copy = metaTemplateCopy(card);
      return (
        <article
          key={cardKey}
          style={{ width: chrome.cardWidth, background: chrome.cardBg, color: chrome.cardInk, borderRadius: chrome.radius }}
          className="shrink-0 snap-start overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
        >
          {picture}
          <div className="px-3 pb-3 pt-2.5" dir="auto">
            <p style={{ color: chrome.cardInk }} className="text-[15px] font-bold leading-5">{copy.title || name}</p>
            {copy.subtitle ? (
              <p style={{ color: chrome.cardMuted }} className="mt-0.5 whitespace-pre-line text-[13px] leading-[18px]">{copy.subtitle}</p>
            ) : null}
            <a
              href={storefrontUrl || undefined}
              target="_blank"
              rel="noreferrer"
              style={{ background: chrome.cardButtonBg, color: chrome.cardButtonInk }}
              className="mt-2.5 block rounded-[10px] px-3 py-2 text-center text-[14px] font-bold"
            >
              {copy.button}
            </a>
          </div>
        </article>
      );
    }

    if (standalone) {
      return (
        <article
          key={cardKey}
          style={{ width: chrome.cardWidth, background: chrome.cardBg, color: chrome.cardInk, borderRadius: chrome.radius }}
          className={`${strip ? "shrink-0 snap-start" : ""} overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.25)]`}
        >
          {picture}
          <div className="px-3 py-2.5" dir="auto">
            <p style={{ color: chrome.cardInk }} className="truncate text-[14px] font-semibold leading-5">{name}</p>
            {subtitle ? <p style={{ color: chrome.cardMuted }} className="mt-0.5 truncate text-[12.5px] leading-4">{subtitle}</p> : null}
          </div>
          {storefrontUrl ? (
            <>
              <span aria-hidden="true" style={{ background: chrome.cardLine }} className="block h-px w-full" />
              <a
                href={storefrontUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: chrome.cardAction }}
                className="block px-3 py-2.5 text-center text-[14px] font-semibold"
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
          <p style={{ color: chrome.cardInk }} className="text-[14px] font-semibold leading-5">{name}</p>
          {subtitle ? <p style={{ color: chrome.cardMuted }} className="mt-0.5 text-[12.5px] leading-4">{subtitle}</p> : null}
        </div>
        {storefrontUrl ? (
          <>
            <span aria-hidden="true" style={{ background: chrome.cardLine }} className="my-1.5 block h-px w-full" />
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: chrome.cardAction }}
              className="flex items-center justify-center gap-1.5 py-1 text-[13.5px] font-semibold"
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
