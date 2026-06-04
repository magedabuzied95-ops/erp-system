import { buildProductContext, ensureProductLinkInReply } from "./aiProductContext.js";
import db from "../database/db.js";
import { getAIChannelSettings } from "./aiChannelSettingsService.js";
import {
  AI_AGENT_CHANNELS,
  getChannelSettings,
  linkChannelConversationToCustomerProfile,
  logChannelEvent,
  normalizeOutgoingChannelReply,
} from "./aiChannelAdapterService.js";
import { detectEscalation } from "./aiEscalationDetector.js";
import { pushAIEvent } from "./aiEventLogger.js";
import { getAISettings, getAIToneInstruction } from "./aiSettingsService.js";
import {
  loadAiConversationMemory,
  updateAiConversationMemory,
} from "./aiConversationMemoryService.js";
import {
  buildDynamicClarificationQuestion,
  resolveClassificationOptionsForMessage,
} from "./aiClassificationResolverService.js";
import { buildWhatsappImageCardsForRequest, normalizeProductCards } from "./aiProductCards.js";
import {
  appendAiGeneratedSupportReply,
  getAiSupportConversationState,
  markAiSupportConversationEscalated,
} from "./aiSupportLogService.js";
import { addTraceStep, failTrace, finishTrace } from "./aiReplyTraceService.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const clarificationGroupLabel = (groupKey = "") => {
  const key = text(groupKey);
  if (key === "gender") return "الفئة";
  if (key === "product_type") return "النوع";
  if (key === "grade") return "الدرجة";
  return key || "clarification";
};

const IMAGE_CONTEXT_REPLY = "\u062a\u0642\u0635\u062f \u0635\u0648\u0631\u0629 \u0623\u0646\u0647\u064a \u0645\u0648\u062f\u064a\u0644 \u064a\u0627 \u0641\u0646\u062f\u0645\u061f";
const COLOR_CONTEXT_REPLY = "\u062a\u0642\u0635\u062f \u0623\u0644\u0648\u0627\u0646 \u0623\u0646\u0647\u064a \u0645\u0648\u062f\u064a\u0644 \u064a\u0627 \u0641\u0646\u062f\u0645\u061f";
const IMAGE_READY_REPLY = "\u0623\u0643\u064a\u062f \u064a\u0627 \u0641\u0646\u062f\u0645\u060c \u0647\u0628\u0639\u062a\u0644\u0643 \u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u0645\u062a\u0627\u062d\u0629.";
const VISUAL_PRODUCT_INTENTS = new Set(["image_request", "more_images", "color_question", "size_check", "size_question"]);

const normalizeArabicText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[؟?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isBareConfirmation = (message = "") => {
  const normalized = normalizeArabicText(message);
  return /^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|\u0627\u0648\u0643|ok|okay|yes|yep)$/i.test(normalized);
};

const messageHasProductName = (message = "") =>
  /(\u062c\u0648\u0631\u062f\u0646|\u0646\u0627\u064a\u0643|\u0627\u062f\u064a\u062f\u0627\u0633|nike|adidas|jordan|air\s*jordan|yeezy|samba|campus|shox)/i.test(message);

const detectFollowupIntent = (message = "") => {
  const raw = text(message);
  const normalized = normalizeArabicText(raw);
  const colorQuestion = [
    "\u0627\u0644\u0648\u0627\u0646\u0647 \u0627\u064a\u0647",
    "\u0627\u0644\u0648\u0627\u0646\u0647\u0627 \u0627\u064a\u0647",
    "\u0641\u064a\u0647 \u0627\u0644\u0648\u0627\u0646",
    "\u0641\u064a \u0627\u0644\u0648\u0627\u0646",
    "\u0627\u064a\u0647 \u0627\u0644\u0627\u0644\u0648\u0627\u0646",
    "\u0627\u064a\u0647 \u0627\u0644\u0648\u0627\u0646",
  ].some((term) => normalized.includes(term)) || /\bavailable\s+colors\b|\bcolors?\b/i.test(raw);
  const imageRequest = /(\u0627\u0628\u0639\u062a(?:\u0644\u064a)?\s*\u0635\u0648\u0631|\u0635\u0648\u0631\u062a\u0647|\u0635\u0648\u0631\u0629|\u0635\u0648\u0631\s*[\u0627\u0623]?\u0643\u062a\u0631|\u0627\u0634\u0648\u0641|\u0648\u0631\u064a\u0646\u064a|send\s+(?:photo|image)|more\s+(?:photos|images)|photos?|images?)/i.test(raw) ||
    normalized.includes("\u0639\u0627\u064a\u0632 \u0627\u0634\u0648\u0641");
  if (imageRequest) return normalized.includes("\u0627\u0643\u062a\u0631") || normalized.includes("\u0627\u0643\u062a\u0631") || /more\s+(?:photos|images)/i.test(raw) ? "more_images" : "image_request";
  return colorQuestion ? "color_question" : "";
};

const detectVisualProductIntent = (message = "") => {
  const followup = detectFollowupIntent(message);
  if (followup) return followup;
  const raw = text(message);
  const normalized = normalizeArabicText(raw);
  if (/(\u0645\u0642\u0627\u0633\u0627\u062a|\u0645\u0642\u0627\u0633|sizes?|available|availability)/i.test(raw) || /(\u0645\u0642\u0627\u0633\u0627\u062a|\u0645\u0642\u0627\u0633|\u0645\u062a\u0627\u062d)/i.test(normalized)) return "size_check";
  return "";
};

const cleanVisualProductQuery = ({ message = "", detectedIntent = "", memory = null } = {}) => {
  const original = text(message).replace(/\s+/g, " ").trim();
  const intent = text(detectedIntent);
  const { product } = memoryProductContext(memory);
  if (!original || !VISUAL_PRODUCT_INTENTS.has(intent)) {
    return { original_message: original, detected_intent: intent, brand: "", model: "", clean_query: "", source: product ? "memory" : "", used_for_search: false };
  }
  const normalized = normalizeArabicText(original);
  const brand = /(\u062c\u0648\u0631\u062f\u0646|jordan|aj4|j4)/i.test(original)
    ? "Jordan"
    : /(\u0646\u0627\u064a\u0643|nike|\u0634\u0648\u0643\u0633|shox)/i.test(original)
      ? "Nike"
      : /(\u0627\u062f\u064a\u062f\u0627\u0633|adidas)/i.test(original)
        ? "Adidas"
        : "";
  const model = /(\u062c\u0648\u0631\u062f\u0646\s*(?:4|\u0664|\u06f4|\u0641\u0648\u0631)|jordan\s*4|jordan4|aj4|j4)/i.test(normalized)
    ? "jordan4"
    : /(\u0634\u0648\u0643\u0633|shox)/i.test(normalized)
      ? "shox"
      : /(\u0645\u064a\u0631\u0648\u0631|mirror)/i.test(normalized)
        ? "mirror"
        : "";
  const helperPattern = /^(?:\u0645\u0645\u0643\u0646|\u0628\u0644\u064a\u0632|please|pls|send|show|me|عايز|عايزة)$/i;
  const commandPattern = /^(?:\u0635\u0648\u0631|\u0635\u0648\u0631\u0647|\u0635\u0648\u0631\u0629|\u0627\u0628\u0639\u062a|\u0627\u0628\u0639\u062a\u0644\u064a|\u0648\u0631\u064a\u0646\u064a|\u0627\u0644\u0648\u0627\u0646|\u0623\u0644\u0648\u0627\u0646|\u0645\u0642\u0627\u0633\u0627\u062a|\u0645\u0642\u0627\u0633|\u0645\u062a\u0627\u062d|\u0639\u0646\u062f\u0643|\u0641\u064a|\u0641\u064a\u0647|\u0628\u062a\u0627\u0639|\u0628\u062a\u0627\u0639\u0629|\u0627\u0644\u0645\u0648\u062f\u064a\u0644|\u0627\u0644\u0634\u0648\u0632|\u0627\u064a\u0647|\u0625\u064a\u0647|\u0627\u064a|\u0625\u064a|photos?|images?|pictures?|colors?|colours?|sizes?|available)$/i;
  const tokens = original
    .replace(/[؟?،,.;:!]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token !== "\u0627\u0644" && token !== "\u0627\u0644\u0640")
    .filter((token) => !helperPattern.test(token))
    .filter((token) => !commandPattern.test(token))
    .map((token) => token.replace(/^\u0627\u0644(?=[\u0600-\u06ff]{2,})/, ""));
  const cleanQuery = tokens.join(" ").replace(/\s+/g, " ").trim();
  const hasProductEntity = Boolean(brand || model || /(\u062c\u0648\u0631\u062f\u0646|jordan|adidas|\u0627\u062f\u064a\u062f\u0627\u0633|nike|\u0646\u0627\u064a\u0643|\u0634\u0648\u0643\u0633|shox|mirror|\u0645\u064a\u0631\u0648\u0631)/i.test(cleanQuery));
  return {
    original_message: original,
    detected_intent: intent,
    brand,
    model,
    clean_query: hasProductEntity ? cleanQuery : "",
    source: hasProductEntity && (brand || model) ? "entities" : hasProductEntity ? "stripped_message" : product ? "memory" : "",
    used_for_search: Boolean(hasProductEntity && cleanQuery),
  };
};

