// Phase 7.5 — pure helpers for the storefront "notify me when available" (Restock Intent) CTA.
// Framework-free so they are unit-testable. No API calls, no messaging, and no i18n runtime:
// the page resolves every string through sfText(key, fallback, options); the Arabic copy
// below is the fallback and the dictionary (storefront.restock.*) carries both languages.

const stockOf = (variant = {}) => Number(variant?.stock ?? variant?.available ?? 0) || 0;

// The CTA relates to the CURRENT selected variant and only shows when that variant is unavailable.
export const shouldShowRestockCta = (variant) => Boolean(variant && variant.id) && stockOf(variant) <= 0;

// Stable per-variant key so success/loading state never leaks across variants (size 44 → size 45).
export const restockVariantKey = (variant = {}) => (variant && variant.id != null ? String(variant.id) : "");

/** Arabic fallbacks, keyed like the dictionary entries under storefront.restock.* */
export const RESTOCK_COPY = Object.freeze({
  cta: "بلغني لما يتوفر",
  availableNow: "المقاس متوفر دلوقتي",
  loginRequired: "سجّل دخولك لتفعيل الإبلاغ عند التوفر",
  error: "تعذّر إنشاء الطلب، حاول تاني",
  notifySizeColor: "هنبلغك لما {{color}} مقاس {{size}} يتوفر",
  notifySize: "هنبلغك لما مقاس {{size}} يتوفر",
  notifyColor: "هنبلغك لما {{color}} يتوفر",
  notifyProduct: "هنبلغك لما المنتج يتوفر",
});

const interpolate = (template = "", values = {}) =>
  String(template).replace(/\{\{(\w+)\}\}/g, (_match, name) => (values[name] == null ? "" : String(values[name])));

/**
 * Success copy for the ACTUAL selected variant as an sfText argument tuple:
 * [key, arabicFallback, interpolationValues]. Never promises a channel.
 */
export const restockSuccessCopy = (variant = {}) => {
  const size = (variant.size ?? "").toString().trim();
  const color = (variant.color ?? "").toString().trim();
  if (size && color) return ["storefront.restock.notifySizeColor", RESTOCK_COPY.notifySizeColor, { color, size }];
  if (size) return ["storefront.restock.notifySize", RESTOCK_COPY.notifySize, { size }];
  if (color) return ["storefront.restock.notifyColor", RESTOCK_COPY.notifyColor, { color }];
  return ["storefront.restock.notifyProduct", RESTOCK_COPY.notifyProduct, {}];
};

// Plain-Arabic rendering of the success copy (tests and non-React callers).
export const restockSuccessText = (variant = {}) => {
  const [, fallback, values] = restockSuccessCopy(variant);
  return interpolate(fallback, values);
};

export const RESTOCK_CTA_LABEL = RESTOCK_COPY.cta;
export const RESTOCK_AVAILABLE_NOW_TEXT = RESTOCK_COPY.availableNow;
export const RESTOCK_LOGIN_TEXT = RESTOCK_COPY.loginRequired;
export const RESTOCK_ERROR_TEXT = RESTOCK_COPY.error;
