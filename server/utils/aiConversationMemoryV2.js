import { normalizeArabicIntentPayload, normalizeArabicMessage } from "./arabicTextNormalizer.js";

const toText = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (items = []) => [...new Set(asArray(items).map((item) => toText(item)).filter(Boolean))];
const MAX_CARDS = 8;

const COLOR_GROUPS = [
  ["black", ["black", "black color", "اسود", "أسود", "الاسود", "الأسود", "سودا", "سود"]],
  ["white", ["white", "ابيض", "أبيض", "الابيض", "الأبيض", "وايت"]],
  ["grey", ["grey", "gray", "رمادي", "رصاصي", "جراي"]],
  ["beige", ["beige", "بيج"]],
  ["brown", ["brown", "بني"]],
  ["blue", ["blue", "ازرق", "أزرق", "الازرق", "الأزرق"]],
  ["green", ["green", "اخضر", "أخضر", "الاخضر", "الأخضر"]],
  ["red", ["red", "احمر", "أحمر", "الاحمر", "الأحمر"]],
  ["navy", ["navy", "كحلي", "كحلى"]],
  ["pink", ["pink", "وردي", "روز"]],
];

const BUYING_TERMS = [
  "هاخده",
  "هاخدها",
  "احجزه",
  "احجزها",
  "احجزهولي",
  "احجزهولى",
  "اكد الطلب",
  "أكد الطلب",
  "عايزه",
  "عايزة",
  "عايزه ا",
  "عاوز",
  "عاوزة",
  "هبعته",
  "هبعتها",
  "خلاص",
  "تمام",
  "ماشي",
  "ينفع",
];

const YES_TERMS = ["ايوه", "ايوة", "اه", "آه", "تمام", "مظبوط", "بالظبط", "صح", "ماشي", "ينفع", "أكيد", "اكيد"];
const NO_TERMS = ["لا", "لأ", "لاء", "مش", "مفيش"];
const MORE_IMAGES_TERMS = [
  "صور تاني",
  "صور ثاني",
  "صور اكتر",
  "صور أكثر",
  "ابعت صور",
  "ابعث صور",
  "more images",
  "more photos",
  "more pictures",
  "send more photos",
  "send more images",
];
const ALTERNATIVE_TERMS = [
  "لون تاني",
  "لون ثاني",
  "في لون تاني",
  "في لون ثاني",
  "بديل",
  "في بديل",
  "alternatives",
  "alternative",
  "closest alternative",
];
const SIZE_TERMS = ["مقاس", "مقاسات", "size", "sizes"];
const ORDER_TRACKING_TERMS = ["فين الاوردر", "رقم الطلب", "order tracking", "track order", "track my order", "where is my order", "order status"];

const normalizeCompact = (value = "") =>
  normalizeArabicIntentPayload(value).normalizedForIntent
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeSize = (value = "") => {
  const normalized = normalizeCompact(value);
  const match = normalized.match(/\b([0-9]{1,3})\b/);
  return match?.[1] ? String(Number(match[1])) : "";
};

const compactCard = (product = {}) => {
  const productId = toText(product.productId || product.product_id || product.id || "");
  const productName = toText(product.productName || product.product_name || product.name || product.title || "");
  const color = toText(product.color || product.matched_variant_color || product.selected_color || product.variant_color || "");
  const sizeOptions = unique([
    ...(Array.isArray(product.sizeOptions) ? product.sizeOptions : []),
    ...(Array.isArray(product.available_sizes) ? product.available_sizes : []),
    ...(Array.isArray(product.sizes) ? product.sizes : []),
    ...(Array.isArray(product.inventory_profile?.available_sizes) ? product.inventory_profile.available_sizes : []),
  ]).slice(0, 8);
  const imageUrl = toText(product.imageUrl || product.image_url || product.image || product.main_image || product.thumbnail || "");
  const price = Number(product.price || product.final_price || product.sale_price || product.display_price || 0) || 0;
  return {
    productId,
    productName,
    color,
    sizeOptions,
    imageUrl,
    price,
  };
};

const compactShownCards = (shownProducts = [], selectedProduct = null) => {
  const candidates = [
    ...asArray(shownProducts),
    ...(selectedProduct ? [selectedProduct] : []),
  ]
    .map((product) => compactCard(product))
    .filter((card) => card.productId || card.productName);

  const deduped = [];
  const seen = new Set();
  for (const card of candidates) {
    const key = [card.productId, card.productName, card.color, card.imageUrl].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(card);
    if (deduped.length >= MAX_CARDS) break;
  }
  return deduped;
};