const memoryProductContext = (memory = null) => {
  const preferences = memory?.preferences || {};
  const cards = [
    ...asArray(preferences.last_product_cards),
    ...asArray(preferences.lastProductCards),
    ...asArray(memory?.last_products),
    ...asArray(memory?.lastProductCards),
  ];
  const product = [
    preferences.last_product,
    preferences.lastProductCard,
    memory?.last_product,
    memory?.lastProductCard,
    cards[0],
  ].find((item) => item && (item.product_id || item.id || item.name || item.title)) || null;
  return { product, cards };
};

const selectionIndexFromMessage = (message = "") => {
  const normalized = normalizeArabicText(message);
  if (/(\b2\b|\u0627\u0644\u062a\u0627\u0646\u064a|\u0627\u0644\u062b\u0627\u0646\u064a|second)/i.test(normalized)) return 1;
  if (/(\b3\b|\u0627\u0644\u062a\u0627\u0644\u062a|\u0627\u0644\u062b\u0627\u0644\u062b|third)/i.test(normalized)) return 2;
  if (/(\b1\b|\u0627\u0644\u0627\u0648\u0644|\u0627\u0644\u0623\u0648\u0644|first)/i.test(normalized)) return 0;
  return -1;
};

const imageIdentity = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+/g, "/");

const dedupeImageCards = (cards = [], { logLabel = "[image-card-dedupe]" } = {}) => {
  const beforeCount = Array.isArray(cards) ? cards.length : 0;
  const seen = new Set();
  const deduped = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const imageUrl = imageIdentity(card?.image_url || card?.image || card?.main_image || card?.variant_image || card?.color_image || "");
    const color = text(card?.color || card?.matched_variant_color || "").toLowerCase();
    const key = [text(card?.product_id || card?.id || ""), text(card?.variant_id || card?.selected_variant_id || ""), color, imageUrl].join("|");
    if ((imageUrl && seen.has(imageUrl)) || seen.has(key)) continue;
    if (imageUrl) seen.add(imageUrl);
    seen.add(key);
    deduped.push(card);
  }
  if (beforeCount !== deduped.length) {
    console.log(logLabel, {
      before_count: beforeCount,
      after_count: deduped.length,
      removed_count: beforeCount - deduped.length,
    });
  }
  return deduped;
};

const buildFollowupCards = ({ memory = null, message = "", limit = 6, wantsAllImages = false } = {}) => {
  const { product, cards } = memoryProductContext(memory);
  const selectedIndex = selectionIndexFromMessage(message);
  const selectedCard = selectedIndex >= 0 ? cards[selectedIndex] : null;
  const ordered = wantsAllImages
    ? [
        ...(product ? [product] : []),
        ...cards,
        ...(selectedCard ? [selectedCard] : []),
      ]
    : [
        ...(selectedCard ? [selectedCard] : []),
        ...cards,
        ...(product ? [product] : []),
      ];
  console.log("[ai-selection-brain]", {
    source: "whatsapp_live",
    selected_index: selectedIndex,
    has_selected_card: Boolean(selectedCard),
    memory_card_count: cards.length,
    selected_product_id: selectedCard?.product_id || selectedCard?.id || null,
    reason: selectedIndex >= 0 ? "ordinal_followup" : "last_product_context",
    wants_all_images: wantsAllImages,
  });
  const orderedWithVariantSource = ordered.map((card) => {
    if (!card || typeof card !== "object") return card;
    return {
      ...card,
      _variant_load_source: card._variant_load_source || "ai_memory_cards",
      _variant_load_raw_variant_count: Array.isArray(card.variants) ? card.variants.length : card._variant_load_raw_variant_count || 0,
      _variant_load_source_verification: {
        product_variants_table: false,
        cache: false,
        memory: true,
        ai_memory_cards: true,
        storefront_projection_table: false,
        ...(card._variant_load_source_verification || {}),
      },
    };
  });
  const normalizedCards = normalizeProductCards(orderedWithVariantSource, { limit })
    .filter((card) => text(card.image_url || card.image || card.main_image || card.thumbnail));
  const dedupedCards = dedupeImageCards(normalizedCards);
  return dedupedCards
    .map((card) => ({
      ...card,
      response_type: "product_card",
    }));
};

const colorsFromMemoryProduct = (product = {}, cards = []) =>
  [...new Set([
    product.color,
    product.requested_color,
    product.matched_variant_color,
    ...(Array.isArray(product.colors) ? product.colors : String(product.colors || "").split(/[,،/|]+/)),
    ...(Array.isArray(product.available_colors) ? product.available_colors : String(product.available_colors || "").split(/[,،/|]+/)),
    ...asArray(product.variants).map((variant) => variant?.color || variant?.color_name || variant?.name),
    ...asArray(cards).map((card) => card?.color || card?.matched_variant_color),
  ].map(text).filter(Boolean))].slice(0, 12);

const sizesFromMemoryCards = (product = {}, cards = []) =>
  [...new Set([
    product.size,
    product.requested_size,
    product.matched_variant_size,
    ...(Array.isArray(product.sizes) ? product.sizes : String(product.sizes || "").split(/[,،/|]+/)),
    ...(Array.isArray(product.available_sizes) ? product.available_sizes : String(product.available_sizes || "").split(/[,،/|]+/)),
    ...asArray(product.variants).map((variant) => variant?.size),
    ...asArray(cards).flatMap((card) => asArray(card?.sizes || card?.available_sizes)),
  ].map(text).filter(Boolean))].slice(0, 12);

const resolveAwaitingCustomerAction = (memory = null) => {
  const preferences = memory?.preferences || {};
  const lastQuestion = text(preferences.last_ai_question || memory?.last_ai_question || preferences.last_bot_message || "");
  const explicit = text(preferences.awaiting_customer_action || memory?.awaiting_customer_action);
  if (explicit) return { action: explicit, lastQuestion };
  if (/تحب\s+أشوفك\s+الألوان\s+والمقاسات|الألوان\s+والمقاسات|colors.*sizes/i.test(lastQuestion)) {
    return { action: "show_colors_sizes", lastQuestion };
  }
  return { action: "", lastQuestion };
};

const buildBareConfirmationPayload = ({ body = "", memory = null } = {}) => {
  if (!isBareConfirmation(body) || messageHasProductName(body)) return null;
  const { product, cards: memoryCards } = memoryProductContext(memory);
  const preferences = memory?.preferences || {};
  const { action: awaitingAction, lastQuestion } = resolveAwaitingCustomerAction(memory);
  const hasSelectedSize = Boolean(text(preferences.last_selected_size || preferences.selectedSize || memory?.selectedSize));
  const hasSelectedColor = Boolean(text(preferences.last_selected_color || preferences.selectedColor || memory?.selectedColor));
  const inferredAction = awaitingAction || (product && (!hasSelectedSize || !hasSelectedColor) ? "show_colors_sizes" : "");
  const cards = inferredAction === "show_colors_sizes"
    ? buildFollowupCards({ memory, message: body, limit: 6 })
    : [];
  const colors = product ? colorsFromMemoryProduct(product, memoryCards) : [];
  const sizes = product ? sizesFromMemoryCards(product, memoryCards) : [];
  let answer = "تمام يا فندم، تحب أساعدك بإيه؟";
  let resolvedAction = inferredAction || "clarify";
  let suggestedProducts = [];
  let productContext = product || cards[0] || null;
  if (inferredAction === "show_colors_sizes") {
    answer = "تمام يا فندم، دي الألوان والمقاسات المتاحة ";
    const detail = [
      colors.length ? `الألوان: ${colors.join("، ")}` : "",
      sizes.length ? `المقاسات: ${sizes.join("، ")}` : "",
    ].filter(Boolean).join("\n");
    if (detail) answer = `${answer}\n${detail}`;
    suggestedProducts = cards;
    resolvedAction = "show_colors_sizes";
  } else if (inferredAction === "select_size") {
    answer = "مقاس كام يا فندم؟";
    resolvedAction = "select_size";
  } else if (inferredAction === "select_color") {
    answer = "تحب أنهي لون؟";
    resolvedAction = "select_color";
  } else if (["checkout_confirm", "confirm_order"].includes(inferredAction)) {
    return null;
  }
  console.log("[ai-confirmation-router]", {
    message: body,
    awaiting_customer_action: awaitingAction || "",
    last_ai_question: lastQuestion,
    resolved_action: resolvedAction,
    used_last_product: Boolean(productContext),
    should_skip_product_search: true,
  });
  return {
    answer,
    confidence: 0.97,
    detected_intent: "bare_confirmation",
    response_type: suggestedProducts.length ? "product_card" : "confirmation",
    suggested_products: suggestedProducts,
    product_cards: suggestedProducts,
    channel_reply: { text: answer, product_cards: suggestedProducts, response_type: suggestedProducts.length ? "product_card" : "confirmation" },
    product_context: productContext,
    product_search_skipped: true,
    followup_memory_used: Boolean(productContext),
    debug: { skip_product_search_trace: true, resolved_action: resolvedAction },
    ai_memory_patch: {
      preferences: {
        last_ai_question: answer,
        awaiting_customer_action: resolvedAction === "show_colors_sizes" ? "select_size" : "",
      },
    },
  };
};

