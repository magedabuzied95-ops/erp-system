import db from "../database/db.js";
import {
  loadTenantSaleModeSettings,
  resolveCustomerDisplayPrice,
  resolveSocialProductDisplayPrice,
} from "../utils/customerDisplayPrice.js";
import { getPublicAppUrl, getPublicBackendUrl } from "../utils/publicUrl.js";
import { tidyGreetingText } from "../utils/greetingText.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const isAbsoluteHttpUrl = (value = "") => /^https?:\/\//i.test(text(value));
const toFiniteNumber = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const renderTemplateText = (template = "", context = {}) =>
  String(template || "").replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return String(context[key] ?? context[key.toLowerCase()] ?? "").trim();
  });

export const GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY = "تم الرد على حضرتك في الخاص ✅";
export const SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX = "SOCIAL_SIZE_SELECT::";
export const SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX = "SOCIAL_COLOR_SELECT::";
export const SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX = "SOCIAL_ORDER_ACTION::";
// Several products in one conversation make a bare "الأسود" ambiguous. These buttons name the
// model, so the tap says which product before the colour and size questions start.
export const SOCIAL_COMMENT_PRODUCT_QUICK_REPLY_PREFIX = "SOCIAL_PRODUCT_SELECT::";

export const sortSocialCommentAvailableSizes = (values = []) =>
  asArray(values)
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => {
      const leftNumber = Number.parseFloat(left);
      const rightNumber = Number.parseFloat(right);
      const leftIsNumber = Number.isFinite(leftNumber);
      const rightIsNumber = Number.isFinite(rightNumber);
      if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
      if (leftIsNumber) return -1;
      if (rightIsNumber) return 1;
      return left.localeCompare(right, "ar", { numeric: true, sensitivity: "base" });
    });

const publicAppBaseUrl = () => text(getPublicAppUrl()).replace(/\/+$/g, "");

// Uploaded files are served by the BACKEND, not by the storefront. Sending `/uploads/...` to the
// app origin does not 404 — the SPA answers every unknown path with index.html and a 200 — so
// Meta fetched HTML where it expected a JPEG and rendered every carousel card without a picture,
// with nothing logged anywhere. Products migrated to Cloudinary store an absolute URL and were
// unaffected, which is why only newly uploaded products lost their images.
export const ensureAbsoluteSocialAssetUrl = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  if (isAbsoluteHttpUrl(normalized)) return normalized;
  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const assetBaseUrl = /^\/uploads\//i.test(path)
    ? text(getPublicBackendUrl()).replace(/\/+$/g, "") || publicAppBaseUrl()
    : publicAppBaseUrl();
  if (!assetBaseUrl) return normalized;
  return `${assetBaseUrl}${path}`;
};

export const ensureAbsoluteSocialProductLink = (value = "") => {
  const normalized = text(value);
  if (!normalized) {
    const publicUrl = publicAppBaseUrl();
    return publicUrl ? `${publicUrl}/shop/products` : "";
  }
  return ensureAbsoluteSocialAssetUrl(normalized);
};

const absolutizeRelativeShopLinks = (value = "") =>
  String(value || "").replace(/(^|[\s(])((?:\/shop\/[^\s)\]]+))/g, (_match, prefix, relativePath) => {
    return `${prefix}${ensureAbsoluteSocialProductLink(relativePath)}`;
  });

const DEFAULT_SIZE_FALLBACK = "ابعتلنا المقاس المطلوب وهنراجع التوفر لحضرتك فورًا.";
// Used when the colour buttons could not ride the message (Instagram, or a failed visual): the
// customer still has to name a colour before a size, so the ask survives as plain text.
const DEFAULT_COLOR_THEN_SIZE_FALLBACK = "ابعتلنا اللون المطلوب الأول وبعدين المقاس وهنراجع التوفر لحضرتك فورًا.";
const DEFAULT_COLOR_LABEL = "غير محدد";

const normalizeSocialCommentColorPart = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const colorMap = {
    black: "أسود",
    white: "أبيض",
    grey: "رمادي",
    gray: "رمادي",
    red: "أحمر",
    blue: "أزرق",
    green: "أخضر",
    yellow: "أصفر",
    beige: "بيج",
    brown: "بني",
    pink: "وردي",
    purple: "بنفسجي",
    orange: "برتقالي",
    navy: "كحلي",
    camel: "جملي",
  };
  return colorMap[lower] || raw;
};

export const normalizeSocialCommentColorDisplay = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  // "and" and "و" only separate colours when they stand alone as words. Matching them anywhere
  // tore real colour names apart: "Burgandy" became "Burg / y" and "أسود وأبيض" became
  // "أس / د / أبيض". Punctuation separators need no such guard.
  const parts = raw
    .split(/\s*[&/+]\s*|\s+(?:and|و)\s+/i)
    .map((part) => normalizeSocialCommentColorPart(part))
    .filter(Boolean);
  if (parts.length > 1) return parts.join(" / ");
  return normalizeSocialCommentColorPart(raw) || raw;
};

