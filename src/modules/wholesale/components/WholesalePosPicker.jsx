import { useCallback, useEffect, useState } from "react";
import { api } from "../../../shared/api/api";
import { IS_WHOLESALE_APP } from "../../../shared/constants/app";

// Wholesale copy only: the POS keeps its colour picker, but where retail lists sizes the
// wholesale copy lists the model's units (carton / series / dozen / piece). Every line is
// priced at the piece price of the customer's tier (set on the customer), from the
// product page.

const UNIT_ORDER = ["carton", "series", "dozen", "piece"];

/** [{ unit, pieces }] the model is sold by, in display order. */
export const wholesaleUnits = (settings) => {
  if (!settings) return [];
  return UNIT_ORDER.flatMap((unit) => {
    if (unit === "piece") return settings.sell_piece ? [{ unit, pieces: 1 }] : [];
    if (unit === "series") return settings.sell_series && settings.series_pieces ? [{ unit, pieces: Number(settings.series_pieces) }] : [];
    if (unit === "carton") return settings.sell_carton && settings.carton_pieces ? [{ unit, pieces: Number(settings.carton_pieces) }] : [];
    return settings.sell_dozen ? [{ unit, pieces: 12 }] : [];
  });
};

// The units of every model, kept by the POS hook for receipts (which render outside it).
let unitsByProduct = {};

/** 30 pieces of a model with carton 24 / series 6 -> "1 كرتونة + 1 سيرية"; "" when just pieces. */
export const wholesaleUnitsLabel = (productId, pieces, t) => {
  if (!IS_WHOLESALE_APP) return "";
  const settings = unitsByProduct[productId];
  let left = Math.max(0, Math.trunc(Number(pieces) || 0));
  if (!settings || !left) return "";
  const parts = [];
  const take = (size, unit) => {
    if (!size || size <= 1 || left < size) return;
    const count = Math.floor(left / size);
    left -= count * size;
    parts.push(`${count} ${t(`orders.wholesale.units.${unit}`)}`);
  };
  if (settings.sell_carton) take(Number(settings.carton_pieces), "carton");
  if (settings.sell_series) take(Number(settings.series_pieces), "series");
  if (settings.sell_dozen) take(12, "dozen");
  if (!parts.length) return "";
  if (left) parts.push(`${left} ${t("orders.wholesale.units.piece")}`);
  return parts.join(" + ");
};

/**
 * Tier prices for the whole catalogue plus the selected customer's tier.
 * priceOf(productId) -> the piece price the cart should use, or null (not set up / retail).
 */
export function useWholesalePosPricing(customerId) {
  const [prices, setPrices] = useState({});
  const [tier, setTier] = useState("wholesale");

  useEffect(() => {
    if (!IS_WHOLESALE_APP) return;
    api.get("/wholesale/prices").then((res) => {
      unitsByProduct = res?.data || {};
      setPrices(res?.data || {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!IS_WHOLESALE_APP) return undefined;
    if (!customerId) { setTier("wholesale"); return undefined; }
    let cancelled = false;
    api.get(`/wholesale/customers/${customerId}/terms`)
      .then((res) => { if (!cancelled) setTier(res?.data?.tier || "wholesale"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [customerId]);

  const priceOf = useCallback((productId) => {
    if (!IS_WHOLESALE_APP) return null;
    const row = prices[productId];
    if (!row) return null;
    const half = row.price_half_wholesale;
    const whole = row.price_wholesale;
    const value = tier === "half_wholesale" && half !== null && half !== undefined ? half : whole;
    return value === null || value === undefined ? null : Number(value);
  }, [prices, tier]);

  return { enabled: IS_WHOLESALE_APP, tier, priceOf };
}

/** The units a model is sold by (from its product page), loaded when its picker opens. */
const settingsCache = new Map();
export function useWholesaleProductUnits(productId) {
  const [settings, setSettings] = useState(() => (productId ? settingsCache.get(String(productId)) || null : null));
  useEffect(() => {
    if (!IS_WHOLESALE_APP || !productId) { setSettings(null); return undefined; }
    const key = String(productId);
    if (settingsCache.has(key)) setSettings(settingsCache.get(key));
    let cancelled = false;
    api.get(`/wholesale/products/${productId}`)
      .then((res) => {
        const next = res?.data?.configured ? res.data.settings : { sell_piece: true };
        settingsCache.set(key, next);
        if (!cancelled) setSettings(next);
      })
      .catch(() => { if (!cancelled) setSettings({ sell_piece: true }); });
    return () => { cancelled = true; };
  }, [productId]);
  return settings;
}

/** The product card shows the tier price instead of "price required". */
export const withWholesalePrice = (product, price) => {
  if (price === null || price === undefined) return product;
  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => ({ ...variant, price, sale_price: price, regular_price: price, original_price: price }))
    : product.variants;
  return { ...product, price, sale_price: price, base_price: price, min_price: price, max_price: price, regular_price: price, original_price: price, variants };
};

/** The POS catalogue with tier prices, for every cart-vs-catalogue reconciliation. */
export const priceCatalogForWholesale = (catalog, priceOf) => {
  if (typeof priceOf !== "function" || !Array.isArray(catalog)) return catalog;
  return catalog.map((product) => withWholesalePrice(product, priceOf(product?.product_id ?? product?.id)));
};
