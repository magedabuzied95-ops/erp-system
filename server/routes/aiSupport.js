import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import {
  buildAiSupportImageProductSearch,
  buildAiSupportImageRankingDebug,
  buildAiSupportModelColorDebug,
  buildAiSupportProductSearchDebug,
  buildAiSupportTrustedContext,
  detectAiSupportIntent,
} from "../services/aiSupportContextService.js";
import {
  clearAiSupportTestHistory,
  getAiSupportConversationState,
  getAiSupportInsights,
  listAiSupportHistory,
  logAiSupportMessage,
  trackAiSupportCartOutcome,
  trackAiSupportProductClick,
} from "../services/aiSupportLogService.js";
import {
  buildMemoryQuickSuggestions,
  personalizeAiSupportResponse,
  resolveAiConversationIdentity,
  updateAiConversationMemory,
} from "../services/aiConversationMemoryService.js";
import { buildAiOrderChatResponse } from "../services/aiAgentOrderService.js";
import {
  AI_AGENT_CHANNELS,
  buildAiFlowPayloadFromNormalizedMessage,
  normalizeIncomingChannelMessage,
  normalizeOutgoingChannelReply,
} from "../services/aiChannelAdapterService.js";
import {
  humanizeSalesResponse,
  scheduleAiFollowupIfNeeded,
  upsertAiCustomerProfile,
} from "../services/aiSalesAgentService.js";
import { getWebsiteSettings, updateWebsiteSettings } from "../services/liveActivityService.js";
import { generateSupportAnswer, understandProductImageForSearch } from "../services/openaiSupportService.js";
import { reindexAllProductImages } from "../services/aiVisualProductImageIndexService.js";
import { buildStorefrontProductUrl } from "../services/storefrontProductUrlService.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const IMAGE_SEARCH_MAX_BYTES = positiveNumber(process.env.AI_SUPPORT_IMAGE_SEARCH_MAX_BYTES, 8 * 1024 * 1024);
const IMAGE_SEARCH_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_SEARCH_FALLBACK_MESSAGE = "حصلت مشكلة أثناء تحليل الصورة، حاول مرة تانية.";
const imageSearchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMAGE_SEARCH_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_SEARCH_ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    const error = new Error("UNSUPPORTED_IMAGE_TYPE");
    error.code = "UNSUPPORTED_IMAGE_TYPE";
    return cb(error);
  },
});

const RATE_LIMIT_WINDOW_MS = positiveNumber(process.env.AI_SUPPORT_RATE_LIMIT_WINDOW_MS, 60_000);
const RATE_LIMIT_MAX = positiveNumber(process.env.AI_SUPPORT_RATE_LIMIT_MAX, 20);
const rateLimitBuckets = new Map();

const toText = (value, fallback = "") => String(value ?? fallback).trim();
const isDevelopment = process.env.NODE_ENV !== "production";
const isAiSupportDebug = () => process.env.AI_SUPPORT_DEBUG === "1";
const isVisualDebug = () => ["1", "true", "yes", "on"].includes(String(process.env.VISUAL_DEBUG || "").trim().toLowerCase());
const isArabicText = (value = "") => /[\u0600-\u06ff]/.test(toText(value));

const normalizePublicSuggestedProducts = (items = []) =>
  Array.isArray(items)
    ? items.map((item) => ({
        ...item,
        price: Number(item?.price) > 0 ? Number(item.price) : null,
        sale_price: Number(item?.sale_price) > 0 ? Number(item.sale_price) : null,
        final_price: Number(item?.final_price || item?.price || item?.sale_price) > 0
          ? Number(item.final_price || item.price || item.sale_price)
          : null,
        stock_status: item?.stock_status || (Number(item?.total_stock || item?.stock || 0) > 0 ? "in_stock" : "out_of_stock"),
      }))
    : [];

const extractRequestedModel = (message = "") => {
  const matches = toText(message).match(/[A-Za-z][A-Za-z0-9 -]{1,40}/g) || [];
  return matches.map((item) => item.trim()).find((item) => item.length > 1) || "";
};

const isGenericEnglishFallback = (answer = "") => {
  const text = toText(answer).toLowerCase();
  return (
    text.includes("i do not have enough verified information") ||
    text.includes("please contact support") ||
    text.includes("ai support is temporarily unavailable")
  );
};

const buildArabicSalesFallback = ({ message = "", suggestedProducts = [] } = {}) => {
  const products = normalizePublicSuggestedProducts(suggestedProducts);
  const requestedModel = extractRequestedModel(message);
  const modelPart = requestedModel ? ` من ${requestedModel}` : "";
  const hasOutOfStock = products.some((product) => Number(product?.total_stock || 0) <= 0 || /out|unavailable|خلص|غير/i.test(toText(product?.availability)));

  if (products.length) {
    return [
      `أكيد يا باشا، عندنا شوية موديلات قريبة${modelPart}. بص عليهم كده، ولو عايز مقاس معين قولّي مقاسك.`,
      hasOutOfStock ? "فيه موديلات ظاهرة بس بعضها خلصان، أقدر أطلعلك المتاح بس." : "",
    ].filter(Boolean).join(" ");
  }

  return "أكيد، تحب كوتشي رجالي ولا حريمي؟ ومقاسك كام؟ ولو معاك صورة موديل ابعتهالي وأنا أطلعلك الأقرب ليه.";
};

const normalizeVisualText = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const detectVisualRequest = (message = "") => {
  const text = normalizeVisualText(message);
  const has = (terms = []) => terms.some((term) => text.includes(normalizeVisualText(term)));
  if (has(["دليل المقاسات", "size guide", "size chart"])) return "size_guide";
  if (has(["المقاسات", "مقاسات", "متاح مقاس", "sizes"])) return "sizes";
  if (has(["فيه الوان", "في ألوان", "الوان", "ألوان", "colors", "colours"])) return "colors";
  if (has(["تلبس على ايه", "تلبس على إيه", "complete the look", "كمل اللوك", "complete look"])) return "complete_the_look";
  if (has(["ارخص", "cheaper", "بديل ارخص", "بدائل ارخص"])) return "cheaper_alternatives";
  if (has(["شبهه", "بدائل", "similar", "شبيه"])) return "similar_products";
  if (has(["ابعت صور", "عايز اشوفها", "عايز أشوفها", "وريني", "شكلها عامل ايه", "شكلها عامل إيه", "show me", "photos", "pictures"])) return "product_images";
  return "";
};

const firstImageFromProduct = (product = {}) => {
  const galleryImage = Array.isArray(product.product_images)
    ? product.product_images.map((image) => image?.image_url || image?.url || image?.path || image).find(Boolean)
    : "";
  return toText(product.matched_variant_image || product.matched_image_url || product.selected_card_image_url || product.image_url || product.image || product.main_image || product.thumbnail || galleryImage);
};

const visualProductItem = (product = {}, index = 0) => ({
  id: product.id || product.product_id || product.sku || `visual-${index}`,
  product_id: product.id || product.product_id || null,
  variant_id: product.matched_variant_id || null,
  title: product.name || product.title || "منتج مقترح",
  subtitle: [product.matched_variant_color || product.requested_color, product.matched_variant_size || product.requested_size].filter(Boolean).join(" / "),
  image_url: firstImageFromProduct(product),
  price: Number(product.final_price || product.price || product.sale_price || 0) > 0 ? Number(product.final_price || product.price || product.sale_price) : null,
  availability: product.stock_status || product.availability || (Number(product.total_stock || product.stock || 0) > 0 ? "in_stock" : "out_of_stock"),
  product_url: product.product_url || buildStorefrontProductUrl(product),
});

const visualVariantItems = (products = []) =>
  products
    .flatMap((product) => {
      const base = visualProductItem(product);
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const direct = product.matched_variant_image || product.matched_image_url
        ? [{
            ...base,
            id: `${base.id}-matched`,
            title: product.matched_variant_color || product.requested_color || product.name || base.title,
            subtitle: [product.matched_variant_size || product.requested_size, product.name].filter(Boolean).join(" - "),
            image_url: product.matched_variant_image || product.matched_image_url,
          }]
        : [];
      return [
        ...direct,
        ...variants.map((variant, index) => ({
          ...base,
          id: variant.id || `${base.id}-variant-${index}`,
          variant_id: variant.id || null,
          title: variant.color || variant.color_name || variant.name || product.name || base.title,
          subtitle: [variant.size, product.name].filter(Boolean).join(" - "),
          image_url: variant.image_url || variant.variant_image_url || variant.color_image_url || base.image_url,
          price: Number(variant.price || base.price || 0) > 0 ? Number(variant.price || base.price) : base.price,
          availability: Number(variant.stock || 0) > 0 ? "in_stock" : base.availability,
        })),
      ];
    })
    .filter((item) => item.image_url)
    .slice(0, 8);

const sizeGuideAttachment = (products = []) => {
  const sizes = [...new Set(products.flatMap((product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    return [
      product.requested_size,
      product.matched_variant_size,
      ...(product.inventory_profile?.available_sizes || []),
      ...variants.map((variant) => variant.size),
    ];
  }).map(toText).filter(Boolean))].slice(0, 14);
  if (!sizes.length) return null;
  return {
    type: "size_guide",
    title: "دليل المقاسات",
    sizes,
    note: "اختار مقاسك المعتاد، ولو بين مقاسين ابعتلنا طول القدم ونأكد الأنسب.",
  };
};

