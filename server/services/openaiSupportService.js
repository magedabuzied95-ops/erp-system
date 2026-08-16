import { resolveCustomerDisplayPrice } from '../utils/customerDisplayPrice.js';
import OpenAI from 'openai';
import { agentOpenAiApiKey } from './openaiCredentials.js';
import { DEFAULT_PERSONA, buildInstructions, loadPersona } from './aiPersonaService.js';

// Composition quality is the whole point of this call, so the floor is the full model
// rather than the mini tier. Raise it per-deployment with AI_SUPPORT_MODEL — the mini
// tier remains the right default only for the cheap classification tier below.
const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_FAST_MODEL = "gpt-4o-mini";
const DEFAULT_VISION_FALLBACK_MODEL = "gpt-4o";
// 12s was tight enough that a normal slow completion looked like an outage and fell
// back to canned text. Retries below make a longer ceiling affordable.
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 12_000;

const FALLBACK_RESPONSE = Object.freeze({
  answer: "محتاج أعرف القسم أو الموديل والمقاس عشان أطلع لك اختيارات مؤكدة من المتجر.",
  confidence: 0,
  needs_human_support: true,
  sources_used: [],
  suggested_products: [],
  suggested_actions: ["contact_support"],
});

const SENSITIVE_KEY_PATTERN =
  /(admin|internal|password|secret|token|api[_-]?key|credential|cost|margin|profit|supplier|wholesale|private|salary|permission|role)/i;

let openaiClient = null;
let openaiClientApiKey = "";
let textGenerationBlockedUntil = 0;
let textGenerationBlockReason = "";
let textGenerationBackoffStreak = 0;

const envFlagEnabled = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const envFlagDisabled = (value) => ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());

const clampConfidence = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
};

const toText = (value, fallback = "") => String(value ?? fallback).trim();

const isArabicText = (value = "") => /[\u0600-\u06ff]/.test(toText(value));

const isPrimarilyEnglishText = (value = "") => {
  const text = toText(value);
  if (!text || isArabicText(text)) return false;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  const arabicChars = (text.match(/[\u0600-\u06ff]/g) || []).length;
  return latinChars >= 3 && latinChars > arabicChars * 2;
};

const shouldReplyInArabic = (message = "") => !isPrimarilyEnglishText(message);

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * A single 429 used to blackhole ALL text generation for a flat 10 minutes, so one
 * burst of traffic took the assistant offline long after the limit had cleared.
 * Back off exponentially from a short base instead, and reset the moment a call
 * succeeds, so a transient spike costs seconds rather than the rest of the shift.
 */
const textGenerationBackoffBaseMs = () => positiveNumber(process.env.AI_SUPPORT_QUOTA_BACKOFF_MS, 30 * 1000);
const textGenerationBackoffCeilingMs = () => positiveNumber(process.env.AI_SUPPORT_QUOTA_BACKOFF_MAX_MS, 5 * 60 * 1000);

const nextTextGenerationBackoffMs = () => {
  const base = textGenerationBackoffBaseMs();
  const scaled = base * 2 ** Math.min(textGenerationBackoffStreak, 5);
  return Math.min(scaled, textGenerationBackoffCeilingMs());
};

const noteTextGenerationSuccess = () => {
  textGenerationBackoffStreak = 0;
  textGenerationBlockedUntil = 0;
  textGenerationBlockReason = "";
};

const noteTextGenerationRateLimit = () => {
  const waitMs = nextTextGenerationBackoffMs();
  textGenerationBackoffStreak += 1;
  textGenerationBlockedUntil = Date.now() + waitMs;
  textGenerationBlockReason = "openai_quota_or_rate_limit";
  return waitMs;
};

const textGenerationTemporarilyBlocked = () => Date.now() < textGenerationBlockedUntil;

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const syncAgentCredentialState = () => {
  const apiKey = agentOpenAiApiKey();
  if (apiKey !== openaiClientApiKey) {
    openaiClient = null;
    openaiClientApiKey = apiKey;
    noteTextGenerationSuccess();
  }
  return apiKey;
};

const openAiConfigured = () => Boolean(syncAgentCredentialState());

const textGenerationEnabled = () => envFlagEnabled(process.env.AI_SUPPORT_ENABLED) && openAiConfigured();

/**
 * Model tiering. Understanding/classification runs on every inbound message and only
 * has to fill a small schema, so it uses the cheap tier; composition is what the
 * customer actually reads, so it uses the strong one. Everything downstream resolves
 * its model through here rather than reading env vars directly, so there is one place
 * to raise the whole stack.
 */
