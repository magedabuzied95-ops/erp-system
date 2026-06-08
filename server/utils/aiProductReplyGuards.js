import { normalizeArabicIntentPayload, normalizeArabicMessage } from "./arabicTextNormalizer.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeGuardText = (value = "") =>
  normalizeArabicIntentPayload(value).normalizedForIntent
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const NAME_CONTROL_PHRASES = [
  "تمام",
  "ماشي",
  "اكد",
  "أكد",
  "اكد الاوردر",
  "أكد الاوردر",
  "اكد الطلب",
  "أكد الطلب",
  "تمام اكد",
  "تمام أكد",
  "احجزه",
  "احجزها",
  "احجز",
  "هاخده",
  "هاخدها",
  "هاخد",
  "order",
  "checkout",
  "confirm",
  "reserve",
  "buy",
];

const looksLikeNameControlPhrase = (value = "") => {
  const normalized = normalizeGuardText(value);
  if (!normalized) return false;
  if (normalized.length > 60) return false;
  return NAME_CONTROL_PHRASES.some((phrase) => {
    const needle = normalizeGuardText(phrase);
    return needle && (normalized === needle || normalized.includes(needle));
  });
};

export const guardAiNameCapture = ({ messageText = "", route = "" } = {}) => {
  const original = text(messageText);
  const blockedAsName = looksLikeNameControlPhrase(original);
  const reason = blockedAsName ? "order_confirmation_phrase" : "";
  if (blockedAsName) {
    console.log("[ai-name-guard]", {
      messageText: original,
      blockedAsName,
      reason,
      route,
    });
  }
  return { blockedAsName, reason };
};

export const buildAiPriceGuard = ({
  productId = null,
  variantId = null,
  rawPrice = null,
  product = {},
  productContext = {},
  memory = {},
  messageText = "",
  route = "",
} = {}) => {
  const fallbackPrice = rawPrice ?? product?.price ?? product?.final_price ?? product?.sale_price ?? product?.regular_price ?? productContext?.price ?? null;
  const numericPrice = numeric(fallbackPrice);
  const renderedPrice = numericPrice && numericPrice > 0 ? `${Math.round(numericPrice).toLocaleString("en-US")} جنيه` : "";
  const totalStock = numeric(product?.total_stock ?? product?.stock ?? productContext?.total_stock ?? 0) || 0;
  const variantsCount = Array.isArray(product?.variants) ? product.variants.length : Array.isArray(productContext?.variants) ? productContext.variants.length : 0;
  const memorySizes = [
    memory?.selectedSize,
    memory?.activeSize,
    memory?.preferences?.size,
    memory?.preferences?.selectedSize,
    productContext?.size,
    productContext?.selectedSize,
    productContext?.requestedSize,
    productContext?.sizeLabel,
    ...(Array.isArray(productContext?.sizeOptions) ? productContext.sizeOptions : []),
  ].map((item) => text(item)).filter(Boolean);
  const memoryOnlyProduct = !renderedPrice && totalStock <= 0 && variantsCount === 0 && memorySizes.length > 0;
  const blockedDashPrice = !renderedPrice;
  const safeReplyText = blockedDashPrice
    ? "تمام، هأكدلك التوفر والسعر قبل تسجيل الأوردر. ابعتلي اسمك ورقمك لو تحب نكمل."
    : "";
  console.log("[ai-price-guard]", {
    productId: text(productId || product?.product_id || product?.id || productContext?.productId || null),
    variantId: text(variantId || product?.variant_id || productContext?.variantId || null),
    rawPrice: fallbackPrice ?? null,
    renderedPrice,
    blockedDashPrice,
    memoryOnlyProduct,
    route,
    messageText: text(messageText),
  });
  return {
    rawPrice: fallbackPrice ?? null,
    renderedPrice,
    blockedDashPrice,
    memoryOnlyProduct,
    safeReplyText,
    shouldUseSafeReply: blockedDashPrice,
  };
};

export const formatSafeProductPrice = (value = "") => {
  const parsed = numeric(value);
  return parsed && parsed > 0 ? `${Math.round(parsed).toLocaleString("en-US")} جنيه` : "";
};

export default {
  guardAiNameCapture,
  buildAiPriceGuard,
  formatSafeProductPrice,
};