const buildVisualAttachments = ({ message = "", response = {} } = {}) => {
  const requestType = detectVisualRequest(message);
  if (!requestType) return [];
  const products = normalizePublicSuggestedProducts(response.suggested_products).slice(0, 8);
  const withImages = products.map(visualProductItem).filter((item) => item.image_url);
  const attachments = [];

  if (["product_images", "colors"].includes(requestType) && withImages.length) {
    attachments.push({
      type: requestType === "colors" ? "variant_color_cards" : "product_image_cards",
      title: requestType === "colors" ? "الألوان والصور المتاحة" : "صور المنتجات",
      items: requestType === "colors" ? visualVariantItems(products) : withImages,
    });
  }
  if (requestType === "sizes") {
    const guide = sizeGuideAttachment(products);
    if (guide) attachments.push(guide);
    if (withImages.length) attachments.push({ type: "product_carousel", title: "الموديلات المتاحة", items: withImages });
  }
  if (requestType === "size_guide") {
    const guide = sizeGuideAttachment(products);
    if (guide) attachments.push(guide);
  }
  if (requestType === "similar_products" && withImages.length) {
    attachments.push({ type: "similar_products", title: "منتجات مشابهة", items: withImages });
  }
  if (requestType === "cheaper_alternatives" && products.length) {
    const referencePrice = Number(products[0]?.final_price || products[0]?.price || 0);
    const cheaper = products
      .map(visualProductItem)
      .filter((item) => item.image_url && (!referencePrice || !item.price || item.price <= referencePrice))
      .sort((left, right) => Number(left.price || 0) - Number(right.price || 0));
    if (cheaper.length) attachments.push({ type: "cheaper_alternatives", title: "بدائل بسعر أقل", items: cheaper });
  }
  if (requestType === "complete_the_look" && withImages.length) {
    attachments.push({ type: "complete_the_look", title: "اقتراحات تكمل اللوك", items: withImages });
  }
  return attachments.filter((attachment) => attachment?.type && (attachment.items?.length || attachment.sizes?.length));
};

const attachVisualSellingPayload = ({ message = "", response = {} } = {}) => {
  const visualAttachments = buildVisualAttachments({ message, response });
  if (!visualAttachments.length) return response;
  return {
    ...response,
    visual_attachments: visualAttachments,
    detected_visual_request: detectVisualRequest(message),
  };
};

const imageSearchUploadErrorMessage = (error = {}) =>
  error.code === "LIMIT_FILE_SIZE"
    ? "حجم الصورة كبير. ارفع صورة أصغر."
    : "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP.";

const IMAGE_EXACT_MATCH_THRESHOLD = 1_350;
const IMAGE_HIGH_CONFIDENCE_ANSWER = "\u0623\u064a\u0648\u0647\u060c \u0644\u0642\u064a\u062a \u0645\u0648\u062f\u064a\u0644 \u0645\u0637\u0627\u0628\u0642 \u0623\u0648 \u0642\u0631\u064a\u0628 \u062c\u062f\u064b\u0627 \u0644\u0644\u0635\u0648\u0631\u0629. \u062a\u062d\u0628 \u0627\u0644\u0635\u0648\u0631 \u0623\u0648 \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u062d\u0629\u061f";
const IMAGE_MEDIUM_CONFIDENCE_ANSWER = "\u0645\u0634 \u0645\u062a\u0623\u0643\u062f 100\u066a\u060c \u0628\u0633 \u062f\u064a \u0623\u0642\u0631\u0628 \u0645\u0648\u062f\u064a\u0644\u0627\u062a \u0634\u0628\u0647 \u0627\u0644\u0635\u0648\u0631\u0629";
const IMAGE_LOW_CONFIDENCE_ANSWER = "\u0627\u0644\u0635\u0648\u0631\u0629 \u0645\u0634 \u0648\u0627\u0636\u062d\u0629 \u0643\u0641\u0627\u064a\u0629. \u062a\u062d\u0628 \u062a\u0628\u0639\u062a \u0635\u0648\u0631\u0629 \u0623\u0648\u0636\u062d \u0623\u0648 \u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u062f\u064a\u0644\u061f";
const MORE_COLORS_NOTE = "\u0648\u0641\u064a\u0647 \u0623\u0644\u0648\u0627\u0646 \u062a\u0627\u0646\u064a\u0629 \u0643\u0645\u0627\u0646\u060c \u062a\u062d\u0628 \u0623\u0628\u0639\u062a\u0647\u0627\u0644\u0643\u061f";
const IMAGE_VARIANT_EXACT_MATCH_ANSWER = "أيوه، الموديل ده متاح عندنا ونفس الفاريانت/اللون ظاهر في النتيجة.";
const IMAGE_VARIANT_REQUEST_UNAVAILABLE_ANSWER = "الموديل موجود عندنا، لكن المقاس أو اللون المطلوب مش متاح في نفس الفاريانت حاليا. النتيجة المعروضة هي نفس الموديل مع حالة التوفر الحالية.";
const IMAGE_EXACT_VARIANT_RENDERED_ANSWER = "أيوه، الموديل ده متاح عندنا، ونفس اللون/النسخة المطابقة للصورة ظاهر في النتيجة.";
const IMAGE_EXACT_MATCH_ANSWER = "أيوه، الموديل ده متاح عندنا  ودي أقرب نتيجة مطابقة للصورة.";
const IMAGE_NO_EXACT_MATCH_ANSWER = "مش لاقيين نفس الموديل بالظبط، لكن دي أقرب المنتجات المتاحة.";
const IMAGE_NO_PRODUCTS_ANSWER = "مش لاقيين نفس الموديل بالظبط، قولّي المقاس أو اللون ونطلعلك شبهه.";

const normalizeVisualMatchText = (value = "") =>
  toText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const appendMoreColorsNote = (response = {}) => {
  const products = normalizePublicSuggestedProducts(response?.suggested_products);
  const hasMoreColors = products.some((product) => Boolean(product?.has_more_color_variants) || Number(product?.color_variant_count || 0) > 6);
  const answer = toText(response?.answer);
  if (!hasMoreColors || answer.includes(MORE_COLORS_NOTE)) return response;
  return {
    ...response,
    answer: [answer, MORE_COLORS_NOTE].filter(Boolean).join("\n"),
    more_color_variants_available: true,
  };
};

const detectedModelAliases = (detected = {}) => {
  const rawAliases = [
    detected.likely_model,
    detected.detected_model,
    detected.model,
    detected.model_keywords,
    detected.likely_model_keywords,
  ].flatMap((item) => (Array.isArray(item) ? item : [item]));
  const normalized = rawAliases.map(normalizeVisualMatchText).filter(Boolean);
  const blob = normalized.join(" ");
  if (/\bjordan\b/.test(blob) && /\b4\b|iv\b/.test(blob)) {
    normalized.push("air jordan 4", "jordan 4", "aj4", "j4", "جوردن 4", "جوردن ٤", "جوردن فور", "بلاك كات");
  }
  return [...new Set(normalized)].filter((item) => item.length >= 2);
};

const productVisualMatchBlob = (product = {}) =>
  normalizeVisualMatchText([
    product.name,
    product.sku,
    product.brand,
    product.category,
    product.product_type,
    product.style,
    product.intelligence?.canonical_name,
    product.intelligence?.aliases,
    product.intelligence?.styles,
  ].flatMap((item) => (Array.isArray(item) ? item : [item])).filter(Boolean).join(" "));

const finalImageProductScoreRows = ({ productSearch = {}, suggestedProducts = [] } = {}) => {
  const rows = Array.isArray(productSearch?.debug?.final_sorted_order_returned_to_frontend)
    ? productSearch.debug.final_sorted_order_returned_to_frontend
    : [];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return suggestedProducts.map((product, index) => ({
    product,
    row: byId.get(String(product.id)) || {},
    index,
  }));
};

const imageProductVariantExactMatch = ({ product = {}, row = {}, productSearch = {}, detected = {} } = {}) => {
  const matchedVariantId = product.matched_variant_id ?? row.matched_variant_id ?? row.top_candidate_variant_id ?? productSearch?.exact_match_variant_id ?? null;
  const matchedVariantImage = toText(product.matched_variant_image || product.matched_image_url || row.matched_variant_image || row.top_candidate_image_url);
  const matchedImageSource = toText(product.matched_image_source || row.top_candidate_source);
  const finalScore = Math.max(Number(row.final_score || 0), Number(product.image_match_score || 0));
  const modelConfidence = Number(row.model_score || product.image_match_score_breakdown?.model_score || 0);
  const colorConfidence = Number(row.color_score || product.color_match_score || 0);
  const visualHighConfidence =
    Boolean(row.exact_image_candidate_match || row.exact_model_match || row.hard_filter_match) ||
    finalScore >= IMAGE_EXACT_MATCH_THRESHOLD;
  const variantExact = Boolean(
    matchedVariantId &&
    matchedVariantImage &&
    ["variant", "product_variant_images"].includes(matchedImageSource) &&
    visualHighConfidence &&
    (modelConfidence >= 0 || colorConfidence >= 0 || Number(detected.confidence || 0) >= 0.75)
  );

  if (!variantExact) return null;

  const requestedSize = toText(product.requested_size || detected.requested_size || detected.size || detected.customer_size);
  const requestedColor = toText(product.requested_color || detected.requested_color || (Array.isArray(detected.colors) ? detected.colors[0] : "") || (Array.isArray(detected.main_colors) ? detected.main_colors[0] : ""));
  const requestedVariantUnavailable =
    product.exact_variant_available === false ||
    product.requested_size_available === false ||
    Number(product.requested_size_stock ?? 1) === 0 ||
    Number(product.total_stock ?? product.stock ?? 1) <= 0;

  return {
    matchedVariantId,
    matchedVariantImage,
    matchedVariantColor: product.matched_variant_color || row.matched_variant_color || row.top_candidate_variant_color || "",
    matchedVariantSize: product.matched_variant_size || row.matched_variant_size || row.top_candidate_variant_size || "",
    finalScore,
    requestedColor,
    requestedSize,
    requestedVariantUnavailable,
    reason: requestedVariantUnavailable
      ? "matched variant image, but requested size/color availability is false"
      : "matched_variant_id + matched_variant_image + high visual/model confidence",
  };
};

