/**
 * Customer-facing prices are whole pounds. Fractions in this catalogue have all
 * been typos (a 949.99 reached a story image before anyone noticed), so they are
 * rejected at save time rather than rounded — rounding would silently change a
 * price the seller believed they had entered.
 *
 * Only selling prices are covered. Cost, purchase and supplier figures legitimately
 * carry fractions and are left alone.
 */
const PRICE_FIELD_LABELS = {
  regular_price: "السعر الأساسي",
  price: "السعر",
  sale_price: "سعر العرض",
  offer_price: "سعر العرض",
  selling_price: "سعر البيع",
  variant_price: "سعر المتغير",
  variant_sale_price: "سعر عرض المتغير",
  variant_selling_price: "سعر بيع المتغير",
};

/** "" for a value that is absent — absent is not the same as invalid. */
const fractionalPart = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  if (!text) return "";
  const numeric = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "";
  return Number.isInteger(numeric) ? "" : text;
};

/**
 * @param {object} payload values keyed by price field name
 * @returns {string[]} human-readable problems, empty when every price is whole
 */
export const wholePoundPriceErrors = (payload = {}) => {
  const errors = [];
  for (const [field, label] of Object.entries(PRICE_FIELD_LABELS)) {
    const offending = fractionalPart(payload?.[field]);
    if (offending) errors.push(`${label} لازم يكون رقم صحيح بدون كسور (المُدخل: ${offending})`);
  }
  return errors;
};

/** Same check across a variants array, reported with the variant's position. */
export const wholePoundVariantPriceErrors = (variants = []) => {
  const errors = [];
  (Array.isArray(variants) ? variants : []).forEach((variant, index) => {
    for (const message of wholePoundPriceErrors(variant || {})) {
      errors.push(`المتغير رقم ${index + 1}: ${message}`);
    }
  });
  return errors;
};

export default wholePoundPriceErrors;