// A typed colour has to be resolved back to the string the catalog stores, or the variant lookup
// misses: the customer writes "الابيض", the row says "White". Both sides are pushed through the
// same display normaliser (which already maps English → Arabic), stripped of the definite article
// and of diacritic-ish alef variants, then compared exactly before falling back to containment.
const colorMatchKey = (value = "") =>
  normalizeSocialCommentColorDisplay(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\bال(?=\p{L})/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// "ابيض واسود" writes the joining "و" onto the next word, so the key comes out as
// "ابيض واسود" while the catalog key is "ابيض اسود". Dropping a leading "و" off each token
// repairs that — but a real colour can start with one ("وردي" → "ردي"), so the stripped form is
// only ever accepted on an EXACT key match, never on containment.
const colorMatchKeyWithoutJoiners = (key = "") =>
  key.split(" ").map((token) => (token.length > 2 && token.startsWith("و") ? token.slice(1) : token)).join(" ");

export const matchSocialCommentColorInput = (input = "", catalogColors = []) => {
  const needle = colorMatchKey(input);
  if (!needle) return "";
  const candidates = asArray(catalogColors).map(text).filter(Boolean);
  const keyed = candidates.map((color) => ({ color, key: colorMatchKey(color) }));
  const exact = keyed.find((entry) => entry.key && entry.key === needle);
  if (exact) return exact.color;
  const dejoined = colorMatchKeyWithoutJoiners(needle);
  if (dejoined !== needle) {
    const dejoinedExact = keyed.find((entry) => entry.key && entry.key === dejoined);
    if (dejoinedExact) return dejoinedExact.color;
  }
  // "عايز الأسود" — the colour is a word inside the sentence. Longest catalog key first so
  // "White & Black" wins over "White" when the customer typed both.
  const contained = keyed
    .filter((entry) => entry.key && (needle.includes(entry.key) || entry.key.includes(needle)))
    .sort((left, right) => right.key.length - left.key.length);
  return contained.length === 1 || (contained.length > 1 && contained[0].key.length > contained[1].key.length)
    ? contained[0].color
    : "";
};

const normalizePriceText = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = toFiniteNumber(normalized);
  if (!Number.isFinite(parsed)) return normalized;
  if (parsed <= 0) return "";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed.toFixed(2)).replace(/\.?0+$/g, "");
};

const hasUsablePriceValue = (value = "") => {
  const normalized = normalizePriceText(value);
  if (!normalized) return false;
  const parsed = toFiniteNumber(normalized);
  if (parsed === null) return true;
  // Zero is "not priced yet", not "free" — quoting 0 to a customer is worse than
  // omitting the price line entirely.
  return parsed > 0;
};

const priceCandidates = (...values) =>
  values
    .map((value) => normalizePriceText(value))
    .filter(Boolean);

const pickFirstPrice = (...values) => priceCandidates(...values)[0] || "";

const resolveSocialCommentDisplayPrice = async ({
  tenantId = null,
  base = {},
  primaryProduct = {},
  variants = [],
  callsite = "",
} = {}) => {
  const socialPriceInfo = await resolveSocialProductDisplayPrice({
    tenantId,
    product: primaryProduct,
    productContext: base,
    linkedProduct: primaryProduct?.product || primaryProduct?.linkedProduct || primaryProduct?.linked_product || {},
    variants,
    availableVariants: variants,
    context: {
      product_id: base.product_id || primaryProduct.product_id || primaryProduct.id || null,
      product_name: base.product_name || primaryProduct.name || primaryProduct.product_name || "",
    },
    callsite,
  });
  const resolved = resolveCustomerDisplayPrice({
    ...primaryProduct,
    ...base,
    product: primaryProduct,
  });
  const displayPrice = normalizePriceText(socialPriceInfo.selected_display_price || resolved.display_price);
  const oldPrice = normalizePriceText(resolved.old_price);
  return {
    priceUsed: displayPrice,
    salePriceUsed: resolved.sale_active ? displayPrice : "",
    regularPriceUsed: oldPrice || (!resolved.sale_active ? displayPrice : ""),
    hasValidPrice: socialPriceInfo.has_valid_price,
  };
};