const responseExactVariantMatch = (response = {}) => {
  if (!response?.exact_match_found) return null;
  const products = normalizePublicSuggestedProducts(response.suggested_products);
  const explicitVariantId = response.exact_match_variant_id ?? response.response_debug?.exact_match_variant_id ?? response.image_ranking_debug?.exact_match_variant_id ?? null;
  return products.find((product) => {
    const productVariantId = product.matched_variant_id ?? null;
    const matchedVariantImage = toText(product.matched_variant_image || product.matched_image_url);
    return productVariantId && matchedVariantImage && (!explicitVariantId || String(productVariantId) === String(explicitVariantId));
  }) || null;
};

const forceExactVariantAnswer = ({ response = {}, stage = "final" } = {}) => {
  const exactVariantProduct = responseExactVariantMatch(response);
  if (!exactVariantProduct) return response;
  const previousAnswer = toText(response.answer);
  const requestedVariantUnavailable =
    exactVariantProduct.exact_variant_available === false ||
    exactVariantProduct.requested_size_available === false ||
    Number(exactVariantProduct.requested_size_stock ?? 1) === 0 ||
    Number(exactVariantProduct.total_stock ?? exactVariantProduct.stock ?? 1) <= 0;
  const forcedAnswer = requestedVariantUnavailable
    ? IMAGE_VARIANT_REQUEST_UNAVAILABLE_ANSWER
    : IMAGE_EXACT_VARIANT_RENDERED_ANSWER;
  const responseDebug = {
    ...(response.response_debug || {}),
    final_exact_match_source: "matched_variant_image",
    exact_match_variant_id: exactVariantProduct.matched_variant_id,
    exact_match_variant_reason: requestedVariantUnavailable
      ? "matched variant image, but requested size/color availability is false"
      : "matched_variant_id + matched_variant_image + high visual/model confidence",
    final_response_synced_with_variant: true,
    final_rendered_answer_reason: requestedVariantUnavailable ? "exact_variant_match_requested_variant_unavailable" : "exact_variant_match_forced_final_answer",
    response_overridden_after_variant_match: previousAnswer !== forcedAnswer,
    rendered_text_source: "exact_variant_hard_override",
  };

  return {
    ...response,
    answer: forcedAnswer,
    exact_match_found: true,
    final_exact_match_source: responseDebug.final_exact_match_source,
    exact_match_variant_id: responseDebug.exact_match_variant_id,
    exact_match_variant_reason: responseDebug.exact_match_variant_reason,
    final_response_synced_with_variant: true,
    personalization_blocked: true,
    response_debug: {
      ...responseDebug,
      override_stage: stage,
      previous_answer: previousAnswer,
    },
  };
};

const buildImageSearchAnswerFromFinalProducts = ({ detected = {}, productSearch = {}, suggestedProducts = [] } = {}) => {
  const topProduct = suggestedProducts[0] || null;
  const scoreRows = finalImageProductScoreRows({ productSearch, suggestedProducts });
  const topRow = topProduct ? scoreRows.find((item) => String(item.product.id) === String(topProduct.id))?.row || {} : {};
  const aliases = detectedModelAliases(detected);
  const detectedBlob = aliases.join(" ");
  const detectedJordan4 = /\bjordan\s*4\b|\bair\s*jordan\s*4\b|\baj4\b|\bj4\b|جوردن\s*(4|٤|فور)|بلاك\s*كات/.test(detectedBlob);
  const nameOrAliasMatch = suggestedProducts.some((product) => {
    const productBlob = productVisualMatchBlob(product);
    if (detectedJordan4 && /\bjordan\s*4\b|\bair\s*jordan\s*4\b|\baj4\b|\bj4\b|جوردن\s*(4|٤|فور)|بلاك\s*كات/.test(productBlob)) return true;
    return aliases.some((alias) => alias.length >= 3 && productBlob.includes(alias));
  });
  const finalScoreMatch = scoreRows.some((item) => Number(item.row?.final_score || 0) >= IMAGE_EXACT_MATCH_THRESHOLD);
  const finalRowExactMatch = scoreRows.some((item) => item.row?.exact_model_match || item.row?.hard_filter_match || item.row?.exact_image_candidate_match);
  const exactVariantMatch = scoreRows
    .map((item) => imageProductVariantExactMatch({ product: item.product, row: item.row, productSearch, detected }))
    .find(Boolean) || null;
  const variantExactFromRanking = Boolean(productSearch?.final_response_synced_with_variant || productSearch?.debug?.final_response_synced_with_variant);
  const debugExactMatch = Boolean(productSearch?.debug?.exact_match_found || productSearch?.debug?.has_exact_model_match || productSearch?.exact_match);
  const exactMatchFound = Boolean(suggestedProducts.length && (exactVariantMatch || variantExactFromRanking || nameOrAliasMatch || finalScoreMatch || finalRowExactMatch || debugExactMatch));
  const confidenceLevel = toText(productSearch?.confidence_level || productSearch?.debug?.confidence_level || (exactMatchFound ? "high" : suggestedProducts.length ? "medium" : "low"));
  const answer = suggestedProducts.length
    ? confidenceLevel === "low"
      ? IMAGE_LOW_CONFIDENCE_ANSWER
      : exactMatchFound || confidenceLevel === "high"
      ? exactVariantMatch?.requestedVariantUnavailable
        ? IMAGE_VARIANT_REQUEST_UNAVAILABLE_ANSWER
        : exactVariantMatch || variantExactFromRanking
          ? IMAGE_VARIANT_EXACT_MATCH_ANSWER
          : IMAGE_HIGH_CONFIDENCE_ANSWER
      : IMAGE_MEDIUM_CONFIDENCE_ANSWER
    : IMAGE_LOW_CONFIDENCE_ANSWER;

  return {
    answer,
    exactMatchFound,
    responseDebug: {
      initial_answer_reason: exactMatchFound ? "image_search_exact_match_decision" : suggestedProducts.length ? "image_search_similar_only_decision" : "image_search_no_products_decision",
      post_openai_answer_reason: "not_openai_generated_image_search_template",
      final_answer_reason: exactMatchFound
        ? "final_suggested_products_contain_strong_match"
        : suggestedProducts.length
          ? "final_suggested_products_are_visual_similar_only"
          : "no_final_suggested_products",
      exact_match_found: exactMatchFound,
      confidence_level: confidenceLevel,
      match_confidence: Number(productSearch?.match_confidence || productSearch?.debug?.match_confidence || 0),
      final_exact_match_source: exactVariantMatch || variantExactFromRanking
        ? productSearch?.final_exact_match_source || productSearch?.debug?.final_exact_match_source || "variant_image"
        : exactMatchFound ? "product_or_alias_match" : "",
      exact_match_variant_id: exactVariantMatch?.matchedVariantId ?? productSearch?.exact_match_variant_id ?? null,
      exact_match_variant_reason: exactVariantMatch?.reason || productSearch?.exact_match_variant_reason || productSearch?.debug?.exact_match_variant_reason || "",
      final_response_synced_with_variant: Boolean(exactVariantMatch || variantExactFromRanking),
      final_rendered_answer_reason: "",
      response_overridden_after_variant_match: false,
      rendered_text_source: "image_search_answer_decision",
      legacy_image_answer_templates_retained: Boolean(IMAGE_EXACT_MATCH_ANSWER && IMAGE_NO_EXACT_MATCH_ANSWER && IMAGE_NO_PRODUCTS_ANSWER),
      top_product_name: topProduct?.name || "",
      top_product_score: Number(topRow?.final_score || topProduct?.image_match_score || 0) || 0,
      top_visual_candidates: productSearch?.debug?.top_visual_candidates || productSearch?.debug?.top_candidate_images || [],
      selected_card_image_source: topProduct?.selected_card_image_source || topRow?.selected_card_image_source || productSearch?.debug?.selected_card_image_source || "",
      selected_card_image_url: topProduct?.selected_card_image_url || topProduct?.image_url || topRow?.selected_card_image_url || productSearch?.debug?.selected_card_image_url || "",
      forced_exact_variant_rank: Boolean(productSearch?.debug?.forced_exact_variant_rank),
      forced_rank_position: productSearch?.debug?.forced_rank_position ?? null,
      final_sorted_product_ids: productSearch?.debug?.final_sorted_product_ids || suggestedProducts.map((product) => product.id),
      top_rank_reason: productSearch?.debug?.top_rank_reason || "",
      exact_match_product_id: productSearch?.debug?.exact_match_product_id ?? null,
      exact_match_image_owner_product_id: productSearch?.debug?.exact_match_image_owner_product_id ?? null,
      exact_match_variant_owner_product_id: productSearch?.debug?.exact_match_variant_owner_product_id ?? null,
      forced_rank_target_product_id: productSearch?.debug?.forced_rank_target_product_id ?? null,
      forced_rank_target_reason: productSearch?.debug?.forced_rank_target_reason || "",
      forced_rank_mismatch_detected: Boolean(productSearch?.debug?.forced_rank_mismatch_detected),
      suggested_product_image_ownership: productSearch?.debug?.suggested_product_image_ownership || [],
      exact_match_blocked_reason: exactMatchFound ? null : productSearch?.debug?.exact_match_blocked_reason || "no exact variant match after final response decision",
      variant_candidate_count: productSearch?.debug?.variant_candidate_count || 0,
      product_variant_images_count: productSearch?.debug?.product_variant_images_count || 0,
      vision_detection_failed: Boolean(productSearch?.debug?.vision_detection_failed),
      fallback_used_visual_candidates: Boolean(productSearch?.debug?.fallback_used_visual_candidates),
      inferred_model_from_candidate: productSearch?.debug?.inferred_model_from_candidate || "",
      inferred_search_query: productSearch?.debug?.inferred_search_query || "",
      top_visual_score: productSearch?.debug?.top_visual_score || 0,
      top_visual_candidate_source: productSearch?.debug?.top_visual_candidate_source || "",
      top_visual_candidate_product_name: productSearch?.debug?.top_visual_candidate_product_name || "",
      why_fallback_message_used: exactMatchFound
        ? ""
        : suggestedProducts.length
          ? "no final product matched detected model aliases or exact score threshold"
          : "no products returned after image ranking",
    },
  };
};