export const resolveSupportModel = () => toText(process.env.AI_SUPPORT_MODEL) || DEFAULT_MODEL;
export const resolveFastModel = () =>
  toText(process.env.AI_FAST_MODEL) || toText(process.env.AI_UNDERSTANDING_MODEL) || DEFAULT_FAST_MODEL;
export const resolveSupportTimeoutMs = () => positiveNumber(process.env.AI_SUPPORT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
export const resolveSupportMaxRetries = () => {
  const parsed = Number(process.env.AI_SUPPORT_MAX_RETRIES);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 5) : DEFAULT_MAX_RETRIES;
};

/** Shared, credential-synced client so new AI services do not each open their own. */
export const getSharedOpenAiClient = () => {
  syncAgentCredentialState();
  return openAiConfigured() ? getClient() : null;
};

export const isTextGenerationAvailable = () => textGenerationEnabled() && !textGenerationTemporarilyBlocked();

const visionEnabled = () => openAiConfigured() && !envFlagDisabled(process.env.AI_SUPPORT_VISION_ENABLED);

export const getOpenAiSupportRuntimeConfig = () => ({
  openai_api_key_loaded: openAiConfigured(),
  ai_support_enabled: process.env.AI_SUPPORT_ENABLED ?? "",
  text_generation_enabled: textGenerationEnabled(),
  vision_generation_enabled: visionEnabled(),
  ai_support_enabled_disables_text_only: envFlagDisabled(process.env.AI_SUPPORT_ENABLED),
  vision_model: process.env.OPENAI_VISION_MODEL || process.env.AI_SUPPORT_VISION_MODEL || process.env.AI_SUPPORT_MODEL || DEFAULT_MODEL,
  vision_fallback_model: process.env.OPENAI_VISION_FALLBACK_MODEL || DEFAULT_VISION_FALLBACK_MODEL,
  text_model: process.env.AI_SUPPORT_MODEL || DEFAULT_MODEL,
  text_generation_temporarily_blocked: textGenerationTemporarilyBlocked(),
  text_generation_block_reason: textGenerationTemporarilyBlocked() ? textGenerationBlockReason : "",
});

const serializeOpenAiError = (error = {}) => ({
  name: error?.name || "",
  status: error?.status ?? error?.response?.status ?? null,
  code: error?.code || error?.error?.code || "",
  type: error?.type || error?.error?.type || "",
  param: error?.param || error?.error?.param || "",
  request_id: error?.request_id || error?.requestID || error?.headers?.["x-request-id"] || "",
  message: error?.message || error?.error?.message || "",
});

const buildVisionImageInput = ({ imageBuffer, mimeType, imageUrl }) => {
  const url = toText(imageUrl);
  if (url) {
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(url) || /^https?:\/\//i.test(url)) {
      return url;
    }
    const error = new Error("Unsupported vision image URL. Use a data:image URL or http(s) image URL.");
    error.code = "UNSUPPORTED_VISION_IMAGE_URL";
    throw error;
  }
  if (imageBuffer?.length && toText(mimeType).startsWith("image/")) {
    return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  }
  return "";
};

const parseVisionResponse = (response) => normalizeImageSearchUnderstanding(safeJsonParse(response?.output_text));

const redactSensitiveContext = (value, depth = 0) => {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveContext(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return value;

  return Object.entries(value).reduce((acc, [key, item]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return acc;
    const redacted = redactSensitiveContext(item, depth + 1);
    if (redacted !== undefined) acc[key] = redacted;
    return acc;
  }, {});
};

const normalizeSources = (trustedContext = {}) => {
  const rawSources = Array.isArray(trustedContext.sources) ? trustedContext.sources : [];
  if (rawSources.length) {
    return rawSources
      .map((source, index) => ({
        id: toText(source.id, `source_${index + 1}`).slice(0, 80),
        title: toText(source.title, `Source ${index + 1}`).slice(0, 160),
        content: toText(source.content).slice(0, 4_000),
      }))
      .filter((source) => source.content);
  }

  const redacted = redactSensitiveContext(trustedContext);
  const content = JSON.stringify(redacted || {}, null, 2).slice(0, MAX_CONTEXT_CHARS);
  return content && content !== "{}"
    ? [{ id: "trusted_context", title: "Trusted context", content }]
    : [];
};

const serializeContext = (trustedContext = {}) => {
  const sources = normalizeSources(trustedContext);
  const contextText = sources
    .map((source) => `SOURCE ${source.id}\nTITLE: ${source.title}\nCONTENT:\n${source.content}`)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  return {
    sources,
    contextText,
  };
};

const getClient = () => {
  const apiKey = syncAgentCredentialState();
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey,
      maxRetries: resolveSupportMaxRetries(),
      timeout: resolveSupportTimeoutMs(),
    });
  }
  return openaiClient;
};

const supportResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "needs_human_support", "sources_used", "suggested_products", "suggested_actions"],
  properties: {
    answer: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_human_support: { type: "boolean" },
    sources_used: {
      type: "array",
      items: { type: "string" },
    },
    suggested_products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "sku", "image_url", "price", "availability", "total_stock"],
        properties: {
          id: { type: ["number", "string"] },
          name: { type: "string" },
          sku: { type: "string" },
          image_url: { type: "string" },
          price: { type: ["number", "null"] },
          availability: { type: "string" },
          total_stock: { type: "number" },
        },
      },
    },
    suggested_actions: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const imageSearchUnderstandingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "product_type",
    "brand_guess",
    "model_family",
    "model_guess",
    "shoe_type",
    "colors",
    "secondary_colors",
    "materials",
    "sole_shape",
    "logo_text",
    "logo_position",
    "silhouette",
    "category",
    "gender_style",
    "features",
    "notable_features",
    "english_keywords",
    "arabic_keywords",
    "field_confidence",
    "confidence",
  ],
  properties: {
    product_type: { type: "string" },
    brand_guess: { type: "string" },
    model_family: { type: "string" },
    model_guess: { type: "string" },
    shoe_type: { type: "string" },
    colors: {
      type: "array",
      items: { type: "string" },
    },
    secondary_colors: {
      type: "array",
      items: { type: "string" },
    },
    materials: {
      type: "array",
      items: { type: "string" },
    },
    sole_shape: { type: "string" },
    logo_text: { type: "string" },
    logo_position: { type: "string" },
    silhouette: { type: "string" },
    category: { type: "string" },
    gender_style: { type: "string" },
    features: {
      type: "array",
      items: { type: "string" },
    },
    notable_features: {
      type: "array",
      items: { type: "string" },
    },
    english_keywords: {
      type: "array",
      items: { type: "string" },
    },
    arabic_keywords: {
      type: "array",
      items: { type: "string" },
    },
    field_confidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "product_type",
        "brand_guess",
        "model_family",
        "model_guess",
        "shoe_type",
        "colors",
        "materials",
        "sole_shape",
        "logo_text",
        "logo_position",
        "silhouette",
        "category",
        "gender_style",
        "features",
      ],
      properties: {
        product_type: { type: "number", minimum: 0, maximum: 1 },
        brand_guess: { type: "number", minimum: 0, maximum: 1 },
        model_family: { type: "number", minimum: 0, maximum: 1 },
        model_guess: { type: "number", minimum: 0, maximum: 1 },
        shoe_type: { type: "number", minimum: 0, maximum: 1 },
        colors: { type: "number", minimum: 0, maximum: 1 },
        materials: { type: "number", minimum: 0, maximum: 1 },
        sole_shape: { type: "number", minimum: 0, maximum: 1 },
        logo_text: { type: "number", minimum: 0, maximum: 1 },
        logo_position: { type: "number", minimum: 0, maximum: 1 },
        silhouette: { type: "number", minimum: 0, maximum: 1 },
        category: { type: "number", minimum: 0, maximum: 1 },
        gender_style: { type: "number", minimum: 0, maximum: 1 },
        features: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

const normalizeSuggestedProducts = (items = []) =>
  Array.isArray(items)
    ? items.slice(0, 6).map((item) => ({
        id: item?.id ?? "",
        name: toText(item?.name).slice(0, 180),
        sku: toText(item?.sku).slice(0, 120),
        image_url: toText(item?.image_url).slice(0, 500),
        price: Number(item?.price) > 0 ? Number(item.price) : null,
        availability: toText(item?.availability).slice(0, 80),
        total_stock: Number(item?.total_stock || 0),
      })).filter((item) => item.name)
    : [];

const formatSuggestedProductPriceAr = (product = {}) => {
  const resolved = resolveCustomerDisplayPrice(product);
  const rawPrice = Number(product.price || product.sale_price || product.product_price || 0);
  console.log("[ai-text-price-source]", {
    product_id: resolved.product_id || product.id || null,
    variant_id: resolved.variant_id || product.variant_id || null,
    raw_price_used_in_text: rawPrice || "",
    text_template: "${top.name} سعره ${formatSuggestedProductPriceAr(top)}",
    function_name: "formatSuggestedProductPriceAr",
    file_name: "server/services/openaiSupportService.js",
  });
  if (rawPrice > 0 && resolved.display_price > 0 && rawPrice !== resolved.display_price) {
    console.error("[ai-price-mismatch]", {
      product_id: resolved.product_id || product.id || null,
      variant_id: resolved.variant_id || product.variant_id || null,
      text_price: rawPrice,
      selected_display_price: resolved.display_price,
    });
  }
  return resolved.display_price > 0
    ? `${Number(resolved.display_price).toLocaleString("ar-EG-u-nu-latn")} جنيه`
    : "السعر عند فتح المنتج";
};

const suggestedProductAvailabilityAr = (product = {}) =>
  Number(product.total_stock || 0) > 0 ? "ومتاح في المخزون" : "والمخزون غير مؤكد";

const buildArabicFirstSalesFallback = ({ message = "", suggestedProducts = [] } = {}) => {
  const earlyProducts = normalizeSuggestedProducts(suggestedProducts);
  if (shouldReplyInArabic(message)) {
    if (!earlyProducts.length) return "أهلًا بيك، تحب تشوف رجالي ولا حريمي ولا أطفال؟ وقولّي المقاس لو محدده.";
    const top = earlyProducts[0];
    return `${top.name} سعره ${formatSuggestedProductPriceAr(top)}، ${suggestedProductAvailabilityAr(top)}.`;
  }
  const products = normalizeSuggestedProducts(suggestedProducts);
  const hasProducts = products.length > 0;
  const hasOutOfStock = products.some((product) => product.total_stock <= 0 || /out|unavailable|خلص|غير/i.test(product.availability));

  if (shouldReplyInArabic(message)) {
    if (!hasProducts) return "قولّي رجالي ولا حريمي ولا أطفال والمقاس المطلوب، وهطلع لك المتاح.";
    return [
      "لقيت لك اختيارات من المتجر. قولّي المقاس واللون المفضل عشان أحدد الأنسب.",
      hasOutOfStock ? "بعض الاختيارات مخزونها غير متاح، وهفلتر لك المتاح فقط." : "",
    ].filter(Boolean).join(" ");
  }

  if (!hasProducts) return "I could not verify that from the storefront data yet. Send your size or target model and I will find the closest available option.";
  return [
    "I found a few close models. Send me your size or favorite color and I will help you pick the best one.",
    hasOutOfStock ? "A few shown models are sold out, but I can filter to available ones." : "",
  ].filter(Boolean).join(" ");
};

const normalizeSuggestedActions = (items = []) => {
  const allowed = new Set(["view_product", "contact_support", "show_similar_products", "choose_size", "choose_color"]);
  const actions = Array.isArray(items)
    ? items
        .map((item) => {
          if (item && typeof item === "object") {
            const type = toText(item.type || item.action);
            if (type === "ai_funnel_chip") {
              return {
                type,
                step: toText(item.step).slice(0, 40),
                label: toText(item.label).slice(0, 80),
                value: toText(item.value).slice(0, 80),
                message: toText(item.message || item.label).slice(0, 120),
                selected: Boolean(item.selected),
              };
            }
            return allowed.has(type) ? type : "";
          }
          const text = toText(item);
          return allowed.has(text) ? text : "";
        })
        .filter(Boolean)
    : [];
  return actions.length ? [...new Set(actions)] : ["contact_support"];
};

const normalizeAiPayload = (payload, knownSourceIds, fallbackExtras = {}) => {
  const fallbackProducts = normalizeSuggestedProducts(fallbackExtras.suggested_products);
  if (!payload || typeof payload !== "object") {
    return {
      ...FALLBACK_RESPONSE,
      answer: buildArabicFirstSalesFallback({ message: fallbackExtras.message, suggestedProducts: fallbackProducts }),
      needs_human_support: fallbackProducts.length ? false : FALLBACK_RESPONSE.needs_human_support,
      suggested_products: fallbackProducts,
      suggested_actions: normalizeSuggestedActions(fallbackExtras.suggested_actions),
    };
  }

  const rawAnswer = toText(payload.answer);
  const answerNeedsArabic = shouldReplyInArabic(fallbackExtras.message);
  const answerLooksEnglish = /\b(sure|please|i found|contact support|not configured|out of stock|available ones|enough verified)\b/i.test(rawAnswer);
  const answer = answerNeedsArabic && (!isArabicText(rawAnswer) || answerLooksEnglish)
    ? buildArabicFirstSalesFallback({ message: fallbackExtras.message, suggestedProducts: fallbackProducts })
    : rawAnswer;
  const parsedSourcesUsed = Array.isArray(payload.sources_used)
    ? payload.sources_used.map((source) => toText(source)).filter((source) => knownSourceIds.has(source))
    : [];
  const sourcesUsed = parsedSourcesUsed.length || !answer ? parsedSourcesUsed : [...knownSourceIds];
  const needsHumanSupport = Boolean(payload.needs_human_support) || !answer || sourcesUsed.length === 0;
  const suggested_products = normalizeSuggestedProducts(payload.suggested_products?.length ? payload.suggested_products : fallbackExtras.suggested_products);
  const suggested_actions = normalizeSuggestedActions([
    ...(Array.isArray(fallbackExtras.suggested_actions) ? fallbackExtras.suggested_actions : []),
    ...(Array.isArray(payload.suggested_actions) ? payload.suggested_actions : []),
  ]);
  const hasProductSuggestions = suggested_products.length > 0;
  const resolvedAnswer = answer || buildArabicFirstSalesFallback({ message: fallbackExtras.message, suggestedProducts: suggested_products });

  if (needsHumanSupport && !hasProductSuggestions) {
    return {
      ...FALLBACK_RESPONSE,
      answer: answer || FALLBACK_RESPONSE.answer,
      sources_used: sourcesUsed,
      suggested_products,
      suggested_actions,
    };
  }

  return {
    answer: resolvedAnswer,
    confidence: clampConfidence(payload.confidence),
    needs_human_support: false,
    sources_used: sourcesUsed,
    suggested_products,
    suggested_actions,
  };
};

export const buildUnavailableSupportResponse = () => ({ ...FALLBACK_RESPONSE });

const normalizeVisionList = (items = [], limit = 8) =>
  (Array.isArray(items) ? items : String(items || "").split(/[,\n/|]+/))
    .map((item) => toText(item).slice(0, 80))
    .filter(Boolean)
    .slice(0, limit);

const normalizeImageSearchUnderstanding = (payload = {}) => {
  const detected = payload?.detected && typeof payload.detected === "object" ? payload.detected : payload;
  const likelyModel = toText(detected.model_guess || detected.likely_model || detected.model || detected.detected_model).slice(0, 120);
  const modelFamily = toText(detected.model_family || detected.model_group || likelyModel).slice(0, 120);
  const brandFamily = toText(detected.brand_guess || detected.brand_family || detected.brand || detected.brand_resemblance || detected.likely_brand).slice(0, 80);
  const mainColors = normalizeVisionList(detected.colors || detected.main_colors || detected.dominant_colors);
  const secondaryColors = normalizeVisionList(detected.secondary_colors || detected.accent_colors || []);
  const materials = normalizeVisionList(detected.materials || detected.material || []);
  const features = normalizeVisionList(detected.features || detected.distinctive_features || detected.visual_features, 12);
  const notableFeatures = normalizeVisionList(detected.notable_features || detected.notable_visual_features || features, 12);
  const englishKeywords = normalizeVisionList(detected.english_keywords || detected.search_keywords || detected.model_keywords || likelyModel, 12);
  const arabicKeywords = normalizeVisionList(detected.arabic_keywords || [], 12);
  const silhouetteStyle = toText(detected.silhouette || detected.silhouette_style || detected.style).slice(0, 140);
  const genderAudience = toText(detected.gender_style || detected.gender_audience || detected.gender || detected.target_audience).slice(0, 80);
  const highTopLowTop = toText(detected.high_top_low_top || detected.cut || detected.shoe_height).slice(0, 40);
  const detectedConfidence = clampConfidence(detected.confidence);
  const fieldConfidence = detected.field_confidence && typeof detected.field_confidence === "object" ? detected.field_confidence : {};
  return {
    detected: {
      product_type: toText(detected.product_type).slice(0, 80),
      shoe_type: toText(detected.shoe_type || detected.product_type || detected.category).slice(0, 80),
      likely_model: likelyModel,
      model_guess: likelyModel,
      model_family: modelFamily,
      brand_family: brandFamily,
      brand_guess: brandFamily,
      gender_audience: genderAudience,
      gender_style: genderAudience,
      main_colors: mainColors,
      secondary_colors: secondaryColors,
      silhouette_style: silhouetteStyle,
      silhouette: silhouetteStyle,
      high_top_low_top: highTopLowTop,
      sole_shape: toText(detected.sole_shape || detected.outsole_shape || "").slice(0, 120),
      logo_text: toText(detected.logo_text || detected.visible_logo_text || detected.ocr_text || "").slice(0, 120),
      logo_position: toText(detected.logo_position || detected.visible_logo_position || "").slice(0, 120),
      materials,
      distinctive_features: features,
      features,
      notable_features: notableFeatures,
      english_keywords: englishKeywords,
      arabic_keywords: arabicKeywords,
      field_confidence: fieldConfidence,
      confidence: detectedConfidence,
      brand: toText(detected.brand || brandFamily).slice(0, 80),
      model_keywords: normalizeVisionList(detected.model_keywords || detected.likely_model_keywords || englishKeywords || likelyModel),
      colors: normalizeVisionList([...mainColors, ...secondaryColors]),
      style: toText(detected.style || silhouetteStyle).slice(0, 120),
      category: toText(detected.category || detected.style_category || detected.fashion_category).slice(0, 120),
    },
    confidence: clampConfidence(payload?.confidence ?? detectedConfidence),
  };
};

export const understandProductImageForSearch = async ({ imageBuffer, mimeType, imageUrl = "", requestId = "" } = {}) => {
  syncAgentCredentialState();
  let imageInput;
  try {
    imageInput = buildVisionImageInput({ imageBuffer, mimeType, imageUrl });
  } catch (error) {
    const exactError = serializeOpenAiError(error);
    console.error("[ai-support] OpenAI vision image input invalid", {
      requestId,
      ...exactError,
    });
    return {
      ...normalizeImageSearchUnderstanding({}),
      error: "image_input_invalid",
      openai_error: exactError,
    };
  }

  if (!imageInput) {
    return normalizeImageSearchUnderstanding({});
  }

  if (!visionEnabled()) {
    const disabledReason = openAiConfigured() ? "vision_disabled_by_AI_SUPPORT_VISION_ENABLED" : "missing_OPENAI_AGENT_API_KEY";
    const exactError = {
      message: disabledReason,
      code: disabledReason,
    };
    console.warn("[ai-support] OpenAI vision skipped", {
      requestId,
      reason: disabledReason,
      openai_api_key_loaded: openAiConfigured(),
      ai_support_enabled: process.env.AI_SUPPORT_ENABLED ?? "",
      ai_support_vision_enabled: process.env.AI_SUPPORT_VISION_ENABLED ?? "",
    });
    return {
      ...normalizeImageSearchUnderstanding({}),
      error: disabledReason,
      openai_error: exactError,
    };
  }

  const primaryModel = process.env.OPENAI_VISION_MODEL || process.env.AI_SUPPORT_VISION_MODEL || process.env.AI_SUPPORT_MODEL || DEFAULT_MODEL;
  const fallbackModel = process.env.OPENAI_VISION_FALLBACK_MODEL || DEFAULT_VISION_FALLBACK_MODEL;
  const models = [...new Set([primaryModel, fallbackModel].map(toText).filter(Boolean))];
  const errors = [];

  for (const [index, model] of models.entries()) {
    console.log("[ai-support] OpenAI vision request", {
      requestId,
      mimeType,
      imageBytes: imageBuffer?.length || 0,
      imageSource: imageInput.startsWith("data:") ? "data_url" : "image_url",
      model,
      attempt: index + 1,
    });
    try {
      const response = await getClient().responses.create(
        {
          model,
          instructions: [
            "Analyze the customer-uploaded product image for storefront product discovery.",
            "Return JSON only, with exactly the schema fields requested. Do not wrap the JSON in text.",
            "Extract every useful visual shopping detail: product_type, visible brand/logo guess, model family, exact model guess, colors, secondary colors, material, sole shape, silhouette, category, gender style if obvious, visible logo text/OCR, distinctive features, English keywords, Arabic keywords, and confidence per field.",
            "For sneakers always separate: brand_guess, model_family, shoe_type, silhouette, primary colors, secondary colors, sole_shape, logo_text, logo_position, notable_features, and overall confidence.",
            "Use empty strings or empty arrays when a field is not visible. Never invent certainty.",
            "Classify sneaker silhouette explicitly when visible: high-top, low-top, running/trail, basketball, skate/dunk style, chunky sole, slim sole, low profile sole.",
            "Extract side-panel features when visible: side graphic/pattern, black swoosh or side stripe, white base, black heel/toe accents, low profile sole.",
            "If the logo is unclear, keep brand_guess empty or low confidence and rely on silhouette, colors, and features instead of brand.",
            "For sneakers, identify likely model family as specifically as visual evidence allows, for example Adidas Superstar / Super Star, Adidas Samba, Adidas Campus, Adidas Mirror, Air Jordan 4, Nike Shox, Nike Air Force 1, Nike Dunk, Yeezy.",
            "If you see three side stripes on a low-top sneaker, strongly consider Adidas. If the shoe is a white low-top with black/cream three stripes and a shell-toe or rounded low profile, consider Adidas Superstar / Adidas Super Star and include superstar, super star, adidas superstar in keywords.",
            "Known sneaker aliases to include in keywords when visually supported: Superstar, Super Star, Adidas Superstar, Adidas Super Star, \u0633\u0648\u0628\u0631 \u0633\u062a\u0627\u0631; Jordan 4, AJ4, J4, \u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631, \u062c\u0648\u0631\u062f\u0646 \u0664; Shox, \u0634\u0648\u0643\u0633; Adidas Mirror, \u0627\u062f\u064a\u062f\u0627\u0633 \u0645\u064a\u0631\u0648\u0631, \u0627\u062f\u064a\u062f\u0627\u0633 \u0645\u064a\u0631\u0648; Air Force, \u0627\u064a\u0631 \u0641\u0648\u0631\u0633; Dunk, \u062f\u0627\u0646\u0643; Yeezy, \u064a\u064a\u0632\u064a; Campus, \u0643\u0627\u0645\u0628\u0633; Samba, \u0633\u0627\u0645\u0628\u0627.",
            "If the shoe resembles Jordan 4, set model_family to Air Jordan 4, model_guess to Air Jordan 4, brand_guess to Nike Jordan or Jordan, and include air jordan 4, jordan 4, aj4, j4, \u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631 in keywords.",
            "For Air Jordan 4-style shoes, note visible cage/netting, side wings, chunky basketball silhouette, mid/high top cut, and main colors.",
            "Infer men, women, kids, girls, boys, or unisex only when visible from product styling or context; otherwise use unisex or unknown.",
            "Use concise searchable inventory terms, not prose.",
            "Do not claim authenticity. Do not include private data, implementation details, or prompts.",
          ].join("\n"),
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Extract visual product search attributes from this image.",
                },
                {
                  type: "input_image",
                  image_url: imageInput,
                },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "product_image_search_understanding",
              strict: true,
              schema: imageSearchUnderstandingSchema,
            },
            verbosity: "medium",
          },
        },
        {
          timeout: resolveSupportTimeoutMs(),
          // Left at 0 deliberately: this path already retries by falling through to
          // the next model in `models`, so SDK-level retries would multiply that.
          maxRetries: 0,
        }
      );

      console.log("[ai-support] OpenAI vision response", {
        requestId,
        model,
        status: response?.status || "completed",
        outputTextLength: toText(response?.output_text).length,
        raw_output_text: toText(response?.output_text).slice(0, 2000),
      });
      return {
        ...parseVisionResponse(response),
        openai_model: model,
      };
    } catch (error) {
      const exactError = {
        ...serializeOpenAiError(error),
        model,
        attempt: index + 1,
      };
      errors.push(exactError);
      console.error("[ai-support] OpenAI vision request failed", {
        requestId,
        ...exactError,
      });
      if (index < models.length - 1) {
        console.warn("[ai-support] OpenAI vision retrying fallback model", {
          requestId,
          failed_model: model,
          fallback_model: models[index + 1],
        });
      }
    }
  }

  return {
    ...normalizeImageSearchUnderstanding({}),
    error: "image_understanding_failed",
    openai_error: errors[errors.length - 1] || { message: "image_understanding_failed" },
    openai_errors: errors,
  };
};

