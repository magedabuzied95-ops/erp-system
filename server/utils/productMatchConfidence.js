import { normalizeArabicIntentPayload, normalizeArabicMessage } from "./arabicTextNormalizer.js";

const text = (value = "") => String(value ?? "").trim();
const unique = (items = [], limit = 32) => [...new Set(items.map(text).filter(Boolean))].slice(0, limit);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const COLOR_TERMS = [
  "black", "white", "red", "blue", "green", "yellow", "pink", "purple", "brown", "beige",
  "gray", "grey", "orange", "navy", "اسود", "أسود", "ابيض", "أبيض", "احمر", "أحمر",
  "ازرق", "أزرق", "اخضر", "أخضر", "بيج", "رمادي", "بني", "ذهبي", "فضي", "كحلي", "أوف وايت",
];

const STOP_WORDS = new Set([
  "عايز", "عاوزه", "عاوزه", "عاوز", "اريد", "ابغى", "ابغى", "ابعت", "صور", "صورة", "صوره", "فيه", "هل",
  "عايزه", "لو", "من", "على", "في", "و", "او", "or", "and", "the", "a", "an", "ال", "هذا", "هذه", "ده",
  "دي", "اللون", "مقاس", "مقاسات", "size", "sizes", "price", "سعر", "بكام", "كام",
]);

const numberize = (value = "") => text(value).replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));

const normalizeToken = (value = "") =>
  normalizeArabicIntentPayload(value).normalizedForIntent ||
  normalizeArabicMessage(value) ||
  text(value).toLowerCase();

const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const candidateTextBlob = (product = {}) => {
  const flattened = [];
  const visit = (value) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(visit);
      return;
    }
    const normalized = text(value);
    if (normalized) flattened.push(normalized);
  };
  visit([
    product.id,
    product.product_id,
    product.name,
    product.title,
    product.product_name,
    product.brand,
    product.brand_name,
    product.model,
    product.model_name,
    product.slug,
    product.canonical_slug,
    product.sku,
    product.barcode,
    product.category,
    product.category_name,
    product.product_type,
    product.type,
    product.description,
    product.tags,
    product.keywords,
    product.color,
    product.color_name,
    product.color_value,
    product.style,
    product.gender,
    product.available_sizes,
    product.sizes,
    product.inventory_profile?.available_sizes,
    product.inventory_profile?.size,
    product.inventory_profile?.size_label,
    product.variants,
    product.product_variants,
  ]);
  return unique(flattened, 80).join(" ");
};

const normalizeBlob = (value = "") => normalizeToken(value).replace(/\s+/g, " ").trim();

const containsAny = (haystack = "", needles = []) => {
  const blob = ` ${normalizeBlob(haystack)} `;
  return needles.filter(Boolean).find((needle) => {
    const term = normalizeBlob(needle);
    if (!term) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(blob) || blob.includes(` ${term} `) || blob.includes(term);
  }) || "";
};

const candidateHasSize = (product = {}) => {
  const sizeFields = [
    product.size,
    product.sizes,
    product.available_sizes,
    product.size_name,
    product.inventory_profile?.size,
    product.inventory_profile?.size_label,
    product.inventory_profile?.available_sizes,
    ...(toArray(product.variants).flatMap((variant) => [variant?.size, variant?.sizes, variant?.available_sizes])),
    ...(toArray(product.product_variants).flatMap((variant) => [variant?.size, variant?.sizes, variant?.available_sizes])),
  ];
  return sizeFields.some((value) => Boolean(text(value)));
};

const candidateHasColor = (product = {}) => {
  const colorFields = [
    product.color,
    product.color_name,
    product.color_value,
    product.color_hex,
    product.variant_color,
    ...(toArray(product.variants).flatMap((variant) => [variant?.color, variant?.color_name, variant?.color_value])),
    ...(toArray(product.product_variants).flatMap((variant) => [variant?.color, variant?.color_name, variant?.color_value])),
  ];
  return colorFields.some((value) => Boolean(text(value)));
};

