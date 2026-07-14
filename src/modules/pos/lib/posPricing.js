import { normalizeSaleModeSettings, resolveSaleModePrice } from "../../../shared/lib/saleMode.js";

const normalizeNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const truthy = (value) => value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";

const pickPositiveNumber = (...values) => {
  const parsed = values.map((value) => normalizeNumber(value));
  return parsed.find((value) => value > 0) || 0;
};

export const shouldForceSalePriceForPos = (product = {}) =>
  [
    product?.is_offer,
    product?.isOffer,
    product?.show_in_offers,
    product?.showInOffers,
    product?.promotion_enabled,
    product?.promotionEnabled,
    product?.is_offer_story,
    product?.isOfferStory,
  ].some(truthy);

export const getPosEffectivePrice = ({ product = {}, variant = null, saleModeSettings = {} } = {}) => {
  const normalizedSaleMode = normalizeSaleModeSettings(saleModeSettings);
  const scope = { ...(product || {}), ...(variant || {}) };
  const regularPrice = pickPositiveNumber(
    variant?.regular_price,
    variant?.original_price,
    variant?.selling_price,
    variant?.price,
    product?.regular_price,
    product?.original_price,
    product?.selling_price,
    product?.price
  );
  const storedSalePrice = pickPositiveNumber(
    variant?.stored_sale_price,
    variant?.raw_sale_price,
    variant?.sale_price,
    product?.stored_sale_price,
    product?.raw_sale_price,
    product?.sale_price
  );

  if (normalizedSaleMode.sale_mode_enabled && shouldForceSalePriceForPos(scope) && storedSalePrice > 0) {
    return {
      regular_price: regularPrice,
      selling_price: regularPrice,
      stored_sale_price: storedSalePrice,
      final_price: storedSalePrice,
      sale_price: storedSalePrice,
      sale_source: "offer",
      sale_badge: String(scope?.sale_reason || "").trim() || "Sale",
      sale_mode_applied: true,
    };
  }

  const resolved = resolveSaleModePrice(
    {
      ...scope,
      regular_price: regularPrice,
      price: regularPrice,
      sale_price: storedSalePrice,
    },
    normalizedSaleMode
  );

  return {
    ...resolved,
    selling_price: regularPrice,
    stored_sale_price: storedSalePrice,
  };
};
