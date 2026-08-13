// Batch 1A — THE canonical "what does the customer pay" authority, environment-neutral.
//
// There must not be two definitions of the active customer price. This module composes the two existing
// authorities and adds nothing of its own:
//   A) NORMAL price  → resolveCurrentSellingPrice()  (Phase 1 pricing contract)
//   B) SALE price    → resolveSaleModePrice()        (the canonical POS Sale Mode semantics)
//   C) COMPARE price → presentation metadata ONLY, never active
//
// The rule the owner confirmed:
//   global website_settings.sale_mode_enabled === false  ⇒  Sale is OFF for everything. `sale_price` is dormant
//   data even when the per-record `sale_price_enabled` flag is true and the number is lower. The active price is
//   the NORMAL price. When the global toggle is ON, the SAME POS rules decide (per-record enable flag, valid
//   relationship, sale window, exclusions, sale_mode_type, percentage/fixed discount, min-margin floor).
//
// The old AI resolver inferred "a sale is running" from ~30 loose per-record flags and never read the global
// toggle, so it quoted dormant sale prices on ~41% of the catalogue (product 39: AI 1550 vs POS 1750). Nothing in
// this module may reintroduce that inference.
import { resolveCurrentSellingPrice } from "./currentSellingPrice.js";
import { normalizeSaleModeSettings, resolveSaleModePrice } from "./saleMode.js";

const money = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const truthy = (value) => value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";

// POS treats an explicit offer flag as "force the stored sale price" while global Sale Mode is on. Mirrored here so
// the shared resolver is a drop-in for getPosEffectivePrice; it is still gated on the global toggle.
export const isForcedOfferSale = (record = {}) =>
  [record?.is_offer, record?.isOffer, record?.show_in_offers, record?.showInOffers,
   record?.promotion_enabled, record?.promotionEnabled, record?.is_offer_story, record?.isOfferStory].some(truthy);

// Compare/strikethrough price. Presentation only — never returned as active_price, never used for budget or
// recommendation eligibility. Read from RAW records: a serialized product API response may have had its
// regular_price overwritten with the resolved normal price, so an API object is not a trustworthy source.
const resolveComparePrice = ({ product = {}, variant = {}, normalPrice = 0, activePrice = 0 }) => {
  const custom = truthy(variant.use_custom_compare_price) || truthy(product.use_custom_compare_price)
    ? (money(variant.regular_price) || money(product.regular_price))
    : 0;
  const preSale = activePrice > 0 && normalPrice > activePrice ? normalPrice : 0;
  const compare = custom > activePrice ? custom : preSale;
  return compare > activePrice ? compare : 0;
};

/**
 * The ONE effective-customer-price resolver.
 * Customer-facing surfaces use `active_price` only; every other field is internal audit metadata.
 */
export const resolveEffectiveCustomerPrice = ({ product = {}, variant = null, saleModeSettings = {} } = {}) => {
  const safeVariant = variant && typeof variant === "object" ? variant : {};
  const settings = normalizeSaleModeSettings(saleModeSettings);
  const normal = resolveCurrentSellingPrice({ product, variant: safeVariant });
  const normalPrice = money(normal.value);
  const storedSalePrice = money(safeVariant.sale_price) || money(product.sale_price);
  const scope = { ...product, ...safeVariant };

  // No canonical normal price ⇒ NO price. Never fall back to the dormant sale price, cost, or wholesale.
  if (normalPrice <= 0) {
    return {
      active_price: 0,
      price_source: "none",
      normal_price: 0,
      normal_price_source: normal.source,
      sale_price: storedSalePrice,
      sale_mode_enabled: settings.sale_mode_enabled,
      sale_mode_applied: false,
      compare_price: 0,
      has_price: false,
      reason: "no_canonical_normal_price",
    };
  }

  // Global toggle OFF ⇒ sale is dormant, full stop. No per-record flag can override it.
  if (!settings.sale_mode_enabled) {
    return {
      active_price: normalPrice,
      price_source: "normal",
      normal_price: normalPrice,
      normal_price_source: normal.source,
      sale_price: storedSalePrice,
      sale_mode_enabled: false,
      sale_mode_applied: false,
      compare_price: resolveComparePrice({ product, variant: safeVariant, normalPrice, activePrice: normalPrice }),
      has_price: true,
      reason: "global_sale_mode_off",
    };
  }

  if (isForcedOfferSale(scope) && storedSalePrice > 0) {
    return {
      active_price: storedSalePrice,
      price_source: "sale",
      normal_price: normalPrice,
      normal_price_source: normal.source,
      sale_price: storedSalePrice,
      sale_mode_enabled: true,
      sale_mode_applied: true,
      compare_price: resolveComparePrice({ product, variant: safeVariant, normalPrice, activePrice: storedSalePrice }),
      has_price: true,
      reason: "offer_forced_sale",
    };
  }

  // Canonical POS Sale Mode decision. `regular_price`/`price` are fed the RESOLVED NORMAL price so the sale
  // relationship (sale < regular), the window, exclusions, discount modes and the margin floor all evaluate
  // against the real normal price rather than a legacy column.
  const resolved = resolveSaleModePrice(
    { ...scope, regular_price: normalPrice, price: normalPrice, sale_price: storedSalePrice },
    settings
  );
  const activePrice = money(resolved.final_price) || normalPrice;
  const saleApplied = resolved.sale_mode_applied === true && activePrice < normalPrice;
  return {
    active_price: activePrice,
    price_source: saleApplied ? "sale" : "normal",
    normal_price: normalPrice,
    normal_price_source: normal.source,
    sale_price: storedSalePrice,
    sale_mode_enabled: true,
    sale_mode_applied: saleApplied,
    compare_price: resolveComparePrice({ product, variant: safeVariant, normalPrice, activePrice }),
    has_price: true,
    reason: saleApplied ? `sale_${resolved.sale_source || "applied"}` : "sale_rules_not_met",
  };
};