const buildWhatsappFollowupPayload = async ({ body = "", memory = null, tenantId = null, conversationId = "" } = {}) => {
  const detectedIntent = detectFollowupIntent(body);
  if (!detectedIntent) return null;
  const { product, cards: memoryCards } = memoryProductContext(memory);
  const messageText = text(body);
  const selectedProduct = memory?.preferences?.selected_product_context || null;
  const wantsAllImages =
    detectedIntent === "more_images" ||
    /صور|كلها|الوان|ألوان|صورهم|كل الصور/i.test(messageText || "");
  const cardLimit = selectedProduct ? 1 : wantsAllImages ? 6 : 3;
  const finalImageCards = await buildWhatsappImageCardsForRequest({
    tenantId,
    conversationId,
    messageText,
    detectedIntent,
    memory,
    selectedProductId: selectedProduct?.product_id || selectedProduct?.id || product?.product_id || product?.id || null,
  });
  const cards = wantsAllImages && Array.isArray(finalImageCards.cards) && finalImageCards.cards.length
    ? finalImageCards.cards
    : buildFollowupCards({ memory, message: body, limit: cardLimit, wantsAllImages });
  const hasContext = Boolean(product || cards.length);
  const productId = product?.product_id || product?.id || cards[0]?.product_id || cards[0]?.id || null;
  if (["image_request", "more_images"].includes(detectedIntent)) {
    if (!hasContext || !cards.length) {
      console.log("[ai-followup:missing-context]", { detected_intent: detectedIntent, reply: IMAGE_CONTEXT_REPLY });
      return {
        answer: IMAGE_CONTEXT_REPLY,
        confidence: 0.92,
        detected_intent: detectedIntent,
        suggested_products: [],
        product_cards: [],
        channel_reply: { text: IMAGE_CONTEXT_REPLY, product_cards: [], response_type: "followup_missing_context" },
        product_search_skipped: true,
        followup_memory_used: false,
        debug: { skip_product_search_trace: true, missing_context: true },
      };
    }
    return {
      answer: IMAGE_READY_REPLY,
      confidence: 0.97,
      detected_intent: detectedIntent,
      response_type: "product_card",
      suggested_products: cards,
      product_cards: cards,
      channel_reply: { text: IMAGE_READY_REPLY, product_cards: cards, response_type: "product_card" },
      product_context: product || cards[0],
      product_search_skipped: true,
      followup_memory_used: true,
      debug: { skip_product_search_trace: true, product_id: productId, final_image_cards: finalImageCards },
      whatsapp_image_cards: Array.isArray(finalImageCards.cards) ? finalImageCards.cards : cards,
    };
  }
  const colors = product ? colorsFromMemoryProduct(product, memoryCards) : [];
  console.log("[ai-followup:color-question]", {
    detected: true,
    product_context_found: hasContext,
    product_id: productId,
    colors,
    cards_count: cards.length,
  });
  if (!hasContext) {
    console.log("[ai-followup:missing-context]", { detected_intent: detectedIntent, reply: COLOR_CONTEXT_REPLY });
    return {
      answer: COLOR_CONTEXT_REPLY,
      confidence: 0.92,
      detected_intent: "color_question",
      suggested_products: [],
      product_cards: [],
      channel_reply: { text: COLOR_CONTEXT_REPLY, product_cards: [], response_type: "followup_missing_context" },
      product_search_skipped: true,
      followup_memory_used: false,
      debug: { skip_product_search_trace: true, missing_context: true },
    };
  }
  const colorText = colors.length ? colors.join("\u060c ") : "\u0645\u062d\u062a\u0627\u062c\u0629 \u062a\u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u0644\u0645\u062e\u0632\u0648\u0646";
  const answer = `\u0627\u0644\u0623\u0644\u0648\u0627\u0646 \u0627\u0644\u0645\u062a\u0627\u062d\u0629 \u0645\u0646\u0647: ${colorText}. \u062a\u062d\u0628 \u0623\u0628\u0639\u062a\u0644\u0643 \u0635\u0648\u0631 \u0643\u0644 \u0644\u0648\u0646\u061f`;
  return {
    answer,
    confidence: 0.96,
    detected_intent: "color_question",
    response_type: cards.length ? "product_card" : "color_question",
    suggested_products: cards,
    product_cards: cards,
    channel_reply: { text: answer, product_cards: cards, response_type: cards.length ? "product_card" : "color_question" },
    product_context: product || cards[0],
    product_search_skipped: true,
    followup_memory_used: true,
    debug: { skip_product_search_trace: true, product_id: productId, colors },
  };
};

const buildClassificationFollowupPayload = async ({ body = "", memory = null } = {}) => {
  const preferences = memory?.preferences || {};
  const pending = preferences.pending_product_search_context || {};
  const hasPending = Boolean(pending.model_query || pending.matched_model_family || pending.filters || pending.missing_classification_groups);
  const resolved = await resolveClassificationOptionsForMessage(body, ["gender", "product_type", "grade"]);
  if (!hasPending && !resolved.length) return null;

  const mergedFilters = {
    ...(pending.filters || {}),
  };
  for (const item of resolved) {
    if (item.group_key && item.option_value) mergedFilters[item.group_key] = item.option_value;
  }
  const missingGroups = ["gender", "product_type", "grade"].filter((groupKey) => !mergedFilters[groupKey]);
  const context = {
    model_query: text(pending.model_query || preferences.last_product_name || preferences.last_model_family || ""),
    matched_model_family: text(pending.matched_model_family || preferences.last_model_family || ""),
    filters: mergedFilters,
    missing_classification_groups: missingGroups,
  };
  if (missingGroups.length) {
    const clarificationType = missingGroups[0] || "";
    const question = await buildDynamicClarificationQuestion(missingGroups);
    return {
      answer: question || "تمام يا فندم، تحبها رجالي ولا حريمي؟ Running ولا Casual؟",
      confidence: 0.94,
      detected_intent: "classification_clarification",
      product_search_skipped: true,
      followup_memory_used: true,
      suggested_products: [],
      product_cards: [],
      channel_reply: { text: question, product_cards: [], response_type: "classification_clarification" },
      ai_memory_patch: {
        preferences: {
          pending_product_search_context: context,
          last_ai_question: question || preferences.last_ai_question || "",
          last_bot_message: question || preferences.last_bot_message || "",
          last_clarification_type: clarificationType,
          last_clarification_expected_values: missingGroups,
        },
      },
      debug: { classification_context: context },
    };
  }

  return {
    answer: "مش لاقي نفس الاختيارات دي حاليًا، تحب أوريك أقرب بدائل؟",
    confidence: 0.9,
    detected_intent: "classification_product_search",
    product_search_skipped: true,
    followup_memory_used: true,
    suggested_products: [],
    product_cards: [],
    channel_reply: { text: "مش لاقي نفس الاختيارات دي حاليًا، تحب أوريك أقرب بدائل؟", product_cards: [], response_type: "classification_product_search" },
    ai_memory_patch: {
      preferences: {
        pending_product_search_context: null,
        last_ai_question: preferences.last_ai_question || "",
        last_bot_message: preferences.last_bot_message || "",
        last_clarification_type: pending.missing_classification_groups?.[0] || "",
        last_clarification_expected_values: pending.missing_classification_groups || [],
      },
    },
    debug: { classification_context: context },
  };
};

const backendPort = () => text(process.env.PORT || process.env.BACKEND_PORT || "8000");