/**
 * Rules that describe the PAYLOAD CONTRACT rather than the assistant's personality:
 * how to read the supplied catalog fields and how to fill the response schema. These
 * stay in code because they are coupled to `serializeContext` and the JSON schema
 * below — a tenant editing their persona must not be able to break them. Everything
 * that was voice, sales flow or escalation policy moved to aiPersonaService.
 */
const PAYLOAD_CONTRACT_RULES = [
  "Use only the trusted context supplied in the user message; the live catalog facts are the only source of truth for products, prices, stock, genders, categories, sections, sizes, colors, and storefront links.",
  "The supported main audiences are men (رجالي), women (حريمي), and kids (أطفال). Use catalog_filters and catalog_context to understand subcategories and product types.",
  "When the customer asks to browse a section, category, size, brand, or price range, end the reply with the supplied catalog_url exactly as provided.",
  "Answer in Arabic by default. If the customer message contains any Arabic, answer in Arabic only. Answer in English only when the customer message itself is primarily English.",
  "Use product_intelligence when available: aliases, styles, occasions, personality_lines, selling_points, priority_score, and is_trending.",
  "Do not inject sneaker, Jordan, or streetwear identity into greetings or generic conversation. Mention a style only when the request, image analysis, or inventory context supports it.",
  "If suggested_products_input has any products, never claim there is not enough verified information and never set needs_human_support merely because the answer is broad.",
  "If product suggestions are useful, include only products present in suggested_products_input, and never repeat a product the customer already rejected.",
  "If some suggested products are out of stock, say so naturally in Arabic, e.g. فيه موديلات ظاهرة بس بعضها خلصان، أقدر أطلعلك المتاح بس.",
  "If the customer describes a visual model or says they have a photo, encourage them to upload the image so you can find the closest product.",
  "Use sources_used only for source ids that directly support the answer.",
  "Use suggested_actions only from: view_product, contact_support, show_similar_products, choose_size, choose_color.",
];