const sanitizePublicAiSupportResponse = ({ response, message }) => {
  const suggestedProducts = normalizePublicSuggestedProducts(response?.suggested_products);
  const arabicMessage = isArabicText(message);
  const answer = toText(response?.answer);
  const isGreetingOnly = response?.greeting_only_mode || response?.detected_intent === "greeting_only";
  const personalizationTextPattern =
    /بتحب|ذوقك|غالب[ًاا]|اخر مرة|آخر مرة|بما إنك بتحب|المناسب ليك|based on your style|your style|your taste|last time|previous/i;

  if (isGreetingOnly) {
    const sanitizedAnswer = /السلام عليكم/.test(toText(message))
      ? "وعليكم السلام\nأقدر أساعدك في المقاسات، الموديلات، أو البحث بصورة."
      : "أهلاً بيك\nأقدر أساعدك في المقاسات، الموديلات، أو البحث بصورة.";
    const blockedPersonalizationText = personalizationTextPattern.test(answer);
    return {
      ...response,
      answer: sanitizedAnswer,
      needs_human_support: false,
      suggested_products: [],
      memory_suggestions: [],
      quick_funnel: null,
      personalization_blocked: true,
      greeting_only_mode: true,
      greeting_response_sanitized: answer !== sanitizedAnswer,
      personalization_text_blocked: blockedPersonalizationText,
    };
  }

  const answerLooksEnglish = /[A-Za-z]/.test(answer) && !isArabicText(answer);
  const shouldReplaceWithArabic =
    arabicMessage &&
    (isGenericEnglishFallback(answer) || answerLooksEnglish || (suggestedProducts.length > 0 && !answer));

  return {
    ...response,
    answer: shouldReplaceWithArabic ? buildArabicSalesFallback({ message, suggestedProducts }) : answer,
    needs_human_support: suggestedProducts.length ? false : response?.needs_human_support !== false,
    suggested_products: suggestedProducts,
  };
};

const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

const isAdminUser = (user = {}) => {
  const role = normalizeRole(user.role_name || user.role);
  return ["admin", "super admin", "superadmin"].includes(role) || user.is_super_admin === true || user.permissions?.includes?.("*");
};

const resolveTenantId = (req) => {
  const rawTenant =
    req.headers?.["x-tenant-id"] ??
    req.body?.tenant_id ??
    req.body?.tenantId ??
    req.query?.tenant_id ??
    req.query?.tenantId ??
    req.optionalUser?.tenant_id ??
    req.optionalUser?.tenantId ??
    req.optionalUser?.tenant?.id ??
    req.optionalUser?.company_id;
  const tenantId = Number(rawTenant);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const getClientIp = (req) => {
  const forwarded = toText(req.headers?.["x-forwarded-for"]);
  return forwarded ? forwarded.split(",")[0].trim() : req.ip || req.socket?.remoteAddress || "unknown";
};

const rateLimitKey = (req) => {
  const tenantId = req.aiSupportTenantId;
  const sessionId = toText(req.body?.metadata?.session_id || req.body?.session_id || req.headers?.["x-session-id"]);
  return `${tenantId}:${getClientIp(req)}:${sessionId || "anonymous"}`;
};

const attachOptionalUser = (req, _res, next) => {
  const raw = toText(req.headers?.authorization);
  const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
  if (!token) return next();
  try {
    req.optionalUser = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
  } catch {
    req.optionalUser = null;
  }
  next();
};

const resolveAuthenticatedTenantId = (req) => {
  const rawTenant =
    req.user?.tenant_id ??
    req.user?.tenantId ??
    req.headers?.["x-tenant-id"] ??
    req.query?.tenant_id ??
    req.query?.tenantId;
  const tenantId = Number(rawTenant);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const requireAiSupportAdmin = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  next();
};

const logSupportExchange = async ({ req, tenantId, metadata, message, context, response }) => {
  try {
    await logAiSupportMessage({
      tenantId,
      userId: req.user?.id || req.optionalUser?.id || req.optionalUser?.user_id || null,
      sessionId: metadata.session_id || req.id,
      customerMessage: message,
      response: { ...response, unknown_product_terms: context.unknown_product_terms || response.unknown_product_terms || [] },
      detectedIntent: context.intent?.type || "",
      fallbackReason: context.fallbackReason || "",
      source: req.user || req.optionalUser ? "admin_console" : "api",
    });
  } catch (error) {
    console.warn("[ai-support] log skipped", {
      requestId: req.id,
      message: error?.message,
    });
  }
};

const channelReplyPayload = (req, response = {}) =>
  normalizeOutgoingChannelReply({
    channel: req.aiChannelMessage?.channel || AI_AGENT_CHANNELS.WEB_CHAT,
    response,
  });

const sendAiSupportChannelResponse = (req, res, response = {}, status = 200) =>
  res.status(status).json({
    success: status < 400,
    ...response,
    channel_reply: channelReplyPayload(req, response),
  });

const statelessGreetingOnlyAnswer = (message = "") => {
  const text = toText(message).toLowerCase();
  const isSalaam = /السلام\s+عليكم|سلام\s+عليكم|elsalam|salam/i.test(text);
  return isSalaam
    ? "وعليكم السلام\nأقدر أساعدك في المقاسات، الموديلات، أو البحث بصورة."
    : "أهلاً بيك\nأقدر أساعدك في المقاسات، الموديلات، أو البحث بصورة.";
};

const buildStatelessGreetingOnlyPayload = (message = "") => ({
  answer: statelessGreetingOnlyAnswer(message),
  confidence: 1,
  needs_human_support: false,
  sources_used: [],
  suggested_products: [],
  suggested_actions: [],
  memory_suggestions: [],
  quick_funnel: null,
  detected_intent: "greeting_only",
  context_source_count: 0,
  source_previews: [],
  fallback_reason: "",
  unknown_product_terms: [],
  personalization_blocked: true,
  greeting_only_mode: true,
  greeting_response_sanitized: true,
  personalization_text_blocked: true,
});

const buildPausedConversationPayload = (status = "human_takeover") => ({
  answer: status === "closed"
    ? "This conversation is closed. Please start a new chat if you need more help."
    : "A team member is handling this conversation now. We received your message and will reply shortly.",
  confidence: 1,
  needs_human_support: true,
  sources_used: [],
  suggested_products: [],
  suggested_actions: status === "closed" ? ["start_new_chat"] : ["wait_for_staff"],
  memory_suggestions: [],
  quick_funnel: null,
  detected_intent: status,
  context_source_count: 0,
  source_previews: [],
  fallback_reason: status,
  auto_response_paused: true,
  conversation_status: status,
});

const updateMemoryAndPersonalize = async ({ req, tenantId, metadata = {}, message = "", response = {} } = {}) => {
  try {
    if (response?.personalization_blocked || response?.greeting_only_mode || response?.detected_intent === "greeting_only") {
      return {
        ...response,
        personalization_blocked: true,
        greeting_only_mode: Boolean(response?.greeting_only_mode || response?.detected_intent === "greeting_only"),
        memory_suggestions: [],
      };
    }
    const identity = resolveAiConversationIdentity({ req, tenantId, metadata });
    if (!identity.tenantId || !identity.sessionId) return response;
    const memory = await updateAiConversationMemory({
      tenantId: identity.tenantId,
      sessionId: identity.sessionId,
      customerPhone: identity.customerPhone,
      customerName: identity.customerName,
      message,
      metadata,
      suggestedProducts: response.suggested_products || [],
      preferencesPatch: response.ai_memory_patch?.preferences || {},
    });
    const personalized = personalizeAiSupportResponse({ response, memory, message });
    return {
      ...personalized,
      memory_suggestions: buildMemoryQuickSuggestions(memory),
    };
  } catch (error) {
    console.warn("[ai-support] memory update skipped", {
      requestId: req?.id,
      tenantId,
      message: error?.message,
    });
    return response;
  }
};

const aiSupportRateLimit = (req, res, next) => {
  const now = Date.now();
  const key = rateLimitKey(req);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      message: "Too many AI support requests. Please try again shortly.",
    });
  }

  next();
};

const cleanupExpiredRateLimitBuckets = () => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
};