const candidateInStock = (product = {}) => {
  const stocks = [
    product.stock,
    product.quantity,
    product.total_stock,
    product.available_stock,
    product.inventory_profile?.available_stock,
    product.inventory_profile?.stock,
    ...(toArray(product.variants).flatMap((variant) => [variant?.stock, variant?.quantity, variant?.available_stock])),
    ...(toArray(product.product_variants).flatMap((variant) => [variant?.stock, variant?.quantity, variant?.available_stock])),
  ].map((value) => Number(value || 0));
  return stocks.some((value) => value > 0);
};

const hasOutOfStockSignal = (product = {}) => {
  const stocks = [
    product.stock,
    product.quantity,
    product.total_stock,
    product.available_stock,
    product.inventory_profile?.available_stock,
    product.inventory_profile?.stock,
    ...(toArray(product.variants).flatMap((variant) => [variant?.stock, variant?.quantity, variant?.available_stock])),
    ...(toArray(product.product_variants).flatMap((variant) => [variant?.stock, variant?.quantity, variant?.available_stock])),
  ].map((value) => Number(value || 0));
  return stocks.length > 0 && stocks.every((value) => value <= 0);
};

const extractMessageSignals = ({ normalizedPayload = {}, intentPayload = {}, text = "" } = {}) => {
  const payload = intentPayload && Object.keys(intentPayload).length ? intentPayload : normalizedPayload;
  const originalText = text || payload.originalText || "";
  const normalizedText = payload.normalizedText || normalizeArabicMessage(originalText);
  const normalizedForIntent = payload.normalizedForIntent || normalizeToken(normalizedText);
  const tokens = unique([
    ...(payload.intentTokens || []),
    ...normalizedForIntent.split(/\s+/),
    ...normalizedText.split(/\s+/),
  ]).filter((token) => token && token.length >= 2 && !STOP_WORDS.has(token));
  const sizeMatch = /\b([0-9]{2,3})\b/.test(normalizedForIntent);
  const colorTerm = containsAny(`${normalizedForIntent} ${normalizedText}`, COLOR_TERMS);
  return {
    originalText,
    normalizedText,
    normalizedForIntent,
    tokens,
    sizeSignal: Boolean((payload.canonicalSignals || []).includes("size") || sizeMatch),
    colorSignal: Boolean((payload.canonicalSignals || []).includes("color") || colorTerm),
    colorTerm,
  };
};

