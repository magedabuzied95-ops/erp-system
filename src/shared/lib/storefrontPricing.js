const normalizeText = (value = "") => String(value ?? "").trim();

export const parseStorefrontPriceValue = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(normalized) ? normalized : 0;
};

export const truthyStorefrontFlag = (value) =>
  value === true ||
  value === 1 ||
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .match(/^(true|1|yes|on|sale_active|is_sale_active|on_sale|sale_enabled|discount_enabled|has_sale|use_sale_price)$/);

export const storefrontSaleModeOn = (product = {}, variant = {}) =>
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
  truthyStorefrontFlag(product?.sale_mode_enabled) ||
  Number(variant?.sale_price || product?.sale_price || 0) > 0;

export const storefrontSellingPrice = (product = {}, variant = {}) =>
  parseStorefrontPriceValue(variant?.selling_price || variant?.price || product?.selling_price || product?.price || product?.regular_price || 0);

const storefrontOriginalPriceCandidates = (product = {}, variant = {}) =>
  [
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
    variant?.regular_price,
    variant?.compare_at_price,
    product?.compare_at_price,
  ]
    .map(parseStorefrontPriceValue)
    .filter((value) => Number.isFinite(value) && value > 0);

export const storefrontOriginalPrice = (product = {}, variant = {}) => {
  const activePrice = storefrontSaleModeOn(product, variant) && parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0) > 0
    ? parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0)
    : storefrontSellingPrice(product, variant);
  const candidates = storefrontOriginalPriceCandidates(product, variant);
  return candidates.find((value) => value > activePrice) || candidates[0] || 0;
};

export const displaySellingPrice = (product = {}, variant = {}) => {
  if (storefrontSaleModeOn(product, variant)) {
    const sale = parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0);
    if (sale > 0) return sale;
  }
  return storefrontSellingPrice(product, variant);
};

export const resolveStorefrontPrice = (product = {}, variant = {}) => {
  const basePrice = storefrontSellingPrice(product, variant);
  const salePrice = parseStorefrontPriceValue(variant?.sale_price ?? product?.sale_price ?? 0);
  const saleModeOn = storefrontSaleModeOn(product, variant);
  const currentPrice = saleModeOn && salePrice > 0 ? salePrice : basePrice;
  const oldCrossedPrice = storefrontOriginalPrice(product, variant);
  const crossedPrice = oldCrossedPrice > currentPrice ? oldCrossedPrice : 0;
  const discountPercent =
    crossedPrice > 0 && currentPrice > 0 && crossedPrice > currentPrice
      ? `${Math.max(1, Math.round(((crossedPrice - currentPrice) / crossedPrice) * 100))}%`
      : "";
  return {
    base_price: basePrice,
    sale_price: saleModeOn && salePrice > 0 ? salePrice : 0,
    current_price: currentPrice,
    old_crossed_price: crossedPrice,
    discount_percent: discountPercent,
    sale_active: Boolean(saleModeOn && salePrice > 0),
    source: saleModeOn && salePrice > 0 ? "sale_price" : "selling_price",
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