const AI_KB_KEY = "ai_support_knowledge_base";
const AI_KB_DEFAULTS = Object.freeze({
  store_name: "",
  phone: "",
  whatsapp: "",
  branch_working_hours: "",
  payment_methods: "",
  shipping_policy: "",
  return_exchange_policy: "",
  delivery_notes: "",
  warranty_notes: "",
  human_support_message: "",
  brand_tone_instructions: "",
  personality_settings: "Egyptian Arabic professional sales agent for Tiger Store. Friendly, confident, respectful, concise, and human.",
  allowed_phrases: "تمام، تحت أمرك، بص، مظبوط، خليني أظبطهولك، المقاس ده بيتحرك بسرعة",
  forbidden_phrases: "أنا مساعد ذكي، يسعدني مساعدتك، برجاء المحاولة لاحقا، لا أملك معلومات كافية",
  sales_scripts: "افهم احتياج العميل الأول، رشح من المنتجات المتاحة، اذكر السعر والتوفر، وضح القيمة، ثم اسأل سؤال واحد مناسب.",
  objection_replies: [
    "السعر غالي: فاهمك، الموديل ده قيمته في الخامة والراحة، وأقدر أطلعلك بديل أرخص لو تحب.",
    "فيه خصم؟ الخصومات المتاحة هأكدها من السيستم، ولو محتاج خصم خاص بحولك للإدارة.",
    "أصلي ولا كوبي؟ هقولك التصنيف المتسجل عندنا بوضوح من غير مبالغة.",
    "الدفع عند الاستلام: لو متاح في سياسة الدفع هنأكدلك، ولو مش واضح بحولك للدعم."
  ].join("\n"),
  tone_strength: "medium",
  discount_rules: "لا توعد بخصم غير مسجل. الخصم الخاص أو آخر سعر يحتاج تحويل للإدارة.",
  handoff_rules: "حول للإدارة عند الغضب، خصم خاص، مشكلة دفع أو توصيل، استبدال/استرجاع، تعارض مخزون، منطقة غير مدعومة، أو ثقة منخفضة.",
  order_draft_approval: "create_after_clear_buying_intent_and_complete_details",
});

const normalizePhone = (value = "") => toText(value).replace(/[\s().-]/g, "");

const validateOptionalPhone = (value = "", label = "Phone") => {
  const text = normalizePhone(value);
  if (!text) return "";
  if (!/^\+?[0-9]{7,15}$/.test(text)) {
    const error = new Error(`${label} must be 7-15 digits and may start with +`);
    error.status = 400;
    throw error;
  }
  return text;
};

const normalizeKnowledgeBase = (payload = {}) => ({
  store_name: toText(payload.store_name).slice(0, 160),
  phone: validateOptionalPhone(payload.phone, "Public phone"),
  whatsapp: validateOptionalPhone(payload.whatsapp, "WhatsApp number"),
  branch_working_hours: toText(payload.branch_working_hours).slice(0, 4000),
  working_hours: toText(payload.branch_working_hours || payload.working_hours).slice(0, 4000),
  payment_methods: toText(payload.payment_methods).slice(0, 4000),
  shipping_policy: toText(payload.shipping_policy).slice(0, 6000),
  return_exchange_policy: toText(payload.return_exchange_policy).slice(0, 6000),
  delivery_notes: toText(payload.delivery_notes).slice(0, 4000),
  warranty_notes: toText(payload.warranty_notes).slice(0, 4000),
  human_support_message: toText(payload.human_support_message).slice(0, 2000),
  brand_tone_instructions: toText(payload.brand_tone_instructions).slice(0, 3000),
  personality_settings: toText(payload.personality_settings).slice(0, 3000),
  allowed_phrases: toText(payload.allowed_phrases).slice(0, 3000),
  forbidden_phrases: toText(payload.forbidden_phrases).slice(0, 3000),
  sales_scripts: toText(payload.sales_scripts).slice(0, 6000),
  objection_replies: toText(payload.objection_replies).slice(0, 6000),
  tone_strength: ["low", "medium", "high"].includes(toText(payload.tone_strength).toLowerCase()) ? toText(payload.tone_strength).toLowerCase() : "medium",
  discount_rules: toText(payload.discount_rules).slice(0, 4000),
  handoff_rules: toText(payload.handoff_rules).slice(0, 4000),
  order_draft_approval: toText(payload.order_draft_approval || "create_after_clear_buying_intent_and_complete_details").slice(0, 120),
});

const publicKnowledgeBase = (settings = {}) => ({
  ...AI_KB_DEFAULTS,
  ...(settings?.[AI_KB_KEY] && typeof settings[AI_KB_KEY] === "object" ? settings[AI_KB_KEY] : {}),
});

router.get("/knowledge-base", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const settings = await getWebsiteSettings({ tenantId });
    return res.json({ success: true, knowledge_base: publicKnowledgeBase(settings) });
  } catch (error) {
    console.error("[ai-support] knowledge base load error", { requestId: req.id, message: error?.message });
    return res.status(500).json({ success: false, message: "Failed to load AI support knowledge base" });
  }
});

router.put("/knowledge-base", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const normalized = normalizeKnowledgeBase(req.body?.knowledge_base || req.body || {});
    const settings = await updateWebsiteSettings({ tenantId, settings: { [AI_KB_KEY]: normalized } });
    return res.json({ success: true, knowledge_base: publicKnowledgeBase(settings) });
  } catch (error) {
    const status = error?.status || 500;
    console.error("[ai-support] knowledge base save error", { requestId: req.id, status, message: error?.message });
    return res.status(status).json({ success: false, message: error?.message || "Failed to save AI support knowledge base" });
  }
});

router.delete("/knowledge-base", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const settings = await updateWebsiteSettings({ tenantId, settings: { [AI_KB_KEY]: { ...AI_KB_DEFAULTS } } });
    return res.json({ success: true, knowledge_base: publicKnowledgeBase(settings) });
  } catch (error) {
    console.error("[ai-support] knowledge base reset error", { requestId: req.id, message: error?.message });
    return res.status(500).json({ success: false, message: "Failed to reset AI support knowledge base" });
  }
});

router.get("/debug-product-search", async (req, res) => {
  if (!isDevelopment && process.env.AI_SUPPORT_DEBUG !== "1") {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  try {
    const tenantId = Number(req.query?.tenant_id || req.query?.tenantId || req.headers?.["x-tenant-id"] || 1);
    const query = toText(req.query?.q || req.query?.query);
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      return res.status(400).json({ success: false, message: "A valid tenant_id is required" });
    }
    if (!query) {
      return res.status(400).json({ success: false, message: "Query q is required" });
    }
    const payload = await buildAiSupportProductSearchDebug({ tenantId, query, req });
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[ai-support] debug product search error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({ success: false, message: error?.message || "Debug product search failed" });
  }
});

router.get("/debug-image-ranking", async (req, res) => {
  if (!isDevelopment && process.env.AI_SUPPORT_DEBUG !== "1") {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  try {
    const tenantId = Number(req.query?.tenant_id || req.query?.tenantId || req.headers?.["x-tenant-id"] || 1);
    const query = toText(req.query?.q || req.query?.query || "jordan4");
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      return res.status(400).json({ success: false, message: "A valid tenant_id is required" });
    }
    const payload = await buildAiSupportImageRankingDebug({ tenantId, query, req });
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[ai-support] debug image ranking error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({ success: false, message: error?.message || "Debug image ranking failed" });
  }
});

router.post("/reindex-product-images", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const result = await reindexAllProductImages({ tenantId });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[ai-support] reindex product images error", {
      requestId: req.id,
      message: error?.message || "reindex failed",
    });
    return res.status(500).json({ success: false, message: error?.message || "Failed to reindex product images" });
  }
});

const handleImageSearchUpload = (req, res, next) => {
  imageSearchUpload.single("image")(req, res, (error) => {
    if (!error) return next();
    console.warn("[ai-support] image-search upload rejected", {
      requestId: req.id,
      contentType: req.headers?.["content-type"] || "",
      code: error.code || "",
      message: error.message || "",
      tenant_id: req.body?.tenant_id ?? req.body?.tenantId ?? req.headers?.["x-tenant-id"] ?? null,
    });
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message: imageSearchUploadErrorMessage(error),
    });
  });
};

