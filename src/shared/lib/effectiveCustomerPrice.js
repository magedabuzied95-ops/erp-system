// Batch 1A — THE canonical "what does the customer pay" authority, environment-neutral.
//
// There must not be two definitions of the active customer price. This module composes the two existing
// authorities and adds nothing of its own:
//   A) NORMAL price  → resolveCurrentSellingPrice()  (Phase 1 pricing contract)
//   B) SALE price    → resolveSaleModePrice()        (the canonical POS Sale Mode semantics)
//   C) COMPARE price → presentation metadata ONLY, never active
//
// The rule the owner confirmed:
//   1) Curated Offers (`is_offer_story` and its aliases) are self-sufficient. A product sitting in the Offers
//      section with a stored sale price BELOW its normal price is charged at that sale price — in POS, on the
//      storefront and in every AI quote — WITHOUT the global toggle. Owner decision, 2026-08-23: the section is
//      the switch, because a second hidden switch left 79 curated offers quietly ringing at full price.
//   2) For everything else, global website_settings.sale_mode_enabled === false ⇒ Sale is OFF. `sale_price` is
//      dormant data even when the per-record `sale_price_enabled` flag is true and the number is lower; the
//      active price is the NORMAL price. When the global toggle is ON, the SAME POS rules decide (per-record
//      enable flag, valid relationship, sale window, exclusions, sale_mode_type, discount mode, margin floor).
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

// An explicit offer flag means "force the stored sale price". The curated Offers section IS the switch: it does
// NOT wait for the global Sale Mode toggle, because a manager who moves a product into العروض has already made
// the decision, and a second hidden switch only produced offers that quietly rang at full price. The global
// toggle still governs every OTHER sale mechanism (per-record sale_price_enabled, percentage/fixed discount
// modes). Mirrored in getPosEffectivePrice so POS and this resolver stay one rule.
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

  // Curated Offers win first, and they are NOT gated on the global toggle — see isForcedOfferSale. The stored
  // sale price must still be a real discount: `< normalPrice` means a mistyped sale price can only ever be
  // ignored, never raise what the customer is charged.
  if ((isForcedOfferSale(product) || isForcedOfferSale(safeVariant)) && storedSalePrice > 0 && storedSalePrice < normalPrice) {
    return {
      active_price: storedSalePrice,
      price_source: "sale",
      normal_price: normalPrice,
      normal_price_source: normal.source,
      sale_price: storedSalePrice,
      sale_mode_enabled: settings.sale_mode_enabled,
      sale_mode_applied: true,
      compare_price: resolveComparePrice({ product, variant: safeVariant, normalPrice, activePrice: storedSalePrice }),
      has_price: true,
      reason: "offer_forced_sale",
    };
  }

  // Global toggle OFF ⇒ every OTHER sale mechanism is dormant. No per-record flag can override it.
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
