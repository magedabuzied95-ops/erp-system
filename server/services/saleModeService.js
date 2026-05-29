export const SALE_MODE_TYPES = {
  USE_EXISTING_SALE_PRICES_ONLY: "use_existing_sale_prices_only",
  PERCENTAGE_DISCOUNT: "percentage_discount",
  FIXED_DISCOUNT: "fixed_discount",
  USE_EXISTING_SALE_PRICE: "use_existing_sale_price",
};

export const SALE_MODE_DEFAULTS = {
  sale_mode_enabled: false,
  sale_mode_type: SALE_MODE_TYPES.USE_EXISTING_SALE_PRICES_ONLY,
  sale_mode_value: 0,
  sale_mode_label: "",
  sale_mode_excluded_product_ids: [],
  sale_mode_excluded_category_ids: [],
  sale_mode_excluded_brand_ids: [],
  sale_mode_min_price_protection_enabled: false,
  sale_mode_min_margin_percent: 0,
};

const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};

const truthy = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";

const parseIdList = (value) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
};

export const normalizeSaleModeSettings = (settings = {}) => ({
  ...SALE_MODE_DEFAULTS,
  ...(settings || {}),
  sale_mode_enabled: truthy(settings.sale_mode_enabled),
  sale_mode_type:
    settings.sale_mode_type === SALE_MODE_TYPES.USE_EXISTING_SALE_PRICES_ONLY ||
    settings.sale_mode_type === SALE_MODE_TYPES.USE_EXISTING_SALE_PRICE
      ? SALE_MODE_TYPES.USE_EXISTING_SALE_PRICES_ONLY
      : SALE_MODE_DEFAULTS.sale_mode_type,
  sale_mode_value: Math.max(0, money(settings.sale_mode_value)),
  sale_mode_label: String(settings.sale_mode_label || "").trim(),
  sale_mode_excluded_product_ids: parseIdList(settings.sale_mode_excluded_product_ids),
  sale_mode_excluded_category_ids: parseIdList(settings.sale_mode_excluded_category_ids),
  sale_mode_excluded_brand_ids: parseIdList(settings.sale_mode_excluded_brand_ids),
  sale_mode_min_price_protection_enabled: truthy(settings.sale_mode_min_price_protection_enabled),
  sale_mode_min_margin_percent: Math.max(0, money(settings.sale_mode_min_margin_percent)),
});

export const isRealSaleActive = (item = {}, now = new Date()) => {
  if (!truthy(item.sale_price_enabled) && !truthy(item.enable_real_sale_price)) return false;
  const regular = money(item.regular_price ?? item.price);
  const sale = money(item.sale_price ?? item.offer_price);
  if (!(regular > 0 && sale > 0 && sale < regular)) return false;
  const start = item.sale_start_at ? new Date(item.sale_start_at) : null;
  const end = item.sale_end_at ? new Date(item.sale_end_at) : null;
  if (start && !Number.isNaN(start.getTime()) && now < start) return false;
  if (end && !Number.isNaN(end.getTime()) && now > end) return false;
  return true;
};

export const isExcludedFromSaleMode = (item = {}, settings = {}) => {
  const sale = normalizeSaleModeSettings(settings);
  const productIds = [item.product_id, item.productId, item.id].map((value) => String(value ?? ""));
  const categoryIds = [item.category_id, item.categoryId, item.parent_category_id, item.main_category_id, item.sub_category_id, item.child_category_id].map((value) => String(value ?? ""));
  const brandIds = [item.brand_id, item.brandId].map((value) => String(value ?? ""));
  return (
    sale.sale_mode_excluded_product_ids.some((id) => productIds.includes(id)) ||
    sale.sale_mode_excluded_category_ids.some((id) => categoryIds.includes(id)) ||
    sale.sale_mode_excluded_brand_ids.some((id) => brandIds.includes(id))
  );
};

export const resolveSaleModePrice = (item = {}, settings = {}) => {
  const sale = normalizeSaleModeSettings(settings);
  const regularPrice = money(item.regular_price ?? item.price);
  const realSalePrice = money(item.sale_price ?? item.offer_price);
  const cost = money(item.cost_price ?? item.purchase_price);
  const realSaleActive = isRealSaleActive({ ...item, regular_price: regularPrice });

  if (!sale.sale_mode_enabled || regularPrice <= 0 || isExcludedFromSaleMode(item, sale)) {
    return {
      regular_price: regularPrice,
      final_price: regularPrice,
      sale_price: 0,
      sale_source: "regular",
      sale_badge: "",
      sale_mode_applied: false,
    };
  }

  if (
    sale.sale_mode_type === SALE_MODE_TYPES.USE_EXISTING_SALE_PRICES_ONLY ||
    sale.sale_mode_type === SALE_MODE_TYPES.USE_EXISTING_SALE_PRICE
  ) {
    if (realSaleActive) {
      return {
        regular_price: regularPrice,
        final_price: realSalePrice,
        sale_price: realSalePrice,
        sale_source: "product",
        sale_badge: sale.sale_mode_label || item.sale_reason || "Sale",
        sale_mode_applied: true,
      };
    }
    return {
      regular_price: regularPrice,
      final_price: regularPrice,
      sale_price: 0,
      sale_source: "regular",
      sale_badge: "",
      sale_mode_applied: false,
    };
  }

  let discounted = regularPrice;
  if (sale.sale_mode_type === SALE_MODE_TYPES.PERCENTAGE_DISCOUNT) {
    discounted = regularPrice * (1 - Math.min(100, sale.sale_mode_value) / 100);
  } else if (sale.sale_mode_type === SALE_MODE_TYPES.FIXED_DISCOUNT) {
    discounted = regularPrice - sale.sale_mode_value;
  } else {
    discounted = regularPrice;
  }

  discounted = Math.max(0, money(discounted));
  if (sale.sale_mode_min_price_protection_enabled && cost > 0) {
    const floor = money(cost * (1 + sale.sale_mode_min_margin_percent / 100));
    discounted = Math.max(discounted, floor);
  }

  if (!(discounted > 0 && discounted < regularPrice)) {
    return {
      regular_price: regularPrice,
      final_price: regularPrice,
      sale_price: 0,
      sale_source: "regular",
      sale_badge: "",
      sale_mode_applied: false,
    };
  }

  return {
    regular_price: regularPrice,
    final_price: discounted,
    sale_price: discounted,
    sale_source: "global",
    sale_badge: sale.sale_mode_label || "Global Sale",
    sale_mode_applied: true,
  };
};