router.post("/image-search", attachOptionalUser, handleImageSearchUpload, (req, res, next) => {
  console.log("[ai-support] image-search request", {
    requestId: req.id,
    contentType: req.headers?.["content-type"] || "",
    tenant_id: req.body?.tenant_id ?? req.body?.tenantId ?? null,
    x_tenant_id: req.headers?.["x-tenant-id"] ?? null,
    has_auth: Boolean(req.headers?.authorization),
    file: req.file
      ? {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer_bytes: req.file.buffer?.length || 0,
        }
      : null,
  });
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: "محتاجين نحدد المتجر الأول قبل تحليل الصورة.",
    });
  }
  req.aiSupportTenantId = tenantId;
  next();
}, aiSupportRateLimit, async (req, res) => {
  const tenantId = req.aiSupportTenantId;
  const metadata = {
    ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
    session_id: req.body?.metadata?.session_id || req.body?.session_id || req.id,
    tenant_id: tenantId,
    channel: "storefront_chat_image",
  };

  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ success: false, message: "ارفع صورة واضحة للبحث." });
    }
    if (!IMAGE_SEARCH_ALLOWED_TYPES.has(file.mimetype)) {
      return res.status(400).json({ success: false, message: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP." });
    }
    if (file.size > IMAGE_SEARCH_MAX_BYTES || file.buffer.length > IMAGE_SEARCH_MAX_BYTES) {
      return res.status(413).json({ success: false, message: "حجم الصورة كبير. ارفع صورة أصغر." });
    }

    const understanding = await understandProductImageForSearch({
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      requestId: req.id,
    });
    console.log("[ai-support] image-search OpenAI vision complete", {
      requestId: req.id,
      tenantId,
      image_size: file.buffer.length,
      confidence: understanding?.confidence || 0,
      detected: understanding?.detected || {},
      error: understanding?.error || "",
      openai_model: understanding?.openai_model || "",
      openai_error: understanding?.openai_error || null,
      openai_errors: understanding?.openai_errors || [],
    });
    if (understanding?.error) {
      console.error("[ai-support] image-search OpenAI vision unavailable", {
        requestId: req.id,
        tenantId,
        fallback_reason: understanding.error,
        openai_error: understanding.openai_error || null,
        openai_errors: understanding.openai_errors || [],
      });
      const responsePayload = {
        answer: IMAGE_SEARCH_FALLBACK_MESSAGE,
        detected_style_model: "",
        suggested_products: [],
        confidence: 0,
        needs_human_support: false,
        sources_used: [],
        suggested_actions: ["show_similar_products", "contact_support"],
        fallback_reason: understanding.error,
        ...(isDevelopment ? {
          openai_error: understanding.openai_error || null,
          openai_errors: understanding.openai_errors || [],
        } : {}),
      };
      return res.json({ success: true, ...responsePayload });
    }
    let productSearch;
    try {
      productSearch = await buildAiSupportImageProductSearch({
        tenantId,
        analysis: understanding,
        req,
      });
    } catch (error) {
      console.error("[ai-support] image-search product search error", {
        requestId: req.id,
        tenantId,
        message: error?.message || "",
      });
      throw error;
    }
    console.log("[ai-support] image-search product search complete", {
      requestId: req.id,
      tenantId,
      search_query: productSearch?.search_query || "",
      exact_match: Boolean(productSearch?.exact_match),
      vision_detection_failed: Boolean(productSearch?.debug?.vision_detection_failed),
      fallback_used_visual_candidates: Boolean(productSearch?.debug?.fallback_used_visual_candidates),
      inferred_model_from_candidate: productSearch?.debug?.inferred_model_from_candidate || "",
      inferred_search_query: productSearch?.debug?.inferred_search_query || "",
      top_visual_score: productSearch?.debug?.top_visual_score || 0,
      confidence_level: productSearch?.confidence_level || productSearch?.debug?.confidence_level || "",
      match_confidence: productSearch?.match_confidence || productSearch?.debug?.match_confidence || 0,
      fallback_reason: productSearch?.fallback_reason || productSearch?.debug?.exact_match_blocked_reason || "",
      suggested_count: productSearch?.suggested_products?.length || 0,
    });
    const suggestedProducts = normalizePublicSuggestedProducts(productSearch.suggested_products);
    const detected = understanding.detected || {};
    const detectedStyleModel = [
      detected.brand_family,
      detected.likely_model,
      detected.brand,
      ...(Array.isArray(detected.model_keywords) ? detected.model_keywords : []),
      detected.product_type,
      detected.silhouette_style,
      detected.high_top_low_top,
      detected.style,
      ...(Array.isArray(detected.colors) ? detected.colors : []),
      ...(Array.isArray(detected.main_colors) ? detected.main_colors : []),
    ].map(toText).filter(Boolean).slice(0, 8).join(" ") || productSearch.debug?.inferred_model_from_candidate || "";
    const answerDecision = buildImageSearchAnswerFromFinalProducts({
      detected,
      productSearch,
      suggestedProducts,
    });
    const visualMatchIds = suggestedProducts.map((product) => String(product.id || product.product_id || "")).filter(Boolean);

    let responsePayload = {
      answer: answerDecision.answer,
      detected_style_model: detectedStyleModel,
      detected_style: detected.style || detected.category || "",
      detected_model: detected.likely_model || (Array.isArray(detected.model_keywords) ? detected.model_keywords.join(" ") : "") || productSearch.debug?.inferred_model_from_candidate || "",
      detected,
      search_query: productSearch.search_query || "",
      suggested_products: suggestedProducts,
      confidence: suggestedProducts.length
        ? Number(productSearch.match_confidence || productSearch.debug?.match_confidence || understanding.confidence || 0)
        : Number(understanding.confidence || 0),
      needs_human_support: false,
      sources_used: suggestedProducts.map((product) => `product_${product.id}`),
      suggested_actions: suggestedProducts.length ? ["view_product", "show_similar_products", "choose_size", "contact_support"] : ["show_similar_products", "contact_support"],
      fallback_reason: answerDecision.exactMatchFound ? "" : "visual_style_similar",
      exact_match_found: answerDecision.exactMatchFound,
      confidence_level: productSearch.confidence_level || productSearch.debug?.confidence_level || answerDecision.responseDebug?.confidence_level || "",
      match_confidence: productSearch.match_confidence || productSearch.debug?.match_confidence || answerDecision.responseDebug?.match_confidence || 0,
      exact_match_reason: productSearch.exact_match_reason || productSearch.debug?.exact_match_reason || "",
      final_exact_match_source: answerDecision.responseDebug?.final_exact_match_source || productSearch.final_exact_match_source || "",
      exact_match_variant_id: answerDecision.responseDebug?.exact_match_variant_id ?? productSearch.exact_match_variant_id ?? null,
      exact_match_variant_reason: answerDecision.responseDebug?.exact_match_variant_reason || productSearch.exact_match_variant_reason || "",
      final_response_synced_with_variant: Boolean(answerDecision.responseDebug?.final_response_synced_with_variant || productSearch.final_response_synced_with_variant),
      personalization_blocked: Boolean(answerDecision.responseDebug?.final_response_synced_with_variant || productSearch.final_response_synced_with_variant),
      top_visual_candidates: answerDecision.responseDebug?.top_visual_candidates || productSearch.debug?.top_visual_candidates || [],
      selected_card_image_source: answerDecision.responseDebug?.selected_card_image_source || productSearch.debug?.selected_card_image_source || "",
      selected_card_image_url: answerDecision.responseDebug?.selected_card_image_url || productSearch.debug?.selected_card_image_url || "",
      forced_exact_variant_rank: Boolean(answerDecision.responseDebug?.forced_exact_variant_rank || productSearch.debug?.forced_exact_variant_rank),
      forced_rank_position: answerDecision.responseDebug?.forced_rank_position ?? productSearch.debug?.forced_rank_position ?? null,
      final_sorted_product_ids: answerDecision.responseDebug?.final_sorted_product_ids || productSearch.debug?.final_sorted_product_ids || suggestedProducts.map((product) => product.id),
      top_rank_reason: answerDecision.responseDebug?.top_rank_reason || productSearch.debug?.top_rank_reason || "",
      exact_match_product_id: answerDecision.responseDebug?.exact_match_product_id ?? productSearch.debug?.exact_match_product_id ?? null,
      exact_match_image_owner_product_id: answerDecision.responseDebug?.exact_match_image_owner_product_id ?? productSearch.debug?.exact_match_image_owner_product_id ?? null,
      exact_match_variant_owner_product_id: answerDecision.responseDebug?.exact_match_variant_owner_product_id ?? productSearch.debug?.exact_match_variant_owner_product_id ?? null,
      forced_rank_target_product_id: answerDecision.responseDebug?.forced_rank_target_product_id ?? productSearch.debug?.forced_rank_target_product_id ?? null,
      forced_rank_target_reason: answerDecision.responseDebug?.forced_rank_target_reason || productSearch.debug?.forced_rank_target_reason || "",
      forced_rank_mismatch_detected: Boolean(answerDecision.responseDebug?.forced_rank_mismatch_detected || productSearch.debug?.forced_rank_mismatch_detected),
      suggested_product_image_ownership: answerDecision.responseDebug?.suggested_product_image_ownership || productSearch.debug?.suggested_product_image_ownership || [],
      exact_match_blocked_reason: answerDecision.responseDebug?.exact_match_blocked_reason ?? productSearch.debug?.exact_match_blocked_reason ?? null,
      variant_candidate_count: answerDecision.responseDebug?.variant_candidate_count || productSearch.debug?.variant_candidate_count || 0,
      product_variant_images_count: answerDecision.responseDebug?.product_variant_images_count || productSearch.debug?.product_variant_images_count || 0,
      vision_detection_failed: Boolean(answerDecision.responseDebug?.vision_detection_failed || productSearch.debug?.vision_detection_failed),
      fallback_used_visual_candidates: Boolean(answerDecision.responseDebug?.fallback_used_visual_candidates || productSearch.debug?.fallback_used_visual_candidates),
      inferred_model_from_candidate: answerDecision.responseDebug?.inferred_model_from_candidate || productSearch.debug?.inferred_model_from_candidate || "",
      inferred_search_query: answerDecision.responseDebug?.inferred_search_query || productSearch.debug?.inferred_search_query || "",
      top_visual_score: answerDecision.responseDebug?.top_visual_score || productSearch.debug?.top_visual_score || 0,
      top_visual_candidate_source: answerDecision.responseDebug?.top_visual_candidate_source || productSearch.debug?.top_visual_candidate_source || "",
      top_visual_candidate_product_name: answerDecision.responseDebug?.top_visual_candidate_product_name || productSearch.debug?.top_visual_candidate_product_name || "",
      image_ranking_debug: productSearch.debug || null,
      response_debug: answerDecision.responseDebug,
      ai_memory_patch: {
        preferences: {
          lastVisualQuery: productSearch.search_query || detectedStyleModel || "",
          lastVisualFeatures: detected,
          lastVisualMatches: visualMatchIds,
        },
      },
      ...(isAiSupportDebug() && productSearch.debug ? { debug: productSearch.debug } : {}),
      ...(isVisualDebug() && productSearch.debug ? { visual_debug: productSearch.debug } : {}),
    };
    responsePayload = appendMoreColorsNote(responsePayload);
    responsePayload = forceExactVariantAnswer({ response: responsePayload, stage: "pre_memory" });
    responsePayload = await updateMemoryAndPersonalize({
      req,
      tenantId,
      metadata,
      message: "دي الصورة اللي بدور على شبهها",
      response: responsePayload,
    });
    responsePayload = forceExactVariantAnswer({ response: responsePayload, stage: "final_return" });

    await logSupportExchange({
      req,
      tenantId,
      metadata,
      message: "[image_search]",
      context: { intent: { type: "image_search" }, fallbackReason: responsePayload.fallback_reason },
      response: responsePayload,
    });

    return res.json({
      success: true,
      ...responsePayload,
    });
  } catch (error) {
    const responsePayload = {
      answer: IMAGE_SEARCH_FALLBACK_MESSAGE,
      detected_style_model: "",
      suggested_products: [],
      confidence: 0,
      needs_human_support: false,
      sources_used: [],
      suggested_actions: ["contact_support"],
      fallback_reason: "image_search_error",
    };
    await logSupportExchange({
      req,
      tenantId,
      metadata,
      message: "[image_search]",
      context: { intent: { type: "image_search" }, fallbackReason: "image_search_error" },
      response: responsePayload,
    });
    console.error("[ai-support] image-search route error", {
      requestId: req.id,
      tenantId,
      contentType: req.headers?.["content-type"] || "",
      file: req.file ? { mimetype: req.file.mimetype, size: req.file.size, buffer_bytes: req.file.buffer?.length || 0 } : null,
      name: error?.name,
      status: error?.status,
      code: error?.code,
      type: error?.type,
      param: error?.param,
      message: error?.message,
      stack: isDevelopment ? error?.stack : undefined,
    });
    return res.json({ success: true, ...responsePayload });
  }
});