const normalizeBackendBaseUrl = (value = "") => {
  const raw = text(value).replace(/\/+$/g, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const localHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
    if (localHost && (!url.port || url.port === "80" || url.port === "443")) {
      url.port = backendPort();
    }
    url.pathname = url.pathname.replace(/\/+$/g, "").replace(/\/api$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
};

const aiSupportBaseUrl = () => {
  const candidates = [
    process.env.INTERNAL_AI_SUPPORT_URL,
    process.env.PUBLIC_BACKEND_URL,
    process.env.API_BASE_URL,
    process.env.BACKEND_URL,
    process.env.API_PUBLIC_URL,
    process.env.VITE_API_BASE_URL,
  ];
  for (const candidate of candidates) {
    const resolved = normalizeBackendBaseUrl(candidate);
    if (resolved) return resolved;
  }
  return `http://127.0.0.1:${backendPort()}`;
};

const publicWhatsappImageBaseUrl = () => {
  const candidates = [
    process.env.PUBLIC_BACKEND_URL,
    process.env.BACKEND_PUBLIC_URL,
    process.env.PUBLIC_APP_URL,
    process.env.STORE_FRONT_URL,
    process.env.API_PUBLIC_URL,
    process.env.VITE_API_BASE_URL,
  ];
  for (const candidate of candidates) {
    const safe = text(candidate).replace(/\/+$/g, "");
    if (/^https?:\/\//i.test(safe) && !/localhost|127\.0\.0\.1/i.test(safe)) return safe;
  }
  return "";
};

const isPublicWhatsappImageUrl = (url = "") => {
  const safe = text(url);
  return /^https?:\/\//i.test(safe) && !/localhost|127\.0\.0\.1|^file:\/\//i.test(safe);
};

const resolveWhatsappImageUrlForLog = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return /^http:\/\//i.test(raw) ? raw.replace(/^http:\/\//i, "https://") : raw;
  if (/^file:\/\//i.test(raw) || /^[a-z]:[\\/]/i.test(raw) || /^\\\\/.test(raw)) return raw;
  const base = publicWhatsappImageBaseUrl();
  return base ? `${base}/${raw.replace(/^\/+/g, "")}` : raw;
};

const firstWhatsappImageValue = (value) => {
  if (Array.isArray(value)) return firstWhatsappImageValue(value[0]);
  if (value && typeof value === "object") {
    return text(
      value.secure_url ||
        value.cloudinary_url ||
        value.image_url ||
        value.main_image ||
        value.variant_image ||
        value.variant_image_url ||
        value.color_image ||
        value.color_image_url ||
        value.url ||
        value.path ||
        value.src ||
        value.image
    );
  }
  return text(value);
};

const whatsappCardImageCandidates = (card = {}) => [
  card.image_url,
  card.image,
  card.main_image,
  card.variant_image,
  card.variant_image_url,
  card.color_image,
  card.color_image_url,
  card.cloudinary_url,
  card.matched_variant_image,
  card.matched_image_url,
  card.product?.image_url,
  card.product?.main_image,
  card.product?.cloudinary_url,
  card.variant?.image_url,
  card.variant?.variant_image,
  card.variant?.color_image_url,
  card.color?.image_url,
  card.color?.color_image,
  asArray(card.images)[0],
  asArray(card.images)[0]?.url,
  asArray(card.images)[0]?.secure_url,
  asArray(card.media)[0],
  asArray(card.media)[0]?.url,
  asArray(card.product_images)[0],
  asArray(card.product?.images)[0],
  asArray(card.variant?.images)[0],
  asArray(card.color?.images)[0],
].map(firstWhatsappImageValue).filter(Boolean);

const whatsappCardImagesCount = (card = {}) =>
  [
    card.images,
    card.media,
    card.product_images,
    card.product?.images,
    card.product?.product_images,
    card.variant?.images,
    card.variant?.media,
    card.color?.images,
  ].reduce((total, value) => total + asArray(value).length, 0);

const whatsappCardImageDebug = (card = {}) => {
  const rawImageUrl = whatsappCardImageCandidates(card)[0] || "";
  const resolvedImageUrl = resolveWhatsappImageUrlForLog(rawImageUrl);
  const isPublic = isPublicWhatsappImageUrl(resolvedImageUrl);
  const selectedCloudinaryUrl =
    card.cloudinary_url ||
    card.secure_url ||
    card.variant?.cloudinary_url ||
    card.variant?.secure_url ||
    card.color?.cloudinary_url ||
    card.color?.secure_url ||
    asArray(card.images)[0]?.cloudinary_url ||
    asArray(card.images)[0]?.secure_url ||
    asArray(card.product_images)[0]?.cloudinary_url ||
    asArray(card.product_images)[0]?.secure_url ||
    "";
  return {
    product_id: card.product_id || card.id || card.product?.id || null,
    product_name: text(card.product_name || card.name || card.title || card.product?.name),
    color: text(card.color || card.matched_variant_color || card.variant?.color || card.color?.name),
    image_url: text(card.image_url),
    image: text(card.image),
    main_image: text(card.main_image || card.product?.main_image),
    variant_image: text(card.variant_image || card.variant?.variant_image || card.variant?.image_url),
    color_image: text(card.color_image || card.color?.image_url || card.color?.color_image),
    cloudinary_url: text(card.cloudinary_url || card.product?.cloudinary_url),
    images_count: whatsappCardImagesCount(card),
    selected_cloudinary_url: text(selectedCloudinaryUrl),
    resolved_image_url: resolvedImageUrl,
    is_public_image_url: isPublic,
    skip_reason: isPublic ? "" : (resolvedImageUrl ? "invalid_private_url" : "missing_image_url"),
  };
};

const logAiWhatsappCardsOutput = ({ aiPayload = {}, reply = null, productCards = [] } = {}) => {
  const detectedIntent = aiPayload?.detected_intent || aiPayload?.intent?.type || aiPayload?.intent || "";
  const wantsAllImages =
    detectedIntent === "image_request" ||
    detectedIntent === "more_images" ||
    /صور|كلها|الوان|ألوان|صورهم|كل الصور/i.test(text(aiPayload?.message_text || reply?.text || ""));
  const cards = [
    ...asArray(productCards),
    ...asArray(reply?.product_cards),
    ...asArray(aiPayload?.channel_reply?.product_cards),
    ...asArray(aiPayload?.suggested_products),
    ...asArray(aiPayload?.product_cards),
  ];
  const seen = new Set();
  const uniqueCards = cards.filter((card) => {
    const productId = text(card?.product_id || card?.id || card?.product?.id || "");
    const variantId = text(card?.variant_id || card?.selected_variant_id || card?.variant?.id || card?.variant?.variant_id || "");
    const color = text(card?.color || card?.matched_variant_color || card?.variant?.color || card?.color_name || "").toLowerCase();
    const imageUrl = text(card?.resolved_image_url || card?.image_url || card?.image || card?.main_image || card?.variant_image || card?.color_image || "");
    const key = wantsAllImages
      ? [productId, variantId, color, imageUrl].join("|")
      : text(card?.product_id || card?.id || card?.name || card?.title || JSON.stringify(card || {}));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const debugCards = uniqueCards.slice(0, 5).map(whatsappCardImageDebug);
  const allDebugCards = uniqueCards.map(whatsappCardImageDebug);
  console.info("[ai-whatsapp-cards-output]", {
    detected_intent: detectedIntent,
    response_type: aiPayload?.response_type || aiPayload?.channel_reply?.response_type || reply?.response_type || "",
    product_cards_count: uniqueCards.length,
    first_5_cards: debugCards,
    has_any_image_field: uniqueCards.some((card) => whatsappCardImageCandidates(card).length > 0),
    has_any_resolved_public_image_url: allDebugCards.some((card) => card.is_public_image_url),
  });
};

const errorSummary = (error = {}) => ({
  message: error?.message || String(error),
  causeMessage: error?.cause?.message || "",
  code: error?.code || "",
  status: error?.status || "",
});

const firstProductFromPayload = (payload = {}) => {
  const candidates = [
    payload.product,
    payload.suggested_product,
    payload.selected_product,
    payload.recommended_product,
    payload.product_context,
    ...(Array.isArray(payload.suggested_products) ? payload.suggested_products : []),
    ...(Array.isArray(payload.product_cards) ? payload.product_cards : []),
    ...(Array.isArray(payload.channel_reply?.product_cards) ? payload.channel_reply.product_cards : []),
  ];
  return candidates.find((product) => product?.id || product?.product_id || product?.name || product?.title) || null;
};

const staleAlternativeReply = (value = "") =>
  /(\u0642\u064a\u0645\u062a\u0647\s+\u062d\u0644\u0648\u0629\s+\u0645\u0642\u0627\u0628\u0644\s+\u0627\u0644\u0633\u0639\u0631|\u062a\u062d\u0628\s+\u0623?\u0637\u0644\u0639\u0644\u0643\s+\u0623?\u0642\u0631\u0628\s+\u0628\u062f\u064a\u0644|\u0628\u0635\s+\u064a\u0627\s+\u0628\u0627\u0634\u0627)/i.test(value);

const customerAskedForAlternative = (value = "") =>
  /(\u0628\u062f\u064a\u0644|\u0628\u062f\u0627\u0626\u0644|\u0623\u0631\u062e\u0635|\u0627\u0631\u062e\u0635|\u062d\u0627\u062c\u0629\s+\u062a\u0627\u0646\u064a\u0629|alternative|cheaper|similar)/i.test(value);

const productIsInStock = (product = {}) => {
  const stock = Number(product.total_stock ?? product.stock ?? product.inventory_profile?.total_stock ?? 0);
  const status = text(product.stock_status || product.availability).toLowerCase();
  return stock > 0 || ["in_stock", "in stock", "available", "متوفر"].includes(status);
};

const productPriceText = (product = {}) => {
  const resolved = resolveCustomerDisplayPrice({ ...product, variant: product.selected_variant || product.variant || product.matched_variant || {}, selected_variant: product.selected_variant || product.variant || product.matched_variant || {} });
  const parsed = Number(product.final_price || product.sale_price || product.price || product.regular_price || product.product_price || 0);
  console.log("[ai-text-price-source]", {
    product_id: resolved.product_id || product.id || null,
    variant_id: resolved.variant_id || product.variant_id || null,
    raw_price_used_in_text: parsed || "",
    text_template: "سعره ${price} جنيه.",
    function_name: "productPriceText",
    file_name: "server/services/aiInboxService.js",
  });
  if (parsed > 0 && resolved.display_price > 0 && parsed !== resolved.display_price) {
    console.error("[ai-price-mismatch]", {
      product_id: resolved.product_id || product.id || null,
      variant_id: resolved.variant_id || product.variant_id || null,
      text_price: parsed,
      selected_display_price: resolved.display_price,
    });
  }
  return resolved.display_price > 0 ? Math.round(resolved.display_price).toLocaleString("en-US") : "";
};

const sanitizeWhatsappLiveReply = ({ replyText = "", payload = {}, messageText = "" } = {}) => {
  const product = firstProductFromPayload(payload);
  if (!staleAlternativeReply(replyText)) return replyText;
  if (!product || !productIsInStock(product) || customerAskedForAlternative(messageText)) return replyText;
  const name = text(product.name || product.title || product.product_name || "الموديل");
  const price = productPriceText(product);
  const sanitized = [
    `أيوه يا فندم، ${name} متوفر`,
    price ? `سعره ${price} جنيه.` : "",
    "تحب أشوفك الألوان والمقاسات؟",
  ].filter(Boolean).join("\n");
  console.info("[whatsapp:reply-sanitized]", {
    reason: "stale_alternative_phrase_with_available_product",
    product_id: product.product_id || product.id || null,
    product_name: name,
    had_price: Boolean(price),
  });
  return sanitized;
};

const shouldSendChannelReply = (payload = {}) => {
  const status = text(payload?.conversation_status || payload?.detected_intent).toLowerCase();
  if (payload?.auto_response_paused === true) return { ok: false, reason: "auto_response_paused" };
  if (["human_takeover", "closed"].includes(status)) return { ok: false, reason: status };
  if (payload?.needs_human_support === true) return { ok: false, reason: "needs_human_support" };
  if (Number(payload?.confidence) > 0 && Number(payload.confidence) < 0.35) return { ok: false, reason: "low_confidence" };
  return { ok: true, reason: "reply_allowed" };
};

const collectProducts = (payload = {}) => {
  const lists = [
    payload?.product_candidates,
    payload?.candidate_products,
    payload?.suggested_products,
    payload?.product_cards,
    payload?.channel_reply?.product_cards,
    payload?.debug?.candidate_products,
    payload?.debug?.ranked_products,
    payload?.debug?.products,
    payload?.debug?.eligible_products,
  ];
  const seen = new Set();
  return lists.flatMap((items) => (Array.isArray(items) ? items : [])).filter((product) => {
    const id = text(product?.id || product?.product_id || product?.productId || product?.sku || product?.name || product?.title);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 80);
};

const productTraceSummary = (product = {}) => ({
  id: product?.id || product?.product_id || product?.productId || null,
  name: product?.name || product?.title || product?.product_name || "",
  score: product?.relevance_score ?? product?.score_breakdown?.score ?? product?.score ?? product?.intent_match_score ?? product?.visual_match_score ?? null,
  confidence: product?.relevance_confidence ?? product?.confidence ?? product?.score_breakdown?.confidence ?? product?.score ?? product?.intent_match_score ?? product?.visual_match_score ?? null,
  strong_reason_count: product?.score_breakdown?.strong_reason_count ?? product?.strong_reason_count ?? (
    Array.isArray(product?.relevance_reasons || product?.reasons || product?.match_reasons)
      ? (product?.relevance_reasons || product?.reasons || product?.match_reasons).length
      : null
  ),
  reasons: product?.relevance_reasons || product?.reasons || product?.score_breakdown?.reasons || product?.match_reasons || [],
  reject_reason: product?.reject_reason || product?.rejected_reason || product?.score_breakdown?.reject_reason || product?.score_breakdown?.rejected_reason || "",
});

const extractTraceIntent = (payload = {}, messageText = "") => {
  const normalized = text(payload?.normalized_message || payload?.debug?.normalized_message || messageText).toLowerCase();
  const colorQuestion = /(الوانه ايه|ألوانه ايه|الوانها ايه|ألوانها ايه|فيه الوان|في ألوان|ايه الألوان|ايه الالوان|available colors|\bcolors?\b)/i.test(messageText);
  const brand = text(payload?.entities?.brand || payload?.requested_brand || payload?.debug?.requested_brand ||
    (/(جوردن|jordan|aj4|j4)/i.test(messageText) ? "Jordan" : /(نايك|nike)/i.test(messageText) ? "Nike" : /(اديداس|adidas)/i.test(messageText) ? "Adidas" : ""));
  const model = text(payload?.entities?.model || payload?.requested_model || payload?.requested_model_family || payload?.debug?.requested_model_family ||
    (/(jordan\s*4|جوردن\s*(4|٤|فور)|aj4|j4|retro\s*4)/i.test(messageText) ? "jordan4" : ""));
  const sizeMatch = String(messageText || "").match(/\b(3[5-9]|4[0-9]|5[0-2])\b/);
  const colorMatch = String(messageText || "").match(/(اسود|أبيض|ابيض|احمر|أحمر|ازرق|أزرق|اخضر|أخضر|رمادي|بيج|black|white|red|blue|green|grey|gray|beige)/i);
  const buyingIntent = /(عايز|اشتري|أشتري|اشتريه|buy|order|checkout|price|سعر|مقاس)/i.test(messageText);
  return {
    detected_intent: colorQuestion ? "color_question" : payload?.detected_intent || payload?.intent?.type || payload?.intent || "",
    confidence: payload?.confidence ?? payload?.intent_confidence ?? payload?.intent?.confidence ?? null,
    normalized_message: normalized,
    entities: {
      brand,
      model,
      size: payload?.entities?.size || payload?.requested_size || (sizeMatch ? sizeMatch[1] : ""),
      color: payload?.entities?.color || payload?.requested_color || (colorMatch ? colorMatch[1] : ""),
      buying_intent: payload?.entities?.buying_intent ?? payload?.buying_intent ?? buyingIntent,
    },
  };
};

const inferResponseType = (payload = {}, replyText = "") => {
  const intent = text(payload?.detected_intent || payload?.intent?.type || payload?.intent).toLowerCase();
  if (payload?.needs_human_support) return "escalation";
  if (intent.includes("color")) return "color_question";
  if (collectProducts(payload).length) return "product_card";
  if (intent.includes("order") || intent.includes("checkout") || intent.includes("buy")) return "order_flow";
  if (intent.includes("greeting") || /^(hi|hello|السلام)/i.test(replyText)) return "greeting";
  return "fallback";
};

const addAiPayloadTraceSteps = async ({ traceId, aiPayload, messageText, replyText = "", replyDecision = {} } = {}) => {
  if (!traceId || !aiPayload) return;
  const candidates = collectProducts(aiPayload);
  const filtered = [
    ...(Array.isArray(aiPayload?.excluded_products) ? aiPayload.excluded_products : []),
    ...(Array.isArray(aiPayload?.debug?.excluded_products) ? aiPayload.debug.excluded_products : []),
    ...(Array.isArray(aiPayload?.debug?.filtered_products) ? aiPayload.debug.filtered_products : []),
    ...(Array.isArray(aiPayload?.debug?.rejected_products) ? aiPayload.debug.rejected_products : []),
  ];
  const selected = [
    ...(Array.isArray(aiPayload?.suggested_products) ? aiPayload.suggested_products : []),
    ...(Array.isArray(aiPayload?.product_cards) ? aiPayload.product_cards : []),
    ...(Array.isArray(aiPayload?.channel_reply?.product_cards) ? aiPayload.channel_reply.product_cards : []),
  ];
  const skipProductSearchTrace = aiPayload?.product_search_skipped === true || aiPayload?.debug?.skip_product_search_trace === true;
  await addTraceStep(traceId, "intent_detection", extractTraceIntent(aiPayload, messageText));
  if (!skipProductSearchTrace) {
    await addTraceStep(traceId, "product_search", {
      query_used: aiPayload?.query || aiPayload?.search_query || aiPayload?.debug?.query || aiPayload?.debug?.search_query || messageText,
      candidate_products: candidates.map(productTraceSummary),
      candidate_count: candidates.length,
    });
    await addTraceStep(traceId, "product_filtering", {
      excluded_products: filtered.map(productTraceSummary),
      exclusion_reasons: filtered.map((product) => ({
        id: product?.id || product?.product_id || product?.productId || null,
        reason: product?.reason || product?.reject_reason || product?.rejected_reason || product?.score_breakdown?.reject_reason || "",
      })),
      final_eligible_products: selected.map(productTraceSummary),
    });
    await addTraceStep(traceId, "decision_gate", {
      shouldSendProduct: selected.length > 0 && replyDecision?.ok !== false,
      selected_product_ids: selected.map((product) => product?.id || product?.product_id || product?.productId).filter(Boolean),
      rejected_product_ids: filtered.map((product) => product?.id || product?.product_id || product?.productId).filter(Boolean),
      reject_reasons: filtered.map((product) => product?.reject_reason || product?.rejected_reason || product?.reason || product?.score_breakdown?.reject_reason || "").filter(Boolean),
      confidence: aiPayload?.decision_gate?.confidence ?? selected[0]?.relevance_confidence ?? selected[0]?.confidence ?? selected[0]?.score_breakdown?.confidence ?? aiPayload?.confidence ?? null,
      strong_reason_count: selected[0]?.score_breakdown?.strong_reason_count ?? selected[0]?.strong_reason_count ?? (Array.isArray(selected[0]?.relevance_reasons || selected[0]?.reasons) ? (selected[0]?.relevance_reasons || selected[0]?.reasons).length : null),
      reasons: selected[0]?.relevance_reasons || selected[0]?.reasons || selected[0]?.score_breakdown?.reasons || [],
      strong_reasons: selected.map((product) => ({
        id: product?.id || product?.product_id || product?.productId || null,
        confidence: product?.relevance_confidence ?? product?.confidence ?? product?.score_breakdown?.confidence ?? null,
        strong_reason_count: product?.score_breakdown?.strong_reason_count ?? product?.strong_reason_count ?? (Array.isArray(product?.relevance_reasons || product?.reasons) ? (product?.relevance_reasons || product?.reasons).length : null),
        reasons: product?.relevance_reasons || product?.reasons || product?.score_breakdown?.reasons || product?.match_reasons || [],
        reject_reason: product?.reject_reason || product?.rejected_reason || product?.score_breakdown?.reject_reason || "",
      })),
    });
  }
  if (replyText) {
    await addTraceStep(traceId, "reply_generation", {
      generated_text: replyText,
      response_type: inferResponseType(aiPayload, replyText),
      detectedIntent: aiPayload?.detected_intent || aiPayload?.intent?.type || aiPayload?.intent || "",
      confidence: aiPayload?.confidence ?? aiPayload?.intent_confidence ?? null,
    });
  }
};

const shouldAutoReplyToWhatsapp = async ({ tenantId, conversationId, payload = {} } = {}) => {
  const state = await getAiSupportConversationState({ tenantId, sessionId: conversationId }).catch(() => null);
  const status = text(state?.status || payload?.conversation_status).toLowerCase();
  const globalSettings = await getAISettings();
  const channelAISettings = await getAIChannelSettings(AI_AGENT_CHANNELS.WHATSAPP, AI_AGENT_CHANNELS.WHATSAPP);
  const runtimeSettings = await getChannelSettings({ tenantId, channel: AI_AGENT_CHANNELS.WHATSAPP }).catch(() => ({}));
  const globalMode = text(globalSettings.autoReplyMode || "suggest_only").toLowerCase();
  const channelMode = text(channelAISettings.aiMode || "suggest_only").toLowerCase();
  const runtimeMode = text(runtimeSettings.auto_reply_mode || (runtimeSettings.ai_replies_enabled === true ? "fully_automatic" : "off")).toLowerCase();
  const automaticModes = new Set(["fully_automatic", "automatic"]);
  const runtimeAutomatic = runtimeSettings.ai_replies_enabled === true && automaticModes.has(runtimeMode);
  const globalAutomatic = automaticModes.has(globalMode);
  const channelAutomatic = automaticModes.has(channelMode);
  const effectiveMode = runtimeAutomatic ? "fully_automatic" : globalAutomatic && channelAutomatic ? "fully_automatic" : runtimeMode || channelMode || globalMode || "off";
  const shouldAutoSend = effectiveMode === "fully_automatic";
  const base = {
    tenantId,
    conversationId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    globalMode,
    channelMode,
    runtimeMode,
    effectiveMode,
    shouldAutoSend,
    status,
  };

  if (status === "human_takeover") return { ok: false, reason: "human_takeover", ...base };
  if (status === "closed" || payload?.auto_response_paused === true) return { ok: false, reason: "paused", ...base };
  if (globalMode === "off") return { ok: false, reason: "GLOBAL_OFF", ...base };
  if (channelMode === "off") return { ok: false, reason: "CHANNEL_OFF", ...base };
  if (runtimeSettings.ai_replies_enabled !== true || !automaticModes.has(runtimeMode)) {
    return { ok: false, reason: runtimeMode === "off" ? "AUTO_REPLY_OFF" : "SUGGEST_ONLY", ...base };
  }
  if (!shouldAutoSend) return { ok: false, reason: "SUGGEST_ONLY", ...base };
  return { ok: true, reason: "fully_automatic", settings: { globalSettings, channelAISettings, runtimeSettings }, ...base };
};

const routeWhatsappMessageThroughAi = async ({ tenantId, message = {} } = {}) => {
  const globalSettings = await getAISettings();
  const channelAISettings = await getAIChannelSettings(AI_AGENT_CHANNELS.WHATSAPP, AI_AGENT_CHANNELS.WHATSAPP);
  const effectiveTone = channelAISettings.tone || globalSettings.tone || "casual";
  const resolvedUrl = `${aiSupportBaseUrl().replace(/\/+$/, "")}/api/ai-support/chat`;
  console.info("[whatsapp:ai-generate-url]", { resolvedUrl });
  const response = await fetch(resolvedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": String(tenantId),
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      message: message.message_text || "Customer sent an attachment",
      session_id: message.external_conversation_id,
      metadata: {
        session_id: message.external_conversation_id,
        customer_id: message.external_customer_id,
        customer_phone: message.external_customer_id,
        customer_name: message.customer_name,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        external_conversation_id: message.external_conversation_id,
        external_customer_id: message.external_customer_id,
        ai_tone: effectiveTone,
        ai_tone_instruction: getAIToneInstruction(effectiveTone),
        attachments: message.attachments || [],
        timestamp: message.timestamp,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || "AI support flow failed"), { status: response.status, responseBody: payload });
  }
  return payload;
};

const syncWhatsappLiveMemoryToChannel = async ({ tenantId, sessionId, phone = "", memory = null } = {}) => {
  if (!tenantId || !sessionId || !memory) return null;
  const payload = {
    ...(memory || {}),
    ai_memory_source: "ai_conversation_memories",
  };
  await db.query(
    `
    UPDATE ai_channel_conversations
    SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{ai_memory}', $4::jsonb, true),
        updated_at = NOW()
    WHERE tenant_id = $1
      AND channel = $2
      AND external_conversation_id = $3
    `,
    [tenantId, AI_AGENT_CHANNELS.WHATSAPP, sessionId, JSON.stringify(payload)]
  ).catch((error) => {
    console.warn("[ai-followup:memory-sync-skipped]", {
      conversation_id: sessionId,
      session_id: sessionId,
      message: error?.message || "memory sync failed",
    });
  });
  return payload;
};

export const generateWhatsappAiAutoReply = async ({ tenantId, phone, sessionId, customerName = "", messageText = "", timestamp = "", traceId = null } = {}) => {
  const safeTenantId = number(tenantId, number(process.env.WHATSAPP_TENANT_ID, 1));
  const safePhone = text(phone);
  const safeSessionId = text(sessionId || (safePhone ? `whatsapp:${safePhone}` : ""));
  const body = text(messageText);
  if (!safeTenantId || !safePhone || !safeSessionId || !body) {
    console.info("[whatsapp:ai-skipped]", { reason: "missing_required_input", tenantId: safeTenantId, sessionId: safeSessionId, phoneSuffix: safePhone.slice(-4) });
    await addTraceStep(traceId, "ai_mode_check", { reason: "missing_required_input", shouldAutoSend: false, conversationMode: "", effectiveMode: "", globalMode: "", channelMode: "" });
    await finishTrace(traceId, { status: "skipped", reason: "missing_required_input" });
    return { triggered: false, sent: false, reason: "missing_required_input" };
  }

  const decision = await shouldAutoReplyToWhatsapp({ tenantId: safeTenantId, conversationId: safeSessionId });
  await addTraceStep(traceId, "ai_mode_check", {
    globalMode: decision.globalMode,
    channelMode: decision.channelMode,
    conversationMode: decision.runtimeMode,
    effectiveMode: decision.effectiveMode,
    shouldAutoSend: decision.shouldAutoSend,
    skip_reason: decision.ok ? "" : decision.reason,
  });
  if (!decision.ok) {
    console.info("[whatsapp:ai-skipped]", {
      reason: decision.reason,
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      mode: decision.runtimeMode,
      globalMode: decision.globalMode,
      channelMode: decision.channelMode,
      effectiveMode: decision.effectiveMode,
      shouldAutoSend: decision.shouldAutoSend,
    });
    await finishTrace(traceId, { status: "skipped", reason: decision.reason });
    return { triggered: false, sent: false, reason: decision.reason };
  }

  const escalation = detectEscalation(body);
  if (escalation.shouldEscalate) {
    await markAiSupportConversationEscalated({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      reason: escalation.reason || "CUSTOMER_RISK_OR_COMPLAINT",
      keyword: escalation.keyword || "",
      source: "whatsapp_ai_auto_reply",
    });
    console.info("[whatsapp:ai-skipped]", { reason: escalation.reason || "escalated_to_human", tenantId: safeTenantId, sessionId: safeSessionId, keyword: escalation.keyword || "" });
    await addTraceStep(traceId, "reply_generation", {
      generated_text: "",
      response_type: "escalation",
      detectedIntent: "escalation",
      confidence: escalation.confidence || null,
      skip_reason: escalation.reason || "escalated_to_human",
    });
    await finishTrace(traceId, { status: "skipped", reason: escalation.reason || "escalated_to_human" });
    return { triggered: false, sent: false, reason: escalation.reason || "escalated_to_human" };
  }

  const message = {
    external_conversation_id: safeSessionId,
    external_customer_id: safePhone,
    customer_name: customerName,
    message_text: body,
    timestamp: timestamp || new Date().toISOString(),
    attachments: [],
  };
  const loadedMemory = await loadAiConversationMemory({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    customerPhone: safePhone,
  }).catch((error) => {
    console.warn("[ai-followup:memory-load]", {
      conversation_id: safeSessionId,
      session_id: safeSessionId,
      has_last_product: false,
      last_product_id: null,
      last_product_cards_count: 0,
      error: error?.message || "memory load failed",
    });
    return null;
  });
  const loadedPreferences = loadedMemory?.preferences || {};
  const loadedProductCards = [
    ...asArray(loadedPreferences.last_product_cards),
    ...asArray(loadedPreferences.lastProductCards),
    ...asArray(loadedMemory?.last_products),
  ];
  const loadedLastProduct = loadedPreferences.last_product || loadedPreferences.lastProductCard || loadedMemory?.last_product || loadedProductCards[0] || null;
  console.log("[ai-followup:memory-load]", {
    conversation_id: safeSessionId,
    session_id: safeSessionId,
    has_last_product: Boolean(loadedLastProduct),
    last_product_id: loadedPreferences.last_product_id || loadedLastProduct?.product_id || loadedLastProduct?.id || null,
    last_product_cards_count: loadedProductCards.length,
  });
  await addTraceStep(traceId, "followup_memory_load", {
    conversation_id: safeSessionId,
    session_id: safeSessionId,
    has_last_product: Boolean(loadedLastProduct),
    last_product_id: loadedPreferences.last_product_id || loadedLastProduct?.product_id || loadedLastProduct?.id || null,
    last_product_cards_count: loadedProductCards.length,
  });
  await syncWhatsappLiveMemoryToChannel({ tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone, memory: loadedMemory });
  const cleanProductIntent = detectVisualProductIntent(body);
  const cleanProductTrace = cleanVisualProductQuery({ message: body, detectedIntent: cleanProductIntent, memory: loadedMemory });
  if (cleanProductIntent) {
    console.log("[ai-clean-product-query]", cleanProductTrace);
    await addTraceStep(traceId, "ai-clean-product-query", cleanProductTrace);
  }
  const classificationFollowupPayload = await buildClassificationFollowupPayload({ body, memory: loadedMemory });
  if (classificationFollowupPayload) {
    const classificationReply = classificationFollowupPayload.channel_reply || normalizeOutgoingChannelReply({ channel: AI_AGENT_CHANNELS.WHATSAPP, response: classificationFollowupPayload });
    const classificationReplyText = classificationReply.text || classificationFollowupPayload.answer || "";
    await updateAiConversationMemory({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      customerPhone: safePhone,
      customerName,
      message: body,
      metadata: {
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        session_id: safeSessionId,
        customer_phone: safePhone,
        customer_name: customerName,
      },
      suggestedProducts: classificationFollowupPayload.suggested_products || classificationFollowupPayload.product_cards || [],
      preferencesPatch: classificationFollowupPayload.ai_memory_patch?.preferences || {},
    }).then((memory) => syncWhatsappLiveMemoryToChannel({ tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone, memory })).catch(() => {});
    await addAiPayloadTraceSteps({ traceId, aiPayload: classificationFollowupPayload, messageText: body, replyText: classificationReplyText, replyDecision: { ok: true } });
    logAiWhatsappCardsOutput({ aiPayload: classificationFollowupPayload, reply: classificationReply, productCards: collectProducts(classificationFollowupPayload) });
    return {
      triggered: true,
      sent: false,
      replyText: classificationReplyText,
      reply: classificationReply,
      aiPayload: classificationFollowupPayload,
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      phone: safePhone,
    };
  }
  const confirmationPayload = buildBareConfirmationPayload({ body, memory: loadedMemory });
  if (confirmationPayload) {
    const confirmationReply = confirmationPayload.channel_reply || normalizeOutgoingChannelReply({ channel: AI_AGENT_CHANNELS.WHATSAPP, response: confirmationPayload });
    const confirmationReplyText = confirmationReply.text || confirmationPayload.answer || "";
    const confirmationProducts = collectProducts(confirmationPayload);
    const resolvedAction = confirmationPayload.debug?.resolved_action || "";
    const shouldSkipProductSearch = confirmationPayload.product_search_skipped === true;
    await addTraceStep(traceId, "ai-confirmation-router", {
      message: body,
      awaiting_customer_action: loadedPreferences.awaiting_customer_action || "",
      last_ai_question: loadedPreferences.last_ai_question || loadedPreferences.last_bot_message || "",
      resolved_action: resolvedAction,
      used_last_product: Boolean(confirmationPayload.product_context),
      should_skip_product_search: shouldSkipProductSearch,
    });
    await updateAiConversationMemory({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      customerPhone: safePhone,
      customerName,
      message: body,
      metadata: {
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        session_id: safeSessionId,
        customer_phone: safePhone,
        customer_name: customerName,
      },
      suggestedProducts: confirmationPayload.suggested_products || confirmationPayload.product_cards || [],
      preferencesPatch: {
        ...(confirmationPayload.ai_memory_patch?.preferences || {}),
        last_product: confirmationPayload.product_context || loadedPreferences.last_product || null,
        last_product_id: confirmationPayload.product_context?.product_id || confirmationPayload.product_context?.id || loadedPreferences.last_product_id || "",
        last_product_name: confirmationPayload.product_context?.name || confirmationPayload.product_context?.title || loadedPreferences.last_product_name || "",
        last_product_cards: confirmationPayload.suggested_products?.length ? confirmationPayload.suggested_products : loadedPreferences.last_product_cards || [],
        lastProductCard: confirmationPayload.product_context || loadedPreferences.lastProductCard || null,
      },
    }).then((memory) => syncWhatsappLiveMemoryToChannel({ tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone, memory })).catch(() => {});
    await addAiPayloadTraceSteps({ traceId, aiPayload: confirmationPayload, messageText: body, replyText: confirmationReplyText, replyDecision: { ok: true } });
    logAiWhatsappCardsOutput({ aiPayload: confirmationPayload, reply: confirmationReply, productCards: confirmationProducts });
    return {
      triggered: true,
      sent: false,
      replyText: confirmationReplyText,
      reply: confirmationReply,
      aiPayload: confirmationPayload,
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      phone: safePhone,
    };
  }
  const followupPayload = cleanProductTrace.used_for_search ? null : await buildWhatsappFollowupPayload({ body, memory: loadedMemory, tenantId: safeTenantId, conversationId: safeSessionId });
  if (followupPayload) {
    const productCards = collectProducts(followupPayload);
    await addTraceStep(traceId, "ai-selection-brain", {
      source: "whatsapp_live",
      selected_index: selectionIndexFromMessage(body),
      used_memory: followupPayload.followup_memory_used === true,
      product_id: followupPayload.product_context?.product_id || followupPayload.product_context?.id || null,
      card_count: productCards.length,
    });
    const followupReply = followupPayload.channel_reply || normalizeOutgoingChannelReply({ channel: AI_AGENT_CHANNELS.WHATSAPP, response: followupPayload });
    const followupReplyText = followupReply.text || followupPayload.answer || "";
    const cardCount = productCards.length;
    await addTraceStep(traceId, "followup_response", {
      detected_intent: followupPayload.detected_intent,
      used_memory: followupPayload.followup_memory_used === true,
      card_count: cardCount,
      reply: followupReplyText,
    });
    await updateAiConversationMemory({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      customerPhone: safePhone,
      customerName,
      message: body,
      metadata: {
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        session_id: safeSessionId,
        customer_phone: safePhone,
        customer_name: customerName,
        last_selected_color: followupPayload.product_context?.color || loadedPreferences.last_selected_color || "",
        last_selected_size: loadedPreferences.last_selected_size || "",
      },
      suggestedProducts: followupPayload.suggested_products || followupPayload.product_cards || [],
      preferencesPatch: followupPayload.product_context ? {
        last_product: followupPayload.product_context,
        last_product_id: followupPayload.product_context.product_id || followupPayload.product_context.id || "",
        last_product_name: followupPayload.product_context.name || followupPayload.product_context.title || "",
        last_model_family: followupPayload.product_context.model_family || loadedPreferences.last_model_family || "",
        last_product_cards: followupPayload.suggested_products || followupPayload.product_cards || loadedPreferences.last_product_cards || [],
        lastProductCard: followupPayload.product_context,
      } : {},
    }).catch(() => {});
    await addAiPayloadTraceSteps({ traceId, aiPayload: followupPayload, messageText: body, replyText: followupReplyText, replyDecision: { ok: true } });
    logAiWhatsappCardsOutput({ aiPayload: followupPayload, reply: followupReply, productCards });
    return {
      triggered: true,
      sent: false,
      replyText: followupReplyText,
      reply: followupReply,
      aiPayload: followupPayload,
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      phone: safePhone,
    };
  }
  console.info("[whatsapp:ai-trigger]", {
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    phoneSuffix: safePhone.slice(-4),
    messageLength: body.length,
    effectiveMode: decision.effectiveMode,
    shouldAutoSend: decision.shouldAutoSend,
  });
  console.info("[whatsapp:ai-generate-start]", {
    target: "ai-support-chat",
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    phoneSuffix: safePhone.slice(-4),
  });
  let aiPayload = null;
  try {
    aiPayload = await routeWhatsappMessageThroughAi({ tenantId: safeTenantId, message });
    if (cleanProductTrace.used_for_search && aiPayload && typeof aiPayload === "object") {
      aiPayload.detected_intent = cleanProductTrace.detected_intent || aiPayload.detected_intent;
      aiPayload.query = cleanProductTrace.clean_query;
      aiPayload.search_query = cleanProductTrace.clean_query;
      aiPayload.entities = {
        ...(aiPayload.entities || {}),
        brand: aiPayload.entities?.brand || cleanProductTrace.brand || "",
        model: aiPayload.entities?.model || cleanProductTrace.model || "",
      };
      aiPayload.debug = {
        ...(aiPayload.debug || {}),
        clean_product_query: cleanProductTrace.clean_query,
        clean_product_query_source: cleanProductTrace.source,
      };
    }
  } catch (error) {
    const summary = errorSummary(error);
    console.error("[whatsapp:ai-generate-error]", {
      ...summary,
      target: "ai-support-chat",
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      phoneSuffix: safePhone.slice(-4),
    });
    await appendAiGeneratedSupportReply({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      answer: `WhatsApp AI generation failed: ${summary.message}`,
      confidence: 0,
      detectedIntent: "whatsapp_ai_generation_error",
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "failed",
      deliveryError: summary.causeMessage ? `${summary.message} / cause: ${summary.causeMessage}` : summary.message,
    }).catch(() => {});
    await addTraceStep(traceId, "reply_generation", {
      generated_text: "",
      response_type: "error",
      detectedIntent: "whatsapp_ai_generation_error",
      confidence: 0,
      error: summary,
    });
    await failTrace(traceId, error, { phase: "ai_generation", target: "ai-support-chat", sessionId: safeSessionId });
    return { triggered: true, sent: false, reason: "ai_generation_failed", error: summary };
  }
  pushAIEvent({
    type: "AI_REPLY_GENERATED",
    status: "success",
    conversationId: safeSessionId,
    platform: AI_AGENT_CHANNELS.WHATSAPP,
  });
  await linkChannelConversationToCustomerProfile({
    tenantId: safeTenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    externalConversationId: safeSessionId,
    externalCustomerId: safePhone,
  }).catch(() => {});

  const replyDecision = shouldSendChannelReply(aiPayload);
  if (!replyDecision.ok) {
    console.info("[whatsapp:ai-skipped]", { reason: replyDecision.reason, tenantId: safeTenantId, sessionId: safeSessionId, confidence: aiPayload?.confidence || 0 });
    await addAiPayloadTraceSteps({ traceId, aiPayload, messageText: body, replyDecision });
    await addTraceStep(traceId, "reply_generation", {
      generated_text: "",
      response_type: replyDecision.reason === "needs_human_support" ? "escalation" : "fallback",
      detectedIntent: aiPayload?.detected_intent || "",
      confidence: aiPayload?.confidence || 0,
      skip_reason: replyDecision.reason,
    });
    await finishTrace(traceId, { status: "skipped", reason: replyDecision.reason });
    return { triggered: true, sent: false, reason: replyDecision.reason, aiPayload };
  }

  const reply = aiPayload.channel_reply || normalizeOutgoingChannelReply({ channel: AI_AGENT_CHANNELS.WHATSAPP, response: aiPayload });
  const productContext = buildProductContext(firstProductFromPayload(aiPayload));
  let replyText = ensureProductLinkInReply(reply.text || aiPayload.answer || "", productContext);
  replyText = sanitizeWhatsappLiveReply({ replyText, payload: aiPayload, messageText: body });
  if (reply && typeof reply === "object") reply.text = replyText;
  if (aiPayload && typeof aiPayload === "object") aiPayload.answer = replyText;
  if (!text(replyText)) {
    console.info("[whatsapp:ai-skipped]", { reason: "empty_ai_reply", tenantId: safeTenantId, sessionId: safeSessionId });
    await addAiPayloadTraceSteps({ traceId, aiPayload, messageText: body, replyText: "", replyDecision });
    await addTraceStep(traceId, "reply_generation", {
      generated_text: "",
      response_type: "fallback",
      detectedIntent: aiPayload?.detected_intent || "",
      confidence: aiPayload?.confidence || 0,
      skip_reason: "empty_ai_reply",
    });
    await finishTrace(traceId, { status: "skipped", reason: "empty_ai_reply" });
    return { triggered: true, sent: false, reason: "empty_ai_reply", aiPayload };
  }
  const aiSuggestedProducts = [
    ...asArray(reply.product_cards),
    ...asArray(aiPayload?.channel_reply?.product_cards),
    ...asArray(aiPayload?.suggested_products),
    ...asArray(aiPayload?.product_cards),
  ];
  const awaitingPatch = /تحب\s+أشوفك\s+الألوان\s+والمقاسات|الألوان\s+والمقاسات/i.test(replyText)
    ? {
        last_ai_question: replyText,
        awaiting_customer_action: "show_colors_sizes",
        last_bot_message: replyText,
      }
    : {
        last_ai_question: replyText,
        last_bot_message: replyText,
      };
  if (aiSuggestedProducts.length) {
    await updateAiConversationMemory({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      customerPhone: safePhone,
      customerName,
      message: body,
      metadata: {
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        session_id: safeSessionId,
        customer_phone: safePhone,
        customer_name: customerName,
      },
      suggestedProducts: aiSuggestedProducts,
      preferencesPatch: awaitingPatch,
    }).then((memory) => syncWhatsappLiveMemoryToChannel({ tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone, memory })).catch((error) => {
      console.warn("[ai-followup:memory-persist-skipped]", {
        conversation_id: safeSessionId,
        session_id: safeSessionId,
        message: error?.message || "memory persist failed",
      });
    });
  } else {
    await updateAiConversationMemory({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      customerPhone: safePhone,
      customerName,
      message: body,
      metadata: {
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        session_id: safeSessionId,
        customer_phone: safePhone,
        customer_name: customerName,
      },
      suggestedProducts: [],
      preferencesPatch: awaitingPatch,
    }).then((memory) => syncWhatsappLiveMemoryToChannel({ tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone, memory })).catch((error) => {
      console.warn("[ai-followup:memory-persist-skipped]", {
        conversation_id: safeSessionId,
        session_id: safeSessionId,
        message: error?.message || "memory persist failed",
      });
    });
  }
  await addAiPayloadTraceSteps({ traceId, aiPayload, messageText: body, replyText, replyDecision });
  console.info("[whatsapp:ai-generated]", {
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    replyLength: replyText.length,
    detectedIntent: aiPayload.detected_intent || "",
    confidence: aiPayload.confidence || 0,
  });
  logAiWhatsappCardsOutput({ aiPayload, reply, productCards: aiSuggestedProducts });
  return { triggered: true, sent: false, replyText, reply, aiPayload, tenantId: safeTenantId, sessionId: safeSessionId, phone: safePhone };
};

export const logWhatsappAiOutbound = async ({ tenantId, phone, sessionId, replyText = "", sent = false, metadata = {} } = {}) => {
  await logChannelEvent({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    direction: "outbound",
    externalCustomerId: phone,
    conversationId: sessionId,
    messagePreview: replyText,
    status: sent ? "sent" : "not_sent",
    metadata: { source: "evolution_api_ai_auto_reply", ...metadata },
  }).catch(() => {});
};

export default {
  generateWhatsappAiAutoReply,
  logWhatsappAiOutbound,
};