const hasUsefulProductContext = (memory = {}) => Boolean(
  toText(memory?.lastMentionedProductId) ||
  toText(memory?.lastMentionedCanonicalProduct) ||
  asArray(memory?.lastShownProductCards).length
);

const textHasAny = (text = "", terms = []) => {
  const haystack = normalizeCompact(text);
  return terms.some((term) => {
    const needle = normalizeCompact(term);
    return needle && haystack.includes(needle);
  });
};

const detectColor = (text = "") => {
  const normalized = normalizeCompact(text);
  for (const [color, aliases] of COLOR_GROUPS) {
    if (aliases.some((alias) => normalized === normalizeCompact(alias) || normalized.includes(normalizeCompact(alias)))) {
      return color;
    }
  }
  return "";
};

const detectSize = (text = "") => normalizeSize(text);

export const mergeConversationMemoryV2 = (existingMemory = null, patch = null) => {
  const base = existingMemory && typeof existingMemory === "object" ? existingMemory : {};
  const next = patch && typeof patch === "object" ? patch : {};
  const mergedCards = compactShownCards(
    next.lastShownProductCards || base.lastShownProductCards || [],
    next.selectedProduct || null
  );
  const result = {
    version: 2,
    lastMentionedProductId: toText(next.lastMentionedProductId || base.lastMentionedProductId || ""),
    lastMentionedProductName: toText(next.lastMentionedProductName || base.lastMentionedProductName || ""),
    lastMentionedCanonicalProduct: toText(next.lastMentionedCanonicalProduct || base.lastMentionedCanonicalProduct || ""),
    lastMatchedAlias: toText(next.lastMatchedAlias || base.lastMatchedAlias || ""),
    lastShownProductCards: mergedCards,
    selectedColor: toText(next.selectedColor || base.selectedColor || ""),
    selectedSize: toText(next.selectedSize || base.selectedSize || ""),
    pendingBuyingIntent: Boolean(next.pendingBuyingIntent ?? base.pendingBuyingIntent ?? false),
    pendingQuestion: toText(next.pendingQuestion || base.pendingQuestion || ""),
    updatedAt: toText(next.updatedAt || base.updatedAt || new Date().toISOString()),
  };
  return result;
};

export const buildConversationMemoryV2 = ({
  existingMemory = null,
  messageText = "",
  normalizedPayload = null,
  intentPayload = null,
  aliasResult = null,
  searchHints = null,
  confidenceResult = null,
  shownProducts = [],
  selectedProduct = null,
  selectedColor = "",
  selectedSize = "",
} = {}) => {
  const current = existingMemory && typeof existingMemory === "object" ? existingMemory : null;
  const payload = normalizedPayload && typeof normalizedPayload === "object" ? normalizedPayload : normalizeArabicIntentPayload(messageText);
  const intent = intentPayload && typeof intentPayload === "object" ? intentPayload : payload;
  const product = selectedProduct || asArray(shownProducts)[0] || null;
  const cards = compactShownCards(shownProducts, product);
  const resolvedColor = toText(selectedColor || current?.selectedColor || "");
  const resolvedSize = toText(selectedSize || current?.selectedSize || "");
  const canonicalProduct = toText(aliasResult?.canonicalProduct || searchHints?.canonicalProduct || current?.lastMentionedCanonicalProduct || "");
  const matchedAlias = toText(aliasResult?.matchedAlias || current?.lastMatchedAlias || "");
  const productId = toText(
    product?.productId ||
    product?.product_id ||
    product?.id ||
    current?.lastMentionedProductId ||
    cards[0]?.productId ||
    cards[0]?.product_id ||
    cards[0]?.id ||
    ""
  );
  const productName = toText(
    product?.productName ||
    product?.product_name ||
    product?.name ||
    product?.title ||
    current?.lastMentionedProductName ||
    cards[0]?.productName ||
    cards[0]?.product_name ||
    cards[0]?.name ||
    cards[0]?.title ||
    ""
  );
  const pendingBuyingIntent = Boolean(
    payload.canonicalSignals?.includes("buy") ||
    payload.canonicalSignals?.includes("yes") ||
    textHasAny(messageText, BUYING_TERMS)
  );

  return mergeConversationMemoryV2(current, {
    version: 2,
    lastMentionedProductId: productId,
    lastMentionedProductName: productName,
    lastMentionedCanonicalProduct: canonicalProduct,
    lastMatchedAlias: matchedAlias,
    lastShownProductCards: cards,
    selectedColor: resolvedColor,
    selectedSize: resolvedSize,
    pendingBuyingIntent,
    pendingQuestion: toText(current?.pendingQuestion || ""),
    updatedAt: new Date().toISOString(),
  });
};