const variantStockCount = (variant = {}) => {
  const candidates = [
    variant.stock,
    variant.current_stock,
    variant.available_stock,
    variant.stock_quantity,
    variant.quantity,
    variant.total_stock,
  ];
  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const variantSizeLabel = (variant = {}) =>
  text(variant.size || variant.size_label || variant.variant_size || variant.option1 || "");

const filterInStockVariants = (values = []) =>
  asArray(values).filter((variant) => variant && typeof variant === "object" && variantStockCount(variant) > 0);

const loadAvailableVariantRows = async ({ tenantId = null, productId = null } = {}) => {
  const safeProductId = Number(productId || 0);
  if (!Number.isFinite(safeProductId) || safeProductId <= 0) return [];
  const safeTenantId = Number(tenantId || 0);
  const result = await db.query(
    `
    SELECT
      id,
      size,
      color,
      COALESCE(stock, 0) AS stock
    FROM product_variants
    WHERE product_id = $1
      AND ($2::bigint <= 0 OR tenant_id = $2::bigint OR tenant_id IS NULL)
      AND COALESCE(stock, 0) > 0
    ORDER BY
      CASE
        WHEN NULLIF(REGEXP_REPLACE(COALESCE(size, ''), '[^0-9.]', '', 'g'), '') IS NULL THEN 1
        ELSE 0
      END,
      NULLIF(REGEXP_REPLACE(COALESCE(size, ''), '[^0-9.]', '', 'g'), '')::numeric NULLS LAST,
      COALESCE(size, '') ASC,
      id ASC
    `,
    [safeProductId, safeTenantId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
};

// One row per in-stock COLOUR, with the best photo we have for it: a gallery image tied to the
// exact variant first, then one tied to the colour name, then the colour's own variant image.
// A colour with no photo of its own is not a carousel card — three identical photos labelled
// three different colours is worse than the single product card it replaces.
const loadColorCardRows = async ({ tenantId = null, productId = null } = {}) => {
  const safeProductId = Number(productId || 0);
  if (!Number.isFinite(safeProductId) || safeProductId <= 0) return [];
  const safeTenantId = Number(tenantId || 0);
  const result = await db.query(
    `
    SELECT
      LOWER(TRIM(COALESCE(pv.color, ''))) AS color_key,
      MIN(TRIM(COALESCE(pv.color, ''))) AS color_label,
      MIN(COALESCE(pv.color_sort_order, 0)) AS color_sort_order,
      COALESCE(MAX(NULLIF(TRIM(COALESCE(pvi.image_url, '')), '')), '') AS gallery_image_url,
      COALESCE(MAX(NULLIF(TRIM(COALESCE(pv.image_url, '')), '')), '') AS variant_image_url,
      -- The RAW price columns of this colour's in-stock variants, never a COALESCE over them: the
      -- canonical resolver decides which one is the customer price (a hand-rolled COALESCE is how
      -- purchase_selling_price kept getting lost). One card per colour means one PRICE per colour.
      COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', pv.id,
            'manual_price_override_active', pv.manual_price_override_active,
            'manual_selling_price', pv.manual_selling_price,
            'purchase_selling_price', pv.purchase_selling_price,
            'selling_price', pv.selling_price,
            'price', pv.price,
            'regular_price', pv.regular_price,
            'sale_price', pv.sale_price,
            'sale_price_enabled', pv.sale_price_enabled
          ) ORDER BY pv.id
        ),
        '[]'::json
      ) AS price_variants
    FROM product_variants pv
    LEFT JOIN LATERAL (
      SELECT i.image_url
      FROM product_variant_images i
      WHERE i.product_id = pv.product_id
        AND COALESCE(i.image_url, '') <> ''
        AND (
          i.variant_id = pv.id
          OR LOWER(TRIM(COALESCE(i.color_name, ''))) = LOWER(TRIM(COALESCE(pv.color, '')))
        )
      ORDER BY
        CASE WHEN i.variant_id = pv.id THEN 0 ELSE 1 END,
        CASE WHEN i.is_primary THEN 0 ELSE 1 END,
        i.sort_order ASC,
        i.id ASC
      LIMIT 1
    ) pvi ON TRUE
    WHERE pv.product_id = $1
      AND ($2::bigint <= 0 OR pv.tenant_id = $2::bigint OR pv.tenant_id IS NULL)
      AND COALESCE(pv.stock, 0) > 0
      AND TRIM(COALESCE(pv.color, '')) <> ''
    GROUP BY 1
    ORDER BY MIN(COALESCE(pv.color_sort_order, 0)) ASC, MIN(pv.id) ASC
    `,
    [safeProductId, safeTenantId]
  );
  return Array.isArray(result.rows) ? result.rows : [];
};

const colorGroupKey = (value = "") => text(value).toLowerCase();

// The storefront product page preselects a colour from ?color=, so every card lands the customer
// on the colour they tapped. Size is deliberately left out: they pick that from the DM buttons.
const buildColorProductLink = (baseLink = "", color = "") => {
  const normalizedBase = text(baseLink);
  const normalizedColor = text(color);
  if (!normalizedBase || !normalizedColor) return normalizedBase;
  try {
    const url = new URL(normalizedBase);
    url.searchParams.set("color", normalizedColor);
    return url.toString();
  } catch {
    return normalizedBase;
  }
};

// The customer price of ONE colour, resolved from that colour's own variant rows by the canonical
// authority. Returns null when the colour owns no price of its own — the card then keeps the
// product-level price, exactly as before.
const resolveColorRowPrice = (row = {}, saleModeSettings = null) => {
  const variants = asArray(row?.price_variants).filter((variant) => variant && typeof variant === "object");
  for (const variant of variants) {
    const resolved = resolveCustomerDisplayPrice(
      { product: {}, variant, selected_variant: variant },
      { saleModeSettings }
    );
    const price = toFiniteNumber(resolved?.display_price);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
};

// Colours that really are priced differently must card differently. When every colour resolves to
// the same number — the normal case — the cards keep the single product-level price they already
// used, so this can only ever split a price that was WRONG, never move one that was right.
const applyDistinctColorPrices = (cards = []) => {
  const distinct = new Set(cards.map((card) => card.price).filter((price) => Number.isFinite(price) && price > 0));
  if (distinct.size < 2) return cards.map((card) => ({ ...card, price: null, priceText: "" }));
  return cards;
};

export const buildSocialCommentColorCards = ({
  variantRows = [],
  colorRows = [],
  productName = "",
  productLink = "",
  saleModeSettings = null,
} = {}) => {
  const sizesByColor = new Map();
  for (const variant of asArray(variantRows)) {
    const key = colorGroupKey(variant?.color || "");
    if (!key) continue;
    const size = variantSizeLabel(variant);
    if (!size) continue;
    if (!sizesByColor.has(key)) sizesByColor.set(key, []);
    const sizes = sizesByColor.get(key);
    if (!sizes.includes(size)) sizes.push(size);
  }
  const cards = asArray(colorRows)
    .map((row) => {
      const colorKey = colorGroupKey(row?.color_key || row?.color_label || "");
      const colorValue = text(row?.color_label || row?.color_key || "");
      const imageUrl = ensureAbsoluteSocialAssetUrl(
        text(row?.gallery_image_url || "") || text(row?.variant_image_url || "")
      );
      if (!colorKey || !imageUrl) return null;
      const price = resolveColorRowPrice(row, saleModeSettings);
      return {
        colorKey,
        color: colorValue,
        colorLabel: normalizeSocialCommentColorDisplay(colorValue) || colorValue,
        productName: text(productName),
        imageUrl,
        productLink: buildColorProductLink(productLink, colorValue),
        sizes: sortSocialCommentAvailableSizes(sizesByColor.get(colorKey) || []),
        price,
        priceText: normalizePriceText(price),
      };
    })
    .filter(Boolean)
    .filter((card, index, cards) => cards.findIndex((item) => item.colorKey === card.colorKey) === index);
  return applyDistinctColorPrices(cards);
};

// A carousel earns its place only when it shows something a single card cannot: two or more
// colours, each with its OWN photo. Otherwise the proven single-card path stays.
export const socialCommentCarouselEligible = (colorCards = []) => {
  const cards = asArray(colorCards);
  if (cards.length < 2) return false;
  const distinctImages = new Set(cards.map((card) => text(card.imageUrl)).filter(Boolean));
  return distinctImages.size >= 2;
};

export const normalizeSocialCommentProductContext = async ({ tenantId = null, productContext = {} } = {}) => {
  const primaryProduct = productContext?.primary_product || {};
  const productId = Number(productContext?.product_id || primaryProduct?.product_id || primaryProduct?.id || 0) || null;
  const stockedContextVariants = filterInStockVariants(
    productContext?.available_variants ||
    productContext?.variants ||
    primaryProduct?.available_variants ||
    primaryProduct?.variants ||
    []
  );
  let availableVariantRows = stockedContextVariants.map((variant) => ({
    size: variantSizeLabel(variant),
    stock: variantStockCount(variant),
    color: text(variant.color || ""),
  }));
  if (!availableVariantRows.length && productId) {
    availableVariantRows = await loadAvailableVariantRows({ tenantId, productId }).catch(() => []);
  }
  const availableSizes = sortSocialCommentAvailableSizes(
    availableVariantRows.length
      ? availableVariantRows.map((variant) => variantSizeLabel(variant))
      : (
          productContext?.available_sizes ||
          productContext?.sizes ||
          primaryProduct?.available_sizes ||
          primaryProduct?.sizes ||
          []
        )
  );
  const productLink = ensureAbsoluteSocialProductLink(
    productContext?.product_link ||
    productContext?.product_url ||
    productContext?.storefront_url ||
    primaryProduct?.product_link ||
    primaryProduct?.product_url ||
    primaryProduct?.storefront_url ||
    ""
  );
  const productImageUrl = ensureAbsoluteSocialAssetUrl(
    productContext?.product_image_url ||
    productContext?.image_url ||
    productContext?.image ||
    primaryProduct?.product_image_url ||
    primaryProduct?.image_url ||
    primaryProduct?.image ||
    primaryProduct?.main_image ||
    ""
  );
  const productName = text(productContext?.product_name || primaryProduct?.name || primaryProduct?.product_name || "") || "المنتج";
  const priceResolution = await resolveSocialCommentDisplayPrice({
    tenantId,
    base: {
      sale_active: productContext?.sale_active ?? productContext?.is_sale_active ?? productContext?.on_sale ?? productContext?.sale_enabled ?? productContext?.discount_enabled ?? productContext?.has_sale,
      sale_price: productContext?.sale_price,
      selling_price: productContext?.selling_price,
      price: productContext?.price,
      regular_price: productContext?.final_price,
    },
    primaryProduct: {
      ...primaryProduct,
      sale_active: primaryProduct?.sale_active ?? primaryProduct?.is_sale_active ?? primaryProduct?.on_sale ?? primaryProduct?.sale_enabled ?? primaryProduct?.discount_enabled ?? primaryProduct?.has_sale,
    },
    variants: availableVariantRows,
    callsite: "socialCommentPrivateReplyService.normalizeSocialCommentProductContext",
  });
  // Only worth a query when more than one colour is actually in stock — a single-colour product
  // can never produce a carousel, and this runs on every inbound comment.
  const distinctStockedColors = new Set(
    availableVariantRows.map((variant) => colorGroupKey(variant?.color || "")).filter(Boolean)
  );
  const colorRows = productId && distinctStockedColors.size >= 2
    ? await loadColorCardRows({ tenantId, productId }).catch((error) => {
        console.warn("SOCIAL_COMMENT_COLOR_CARDS_LOAD_FAILED", {
          product_id: productId,
          message: text(error?.message),
        });
        return [];
      })
    : [];
  // The per-colour price is resolved by the canonical authority, which needs the GLOBAL Sale Mode
  // state; without it every colour fails safe to the normal price. Only loaded when there are
  // colour rows to price.
  const saleModeSettings = colorRows.length
    ? await loadTenantSaleModeSettings({ tenantId }).catch(() => ({ sale_mode_enabled: false }))
    : null;
  const colorCards = buildSocialCommentColorCards({
    variantRows: availableVariantRows,
    colorRows,
    productName,
    productLink,
    saleModeSettings,
  });
  const carouselEligible = socialCommentCarouselEligible(colorCards);
  // The exact colour STRINGS the catalog stores, in stock, deduplicated. These are what the
  // colour buttons carry and what the variant lookup matches on, so they must not be prettified.
  const availableColors = availableVariantRows
    .map((variant) => text(variant?.color || ""))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  return {
    hasProductContext: Boolean(productContext?.found || productContext?.has_product_context),
    productId,
    productName,
    availableSizes,
    availableSizesLabel: availableSizes.length ? availableSizes.join(" | ") : DEFAULT_SIZE_FALLBACK,
    availableColors,
    availableVariantsCount: availableVariantRows.length,
    availableVariantRows,
    colorCards,
    carouselEligible,
    productLink,
    productImageUrl,
    priceUsed: priceResolution.priceUsed,
    salePriceUsed: priceResolution.salePriceUsed,
    regularPriceUsed: priceResolution.regularPriceUsed,
  };
};

// The DM no longer repeats the price, the size list or the link: the cards sent just before it
// already carry all three, and reading them twice is how a short reply turns into a wall of text.
// The text's only job is to say what to do with the cards and the buttons.
const CAROUSEL_BROWSE_LINE = "عشان تشوف الألوان والمقاسات المتاحة من كل لون دوس يمين وشمال على الكروت،";
const SINGLE_CARD_BROWSE_LINE = "عشان تشوف المقاسات المتاحة بصّ على الكارت فوق،";
const PICK_SIZE_LINE = "واختار مقاسك من الأزرار تحت 👇";
// Colour first, then size. Asking for a size while several colours are on screen is what let a
// customer press "40" without ever saying which colour he meant — the flow then picked one for
// him. The size buttons only come back once the colour is settled.
const PICK_COLOR_LINE = "واختار اللون الأول من الأزرار تحت 👇";

// Messenger sometimes refuses a message that carries quick replies, and the sender then retries
// with plain text. Pointing at buttons that were dropped on the retry reads as a broken message,
// so the ask becomes a plain question instead.
export const swapSizeButtonsCtaForPlainAsk = (message = "") => {
  const normalized = String(message || "");
  const withoutColorCta = normalized.includes(PICK_COLOR_LINE)
    ? normalized.split(PICK_COLOR_LINE).join(DEFAULT_COLOR_THEN_SIZE_FALLBACK)
    : normalized;
  if (!withoutColorCta.includes(PICK_SIZE_LINE)) return withoutColorCta;
  return withoutColorCta.split(PICK_SIZE_LINE).join(DEFAULT_SIZE_FALLBACK);
};

// The card lines only make sense when a card actually arrived. When the text is all that goes
// out — Instagram refused the visual, or every Messenger visual failed — "look at the card above"
// points at nothing, so those lines come out. The size-button line stays only when the buttons
// really ride on this message (Messenger quick replies); otherwise it becomes a plain question.
export const stripCardPointersFromText = (message = "", { keepSizeButtons = false } = {}) => {
  const base = keepSizeButtons ? String(message || "") : swapSizeButtonsCtaForPlainAsk(message);
  return base
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== CAROUSEL_BROWSE_LINE && trimmed !== SINGLE_CARD_BROWSE_LINE;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const buildProductReplySections = ({ customerName = "", normalizedContext = {} } = {}) => {
  // No sizes means no size buttons underneath — pointing at buttons that were never attached
  // reads as a broken message, so the ask becomes a plain question instead.
  const hasSizes = Array.isArray(normalizedContext.availableSizes)
    ? normalizedContext.availableSizes.length > 0
    : Boolean(normalizedContext.availableSizesLabel) && normalizedContext.availableSizesLabel !== DEFAULT_SIZE_FALLBACK;
  const hasColorChoice = Array.isArray(normalizedContext.availableColors) && normalizedContext.availableColors.length > 1;
  return [
    text(customerName) ? `أهلاً بحضرتك يا ${text(customerName)} ✨` : "أهلاً بحضرتك ✨",
    "",
    normalizedContext.carouselEligible ? CAROUSEL_BROWSE_LINE : SINGLE_CARD_BROWSE_LINE,
    hasColorChoice ? PICK_COLOR_LINE : hasSizes ? PICK_SIZE_LINE : DEFAULT_SIZE_FALLBACK,
    "",
    "متاح شحن لجميع المحافظات",
    "متاح الدفع عند الاستلام ❤️",
    "",
    "لو محتاج مساعدة في اختيار المقاس أو عندك أي استفسار، إحنا معاك في أي وقت ❤️",
  ];
};

export const buildPolishedSocialCommentProductReply = ({
  customerName = "",
  productContext = {},
} = {}) => {
  const normalizedContext = productContext && typeof productContext === "object" && productContext.__normalized_private_reply_context
    ? productContext
    : {
        productName: text(productContext?.product_name || "") || "المنتج",
        priceUsed: normalizePriceText(productContext?.selling_price || productContext?.sale_price || productContext?.price || ""),
        availableSizes: sortSocialCommentAvailableSizes(productContext?.available_sizes || []),
        availableSizesLabel: sortSocialCommentAvailableSizes(productContext?.available_sizes || []).join(" | ") || DEFAULT_SIZE_FALLBACK,
        productLink: ensureAbsoluteSocialProductLink(productContext?.product_link || productContext?.product_url || productContext?.storefront_url || ""),
        availableColors: asArray(productContext?.available_colors).map(text).filter(Boolean),
        carouselEligible: Boolean(productContext?.carousel_eligible),
      };
  return buildProductReplySections({ customerName, normalizedContext }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const sanitizeRenderedPrivateReplyMessage = ({
  message = "",
  normalizedContext = {},
} = {}) => {
  const rawLines = String(message || "").replace(/\r\n/g, "\n").split("\n");
  const cleanedLines = [];
  const hasPrice = hasUsablePriceValue(normalizedContext.priceUsed);
  const hasSizes = Array.isArray(normalizedContext.availableSizes) && normalizedContext.availableSizes.length > 0;
  const sizesInlineValue = hasSizes ? normalizedContext.availableSizes.join(" | ") : DEFAULT_SIZE_FALLBACK;

  for (const rawLine of rawLines) {
    const line = text(rawLine);
    if (!line) {
      cleanedLines.push("");
      continue;
    }
    if (!hasPrice && (
      line.includes("{{price}}") ||
      line.includes("{{formatted_price}}") ||
      line.includes("متاح بسعر") ||
      line === "السعر:" ||
      line.startsWith("السعر:")
    )) {
      continue;
    }

    let nextLine = absolutizeRelativeShopLinks(line).replace(/\bIN STOCK\b/gi, "");

    if (line === "المقاسات المتاحة:") {
      nextLine = line;
    } else if (line.includes("{{available_sizes}}") || line.startsWith("المقاسات المتاحة:")) {
      nextLine = `المقاسات المتاحة: ${sizesInlineValue}`;
    }

    nextLine = nextLine
      .replace(/\{\{\s*available_sizes\s*\}\}/gi, sizesInlineValue)
      .replace(/\{\{\s*product_link\s*\}\}/gi, normalizedContext.productLink || "")
      .replace(/\{\{\s*price\s*\}\}/gi, normalizedContext.priceUsed || "")
      .replace(/\{\{\s*formatted_price\s*\}\}/gi, normalizedContext.priceUsed || "")
      .replace(/متاح\s+بسعر\s*\.\s*/gi, "")
      .replace(/متاح\s+بسعر/gi, "")
      .trimEnd();

    if (!nextLine) continue;
    cleanedLines.push(nextLine);
  }

  const compacted = [];
  for (const line of cleanedLines) {
    if (!line && !compacted.length) continue;
    if (!line && !compacted[compacted.length - 1]) continue;
    compacted.push(line);
  }

  // Last step before the message leaves: an empty {{customer_name}} must not ship as
  // "أهلاً بحضرتك يا  ❤️".
  return tidyGreetingText(compacted.join("\n").replace(/\n{3,}/g, "\n\n").trim());
};

// The colour is chosen first, so a size button carries the colour it belongs to: pressing "42"
// after picking White can never be read back as "42 in Black". `selectedColor` is empty only on
// the single-colour path, where there is nothing to confuse it with.
export const buildSocialCommentSizeQuickReplies = ({
  productContext = null,
  selectedColor = "",
  postId = "",
  commentId = "",
  conversationId = "",
} = {}) => {
  const safeProductId = Number(productContext?.product_id || productContext?.primary_product?.product_id || productContext?.primary_product?.id || 0) || null;
  const sizes = sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []).slice(0, 11);
  if (!safeProductId || !sizes.length) return [];
  return sizes.map((size) => ({
    content_type: "text",
    title: size.slice(0, 20),
    payload: `${SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX}${JSON.stringify({
      size,
      color: text(selectedColor),
      product_id: safeProductId,
      post_id: text(postId),
      comment_id: text(commentId),
      conversation_id: text(conversationId),
    })}`,
  }));
};

// Colour comes BEFORE size now, so these buttons have to build with no size in hand — the old
// builder required one and silently returned [], which is why the first message could only ever
// offer sizes. A size is still carried when one is already known (the customer changed colour
// after picking a size), so the flow can skip straight back to the summary.
export const buildSocialCommentColorQuickReplies = ({
  productId = null,
  selectedSize = "",
  colors = [],
  postId = "",
  commentId = "",
  conversationId = "",
} = {}) => {
  const safeProductId = Number(productId || 0) || null;
  const safeSelectedSize = text(selectedSize);
  const normalizedColors = asArray(colors)
    .map((value) => text(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 11);
  if (!safeProductId || !normalizedColors.length) return [];
  return normalizedColors.map((color) => ({
    content_type: "text",
    title: color.slice(0, 20),
    payload: `${SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX}${JSON.stringify({
      color,
      size: safeSelectedSize,
      product_id: safeProductId,
      post_id: text(postId),
      comment_id: text(commentId),
      conversation_id: text(conversationId),
    })}`,
  }));
};

// One button per model, for the moment a typed colour or size could belong to any of several
// products already sent into this conversation.
export const buildSocialCommentProductQuickReplies = ({
  products = [],
  postId = "",
  commentId = "",
  conversationId = "",
} = {}) => {
  const seen = new Set();
  return asArray(products)
    .map((product) => ({
      productId: Number(product?.product_id || product?.id || 0) || null,
      name: text(product?.name || product?.product_name || product?.title || ""),
    }))
    .filter((product) => {
      if (!product.productId || !product.name) return false;
      if (seen.has(product.productId)) return false;
      seen.add(product.productId);
      return true;
    })
    .slice(0, 11)
    .map((product) => ({
      content_type: "text",
      title: product.name.slice(0, 20),
      payload: `${SOCIAL_COMMENT_PRODUCT_QUICK_REPLY_PREFIX}${JSON.stringify({
        product_id: product.productId,
        post_id: text(postId),
        comment_id: text(commentId),
        conversation_id: text(conversationId),
      })}`,
    }));
};

export const buildSocialCommentOrderActionQuickReplies = ({
  productId = null,
  selectedSize = "",
  selectedColor = "",
  postId = "",
  commentId = "",
} = {}) => {
  const safeProductId = Number(productId || 0) || null;
  if (!safeProductId) return [];
  const payloadBase = {
    product_id: safeProductId,
    size: text(selectedSize),
    color: text(selectedColor),
    post_id: text(postId),
    comment_id: text(commentId),
  };
  return [
    { action: "confirm", title: "✅ تأكيد الطلب" },
    { action: "cancel", title: "❌ إلغاء الطلب" },
  ].map((item) => ({
    content_type: "text",
    title: item.title.slice(0, 20),
    payload: `${SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX}${JSON.stringify({
      ...payloadBase,
      action: item.action,
    })}`,
  }));
};

export const parseSocialCommentSizeQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_SIZE_QUICK_REPLY_PREFIX.length));
    const size = text(parsed?.size || "");
    const productId = Number(parsed?.product_id || 0) || null;
    if (!size || !productId) return null;
    return {
      size,
      color: text(parsed?.color || ""),
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "size",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const parseSocialCommentColorQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_COLOR_QUICK_REPLY_PREFIX.length));
    const color = text(parsed?.color || "");
    const size = text(parsed?.size || "");
    const productId = Number(parsed?.product_id || 0) || null;
    // No size required: the colour is now the FIRST question, so most colour taps carry none.
    if (!color || !productId) return null;
    return {
      color,
      size,
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "color",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const parseSocialCommentProductQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_PRODUCT_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_PRODUCT_QUICK_REPLY_PREFIX.length));
    const productId = Number(parsed?.product_id || 0) || null;
    if (!productId) return null;
    return {
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "product",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const parseSocialCommentOrderActionQuickReplyPayload = (value = "") => {
  const payload = text(value);
  if (!payload.startsWith(SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(payload.slice(SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX.length));
    const action = text(parsed?.action || "");
    const productId = Number(parsed?.product_id || 0) || null;
    if (!action || !productId) return null;
    return {
      action,
      size: text(parsed?.size || ""),
      color: text(parsed?.color || ""),
      product_id: productId,
      post_id: text(parsed?.post_id || ""),
      comment_id: text(parsed?.comment_id || ""),
      conversation_id: text(parsed?.conversation_id || ""),
    };
  } catch {
    console.warn("SOCIAL_COMMENT_QUICK_REPLY_PARSE_FAILED", {
      kind: "action",
      payload: payload.slice(0, 500),
    });
    return null;
  }
};

export const buildSocialCommentOrderSummaryMessage = ({
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "️ ملخص اختيارك",
    "",
    text(productName) || "المنتج",
    `المقاس: ${text(selectedSize) || "-"}`,
    `اللون: ${normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL}`,
  ];
  if (hasUsablePriceValue(priceUsed)) {
    sections.push(`السعر: ${normalizePriceText(priceUsed)} جنيه`);
  }
  sections.push("", "هل تحب نكمل الطلب؟");
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentSalesFlowQuickReplies = ({
  productId = null,
  selectedSize = "",
  selectedColor = "",
  postId = "",
  commentId = "",
  conversationId = "",
  stage = "summary",
} = {}) => {
  const safeProductId = Number(productId || 0) || null;
  if (!safeProductId) return [];
  const payloadBase = {
    product_id: safeProductId,
    size: text(selectedSize),
    color: text(selectedColor),
    post_id: text(postId),
    comment_id: text(commentId),
    conversation_id: text(conversationId),
  };
  const items = stage === "preview"
    ? [
        { action: "send_order", title: "✅ إرسال الطلب" },
        { action: "edit_data", title: "✏️ تعديل البيانات" },
        { action: "cancel", title: "❌ إلغاء" },
      ]
    : [
        { action: "confirm", title: "✅ تأكيد الطلب" },
        { action: "cancel", title: "❌ إلغاء الطلب" },
      ];
  if (stage === "summary") {
    return [
      { title: "✅ تأكيد الطلب", payload: "ORDER_CONFIRM" },
      { title: "❌ إلغاء الطلب", payload: "ORDER_CANCEL" },
    ].map((item) => ({
      content_type: "text",
      title: item.title.slice(0, 20),
      payload: item.payload,
    }));
  }
  return items.map((item) => ({
    content_type: "text",
    title: item.title.slice(0, 20),
    payload: `${SOCIAL_COMMENT_ORDER_ACTION_QUICK_REPLY_PREFIX}${JSON.stringify({
      ...payloadBase,
      action: item.action,
    })}`,
  }));
};

export const buildSocialCommentOrderSummaryMessageV2 = ({
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "️ ملخص طلبك",
    "",
    text(productName) || "المنتج",
    "",
    "المقاس:",
    text(selectedSize) || "-",
    "",
    "اللون:",
    normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL,
  ];
  if (hasUsablePriceValue(priceUsed)) {
    sections.push("", "السعر:", `${normalizePriceText(priceUsed)} جنيه`);
  }
  sections.push("", "━━━━━━━━━━━━", "", "هل ترغب في إتمام الطلب؟");
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentOrderPreviewMessage = ({
  customerName = "",
  customerPhone = "",
  governorate = "",
  customerAddress = "",
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "━━━━━━━━━━━━",
    "",
    "️ مراجعة الطلب",
    "",
    "الاسم",
    text(customerName) || "-",
    "",
    "الهاتف",
    text(customerPhone) || "-",
    "",
    "المحافظة",
    text(governorate) || "-",
    "",
    "العنوان",
    text(customerAddress) || "-",
    "",
    "المنتج",
    text(productName) || "المنتج",
    "",
    "المقاس",
    text(selectedSize) || "-",
    "",
    "اللون",
    normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL,
  ];
  if (hasUsablePriceValue(priceUsed)) {
    sections.push("", "السعر", `${normalizePriceText(priceUsed)} جنيه`);
  }
  sections.push("", "━━━━━━━━━━━━");
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentOrderReviewMessage = ({
  customerName = "",
  customerPhone = "",
  governorate = "",
  customerAddress = "",
  productName = "",
  selectedSize = "",
  selectedColor = "",
  priceUsed = "",
} = {}) => {
  const sections = [
    "━━━━━━━━━━━━",
    "",
    "️ مراجعة الطلب",
    "",
    "الاسم",
    text(customerName) || "-",
    "",
    "الهاتف",
    text(customerPhone) || "-",
    "",
    "المحافظة",
    text(governorate) || "-",
    "",
    "العنوان",
    text(customerAddress) || "-",
    "",
    "المنتج",
    text(productName) || "المنتج",
    "",
    "المقاس",
    text(selectedSize) || "-",
    "",
    "اللون",
    normalizeSocialCommentColorDisplay(selectedColor) || DEFAULT_COLOR_LABEL,
    "",
    "السعر",
    hasUsablePriceValue(priceUsed) ? `${normalizePriceText(priceUsed)} جنيه` : "-",
    "",
    "━━━━━━━━━━━━",
  ];
  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const buildSocialCommentPrivateReplyMessage = async ({
  tenantId = null,
  platform = "",
  commentId = "",
  postId = "",
  customerName = "",
  productContext = null,
  automationTemplate = "",
  fallbackTemplate = "",
} = {}) => {
  const normalizedContext = await normalizeSocialCommentProductContext({
    tenantId,
    productContext: productContext || {},
  });
  const templateContext = {
    customer_name: text(customerName),
    product_name: normalizedContext.productName,
    available_sizes: normalizedContext.availableSizesLabel,
    product_link: normalizedContext.productLink,
    price: normalizedContext.priceUsed,
    formatted_price: normalizedContext.priceUsed,
  };
  const renderedAutomationTemplate = text(automationTemplate)
    ? text(renderTemplateText(automationTemplate, templateContext))
    : "";
  const renderedFallbackTemplate = text(fallbackTemplate)
    ? text(renderTemplateText(fallbackTemplate, templateContext))
    : "";

  let message = "";
  let selectedSource = "";

  if (normalizedContext.hasProductContext) {
    message = buildPolishedSocialCommentProductReply({
      customerName,
      productContext: {
        __normalized_private_reply_context: true,
        productName: normalizedContext.productName,
        priceUsed: normalizedContext.priceUsed,
        availableSizes: normalizedContext.availableSizes,
        availableSizesLabel: normalizedContext.availableSizesLabel,
        availableColors: normalizedContext.availableColors,
        productLink: normalizedContext.productLink,
        carouselEligible: normalizedContext.carouselEligible,
      },
    });
    selectedSource = "polished_product_renderer";
  } else if (renderedAutomationTemplate) {
    message = renderedAutomationTemplate;
    selectedSource = "generic_automation_template";
  } else if (renderedFallbackTemplate) {
    message = renderedFallbackTemplate;
    selectedSource = "generic_automation_template";
  } else {
    message = GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY;
    selectedSource = "generic_automation_template";
  }

  const beforeSanitizePreview = String(message || "").trim().slice(0, 280);
  const finalMessage = sanitizeRenderedPrivateReplyMessage({
    message,
    normalizedContext,
  });

  if (normalizedContext.hasProductContext) {
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_RENDER_DATA", {
      product_id: normalizedContext.productId,
      product_name: normalizedContext.productName,
      price_used: normalizedContext.priceUsed,
      available_sizes: normalizedContext.availableSizes,
      available_variants_count: normalizedContext.availableVariantsCount,
      absolute_product_link: normalizedContext.productLink,
    });
  }
  console.log("SOCIAL_COMMENT_PRIVATE_REPLY_MESSAGE_BUILT", {
    tenant_id: Number(tenantId || 0) || null,
    platform: text(platform),
    comment_id: text(commentId),
    post_id: text(postId),
    has_product_context: normalizedContext.hasProductContext,
    selected_source: selectedSource,
    before_sanitize_preview: beforeSanitizePreview,
    after_sanitize_preview: finalMessage.slice(0, 280),
    price_used: normalizedContext.priceUsed,
    available_sizes: normalizedContext.availableSizes,
  });
  return {
    message: finalMessage,
    selectedSource,
    hasProductContext: normalizedContext.hasProductContext,
    normalizedProductContext: normalizedContext,
    templateContext,
    // Colour first: while the product has more than one colour in stock, the buttons under this
    // first message are COLOURS. Sizes only follow once a colour is settled, so a tap can never
    // be a size with no colour attached to it.
    messengerQuickReplies: normalizedContext.availableColors.length > 1
      ? buildSocialCommentColorQuickReplies({
          productId: normalizedContext.productId,
          colors: normalizedContext.availableColors,
          postId,
          commentId,
        })
      : buildSocialCommentSizeQuickReplies({
          productContext: {
            product_id: normalizedContext.productId,
            available_sizes: normalizedContext.availableSizes,
          },
          selectedColor: normalizedContext.availableColors[0] || "",
          postId,
          commentId,
        }),
  };
};

export const sanitizeUnifiedSocialCommentPrivateReplyMessage = ({
  tenantId = null,
  platform = "",
  commentId = "",
  postId = "",
  customerName = "",
  message = "",
  productContext = null,
} = {}) => {
  const normalizedContext = {
    hasProductContext: Boolean(productContext?.found || productContext?.has_product_context),
    productName: text(productContext?.product_name || productContext?.primary_product?.name || "") || "المنتج",
    priceUsed: normalizePriceText(
      productContext?.selling_price ||
      productContext?.sale_price ||
      productContext?.price ||
      productContext?.final_price ||
      ""
    ),
    availableSizes: sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []),
    availableSizesLabel: sortSocialCommentAvailableSizes(productContext?.available_sizes || productContext?.sizes || []).join(" | ") || DEFAULT_SIZE_FALLBACK,
    productLink: ensureAbsoluteSocialProductLink(
      productContext?.product_link ||
      productContext?.product_url ||
      productContext?.storefront_url ||
      ""
    ),
  };
  let finalMessage = sanitizeRenderedPrivateReplyMessage({
    message: absolutizeRelativeShopLinks(String(message || "")),
    normalizedContext,
  });
  const badShape = normalizedContext.hasProductContext && (
    /IN STOCK/i.test(String(message || "")) ||
    /(^|\n)\s*\/shop\/product/i.test(String(message || "")) ||
    /متاح\s+بسعر/i.test(String(message || ""))
  );
  if (badShape) {
    const rebuilt = buildPolishedSocialCommentProductReply({
      customerName,
      productContext: {
        __normalized_private_reply_context: true,
        productName: normalizedContext.productName,
        priceUsed: normalizedContext.priceUsed,
        availableSizes: normalizedContext.availableSizes,
        availableSizesLabel: normalizedContext.availableSizesLabel,
        productLink: normalizedContext.productLink,
        carouselEligible: normalizedContext.carouselEligible,
      },
    });
    console.log("SOCIAL_COMMENT_PRIVATE_REPLY_BAD_MESSAGE_SHAPE", {
      tenant_id: Number(tenantId || 0) || null,
      platform: text(platform),
      comment_id: text(commentId),
      post_id: text(postId),
      message_preview_before: String(message || "").trim().slice(0, 280),
      message_preview_after: rebuilt.slice(0, 280),
    });
    finalMessage = rebuilt;
  }
  return {
    message: finalMessage || GENERIC_SOCIAL_COMMENT_PRIVATE_REPLY,
    hasProductContext: normalizedContext.hasProductContext,
  };
};