router.post("/chat", attachOptionalUser, (req, res, next) => {
  if (isAiSupportDebug()) {
    console.log("[ai-support] tenant debug", {
      requestId: req.id,
      received_tenant_id: req.body?.tenant_id ?? req.body?.tenantId ?? null,
      received_x_tenant_id: req.headers?.["x-tenant-id"] ?? null,
    });
  }
  const tenantId = resolveTenantId(req);
  const earlyIntent = detectAiSupportIntent(req.body?.message);
  if (!tenantId && earlyIntent.type !== "conversational" && earlyIntent.type !== "greeting_only") {
    return res.status(400).json({
      success: false,
      message: "A valid tenant id is required for AI support.",
    });
  }
  req.aiSupportTenantId = tenantId;
  next();
}, aiSupportRateLimit, async (req, res) => {
  try {
    const tenantId = req.aiSupportTenantId;
    const normalizedMessage = normalizeIncomingChannelMessage({
      channel: req.body?.metadata?.channel || req.body?.channel || AI_AGENT_CHANNELS.WEB_CHAT,
      tenantId,
      body: req.body,
      headers: req.headers,
    });
    const flowPayload = buildAiFlowPayloadFromNormalizedMessage({
      normalizedMessage,
      body: req.body,
      headers: req.headers,
    });
    req.aiChannelMessage = normalizedMessage;
    req.body = {
      ...req.body,
      ...flowPayload,
    };
    const message = toText(normalizedMessage.message_text);
    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Customer message is required.",
      });
    }

    const metadata = {
      ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
      session_id: req.body?.metadata?.session_id || req.body?.session_id || null,
      customer_id: req.body?.metadata?.customer_id || null,
      customer_phone: req.body?.metadata?.customer_phone || null,
      customer_name: req.body?.metadata?.customer_name || null,
      channel: normalizedMessage.channel,
      external_conversation_id: normalizedMessage.external_conversation_id,
      external_customer_id: normalizedMessage.external_customer_id,
      attachments: normalizedMessage.attachments,
      locale: req.body?.metadata?.locale || req.headers?.["accept-language"] || null,
      tenant_id: tenantId,
    };

    if (tenantId && metadata.session_id) {
      const conversationState = await getAiSupportConversationState({ tenantId, sessionId: metadata.session_id });
      if (["human_takeover", "closed"].includes(conversationState?.status)) {
        const responsePayload = buildPausedConversationPayload(conversationState.status);
        await logAiSupportMessage({
          tenantId,
          userId: req.user?.id || req.optionalUser?.id || req.optionalUser?.user_id || null,
          sessionId: metadata.session_id,
          customerMessage: message,
          response: { ...responsePayload, answer: "" },
          detectedIntent: conversationState.status,
          fallbackReason: conversationState.status,
          source: req.user || req.optionalUser ? "admin_console" : "api",
        });
        return sendAiSupportChannelResponse(req, res, responsePayload);
      }
    }

    const earlyIntent = detectAiSupportIntent(message);
    if (earlyIntent.type === "greeting_only") {
      const responsePayload = buildStatelessGreetingOnlyPayload(message);
      if (tenantId) {
        await logSupportExchange({
          req,
          tenantId,
          metadata,
          message,
          context: {
            intent: earlyIntent,
            trustedContext: { tenant_id: tenantId, sources: [] },
            fallbackReason: "",
            unknown_product_terms: [],
          },
          response: responsePayload,
        });
      }
      return sendAiSupportChannelResponse(req, res, responsePayload);
    }
    if (earlyIntent.type !== "greeting_only") {
      const identity = resolveAiConversationIdentity({ req, tenantId, metadata });
      await updateAiConversationMemory({
        tenantId,
        sessionId: identity.sessionId,
        customerPhone: identity.customerPhone,
        customerName: identity.customerName,
        message,
        metadata,
        suggestedProducts: [],
      }).catch((error) => {
        console.warn("[ai-support] memory pre-update skipped", {
          requestId: req.id,
          tenantId,
          message: error?.message,
        });
      });
    }

    const context = await buildAiSupportTrustedContext({
      tenantId,
      message,
      req,
    });

    const orderResponse = await buildAiOrderChatResponse({
      tenantId,
      message,
      metadata,
      req,
    });
    if (orderResponse) {
      let responsePayload = sanitizePublicAiSupportResponse({
        message,
        response: {
          ...orderResponse,
          context_source_count: context.trustedContext?.sources?.length || 0,
          source_previews: context.source_previews || [],
          fallback_reason: orderResponse.fallback_reason || "",
        },
      });
      responsePayload.ai_order = orderResponse.ai_order || null;
      responsePayload.needs_human_support = orderResponse.needs_human_support !== false;
      responsePayload = await humanizeSalesResponse({ tenantId, message, response: responsePayload, metadata });
      responsePayload = await updateMemoryAndPersonalize({ req, tenantId, metadata, message, response: responsePayload });
      responsePayload = attachVisualSellingPayload({ message, response: responsePayload });
      await upsertAiCustomerProfile({ tenantId, sessionId: metadata.session_id, metadata, message, response: responsePayload }).catch((error) => {
        console.warn("[ai-agent:memory] profile update skipped", { tenantId, message: error?.message });
      });
      await scheduleAiFollowupIfNeeded({ tenantId, sessionId: metadata.session_id, metadata, response: responsePayload }).catch((error) => {
        console.warn("[ai-agent:followup] schedule skipped", { tenantId, message: error?.message });
      });
      await logSupportExchange({ req, tenantId, metadata, message, context: { ...context, intent: { type: orderResponse.detected_intent || "order" } }, response: responsePayload });
      return sendAiSupportChannelResponse(req, res, responsePayload);
    }

    if (isAiSupportDebug()) {
      console.log("[ai-support] context", {
        requestId: req.id,
        tenantId,
        detectedIntent: context.intent?.type || "unknown",
        contextSourceCount: context.trustedContext?.sources?.length || 0,
        fallbackReason: context.fallbackReason || "",
      });
    }

    if (context.directResponse) {
      let responsePayload = sanitizePublicAiSupportResponse({
        message,
        response: {
        ...context.directResponse,
        detected_intent: context.intent?.type || "",
        context_source_count: context.trustedContext?.sources?.length || 0,
        source_previews: context.source_previews || [],
        quick_funnel: context.quick_funnel || context.directResponse?.quick_funnel || null,
        fallback_reason: context.fallbackReason || "",
        unknown_product_terms: context.unknown_product_terms || [],
        personalization_blocked: Boolean(context.personalization_blocked || context.directResponse?.personalization_blocked),
        greeting_only_mode: Boolean(context.greeting_only_mode || context.directResponse?.greeting_only_mode),
        },
      });
      responsePayload = await updateMemoryAndPersonalize({ req, tenantId, metadata, message, response: responsePayload });
      responsePayload = await humanizeSalesResponse({ tenantId, message, response: responsePayload, metadata });
      responsePayload = attachVisualSellingPayload({ message, response: responsePayload });
      responsePayload = appendMoreColorsNote(responsePayload);
      await upsertAiCustomerProfile({ tenantId, sessionId: metadata.session_id, metadata, message, response: responsePayload }).catch((error) => {
        console.warn("[ai-agent:memory] profile update skipped", { tenantId, message: error?.message });
      });
      await scheduleAiFollowupIfNeeded({ tenantId, sessionId: metadata.session_id, metadata, response: responsePayload }).catch((error) => {
        console.warn("[ai-agent:followup] schedule skipped", { tenantId, message: error?.message });
      });
      await logSupportExchange({ req, tenantId, metadata, message, context, response: responsePayload });
      return sendAiSupportChannelResponse(req, res, responsePayload);
    }

    if (!context.trustedContext?.sources?.length) {
      let responsePayload = sanitizePublicAiSupportResponse({
        message,
        response: {
        answer: "I do not have enough verified information to answer that. Please contact support so a team member can help you.",
        confidence: 0,
        needs_human_support: true,
        sources_used: [],
        suggested_products: context.suggested_products || [],
        suggested_actions: context.suggested_actions || ["contact_support"],
        detected_intent: context.intent?.type || "",
        context_source_count: 0,
        source_previews: context.source_previews || [],
        quick_funnel: context.quick_funnel || null,
        fallback_reason: context.fallbackReason || "no_trusted_context",
        unknown_product_terms: context.unknown_product_terms || [],
        },
      });
      responsePayload = await updateMemoryAndPersonalize({ req, tenantId, metadata, message, response: responsePayload });
      responsePayload = await humanizeSalesResponse({ tenantId, message, response: responsePayload, metadata });
      responsePayload = attachVisualSellingPayload({ message, response: responsePayload });
      responsePayload = appendMoreColorsNote(responsePayload);
      await upsertAiCustomerProfile({ tenantId, sessionId: metadata.session_id, metadata, message, response: responsePayload }).catch((error) => {
        console.warn("[ai-agent:memory] profile update skipped", { tenantId, message: error?.message });
      });
      await scheduleAiFollowupIfNeeded({ tenantId, sessionId: metadata.session_id, metadata, response: responsePayload }).catch((error) => {
        console.warn("[ai-agent:followup] schedule skipped", { tenantId, message: error?.message });
      });
      await logSupportExchange({ req, tenantId, metadata, message, context, response: responsePayload });
      return sendAiSupportChannelResponse(req, res, responsePayload);
    }

    const result = await generateSupportAnswer({
      message,
      trustedContext: context.trustedContext,
      metadata,
      suggestedProducts: context.suggested_products,
      suggestedActions: context.suggested_actions,
    });

    let responsePayload = sanitizePublicAiSupportResponse({
      message,
      response: {
      ...result,
      detected_intent: context.intent?.type || "",
      context_source_count: context.trustedContext?.sources?.length || 0,
      source_previews: context.source_previews || [],
      quick_funnel: context.quick_funnel || null,
      fallback_reason: context.fallbackReason || "",
      unknown_product_terms: context.unknown_product_terms || [],
      },
    });
    responsePayload = await updateMemoryAndPersonalize({ req, tenantId, metadata, message, response: responsePayload });
    responsePayload = await humanizeSalesResponse({ tenantId, message, response: responsePayload, metadata });
    responsePayload = attachVisualSellingPayload({ message, response: responsePayload });
    responsePayload = appendMoreColorsNote(responsePayload);
    await upsertAiCustomerProfile({ tenantId, sessionId: metadata.session_id, metadata, message, response: responsePayload }).catch((error) => {
      console.warn("[ai-agent:memory] profile update skipped", { tenantId, message: error?.message });
    });
    await scheduleAiFollowupIfNeeded({ tenantId, sessionId: metadata.session_id, metadata, response: responsePayload }).catch((error) => {
      console.warn("[ai-agent:followup] schedule skipped", { tenantId, message: error?.message });
    });
    await logSupportExchange({ req, tenantId, metadata, message, context, response: responsePayload });

    return sendAiSupportChannelResponse(req, res, responsePayload);
  } catch (error) {
    const tenantId = req.aiSupportTenantId || resolveTenantId(req);
    const message = toText(req.body?.message);
    const metadata = {
      ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
      session_id: req.body?.metadata?.session_id || req.body?.session_id || req.id,
      tenant_id: tenantId,
    };
    let responsePayload = sanitizePublicAiSupportResponse({
      message,
      response: {
      answer: "AI support is temporarily unavailable. Please contact support so a team member can help you.",
      confidence: 0,
      needs_human_support: true,
      sources_used: [],
      suggested_products: [],
      suggested_actions: ["contact_support"],
      detected_intent: "route_error",
      context_source_count: 0,
      fallback_reason: "route_error",
      },
    });
    responsePayload = await updateMemoryAndPersonalize({ req, tenantId, metadata, message, response: responsePayload });
    await logSupportExchange({
      req,
      tenantId,
      metadata,
      message,
      context: { intent: { type: "route_error" }, fallbackReason: "route_error" },
      response: responsePayload,
    });
    console.error("[ai-support] route error", {
      requestId: req.id,
      message: error?.message,
    });
    return sendAiSupportChannelResponse(req, res, responsePayload, 500);
  }
});

