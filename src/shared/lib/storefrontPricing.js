const normalizeText = (value = "") => String(value ?? "").trim();
const storefrontPriceDebugSeen = new Set();

export const parseStorefrontPriceValue = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(normalized) ? normalized : 0;
};

export const parseSaleModeEnabled = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return fallback;
};

const shouldLogStorefrontPriceDebug = () => {
  if (typeof window === "undefined") return false;
  try {
    return import.meta.env.DEV || window.localStorage.getItem("PRODUCT_PRICE_DEBUG") === "1";
  } catch {
    return Boolean(import.meta.env.DEV);
  }
};

const logStorefrontPriceDebug = (payload = {}) => {
  if (!shouldLogStorefrontPriceDebug()) return;
  const key = `${payload.productId ?? "unknown"}:${payload.variantId ?? "none"}:${payload.saleModeEnabled ? "1" : "0"}:${payload.chosenPrice ?? 0}:${payload.isOnSale ? "1" : "0"}`;
  if (storefrontPriceDebugSeen.has(key)) return;
  storefrontPriceDebugSeen.add(key);
  console.debug("PRODUCT_PRICE_DEBUG", payload);
  console.debug("STOREFRONT_PRICE_DECISION", payload);
};

export const truthyStorefrontFlag = (value) =>
  value === true ||
  value === 1 ||
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .match(/^(true|1|yes|on|sale_active|is_sale_active|on_sale|sale_enabled|discount_enabled|has_sale|use_sale_price)$/);

export const storefrontForceSaleForOffer = (product = {}, variant = {}) =>
  truthyStorefrontFlag(variant?.is_offer_story) ||
  truthyStorefrontFlag(variant?.isOfferStory) ||
  truthyStorefrontFlag(variant?.is_offer) ||
  truthyStorefrontFlag(variant?.isOffer) ||
  truthyStorefrontFlag(variant?.offer) ||
  truthyStorefrontFlag(variant?.appears_in_offers) ||
  truthyStorefrontFlag(variant?.appearsInOffers) ||
  truthyStorefrontFlag(variant?.storefront_offer) ||
  truthyStorefrontFlag(variant?.storefrontOffer) ||
  truthyStorefrontFlag(variant?.show_in_offer_story) ||
  truthyStorefrontFlag(variant?.showInOfferStory) ||
  truthyStorefrontFlag(product?.is_offer_story) ||
  truthyStorefrontFlag(product?.isOfferStory) ||
  truthyStorefrontFlag(product?.is_offer) ||
  truthyStorefrontFlag(product?.isOffer) ||
  truthyStorefrontFlag(product?.offer) ||
  truthyStorefrontFlag(product?.appears_in_offers) ||
  truthyStorefrontFlag(product?.appearsInOffers) ||
  truthyStorefrontFlag(product?.storefront_offer) ||
  truthyStorefrontFlag(product?.storefrontOffer) ||
  truthyStorefrontFlag(product?.show_in_offer_story) ||
  truthyStorefrontFlag(product?.showInOfferStory);

export const storefrontSaleModeOn = (product = {}, variant = {}) => Boolean(
  truthyStorefrontFlag(variant?.sale_price_enabled) ||
  truthyStorefrontFlag(variant?.sale_enabled) ||
  truthyStorefrontFlag(variant?.on_sale) ||
  truthyStorefrontFlag(variant?.is_sale_active) ||
  truthyStorefrontFlag(variant?.discount_enabled) ||
  truthyStorefrontFlag(product?.sale_price_enabled) ||
  truthyStorefrontFlag(product?.sale_enabled) ||
  truthyStorefrontFlag(product?.on_sale) ||
  truthyStorefrontFlag(product?.is_sale_active) ||
  truthyStorefrontFlag(product?.discount_enabled) ||
  truthyStorefrontFlag(product?.has_sale) ||
  truthyStorefrontFlag(variant?.global_sale_enabled) ||
  truthyStorefrontFlag(variant?.sale_prices_enabled) ||
  truthyStorefrontFlag(variant?.sale_mode_enabled) ||
  truthyStorefrontFlag(product?.global_sale_enabled) ||
  truthyStorefrontFlag(product?.sale_prices_enabled) ||
  truthyStorefrontFlag(product?.sale_mode_enabled)
);

export const storefrontSellingPrice = (product = {}, variant = {}) =>
  parseStorefrontPriceValue(variant?.selling_price || variant?.price || product?.selling_price || product?.price || product?.regular_price || 0);

const storefrontOriginalPriceCandidates = (product = {}, variant = {}) =>
  [
    product?.old_price,
    product?.oldPrice,
    product?.price_before_sale,
    product?.priceBeforeSale,
    product?.custom_compare_price,
    product?.compare_base_price,
    product?.original_price,
    product?.base_price,
    product?.list_price,
    variant?.custom_compare_price,
    variant?.compare_base_price,
    variant?.original_price,
    variant?.base_price,
    variant?.list_price,
    product?.regular_price,
    variant?.old_price,
    variant?.oldPrice,
    variant?.price_before_sale,
    variant?.priceBeforeSale,
    variant?.regular_price,
    variant?.compare_at_price,
    product?.compare_at_price,
  ]
    .map(parseStorefrontPriceValue)
    .filter((value) => Number.isFinite(value) && value > 0);