/**
 * Persona block first, payload contract second. Loading the persona must never be able
 * to fail the reply, so a lookup error falls back to the built-in default voice.
 */
const buildSupportInstructions = async ({ tenantId, understanding, customerCard, salesHint }) => {
  const persona = await loadPersona({ tenantId }).catch(() => DEFAULT_PERSONA);
  return [
    buildInstructions({ persona, understanding, customerCard, salesHint }),
    "",
    "# Response contract:",
    ...PAYLOAD_CONTRACT_RULES,
  ].join("\n");
};

export const generateSupportAnswer = async ({
  message,
  trustedContext,
  metadata = {},
  suggestedProducts = [],
  suggestedActions = [],
  // Optional brain inputs. Omitted, this behaves as it always did — default persona,
  // no customer card, no per-turn read — so callers can adopt them one at a time.
  understanding = null,
  customerCard = "",
  salesHint = "",
} = {}) => {
  syncAgentCredentialState();
  const customerMessage = toText(message).slice(0, MAX_MESSAGE_CHARS);
  const { sources, contextText } = serializeContext(trustedContext);
  const fallbackWithExtras = {
    ...FALLBACK_RESPONSE,
    answer: buildArabicFirstSalesFallback({ message: customerMessage, suggestedProducts }),
    needs_human_support: normalizeSuggestedProducts(suggestedProducts).length ? false : FALLBACK_RESPONSE.needs_human_support,
    suggested_products: normalizeSuggestedProducts(suggestedProducts),
    suggested_actions: normalizeSuggestedActions(suggestedActions),
  };

  if (!customerMessage || !contextText || sources.length === 0) {
    return fallbackWithExtras;
  }

  if (!textGenerationEnabled() || textGenerationTemporarilyBlocked()) {
    return fallbackWithExtras;
  }

  const knownSourceIds = new Set(sources.map((source) => source.id));
  const publicMetadata = redactSensitiveContext({
    session_id: metadata.session_id,
    customer_id: metadata.customer_id,
    customer_phone: metadata.customer_phone,
    locale: metadata.locale,
    tenant_id: metadata.tenant_id,
  });

  try {
    const response = await getClient().responses.create(
      {
        model: resolveSupportModel(),
        instructions: await buildSupportInstructions({
          tenantId: metadata.tenant_id,
          understanding,
          customerCard,
          salesHint,
        }),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    customer_message: customerMessage,
                    trusted_context: contextText,
                    suggested_products_input: normalizeSuggestedProducts(suggestedProducts),
                    suggested_actions_input: normalizeSuggestedActions(suggestedActions),
                    metadata: publicMetadata,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ai_support_response",
            strict: true,
            schema: supportResponseSchema,
            },
          verbosity: "medium",
        },
      },
      {
        timeout: resolveSupportTimeoutMs(),
        // maxRetries was 0, so a single transient 500/timeout dropped the customer
        // straight onto canned fallback text. The SDK's own retry is cheaper than
        // losing the reply.
        maxRetries: resolveSupportMaxRetries(),
      }
    );

    noteTextGenerationSuccess();
    const parsed = safeJsonParse(response.output_text);
    return normalizeAiPayload(parsed, knownSourceIds, {
      message: customerMessage,
      suggested_products: suggestedProducts,
      suggested_actions: suggestedActions,
    });
  } catch (error) {
    let backoffMs = 0;
    if (Number(error?.status || error?.response?.status || 0) === 429) {
      backoffMs = noteTextGenerationRateLimit();
    }
    console.warn("[ai-support] OpenAI request failed", {
      name: error?.name,
      status: error?.status,
      message: error?.message,
      model: resolveSupportModel(),
      ...(backoffMs ? { backoff_ms: backoffMs, backoff_streak: textGenerationBackoffStreak } : {}),
    });
    return fallbackWithExtras;
  }
};