router.get("/history", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant context is required",
      });
    }

    const history = await listAiSupportHistory({
      tenantId,
      needsHumanSupport: req.query?.needs_human_support ?? "",
      lowConfidence: ["1", "true", "yes"].includes(String(req.query?.low_confidence || "").toLowerCase()),
      limit: req.query?.limit,
    });

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("[ai-support] history error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to load AI support history",
    });
  }
});

const emptyInsightsPayload = () => ({
  handoff_count: 0,
  top_questions: [],
  top_product_terms: [],
  top_requested_sizes: [],
  top_requested_colors: [],
  most_suggested_products: [],
  most_clicked_products: [],
  pending_aliases: [],
  fallback_questions: [],
});

router.get("/insights", attachOptionalUser, async (req, res) => {
  const receivedTenantId = req.query?.tenant_id ?? req.query?.tenantId ?? null;
  const receivedHeaderTenantId = req.headers?.["x-tenant-id"] ?? null;
  const authUser = req.user || req.optionalUser || null;
  console.log("[ai-support] insights request", {
    requestId: req.id,
    received_tenant_id: receivedTenantId,
    received_x_tenant_id: receivedHeaderTenantId,
    auth_user: {
      id: authUser?.id ?? authUser?.user_id ?? null,
      tenant_id: authUser?.tenant_id ?? authUser?.tenantId ?? null,
      role: authUser?.role || authUser?.role_name || null,
      is_super_admin: Boolean(authUser?.is_super_admin),
    },
  });

  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant context is required",
      });
    }

    const insights = await getAiSupportInsights({
      tenantId,
      limit: req.query?.limit,
    });

    return res.json({
      success: true,
      insights,
    });
  } catch (error) {
    console.error("[ai-support] insights error", {
      requestId: req.id,
      received_tenant_id: receivedTenantId,
      received_x_tenant_id: receivedHeaderTenantId,
      auth_user_id: authUser?.id ?? authUser?.user_id ?? null,
      code: error?.code,
      detail: error?.detail,
      stack: isDevelopment ? error?.stack : undefined,
      message: error?.message,
    });
    return res.json({
      success: true,
      insights: emptyInsightsPayload(),
    });
  }
});

router.get("/debug/model-colors", attachOptionalUser, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const query = toText(req.query?.query || req.query?.q || "jordan 4");
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required",
      });
    }
    const debug = await buildAiSupportModelColorDebug({
      tenantId,
      query,
      req,
      limit: req.query?.limit || 6,
    });
    return res.json({
      success: true,
      ...debug,
    });
  } catch (error) {
    console.error("[ai-support] debug model-colors error", {
      requestId: req.id,
      query: req.query?.query || "",
      message: error?.message,
      stack: isDevelopment ? error?.stack : undefined,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to load model color debug",
    });
  }
});

router.post("/click", attachOptionalUser, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const productId = req.body?.clicked_product_id ?? req.body?.product_id ?? req.body?.productId;
    const sessionId = req.body?.session_id || req.body?.metadata?.session_id || req.headers?.["x-session-id"];
    if (!tenantId || !sessionId || !Number(productId)) {
      return res.status(400).json({
        success: false,
        message: "tenant_id, session_id, and product_id are required",
      });
    }

    const click = await trackAiSupportProductClick({ tenantId, sessionId, productId });
    await updateAiConversationMemory({
      tenantId,
      sessionId,
      message: "فتح المنتج",
      metadata: req.body?.metadata || {},
      suggestedProducts: [{ id: productId }],
    }).catch((error) => {
      console.warn("[ai-support] click memory update skipped", {
        requestId: req.id,
        tenantId,
        message: error?.message,
      });
    });
    return res.json({ success: true, click });
  } catch (error) {
    console.error("[ai-support] click tracking error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({ success: false, message: "Failed to track AI support product click" });
  }
});

router.post("/cart-outcome", attachOptionalUser, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const productId = req.body?.product_id ?? req.body?.productId;
    const sessionId = req.body?.session_id || req.body?.metadata?.session_id || req.headers?.["x-session-id"];
    if (!tenantId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: "tenant_id and session_id are required",
      });
    }

    const outcome = await trackAiSupportCartOutcome({
      tenantId,
      sessionId,
      productId,
      addedToCart: req.body?.added_to_cart_after_chat !== false,
    });
    await updateAiConversationMemory({
      tenantId,
      sessionId,
      message: "ضيف للكارت",
      metadata: req.body?.metadata || {},
      suggestedProducts: productId ? [{ id: productId }] : [],
    }).catch((error) => {
      console.warn("[ai-support] cart memory update skipped", {
        requestId: req.id,
        tenantId,
        message: error?.message,
      });
    });
    return res.json({ success: true, outcome });
  } catch (error) {
    console.error("[ai-support] cart outcome tracking error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({ success: false, message: "Failed to track AI support cart outcome" });
  }
});

router.delete("/history/test", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant context is required",
      });
    }

    const result = await clearAiSupportTestHistory({ tenantId });
    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[ai-support] clear history error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to clear AI support history",
    });
  }
});

setInterval(cleanupExpiredRateLimitBuckets, RATE_LIMIT_WINDOW_MS).unref?.();

export default router;
