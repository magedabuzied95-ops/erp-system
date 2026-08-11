// Phase 7.5 — pure helpers for the storefront "بلغني لما يتوفر" (Restock Intent) CTA.
// Framework-free so they are unit-testable. No API calls, no messaging.

const stockOf = (variant = {}) => Number(variant?.stock ?? variant?.available ?? 0) || 0;

// The CTA relates to the CURRENT selected variant and only shows when that variant is unavailable.
export const shouldShowRestockCta = (variant) => Boolean(variant && variant.id) && stockOf(variant) <= 0;

// Stable per-variant key so success/loading state never leaks across variants (size 44 → size 45).
export const restockVariantKey = (variant = {}) => (variant && variant.id != null ? String(variant.id) : "");

// Human Arabic success text using the ACTUAL selected variant labels. Never promises a channel.
export const restockSuccessText = (variant = {}) => {
  const size = (variant.size ?? "").toString().trim();
  const color = (variant.color ?? "").toString().trim();
  if (size && color) return `هنبلغك لما ${color} مقاس ${size} يتوفر`;
  if (size) return `هنبلغك لما مقاس ${size} يتوفر`;
  if (color) return `هنبلغك لما ${color} يتوفر`;
  return "هنبلغك لما المنتج يتوفر";
};

export const RESTOCK_CTA_LABEL = "بلغني لما يتوفر";
export const RESTOCK_AVAILABLE_NOW_TEXT = "المقاس متوفر دلوقتي";
export const RESTOCK_LOGIN_TEXT = "سجّل دخولك لتفعيل الإبلاغ عند التوفر";
export const RESTOCK_ERROR_TEXT = "تعذّر إنشاء الطلب، حاول تاني";