export const scoreProductCandidate = ({ product = {}, text: inputText = "", normalizedPayload = null, aliasResult = null, searchHints = null, intentPayload = null } = {}) => {
  const normalized = normalizedPayload && typeof normalizedPayload === "object"
    ? normalizedPayload
    : normalizeArabicIntentPayload(inputText);
  const signals = extractMessageSignals({ normalizedPayload: normalized, intentPayload: intentPayload || normalized, text: inputText });
  const candidateBlob = normalizeBlob(candidateTextBlob(product));
  const scoreLog = [];
  const matchedSignals = [];
  let score = 0;

  const aliasTerms = unique([
    aliasResult?.matchedAlias,
    ...(aliasResult?.searchTerms || []),
    searchHints?.canonicalProduct,
    ...(searchHints?.searchTerms || []),
  ]).filter(Boolean);
  const canonicalProduct = text(aliasResult?.canonicalProduct || searchHints?.canonicalProduct || "");
  const normalizedAliasBlob = normalizeBlob(aliasTerms.join(" "));

  if (canonicalProduct && normalizedAliasBlob && containsAny(candidateBlob, aliasTerms)) {
    score += 35;
    scoreLog.push("+35 alias canonical match");
    matchedSignals.push("alias_canonical_match");
  }

  if (containsAny(candidateBlob, aliasTerms)) {
    score += 25;
    scoreLog.push("+25 alias search term match");
    matchedSignals.push("alias_search_term_match");
  }

  const messageBlob = normalizeBlob([
    signals.normalizedForIntent,
    signals.normalizedText,
    ...(searchHints?.productQueryHints || []),
    ...(searchHints?.searchTerms || []),
    ...(aliasResult?.searchTerms || []),
  ].join(" "));

  const brand = candidateTextBlob(product).includes(text(product.brand || product.brand_name || "")) ? text(product.brand || product.brand_name || "") : "";
  if (brand && containsAny(messageBlob, [brand])) {
    score += 20;
    scoreLog.push("+20 brand match");
    matchedSignals.push("brand_match");
  }

  const modelTerms = unique([
    product.model,
    product.model_name,
    product.product_model,
    product.title,
    product.name,
    product.product_name,
    product.slug,
    product.canonical_slug,
  ]);
  const modelMatch = containsAny(messageBlob, modelTerms) || containsAny(candidateBlob, signals.tokens);
  if (modelMatch) {
    score += 20;
    scoreLog.push("+20 model match");
    matchedSignals.push("model_match");
  }

  if (signals.colorSignal && candidateHasColor(product)) {
    const colorMatch = containsAny(candidateBlob, [signals.colorTerm, ...(product.color ? [product.color] : []), ...(product.color_name ? [product.color_name] : []), ...(product.color_value ? [product.color_value] : [])]);
    if (colorMatch || candidateBlob.includes(signals.colorTerm)) {
      score += 10;
      scoreLog.push("+10 color match");
      matchedSignals.push("color_match");
    }
  }

  if (signals.sizeSignal && candidateHasSize(product)) {
    score += 10;
    scoreLog.push("+10 size match");
    matchedSignals.push("size_match");
  }

  const exactTokenMatch = signals.tokens.find((token) => {
    if (token.length < 2 || STOP_WORDS.has(token)) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(candidateBlob);
  });
  if (exactTokenMatch) {
    score += 10;
    scoreLog.push("+10 exact token match");
    matchedSignals.push("exact_token_match");
  }

  if (candidateInStock(product)) {
    score += 10;
    scoreLog.push("+10 in-stock");
    matchedSignals.push("in_stock");
  } else if (hasOutOfStockSignal(product)) {
    score -= 40;
    scoreLog.push("-40 out-of-stock");
    matchedSignals.push("out_of_stock");
  }

  if (!matchedSignals.length || score < 10) {
    score -= 30;
    scoreLog.push("-30 weak unrelated match");
    matchedSignals.push("weak_unrelated_match");
  }

  const confidence = clamp(Math.round(score), 0, 100);
  return {
    productId: text(product.id || product.product_id || ""),
    productName: text(product.name || product.title || product.product_name || product.model_name || ""),
    confidence,
    score: Math.round(score),
    reasons: unique(scoreLog),
    matchedSignals: unique(matchedSignals),
  };
};

export const rankProductCandidates = ({ candidates = [], text = "", normalizedPayload = null, aliasResult = null, searchHints = null, intentPayload = null } = {}) => {
  const scoredCandidates = (Array.isArray(candidates) ? candidates : []).map((product, index) => {
    const score = scoreProductCandidate({ product, text, normalizedPayload, aliasResult, searchHints, intentPayload });
    return {
      ...product,
      match_rank: index,
      product_match_confidence: score.confidence,
      product_match_score: score.score,
      product_match_reasons: score.reasons,
      product_match_signals: score.matchedSignals,
      product_match_product_id: score.productId,
      product_match_product_name: score.productName,
    };
  });
  const sorted = [...scoredCandidates].sort((left, right) => {
    const confidenceDiff = Number(right.product_match_confidence || 0) - Number(left.product_match_confidence || 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    const scoreDiff = Number(right.product_match_score || 0) - Number(left.product_match_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(left.match_rank || 0) - Number(right.match_rank || 0);
  });
  const bestMatch = sorted[0] && Number(sorted[0].product_match_confidence || 0) >= 65 ? sorted[0] : null;
  return {
    bestMatch,
    rankedCandidates: sorted,
    confidence: Number(sorted[0]?.product_match_confidence || 0),
    fallbackRecommended: !bestMatch,
  };
};

export default {
  rankProductCandidates,
  scoreProductCandidate,
};