export const storefrontOriginalPrice = (product = {}, variant = {}) => {
  const hasForcedOfferSale = storefrontForceSaleForOffer(product, variant) && parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0) > 0;
  const activePrice = (hasForcedOfferSale || storefrontSaleModeOn(product, variant)) && parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0) > 0
    ? parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0)
    : storefrontSellingPrice(product, variant);
  const candidates = storefrontOriginalPriceCandidates(product, variant);
  return candidates.find((value) => value > activePrice) || candidates[0] || 0;
};

export const getDisplayPricing = (product = {}, saleModeEnabled = false, variant = null) => {
  const resolvedVariant = variant || pickPrimaryStorefrontVariant(product?.variants || []);
  const storedSellingPrice = storefrontSellingPrice(product, resolvedVariant || {});
  const salePrice = parseStorefrontPriceValue(resolvedVariant?.sale_price ?? product?.sale_price ?? resolvedVariant?.offer_price ?? product?.offer_price ?? 0);
  const enabled = parseSaleModeEnabled(saleModeEnabled, false);
  const forceSaleForOffer = storefrontForceSaleForOffer(product, resolvedVariant || {});
  const legacySaleEnabled = storefrontSaleModeOn(product, resolvedVariant || {});
  const legacySaleValid = legacySaleEnabled && salePrice > 0 && storedSellingPrice > 0 && salePrice < storedSellingPrice;
  const sellingPrice = legacySaleValid ? salePrice : storedSellingPrice;
  const originalPrice = storefrontOriginalPriceCandidates(product, resolvedVariant || {}).find((value) => value > sellingPrice) ||
    (legacySaleValid ? storedSellingPrice : 0);
  let price = sellingPrice;
  const comparePrice = originalPrice > sellingPrice ? originalPrice : null;
  const isOnSale = Boolean(comparePrice);

  const discountPercent =
    isOnSale && comparePrice && comparePrice > price
      ? Math.max(1, Math.round(((comparePrice - price) / comparePrice) * 100))
      : null;

  const productId = product?.id ?? product?.product_id ?? resolvedVariant?.product_id ?? null;
  const variantId = resolvedVariant?.id ?? resolvedVariant?.variant_id ?? null;
  logStorefrontPriceDebug({
    productId,
    variantId,
    parsedSaleModeEnabled: enabled,
    saleModeEnabled: enabled,
    forceSaleForOffer,
    legacySaleEnabled,
    sellingPrice: storedSellingPrice,
    salePrice: isOnSale ? sellingPrice : 0,
    chosenPrice: price,
    isOnSale,
  });

  return {
    price,
    comparePrice,
    discountPercent,
    isOnSale,
    sellingPrice,
    salePrice,
    chosenPrice: price,
    productId,
    variantId,
  };
};

export const displaySellingPrice = (product = {}, variant = {}) => {
  return getDisplayPricing(product, storefrontSaleModeOn(product, variant), variant).price;
};

export const resolveStorefrontPrice = (product = {}, variant = {}) => {
  const pricing = getDisplayPricing(product, storefrontSaleModeOn(product, variant), variant);
  return {
    base_price: pricing.sellingPrice,
    sale_price: pricing.isOnSale ? pricing.salePrice : 0,
    current_price: pricing.price,
    old_crossed_price: pricing.comparePrice || 0,
    discount_percent: pricing.discountPercent ? `${pricing.discountPercent}%` : "",
    sale_active: Boolean(pricing.isOnSale),
    source: pricing.isOnSale ? "sale_price" : "selling_price",
  };
};

export const pickPrimaryStorefrontVariant = (variants = []) => {
  const list = Array.isArray(variants) ? variants : [];
  return (
    list.find((variant) => Number(variant?.stock ?? variant?.stock_quantity ?? variant?.quantity ?? variant?.available_stock ?? 0) > 0 && normalizeText(variant?.image_url || variant?.image || variant?.photo_url || variant?.thumbnail_url || variant?.variant_image_url || variant?.color_image_url || "")) ||
    list.find((variant) => Number(variant?.stock ?? variant?.stock_quantity ?? variant?.quantity ?? variant?.available_stock ?? 0) > 0) ||
    list.find((variant) => normalizeText(variant?.image_url || variant?.image || variant?.photo_url || variant?.thumbnail_url || variant?.variant_image_url || variant?.color_image_url || "")) ||
    list[0] ||
    null
  );
};

export const resolveStorefrontPriceBreakdown = (product = {}, variant = null) => {
  const resolvedVariant = variant || pickPrimaryStorefrontVariant(product?.variants || []);
  const pricing = resolveStorefrontPrice(product, resolvedVariant || {});
  return {
    ...pricing,
    variant: resolvedVariant || null,
    variant_id: resolvedVariant?.id ?? resolvedVariant?.variant_id ?? null,
    product_id: product?.id ?? product?.product_id ?? null,
  };
};