export const resolveFollowupContext = ({ memory = null, messageText = "", normalizedPayload = null, intentPayload = null } = {}) => {
  const v2 = memory && typeof memory === "object" ? memory : {};
  const payload = normalizedPayload && typeof normalizedPayload === "object" ? normalizedPayload : normalizeArabicIntentPayload(messageText);
  const intent = intentPayload && typeof intentPayload === "object" ? intentPayload : payload;
  const normalizedText = toText(payload.normalizedText || normalizeArabicMessage(messageText));
  const normalizedForIntent = toText(payload.normalizedForIntent || "");
  const hasContext = hasUsefulProductContext(v2);
  if (!hasContext) return { type: "none" };

  const productId = toText(v2.lastMentionedProductId || v2.lastShownProductCards?.[0]?.productId || "");
  const canonicalProduct = toText(v2.lastMentionedCanonicalProduct || "");
  const detectedColor = detectColor(messageText) || detectColor(normalizedText) || detectColor(normalizedForIntent);
  const detectedSize = detectSize(messageText) || detectSize(normalizedText) || detectSize(normalizedForIntent);

  if (textHasAny(messageText, MORE_IMAGES_TERMS) || textHasAny(normalizedText, MORE_IMAGES_TERMS) || textHasAny(normalizedForIntent, MORE_IMAGES_TERMS) || payload.canonicalSignals?.includes("more_images")) {
    return {
      type: "more_images_followup",
      cards: asArray(v2.lastShownProductCards).slice(0, MAX_CARDS),
      productId,
      canonicalProduct,
    };
  }

  if (textHasAny(messageText, ALTERNATIVE_TERMS) || textHasAny(normalizedText, ALTERNATIVE_TERMS) || textHasAny(normalizedForIntent, ALTERNATIVE_TERMS)) {
    return {
      type: "alternative_followup",
      productId,
      canonicalProduct,
    };
  }

  if (
    payload.canonicalSignals?.includes("buy") ||
    payload.canonicalSignals?.includes("yes") ||
    textHasAny(messageText, BUYING_TERMS) ||
    textHasAny(normalizedText, BUYING_TERMS) ||
    textHasAny(normalizedForIntent, BUYING_TERMS)
  ) {
    return {
      type: "buying_followup",
      productId,
      size: detectedSize || toText(v2.selectedSize || ""),
      color: detectedColor || toText(v2.selectedColor || ""),
    };
  }

  if (detectedSize && (textHasAny(messageText, SIZE_TERMS) || textHasAny(normalizedText, SIZE_TERMS) || textHasAny(normalizedForIntent, SIZE_TERMS) || payload.canonicalSignals?.includes("size"))) {
    return {
      type: "size_followup",
      productId,
      size: detectedSize,
      canonicalProduct,
    };
  }

  if (detectedColor && !detectedSize && (textHasAny(messageText, COLOR_GROUPS.flatMap(([, aliases]) => aliases)) || textHasAny(normalizedText, COLOR_GROUPS.flatMap(([, aliases]) => aliases)) || textHasAny(normalizedForIntent, COLOR_GROUPS.flatMap(([, aliases]) => aliases)) || payload.canonicalSignals?.includes("color"))) {
    return {
      type: "color_followup",
      productId,
      canonicalProduct,
      color: detectedColor,
    };
  }

  return { type: "none" };
};

export const summarizeConversationMemoryV2 = (memory = null) => ({
  version: Number(memory?.version || 2),
  lastMentionedProductId: toText(memory?.lastMentionedProductId || ""),
  lastMentionedCanonicalProduct: toText(memory?.lastMentionedCanonicalProduct || ""),
  lastShownProductCards: asArray(memory?.lastShownProductCards).length,
  selectedColor: toText(memory?.selectedColor || ""),
  selectedSize: toText(memory?.selectedSize || ""),
  pendingBuyingIntent: Boolean(memory?.pendingBuyingIntent),
  pendingQuestion: toText(memory?.pendingQuestion || ""),
});

export default {
  buildConversationMemoryV2,
  mergeConversationMemoryV2,
  resolveFollowupContext,
  summarizeConversationMemoryV2,
};
