import db from "../database/db.js";
import { AI_AGENT_CHANNELS, normalizeChannel, normalizeOutgoingChannelReply } from "./aiChannelAdapterService.js";
import { normalizeProductCards, resolvePublicProductImageUrl, resolvePublicProductUrl } from "./aiProductCards.js";
import { resolveCustomerDisplayPrice } from "../utils/customerDisplayPrice.js";
import { normalizeArabicForIntent, normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";
import { rankProductCandidates, scoreProductCandidate } from "../utils/productMatchConfidence.js";
import {
  buildConversationMemoryV2,
  mergeConversationMemoryV2,
  resolveFollowupContext,
  summarizeConversationMemoryV2,
} from "../utils/aiConversationMemoryV2.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (items = []) => [...new Set(asArray(items).map((item) => text(item)).filter(Boolean))];
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const truthyFlag = (value) =>
  value === true ||
  value === 1 ||
  ["true", "1", "yes", "on", "active", "enabled"].includes(String(value || "").trim().toLowerCase());

const normalizeArabic = (value = "") =>
  normalizeArabicForIntent(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const ALT_FOLLOWUP_TRACE_PATTERN = /(لا\s*مش\s*عايز\s*ده\s*وريني\s*بديل|لا\s*مش\s*عايز\s*ده|مش\s*عايز\s*ده|وريني\s*بديل|وريني\s*غيره|وريني\s*حاجة\s*تانية|شوفلي\s*حاجة\s*تانية|حاجة\s*تانية|حاجة\s*ثانية|بديل|بدائل|مش\s*عاجبني|مش\s*ده|ده\s*مش|غيره|غيرها|تاني|تانية|alternative|alternatives)/i;
const shouldTraceAltFollowup = (value = "") => ALT_FOLLOWUP_TRACE_PATTERN.test(normalizeArabic(String(value || "")));
const traceAltFollowup = (stage = "", payload = {}) => {
  if (!shouldTraceAltFollowup([
    payload.message,
    payload.messageText,
    payload.originalMessage,
    payload.normalizedText,
    payload.normalizedForIntent,
  ].filter(Boolean).join(" "))) return;
  console.info("[ALT_FOLLOWUP_TRACE]", { stage, ...payload });
};

const normalizeSizeToken = (value = "") =>
  text(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, "")
    .trim();

const extractRequestedSize = (message = "") => {
  const raw = text(message);
  const normalized = normalizeArabic(raw);
  const match = raw.match(/(?:مقاس|size|sizes?)\s*([0-9\u0660-\u0669\u06f0-\u06f9]{1,3})/i)
    || normalized.match(/(?:مقاس|size|sizes?)\s*([0-9]{1,3})/i)
    || raw.match(/\b([0-9\u0660-\u0669\u06f0-\u06f9]{2,3})\b/);
  return normalizeSizeToken(match?.[1] || "");
};

const memoryCardsFromContext = (memory = {}) => normalizeProductCards([
  ...asArray(memory?.last_product_cards),
  ...asArray(memory?.lastProductCards),
  ...asArray(memory?.preferences?.aiConversationMemoryV2?.lastShownProductCards),
  ...asArray(memory?.aiConversationMemoryV2?.lastShownProductCards),
  ...asArray(memory?.preferences?.last_product_cards),
  ...asArray(memory?.preferences?.lastProductCards),
], { limit: 24 });

const cardSizes = (card = {}) => [
  ...asArray(card.available_sizes),
  ...asArray(card.sizes),
  ...asArray(card.inventory_profile?.available_sizes),
].map((value) => normalizeSizeToken(value)).filter(Boolean);

const cardHasRequestedSize = (card = {}, requestedSize = "") => {
  const normalizedRequestedSize = normalizeSizeToken(requestedSize);
  if (!normalizedRequestedSize) return false;
  return cardSizes(card).includes(normalizedRequestedSize);
};

const uniqueColors = (cards = []) => [...new Set(asArray(cards).map((card) => text(card.color || card.matched_variant_color || card.name || card.title)).filter(Boolean))];

const prettyModelName = (value = "") => {
  const name = text(value);
  if (/jordan\s*4|jordan4|aj4|j4/i.test(name) || /جوردن\s*4|جوردن\s*فور/i.test(name)) return "جوردن 4";
  return name;
};

const buildSizeFollowupFromMemoryCards = ({ message = "", memory = {} } = {}) => {
  const requestedSize = extractRequestedSize(message);
  const rememberedCards = memoryCardsFromContext(memory);
  if (!requestedSize || !rememberedCards.length) return null;

  const matchingCards = rememberedCards.filter((card) => cardHasRequestedSize(card, requestedSize));
  const referenceCards = matchingCards.length ? matchingCards : rememberedCards;
  const modelName = prettyModelName(
    referenceCards[0]?.base_name ||
      referenceCards[0]?.model_name ||
      referenceCards[0]?.product_name ||
      referenceCards[0]?.name ||
      referenceCards[0]?.title ||
      "Jordan 4"
  );
  const availableSizes = [...new Set(rememberedCards.flatMap((card) => cardSizes(card)))].filter(Boolean).sort((a, b) => Number(a) - Number(b));
  const availableSizesText = availableSizes.filter((size) => size !== requestedSize).join("، ");
  const availableColors = uniqueColors(matchingCards);
  const textReply = matchingCards.length
    ? [
        `مقاس ${requestedSize} متوفر في ${modelName} بالألوان دي:`,
        ...availableColors.map((color) => `✅ ${color}`),
        "",
        "أنهي لون أحجزهولك؟",
      ].join("\n")
    : [
        `مقاس ${requestedSize} مش متوفر حاليًا في ${modelName}.`,
        availableSizesText ? `المتاح دلوقتي: ${availableSizesText}` : "",
      ].filter(Boolean).join("\n");
  const filteredCards = matchingCards.length ? matchingCards : [];
  const topProductId = text(filteredCards[0]?.product_id || filteredCards[0]?.id || rememberedCards[0]?.product_id || rememberedCards[0]?.id || "");
  const memoryUpdates = {
    active_product_id: topProductId,
    selected_product_id: topProductId,
    last_product_id: topProductId,
    activeSize: requestedSize,
    selectedSize: requestedSize,
    active_size: requestedSize,
    selected_size: requestedSize,
    buyingStage: "size_selected",
    checkoutStage: "size_selected",
    nextRecommendedStage: "color_selection",
    resolvedQuestionType: "POST_PRODUCT_SIZE_SELECTED",
    replyDecisionReason: "v2_post_product_size_selected_from_last_cards",
    last_intent: "post_product_size_selected",
    ai_brain_version: "v2",
    last_product_cards: rememberedCards,
    lastProductCards: rememberedCards,
  };
  const actions = matchingCards.length
    ? [
        { label: "choose_color", value: "choose_color", action: "choose_color" },
        { label: "contact_support", value: "contact_support", action: "contact_support" },
      ]
    : [
        { label: "contact_support", value: "contact_support", action: "contact_support" },
      ];
  const images = filteredCards
    .map((card) => ({
      id: text(card.image_id || card.image_url || card.product_id || card.id),
      url: text(card.image_url || card.url || card.image),
      image_url: text(card.image_url || card.url || card.image),
      product_id: text(card.product_id || card.id),
    }))
    .filter((image) => image.url);
  return {
    text: textReply,
    answer: textReply,
    intent: "post_product_size_selected",
    detected_intent: "post_product_size_selected",
    products: filteredCards,
    suggested_products: filteredCards,
    product_cards: filteredCards,
    images,
    image_cards: images,
    quickReplies: availableColors.map((color) => ({ label: color, value: color })),
    quick_replies: availableColors.map((color) => ({ label: color, value: color })),
    actions,
    suggested_actions: actions,
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: topProductId,
    next_best_action: matchingCards.length ? "choose_color" : "contact_support",
    reply_goal: matchingCards.length ? "help_pick_color" : "share_available_sizes",
    sales_stage: "SIZE_COLLECTION",
    nextRecommendedStage: "color_selection",
    replyDecisionReason: "v2_post_product_size_selected_from_last_cards",
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      reason: "v2_post_product_size_selected_from_last_cards",
      requested_size: requestedSize,
      matching_card_count: matchingCards.length,
      available_sizes: availableSizes,
    },
  };
};

const buildColorAvailabilityFromMemoryCards = ({ message = "", memory = {} } = {}) => {
  const requestedSize = extractRequestedSize(message) || normalizeSizeToken(memory?.activeSize || memory?.selectedSize || memory?.preferences?.activeSize || memory?.preferences?.selectedSize || "");
  const rememberedCards = memoryCardsFromContext(memory);
  if (!requestedSize || !rememberedCards.length) return null;

  const matchingCards = rememberedCards.filter((card) => cardHasRequestedSize(card, requestedSize));
  if (!matchingCards.length) return null;

  const modelName = prettyModelName(
    matchingCards[0]?.base_name ||
      matchingCards[0]?.model_name ||
      matchingCards[0]?.product_name ||
      matchingCards[0]?.name ||
      matchingCards[0]?.title ||
      "Jordan 4"
  );
  const colors = uniqueColors(matchingCards);
  const topProductId = text(matchingCards[0]?.product_id || matchingCards[0]?.id || "");
  const memoryUpdates = {
    active_product_id: topProductId,
    selected_product_id: topProductId,
    last_product_id: topProductId,
    activeSize: requestedSize,
    selectedSize: requestedSize,
    active_size: requestedSize,
    selected_size: requestedSize,
    buyingStage: "color_selection",
    checkoutStage: "color_selection",
    nextRecommendedStage: "color_selection",
    resolvedQuestionType: "POST_PRODUCT_COLOR_LIST",
    replyDecisionReason: "v2_post_product_color_list_from_last_cards",
    last_intent: "post_product_color_list",
    ai_brain_version: "v2",
    last_product_cards: rememberedCards,
    lastProductCards: rememberedCards,
  };
  const textReply = [
    `مقاس ${requestedSize} متوفر في ${modelName} بالألوان دي:`,
    ...colors.map((color) => `✅ ${color}`),
    "",
    "أنهي لون يعجبك؟",
  ].join("\n");
  return {
    text: textReply,
    answer: textReply,
    intent: "post_product_color_list",
    detected_intent: "post_product_color_list",
    products: [],
    suggested_products: [],
    product_cards: [],
    images: [],
    image_cards: [],
    quickReplies: colors.map((color) => ({ label: color, value: color })),
    quick_replies: colors.map((color) => ({ label: color, value: color })),
    actions: [
      { label: "choose_color", value: "choose_color", action: "choose_color" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    suggested_actions: [
      { label: "choose_color", value: "choose_color", action: "choose_color" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: topProductId,
    next_best_action: "choose_color",
    reply_goal: "show_available_colors",
    sales_stage: "COLOR_COLLECTION",
    nextRecommendedStage: "color_selection",
    replyDecisionReason: "v2_post_product_color_list_from_last_cards",
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      reason: "v2_post_product_color_list_from_last_cards",
      requested_size: requestedSize,
      matching_card_count: matchingCards.length,
      colors,
    },
  };
};

const normalizeColorComparable = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[&+\/\\|]/g, " ")
    .replace(/\b(and|with)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const colorSelectionAliasGroups = [
  ["black red", ["black red", "black and red", "black & red", "اسود واحمر", "أسود وأحمر", "الاسود والاحمر", "الأسود والأحمر", "الاسود واحمر", "الأسود واحمر", "black red"]],
  ["burgundy", ["burgundy", "burdgundy", "bordeaux", "bourdeaux", "برجندي", "برجاندي", "برغندي", "البرجندي", "البرجاندي", "البرغندي"]],
  ["black", ["black", "blac", "اسود", "أسود", "الاسود", "الأسود", "بلاك"]],
  ["white", ["white", "whtie", "ابيض", "أبيض", "الابيض", "الأبيض", "وايت"]],
  ["grey", ["grey", "gray", "جراي", "رمادي", "رصاصي"]],
  ["navy", ["navy", "كحلي", "كحلى"]],
  ["blue", ["blue", "azraq", "ازرق", "أزرق", "الازرق", "الأزرق"]],
  ["red", ["red", "احمر", "أحمر", "الاحمر", "الأحمر", "ريد"]],
  ["green", ["green", "اخضر", "أخضر", "الاخضر", "الأخضر"]],
  ["beige", ["beige", "بيج"]],
  ["brown", ["brown", "بني"]],
];

const colorKeyFromText = (value = "") => {
  const normalized = normalizeColorComparable(value);
  if (!normalized) return "";
  if (/\bblack\b/.test(normalized) && /\bred\b/.test(normalized)) return "black red";
  for (const [key, aliases] of colorSelectionAliasGroups) {
    if (key === "black red") continue;
    if (aliases.some((alias) => normalized.includes(normalizeColorComparable(alias)))) return key;
  }
  return normalized;
};

const detectSelectedColorKey = (message = "") => {
  const normalized = normalizeColorComparable(message);
  if (!normalized) return "";
  if (/\bblack\b/.test(normalized) && /\bred\b/.test(normalized)) return "black red";
  for (const [key, aliases] of colorSelectionAliasGroups) {
    if (key === "black red") continue;
    if (aliases.some((alias) => normalized.includes(normalizeColorComparable(alias)))) return key;
  }
  return "";
};

const cardMatchesRequestedColor = (card = {}, requestedColorKey = "") => {
  const cardKey = colorKeyFromText(card.color || card.matched_variant_color || card.name || card.title || "");
  if (!cardKey || !requestedColorKey) return false;
  return cardKey === requestedColorKey;
};

const resolveCardDisplayPrice = (card = {}) => {
  const candidates = [
    card.display_price,
    card.final_price,
    card.price,
    card.sale_price,
    card.selling_price,
    card.selected_display_price,
    card.variant?.sale_price,
    card.variant?.price,
    card.variant?.selling_price,
    card.variant?.display_price,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return 0;
};

const prettyColorLabel = (card = {}) => text(card.color || card.matched_variant_color || card.name || card.title || "");

const buildColorSelectionFromMemoryCards = ({ message = "", memory = {} } = {}) => {
  const requestedColorKey = detectSelectedColorKey(message);
  const rememberedCards = memoryCardsFromContext(memory);
  if (!requestedColorKey || !rememberedCards.length) return null;

  const selectedSize = normalizeSizeToken(
    extractRequestedSize(message) ||
      memory?.activeSize ||
      memory?.selectedSize ||
      memory?.preferences?.activeSize ||
      memory?.preferences?.selectedSize ||
      ""
  );

  const sizeMatchedCards = selectedSize
    ? rememberedCards.filter((card) => cardHasRequestedSize(card, selectedSize))
    : rememberedCards.slice();
  const matchingCards = sizeMatchedCards.filter((card) => cardMatchesRequestedColor(card, requestedColorKey));
  if (!matchingCards.length) return null;

  const selectedCard = matchingCards[0];
  const modelName = prettyModelName(
    selectedCard?.base_name ||
      selectedCard?.model_name ||
      selectedCard?.product_name ||
      selectedCard?.name ||
      selectedCard?.title ||
      "Jordan 4"
  );
  const displayPrice = resolveCardDisplayPrice(selectedCard);
  const selectedColor = prettyColorLabel(selectedCard);
  const topProductId = text(selectedCard?.product_id || selectedCard?.id || "");
  const topVariantId = text(selectedCard?.variant_id || selectedCard?.selected_variant_id || selectedCard?.variant?.id || "");
  const sizeLabel = selectedSize || text(selectedCard?.sizes?.[0] || selectedCard?.available_sizes?.[0] || "");
  const textReply = [
    "تمام",
    "",
    modelName,
    selectedColor,
    `مقاس ${sizeLabel}`,
    "",
    `السعر: ${displayPrice > 0 ? `${displayPrice} جنيه` : "السعر محتاج يتأكد من السيستم قبل التأكيد"}`,
    "",
    "تحب أحجزهولك؟",
  ].join("\n");
  const normalizedCards = normalizeProductCards([selectedCard], { limit: 1 });
  const imageCards = normalizedCards
    .map((card) => ({
      id: text(card.image_id || card.image_url || card.product_id || card.id),
      url: text(card.image_url || card.url || card.image),
      image_url: text(card.image_url || card.url || card.image),
      product_id: text(card.product_id || card.id),
    }))
    .filter((image) => image.url);
  const memoryUpdates = {
    active_product_id: topProductId,
    selected_product_id: topProductId,
    last_product_id: topProductId,
    activeVariantId: topVariantId,
    selectedVariantId: topVariantId,
    active_variant_id: topVariantId,
    selected_variant_id: topVariantId,
    activeColor: selectedColor,
    selectedColor,
    active_color: selectedColor,
    selected_color: selectedColor,
    activeSize: selectedSize,
    selectedSize,
    active_size: selectedSize,
    selected_size: selectedSize,
    buyingStage: "color_selected",
    checkoutStage: "color_selected",
    nextRecommendedStage: "order_confirmation",
    selectionStage: "color_selected",
    resolvedQuestionType: "POST_PRODUCT_COLOR_SELECTED",
    replyDecisionReason: "v2_post_product_color_selected_from_last_cards",
    last_intent: "post_product_color_selected",
    ai_brain_version: "v2",
    last_product_cards: rememberedCards,
    lastProductCards: rememberedCards,
  };
  return {
    text: textReply,
    answer: textReply,
    intent: "post_product_color_selected",
    detected_intent: "post_product_color_selected",
    products: normalizedCards,
    suggested_products: normalizedCards,
    product_cards: normalizedCards,
    images: imageCards,
    image_cards: imageCards,
    quickReplies: [],
    quick_replies: [],
    actions: [
      { label: "confirm_order", value: "confirm_order", action: "confirm_order" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    suggested_actions: [
      { label: "confirm_order", value: "confirm_order", action: "confirm_order" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: topProductId,
    active_variant_id: topVariantId,
    active_color: selectedColor,
    active_size: selectedSize,
    next_best_action: "confirm_order",
    reply_goal: "confirm_selected_variant",
    sales_stage: "COLOR_SELECTION",
    nextRecommendedStage: "order_confirmation",
    replyDecisionReason: "v2_post_product_color_selected_from_last_cards",
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      reason: "v2_post_product_color_selected_from_last_cards",
      requested_color: requestedColorKey,
      selected_size: selectedSize,
      selected_variant_id: topVariantId,
      selected_product_id: topProductId,
    },
  };
};

const buildPostProductOrderConfirmationFromMemory = ({ message = "", memory = {} } = {}) => {
  const normalized = normalizeArabic(message);
  if (!/^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|yes)$/i.test(normalized)) {
    return null;
  }
  const rememberedCards = memoryCardsFromContext(memory);
  if (!rememberedCards.length) return null;

  const activeProductId = text(activeProductFromMemory(memory));
  const activeSize = normalizeSizeToken(memory?.activeSize || memory?.selectedSize || memory?.preferences?.activeSize || memory?.preferences?.selectedSize || "");
  const activeColor = text(memory?.activeColor || memory?.selectedColor || memory?.preferences?.activeColor || memory?.preferences?.selectedColor || "");
  if (!activeProductId || !activeSize || !activeColor) return null;

  const productCard = rememberedCards.find((card) => text(card.product_id || card.id || "") === activeProductId) || rememberedCards[0] || {};
  const modelName = prettyModelName(
    productCard?.base_name ||
      productCard?.model_name ||
      productCard?.product_name ||
      productCard?.name ||
      productCard?.title ||
      "Jordan 4"
  );
  const replyText = [
    "طھظ…ط§ظ…",
    "",
    modelName,
    activeColor,
    `ظ…ظ‚ط§ط³ ${activeSize}`,
    "",
    "ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط§ط³ظ… وط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ط¹ط´ط§ظ† ط£ط¬ظ‡ط²ظ„ظƒ ط§ظ„ط·ظ„ط¨.",
  ].join("\n");
  const memoryUpdates = {
    active_product_id: activeProductId,
    selected_product_id: activeProductId,
    last_product_id: activeProductId,
    activeSize,
    selectedSize: activeSize,
    active_size: activeSize,
    selected_size: activeSize,
    activeColor,
    selectedColor: activeColor,
    active_color: activeColor,
    selected_color: activeColor,
    buyingStage: "collecting_customer_info",
    checkoutStage: "collecting_customer_info",
    nextRecommendedStage: "collect_customer_details",
    resolvedQuestionType: "POST_PRODUCT_ORDER_CONFIRMATION",
    replyDecisionReason: "v2_post_product_order_confirmation",
    last_intent: "post_product_order_confirmation",
    ai_brain_version: "v2",
    last_product_cards: rememberedCards,
    lastProductCards: rememberedCards,
  };
  return {
    text: replyText,
    answer: replyText,
    intent: "post_product_order_confirmation",
    detected_intent: "post_product_order_confirmation",
    products: [],
    suggested_products: [],
    product_cards: [],
    images: [],
    image_cards: [],
    quickReplies: [],
    quick_replies: [],
    actions: [
      { label: "collect_customer_details", value: "collect_customer_details", action: "collect_customer_details" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    suggested_actions: [
      { label: "collect_customer_details", value: "collect_customer_details", action: "collect_customer_details" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: activeProductId,
    active_size: activeSize,
    active_color: activeColor,
    next_best_action: "collect_customer_details",
    reply_goal: "collect_customer_details",
    sales_stage: "ORDER_COLLECTION",
    nextRecommendedStage: "collect_customer_details",
    replyDecisionReason: "v2_post_product_order_confirmation",
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      reason: "v2_post_product_order_confirmation",
      active_product_id: activeProductId,
      active_size: activeSize,
      active_color: activeColor,
    },
  };
};

const buildPostProductOrderConfirmationFromMemoryV2 = ({ message = "", memory = {} } = {}) => {
  const normalized = normalizeArabic(message);
  if (!/^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|yes)$/i.test(normalized)) return null;

  const rememberedCards = memoryCardsFromContext(memory);
  if (!rememberedCards.length) return null;

  const activeProductId = text(activeProductFromMemory(memory));
  const activeSize = normalizeSizeToken(memory?.activeSize || memory?.selectedSize || memory?.preferences?.activeSize || memory?.preferences?.selectedSize || "");
  const activeColor = text(memory?.activeColor || memory?.selectedColor || memory?.preferences?.activeColor || memory?.preferences?.selectedColor || "");
  if (!activeProductId || !activeSize || !activeColor) return null;

  const productCard = rememberedCards.find((card) => text(card.product_id || card.id || "") === activeProductId) || rememberedCards[0] || {};
  const modelName = prettyModelName(
    productCard?.base_name ||
      productCard?.model_name ||
      productCard?.product_name ||
      productCard?.name ||
      productCard?.title ||
      "Jordan 4"
  );
  const replyText = [
    "\u062a\u0645\u0627\u0645",
    "",
    modelName,
    activeColor,
    `\u0627\u0644\u0645\u0642\u0627\u0633: ${activeSize}`,
    "",
    "\u0627\u0628\u0639\u062a\u0644\u064a \u0627\u0644\u0627\u0633\u0645 \u0648\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644 \u0648\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0639\u0634\u0627\u0646 \u0623\u062c\u0647\u0632\u0644\u0643 \u0627\u0644\u0637\u0644\u0628.",
  ].join("\n");
  const memoryUpdates = {
    active_product_id: activeProductId,
    selected_product_id: activeProductId,
    last_product_id: activeProductId,
    activeSize,
    selectedSize: activeSize,
    active_size: activeSize,
    selected_size: activeSize,
    activeColor,
    selectedColor: activeColor,
    active_color: activeColor,
    selected_color: activeColor,
    buyingStage: "collecting_customer_info",
    checkoutStage: "collecting_customer_info",
    nextRecommendedStage: "collect_customer_details",
    resolvedQuestionType: "POST_PRODUCT_ORDER_CONFIRMATION",
    replyDecisionReason: "v2_post_product_order_confirmation",
    last_intent: "post_product_order_confirmation",
    ai_brain_version: "v2",
    last_product_cards: rememberedCards,
    lastProductCards: rememberedCards,
  };
  return {
    text: replyText,
    answer: replyText,
    intent: "post_product_order_confirmation",
    detected_intent: "post_product_order_confirmation",
    products: [],
    suggested_products: [],
    product_cards: [],
    images: [],
    image_cards: [],
    quickReplies: [],
    quick_replies: [],
    actions: [
      { label: "collect_customer_details", value: "collect_customer_details", action: "collect_customer_details" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    suggested_actions: [
      { label: "collect_customer_details", value: "collect_customer_details", action: "collect_customer_details" },
      { label: "contact_support", value: "contact_support", action: "contact_support" },
    ],
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: activeProductId,
    active_size: activeSize,
    active_color: activeColor,
    next_best_action: "collect_customer_details",
    reply_goal: "collect_customer_details",
    sales_stage: "ORDER_COLLECTION",
    nextRecommendedStage: "collect_customer_details",
    replyDecisionReason: "v2_post_product_order_confirmation",
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      reason: "v2_post_product_order_confirmation",
      active_product_id: activeProductId,
      active_size: activeSize,
      active_color: activeColor,
    },
  };
};

const buildPostProductFsmDecision = ({ message = "", memory = {}, intent = "" } = {}) => {
  const rememberedCards = memoryCardsFromContext(memory);
  const activeProductId = activeProductFromMemory(memory);
  if (!rememberedCards.length || !activeProductId) return null;

  const confirmation = buildPostProductOrderConfirmationFromMemoryV2({ message, memory });
  if (confirmation) return confirmation;

  const colorSelection = buildColorSelectionFromMemoryCards({ message, memory });
  if (colorSelection) return colorSelection;

  const colorAvailability = shouldUseColorAvailabilityFromMemory({ message, memory, intent }) ? buildColorAvailabilityFromMemoryCards({ message, memory }) : null;
  if (colorAvailability) return colorAvailability;

  if (text(intent).toLowerCase() === "size_followup") {
    return buildSizeFollowupFromMemoryCards({ message, memory });
  }

  return null;
};

const buildFollowupDecisionFromMemoryV2 = ({ message = "", memory = {}, followupContext = null } = {}) => {
  const type = text(followupContext?.type || "");
  if (!type || type === "none") return null;
  const rememberedCards = memoryCardsFromContext(memory);
  if (!rememberedCards.length) return null;

  const v2 = memory?.preferences?.aiConversationMemoryV2 || memory?.aiConversationMemoryV2 || null;

  if (type === "more_images_followup" || type === "alternative_followup") {
    const productCards = normalizeProductCards(rememberedCards.slice(0, 6), { limit: 6 });
    const activeProductId = text(productCards[0]?.product_id || productCards[0]?.id || activeProductFromMemory(memory));
    const intentName = type === "more_images_followup" ? "more_images" : "product_search";
    const responseText = buildBaseText({ intent: intentName, cards: productCards, activeProductId });
    const memoryUpdates = {
      active_product_id: activeProductId,
      selected_product_id: activeProductId,
      last_product_id: activeProductId,
      last_product_cards: productCards,
      lastProductCards: productCards,
      ai_brain_version: "v2",
      last_intent: type,
    };
    return {
      text: responseText,
      answer: responseText,
      intent: intentName,
      detected_intent: intentName,
      products: productCards,
      suggested_products: productCards,
      product_cards: productCards,
      images: productCards
        .map((card) => ({
          id: text(card.image_id || card.image_url || card.product_id || card.id),
          url: text(card.image_url || card.url || card.image),
          image_url: text(card.image_url || card.url || card.image),
          product_id: text(card.product_id || card.id),
        }))
        .filter((image) => image.url),
      image_cards: productCards
        .map((card) => ({
          id: text(card.image_id || card.image_url || card.product_id || card.id),
          url: text(card.image_url || card.url || card.image),
          image_url: text(card.image_url || card.url || card.image),
          product_id: text(card.product_id || card.id),
        }))
        .filter((image) => image.url),
      quickReplies: [],
      quick_replies: [],
      actions: [{ label: "contact_support", value: "contact_support", action: "contact_support" }],
      suggested_actions: [{ label: "contact_support", value: "contact_support", action: "contact_support" }],
      memoryUpdates,
      memory_updates: memoryUpdates,
      ai_memory_patch: {
        preferences: {
          ...memoryUpdates,
          aiConversationMemoryV2: buildConversationMemoryV2({
            existingMemory: v2,
            messageText: message,
            shownProducts: productCards,
            selectedProduct: productCards[0] || null,
            aliasResult: null,
          }),
        },
      },
      handoff: { needs_human_support: false, reason: "", conversation_status: "" },
      active_product_id: activeProductId,
      next_best_action: "contact_support",
      reply_goal: type === "more_images_followup" ? "show_more_images" : "show_alternatives",
      sales_stage: "PRODUCT_PRESENTATION",
      nextRecommendedStage: "contact_support",
      replyDecisionReason: type === "more_images_followup" ? "v2_more_images_from_memory" : "v2_alternative_from_memory",
      debug: {
        source: "aiBrainV2",
        engine: "ai_brain_v2",
        legacy_called: false,
        reason: type === "more_images_followup" ? "v2_more_images_from_memory" : "v2_alternative_from_memory",
        followup_type: type,
        memory_v2: summarizeConversationMemoryV2(v2),
      },
    };
  }

  if (type === "color_followup") {
    const colorDecision = buildColorSelectionFromMemoryCards({ message: followupContext?.color ? followupContext.color : message, memory });
    if (colorDecision) return colorDecision;
  }

  if (type === "size_followup") {
    const sizeDecision = buildSizeFollowupFromMemoryCards({ message: followupContext?.size ? `مقاس ${followupContext.size}` : message, memory });
    if (sizeDecision) return sizeDecision;
  }

  if (type === "buying_followup") {
    const confirmation = buildPostProductOrderConfirmationFromMemoryV2({ message: "تمام", memory });
    if (confirmation) return confirmation;
  }

  return null;
};

const shouldUseColorAvailabilityFromMemory = ({ message = "", memory = {}, intent = "" } = {}) => {
  const normalized = normalizeArabic(message);
  const requestedSize = extractRequestedSize(message) || normalizeSizeToken(memory?.activeSize || memory?.selectedSize || memory?.preferences?.activeSize || memory?.preferences?.selectedSize || "");
  if (!requestedSize) return false;

  const hasColorCue =
    /(\u0644\u0648\u0646|\u0627\u0644\u0648\u0627\u0646|\u0623\u0644\u0648\u0627\u0646|color|colors|colour|colours|available colors|available colour|available colours|colors available|colors are available|الالوان المتاحة|الألوان المتاحة|الوان متاحة|ألوان متاحة|في أي لون|في انهي لون|في أنهي لون|أنهي لون|انهي لون)/i.test(message) ||
    /(\u0645\u062a\u0627\u062d|\u0645\u0648\u062c\u0648\u062f|available|availability)/i.test(normalized);

  if (hasColorCue) return true;

  if (text(intent).toLowerCase() === "color_followup") return true;

  const hasSizeContext = Boolean(normalizeSizeToken(memory?.activeSize || memory?.selectedSize || memory?.preferences?.activeSize || memory?.preferences?.selectedSize || ""));
  return hasSizeContext && /(\u0645\u062a\u0627\u062d|\u0645\u0648\u062c\u0648\u062f|available|availability)/i.test(normalized);
};

const containsAny = (value = "", terms = []) => terms.some((term) => value.includes(term));

const detectExplicitModel = (message = "") => {
  const normalized = normalizeArabic(message);
  if (/(\u062c\u0648\u0631\u062f\u0646\s*(?:4|\u0664|\u06f4|\u0641\u0648\u0631)|jordan\s*4|jordan4|aj4|j4)/i.test(normalized)) {
    return {
      brand: "Jordan",
      model: "jordan4",
      display: "Jordan 4",
      aliases: ["jordan 4", "jordan4", "air jordan 4", "aj4", "j4", "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631", "\u062c\u0648\u0631\u062f\u0646 4"],
      confidence: 0.98,
    };
  }
  return null;
};

const hasProductDiscoveryRequestPhrase = (message = "") => {
  const normalized = normalizeArabic(message);
  return [
    "عايز",
    "عاوز",
    "بدور على",
    "بدور",
    "شوفلي",
    "وريني",
    "عندك",
    "ابعتلي",
    "ابعت",
    "looking for",
    "want",
    "need",
    "show me",
    "find me",
  ].some((term) => normalized.includes(term));
};

const classifyIntent = ({ message = "", attachments = [], explicitModel = null, canonicalSignals = [], productQuery = "", productCards = [] } = {}) => {
  const normalized = normalizeArabic(message);
  const signalSet = new Set(asArray(canonicalSignals));
  const hasSignal = (...names) => names.some((name) => signalSet.has(name));
  const hasProductContext = Boolean(text(productQuery) || asArray(productCards).length);
  if (asArray(attachments).length) return "visual_search";
  if (/(human\s*takeover|كلم\s*بني\s*آدم|حولني\s*لموظف|عايز\s*موظف|human support|agent)/i.test(normalized)) return "human_takeover";
  if (/(order\s*status|tracking|track order|status الطلب|حالة\s*الطلب|فين\s*الطلب|أين\s*الطلب|تابع\s*الطلب|تتبع\s*الطلب)/i.test(normalized)) return "order_tracking";
  if (/(اعمل\s*اوردر|اعمل\s*طلب|عايز\s*اطلب|عايز\s*أطلب|أعمل\s*أوردر|order follow|follow up order|order\s*follow)/i.test(normalized)) return "order_follow_up";
  if (hasSignal("more_images")) return explicitModel ? "product_search" : "more_images";
  if (hasSignal("price")) return "price_objection";
  if (hasSignal("color")) return "color_followup";
  if (hasSignal("size")) return "size_followup";
  if (hasSignal("alternatives")) return "product_search";
  if (hasProductContext && hasProductDiscoveryRequestPhrase(normalized)) return "product_search";
  if (hasSignal("yes", "confirm")) return "bare_confirmation";
  if (hasSignal("no", "reject", "cancel")) return "bare_confirmation";
  if (hasSignal("buy")) return "buying_intent";
  if (hasSignal("greeting", "thanks")) return "greeting";
  if (hasSignal("order_tracking")) return "order_tracking";
  if (/(\u0635\u0648\u0631|\u0635\u0648\u0631\u0647|\u0635\u0648\u0631\u0629|photo|image)/i.test(normalized)) return explicitModel ? "product_search" : "more_images";
  if (/(\u063a\u0627\u0644\u064a|\u063a\u0627\u0644\u064a\u0647|expensive|price high)/i.test(normalized)) return "price_objection";
  if (/(\u0644\u0648\u0646|\u0627\u0644\u0648\u0627\u0646|color)/i.test(normalized)) return "color_followup";
  if (/(\u0645\u0642\u0627\u0633|\u0645\u0642\u0627\u0633\u0627\u062a|size|available|availability|\u0645\u062a\u0627\u062d)/i.test(normalized)) return "size_followup";
  if (/^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|yes)$/i.test(normalized)) return "bare_confirmation";
  if (/(\u0639\u0627\u064a\u0632\s*[\u0627\u0623]?\u0634\u062a\u0631\u064a|[\u0627\u0623]?\u0634\u062a\u0631\u064a|buy|order|\u0627\u062d\u062c\u0632|\u062d\u062c\u0632)/i.test(normalized)) return "buying_intent";
  if (explicitModel || /(\u0628\u0643\u0627\u0645|\u0643\u0627\u0645|\u0627\u0644\u0633\u0639\u0631|\u0633\u0639\u0631|price|jordan|\u062c\u0648\u0631\u062f\u0646|nike|adidas)/i.test(normalized)) return "product_search";
  if (containsAny(normalized, ["\u0633\u0644\u0627\u0645", "\u0627\u0647\u0644\u0627", "hello", "hi"])) return "greeting";
  return "general";
};

const tableColumnCache = new Map();

const tableColumns = async (tableName = "") => {
  const safeName = text(tableName);
  if (!safeName) return new Set();
  if (tableColumnCache.has(safeName)) return tableColumnCache.get(safeName);
  const result = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [safeName]);
  const columns = new Set((result.rows || []).map((row) => row.column_name));
  tableColumnCache.set(safeName, columns);
  return columns;
};

const column = (alias = "", columns = new Set(), names = [], fallback = "NULL") => {
  const match = names.find((name) => columns.has(name));
  return match ? `${alias}.${match}` : fallback;
};

const tenantClause = (alias = "", columns = new Set(), paramIndex = 2) =>
  columns.has("tenant_id") ? `AND ($${paramIndex}::bigint IS NULL OR ${alias}.tenant_id = $${paramIndex}::bigint OR ${alias}.tenant_id IS NULL)` : "";

const searchTermsForMessage = ({ message = "", explicitModel = null } = {}) => {
  const aliasResult = resolveProductAlias(message);
  const aliasHints = buildAliasAwareSearchHints({ text: message, aliasResult });
  if (explicitModel) {
    return unique([
      ...explicitModel.aliases,
      ...(aliasHints.hasAliasHint ? aliasHints.searchTerms : []),
      ...(aliasHints.hasAliasHint ? aliasHints.productQueryHints : []),
    ]);
  }
  return unique([
    ...(aliasHints.hasAliasHint ? aliasHints.searchTerms : []),
    ...(aliasHints.hasAliasHint ? aliasHints.productQueryHints : []),
    ...normalizeArabic(message)
    .split(/\s+/)
    .filter((term) => term.length >= 2)
    .slice(0, 8),
  ]);
};

const scoreProduct = ({ product = {}, normalizedMessage = "", explicitModel = null } = {}) => {
  const name = normalizeArabic(product.name || product.title || product.product_name || "");
  const sku = normalizeArabic(product.sku || "");
  let score = 0;
  const reasons = [];
  if (explicitModel?.model === "jordan4") {
    const hasJordan = /(\bjordan\b|\u062c\u0648\u0631\u062f\u0646)/i.test(name);
    const hasFour = /(\b4\b|\bfour\b|\u0641\u0648\u0631|\u0664|\u06f4)/i.test(name);
    const isWrongJordan = /(\bjordan\b|\u062c\u0648\u0631\u062f\u0646)/i.test(name) && !hasFour;
    if (hasJordan) {
      score += 60;
      reasons.push("brand_jordan");
    }
    if (hasFour) {
      score += 80;
      reasons.push("model_4");
    }
    if (/aj4|j4/i.test(name) || /aj4|j4/i.test(sku)) {
      score += 70;
      reasons.push("short_alias");
    }
    if (isWrongJordan) {
      score -= 75;
      reasons.push("wrong_jordan_model_penalty");
    }
  }
  for (const token of normalizedMessage.split(/\s+/).filter((item) => item.length >= 2)) {
    if (name.includes(token) || sku.includes(token)) score += 5;
  }
  const stock = Number(product.total_stock ?? product.stock ?? product.quantity ?? 0) || 0;
  if (stock > 0) score += 8;
  if (product.status && !["active", "published", "available"].includes(text(product.status).toLowerCase())) score -= 20;
  return { score, reasons };
};

const loadCandidateProducts = async ({ tenantId = null, message = "", explicitModel = null, limit = 80 } = {}) => {
  const productColumns = await tableColumns("products");
  const tenantFilter = productColumns.has("tenant_id") ? "AND ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)" : "";
  const deletedFilter = productColumns.has("deleted_at") ? "AND p.deleted_at IS NULL" : "";
  const activeFilter = productColumns.has("is_active") ? "AND COALESCE(p.is_active, TRUE) = TRUE" : "";
  const statusFilter = productColumns.has("status") ? "AND COALESCE(NULLIF(LOWER(p.status), ''), 'active') NOT IN ('deleted', 'archived', 'draft')" : "";
  const searchable = [
    column("p", productColumns, ["name", "title", "product_name"], "''"),
    column("p", productColumns, ["sku"], "''"),
    column("p", productColumns, ["article_code"], "''"),
    column("p", productColumns, ["description"], "''"),
  ];
  const terms = searchTermsForMessage({ message, explicitModel });
  const aliasResult = resolveProductAlias(message);
  const aliasHints = buildAliasAwareSearchHints({ text: message, aliasResult });
  const likeClauses = terms.map((_, index) => searchable.map((expr) => `${expr} ILIKE $${index + 2}`).join(" OR "));
  const sql = `
    SELECT p.*
    FROM products p
    WHERE 1 = 1
      ${tenantFilter}
      ${deletedFilter}
      ${activeFilter}
      ${statusFilter}
      ${likeClauses.length ? `AND (${likeClauses.map((clause) => `(${clause})`).join(" OR ")})` : ""}
    ORDER BY p.id DESC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 80, 200))}
  `;
  const params = [numberOrNull(tenantId), ...terms.map((term) => `%${term}%`)];
  const result = await db.query(sql, params);
  console.info("AI_BRAIN_V2_SQL_TRACE", {
    tenant_id: tenantId || null,
    original_text: message,
    normalized_text: normalizeArabic(message),
    explicit_model: explicitModel?.model || "",
    search_terms: terms,
    alias_search_hints: aliasHints,
    rows_returned: result.rows.length,
    first_product_ids: result.rows.slice(0, 20).map((row) => row.id),
    first_product_names: result.rows.slice(0, 20).map((row) => row.name || row.title || row.product_name || ""),
  });
  console.log("[alias-aware-product-search]", {
    original: message,
    canonicalProduct: aliasHints.canonicalProduct,
    searchTerms: aliasResult.searchTerms || [],
    productQueryHints: aliasHints.productQueryHints,
    usedAliasHint: aliasHints.hasAliasHint,
    fallbackUsed: true,
    matchedProductId: result.rows[0]?.id || null,
    matchedProductName: result.rows[0]?.name || result.rows[0]?.title || "",
    confidence: aliasResult.confidence || 0,
    channel: "ai_brain_v2",
  });
  return result.rows || [];
};

const rankProducts = ({ products = [], message = "", explicitModel = null, aliasResult = null, searchHints = null, intentPayload = null } = {}) => {
  const normalizedMessage = normalizeArabic(message);
  const legacyRanked = asArray(products)
    .map((product) => {
      const scored = scoreProduct({ product, normalizedMessage, explicitModel });
      return {
        ...product,
        ai_brain_v2_score: scored.score,
        ai_brain_v2_reasons: scored.reasons,
      };
    })
    .sort((a, b) => Number(b.ai_brain_v2_score || 0) - Number(a.ai_brain_v2_score || 0) || Number(a.id || 0) - Number(b.id || 0));

  const normalizedPayload = intentPayload || normalizeArabicIntentPayload(message);
  const confidenceRanking = rankProductCandidates({
    candidates: legacyRanked,
    text: message,
    normalizedPayload,
    aliasResult,
    searchHints,
    intentPayload: normalizedPayload,
  });
  console.log("[product-match-confidence]", {
    original: message,
    normalizedText: normalizedPayload.normalizedText || "",
    canonicalProduct: aliasResult?.canonicalProduct || searchHints?.canonicalProduct || null,
    candidateCount: legacyRanked.length,
    bestMatchId: confidenceRanking.bestMatch?.id || confidenceRanking.bestMatch?.product_id || null,
    bestMatchName: confidenceRanking.bestMatch?.name || confidenceRanking.bestMatch?.title || confidenceRanking.bestMatch?.product_name || "",
    confidence: confidenceRanking.confidence,
    reasons: confidenceRanking.bestMatch?.product_match_reasons || [],
    fallbackRecommended: confidenceRanking.fallbackRecommended,
    channel: "ai_brain_v2",
  });

  if (confidenceRanking.bestMatch) {
    return confidenceRanking.rankedCandidates;
  }

  return legacyRanked.map((product) => {
    const productConfidence = scoreProductCandidate({
      product,
      text: message,
      normalizedPayload,
      aliasResult,
      searchHints,
      intentPayload: normalizedPayload,
    });
    return {
      ...product,
      product_match_confidence: productConfidence.confidence,
      product_match_score: productConfidence.score,
      product_match_reasons: productConfidence.reasons,
      product_match_signals: productConfidence.matchedSignals,
    };
  });
};

const loadFullProductForPresentation = async ({ tenantId = null, productId = null } = {}) => {
  if (!productId) return null;
  try {
    const [productColumns, variantColumns, variantImageColumns] = await Promise.all([
      tableColumns("products"),
      tableColumns("product_variants"),
      tableColumns("product_variant_images"),
    ]);
    const variantSelect = {
      id: column("pv", variantColumns, ["id"], "NULL"),
      product_id: column("pv", variantColumns, ["product_id"], "NULL"),
      name: column("pv", variantColumns, ["name", "edition_name"], "''"),
      size: column("pv", variantColumns, ["size"], "''"),
      color: column("pv", variantColumns, ["color"], "''"),
      color_name: column("pv", variantColumns, ["color_name", "color"], "''"),
      color_value: column("pv", variantColumns, ["color_value", "color"], "''"),
      stock: column("pv", variantColumns, ["stock"], "0"),
      quantity: column("pv", variantColumns, ["quantity", "available_quantity", "stock"], "NULL"),
      image_url: column("pv", variantColumns, ["image_url", "image", "photo_url", "thumbnail_url"], "''"),
      variant_image_url: column("pv", variantColumns, ["variant_image_url", "image_url", "image", "photo_url", "thumbnail_url"], "''"),
      color_image_url: column("pv", variantColumns, ["color_image_url", "image_url", "image", "photo_url", "thumbnail_url"], "''"),
      secure_url: column("pv", variantColumns, ["secure_url", "cloudinary_url", "image_url", "image", "photo_url", "thumbnail_url"], "''"),
      sale_price: column("pv", variantColumns, ["sale_price"], "0"),
      selling_price: column("pv", variantColumns, ["selling_price", "price"], "0"),
      price: column("pv", variantColumns, ["price", "regular_price"], "0"),
      sale_active: column("pv", variantColumns, ["sale_price_enabled", "sale_prices_enabled", "global_sale_enabled", "sale_mode_enabled", "sale_active", "is_sale_active", "on_sale", "sale_enabled", "discount_enabled"], "FALSE"),
      sku: column("pv", variantColumns, ["sku"], "''"),
      barcode: column("pv", variantColumns, ["barcode"], "''"),
      is_active: column("pv", variantColumns, ["is_active"], "NULL"),
      branch_id: column("pv", variantColumns, ["branch_id"], "NULL"),
      warehouse_id: column("pv", variantColumns, ["warehouse_id"], "NULL"),
    };
    const variantImageSelect = {
      id: column("pvi", variantImageColumns, ["id"], "NULL"),
      product_id: column("pvi", variantImageColumns, ["product_id"], "NULL"),
      variant_id: column("pvi", variantImageColumns, ["variant_id"], "NULL"),
      color_name: column("pvi", variantImageColumns, ["color_name"], "''"),
      color_value: column("pvi", variantImageColumns, ["color_value", "color_name"], "''"),
      image_url: column("pvi", variantImageColumns, ["image_url"], "''"),
      secure_url: column("pvi", variantImageColumns, ["secure_url", "cloudinary_url", "image_url"], "''"),
      is_primary: column("pvi", variantImageColumns, ["is_primary"], "FALSE"),
      sort_order: column("pvi", variantImageColumns, ["sort_order"], "0"),
    };
    const sql = `
      SELECT
        p.*,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'id', ${variantSelect.id},
              'product_id', ${variantSelect.product_id},
              'name', ${variantSelect.name},
              'size', ${variantSelect.size},
              'color', ${variantSelect.color},
              'color_name', ${variantSelect.color_name},
              'color_value', ${variantSelect.color_value},
              'stock', ${variantSelect.stock},
              'quantity', ${variantSelect.quantity},
              'image_url', ${variantSelect.image_url},
              'variant_image_url', ${variantSelect.variant_image_url},
              'color_image_url', ${variantSelect.color_image_url},
              'secure_url', ${variantSelect.secure_url},
              'sale_price', ${variantSelect.sale_price},
              'selling_price', ${variantSelect.selling_price},
              'price', ${variantSelect.price},
              'sale_active', ${variantSelect.sale_active},
              'sku', ${variantSelect.sku},
              'barcode', ${variantSelect.barcode},
              'is_active', ${variantSelect.is_active},
              'branch_id', ${variantSelect.branch_id},
              'warehouse_id', ${variantSelect.warehouse_id}
            )
          ) FILTER (WHERE pv.id IS NOT NULL),
          '[]'::jsonb
        ) AS variants,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'id', ${variantImageSelect.id},
              'product_id', ${variantImageSelect.product_id},
              'variant_id', ${variantImageSelect.variant_id},
              'color_name', ${variantImageSelect.color_name},
              'color_value', ${variantImageSelect.color_value},
              'image_url', ${variantImageSelect.image_url},
              'secure_url', ${variantImageSelect.secure_url},
              'is_primary', ${variantImageSelect.is_primary},
              'sort_order', ${variantImageSelect.sort_order}
            )
          ) FILTER (WHERE pvi.id IS NOT NULL),
          '[]'::jsonb
        ) AS product_variant_images
      FROM products p
      LEFT JOIN product_variants pv
        ON pv.product_id = p.id
        ${tenantClause("pv", variantColumns, 2)}
      LEFT JOIN product_variant_images pvi
        ON pvi.product_id = p.id
        ${tenantClause("pvi", variantImageColumns, 2)}
      WHERE p.id = $1
        ${tenantClause("p", productColumns, 2)}
      GROUP BY p.id
      LIMIT 1
    `;
    const result = await db.query(sql, [productId, numberOrNull(tenantId)]);
    const row = result.rows[0] || null;
    if (!row) return null;
    row.variants = asArray(row.variants);
    row.product_variant_images = asArray(row.product_variant_images);
    return row;
  } catch (error) {
    console.warn("AI_BRAIN_V2_PRODUCT_PRESENTATION_LOAD_FAILED", {
      tenant_id: tenantId || null,
      product_id: productId || null,
      message: error?.message || "load failed",
    });
    return null;
  }
};

const withActiveDisplayPrice = (card = {}, fullProduct = {}) => {
  const selectedVariant =
    card.variant ||
    asArray(fullProduct.variants).find((variant) => String(variant.id || variant.variant_id || "") === String(card.variant_id || card.selected_variant_id || "")) ||
    {};
  const resolvedPrice = resolveCustomerDisplayPrice({
    ...fullProduct,
    ...selectedVariant,
    product: fullProduct,
    variant: selectedVariant,
    selected_variant: selectedVariant,
  });
  const sellingPrice = money(selectedVariant.selling_price || selectedVariant.price || fullProduct.selling_price || fullProduct.price || fullProduct.regular_price || card.selling_price || card.price);
  const salePrice = money(selectedVariant.sale_price || fullProduct.sale_price || card.sale_price);
  const saleModeValues = [
    selectedVariant.sale_price_enabled,
    selectedVariant.sale_prices_enabled,
    selectedVariant.global_sale_enabled,
    selectedVariant.sale_mode_enabled,
    selectedVariant.sale_active,
    selectedVariant.is_sale_active,
    selectedVariant.on_sale,
    fullProduct.sale_price_enabled,
    fullProduct.sale_prices_enabled,
    fullProduct.global_sale_enabled,
    fullProduct.sale_mode_enabled,
    fullProduct.sale_active,
    fullProduct.is_sale_active,
    fullProduct.on_sale,
  ];
  const hasSaleModeMetadata = saleModeValues.some((value) => value !== undefined && value !== null && text(value) !== "");
  const hasSaleModeFlag = saleModeValues.some(truthyFlag);
  const normalizerSelectedSale = String(card.price_source || "").includes("sale_price") || card.sale_active === true;
  const saleIsCustomerFacing = salePrice > 0 && (normalizerSelectedSale || !hasSaleModeMetadata || hasSaleModeFlag);
  const displayPrice = saleIsCustomerFacing ? salePrice : (resolvedPrice.display_price || sellingPrice || card.price || 0);
  const priceSource = saleIsCustomerFacing ? "sale_price" : (resolvedPrice.price_source || "selling_price");
  const imageUrl = resolvePublicProductImageUrl(card.image_url || card.image || selectedVariant.secure_url || selectedVariant.color_image_url || selectedVariant.image_url || fullProduct.secure_url || fullProduct.image_url || "");
  const productUrl = resolvePublicProductUrl(fullProduct);
  return {
    ...card,
    image_url: imageUrl || card.image_url || "",
    image: imageUrl || card.image || "",
    price: displayPrice,
    final_price: displayPrice,
    display_price: displayPrice,
    old_price: saleIsCustomerFacing && sellingPrice > displayPrice ? sellingPrice : (resolvedPrice.old_price || card.old_price || null),
    price_source: priceSource,
    sale_active: saleIsCustomerFacing,
    sale_price: salePrice || resolvedPrice.sale_price || card.sale_price || 0,
    selling_price: sellingPrice || resolvedPrice.selling_price || card.selling_price || 0,
    product_url: productUrl || card.product_url || card.url || "",
    url: productUrl || card.url || card.product_url || "",
  };
};

const buildPresentationProductCards = async ({ tenantId = null, selectedProducts = [], explicitModel = null, forceColorPresentation = false } = {}) => {
  if (!selectedProducts.length) return [];
  if (!explicitModel && !forceColorPresentation) return normalizeProductCards(selectedProducts, { limit: 6 });
  const fullProducts = await Promise.all(
    selectedProducts.slice(0, 12).map(async (product) => {
      const fullProduct = await loadFullProductForPresentation({ tenantId, productId: product.id || product.product_id });
      return { ...(fullProduct || product), card_reply_mode: "color_only" };
    })
  );
  const cards = normalizeProductCards(fullProducts, { limit: 24 });
  const sourceById = new Map(fullProducts.map((product) => [String(product.id || product.product_id || ""), product]));
  const pricedCards = cards.map((card) => withActiveDisplayPrice(card, sourceById.get(String(card.product_id || card.id || "")) || fullProducts[0] || {}));
  console.info("AI_BRAIN_V2_COLOR_PRESENTATION", {
    tenant_id: tenantId || null,
    model: explicitModel?.model || (forceColorPresentation ? "active_product" : ""),
    product_ids: fullProducts.map((product) => product.id || product.product_id || null).filter(Boolean),
    variant_count: fullProducts.reduce((total, product) => total + asArray(product.variants).length, 0),
    color_card_count: pricedCards.length,
    colors: pricedCards.map((card) => card.color || ""),
    product_urls_missing: pricedCards.filter((card) => !text(card.product_url || card.url)).length,
    images_missing: pricedCards.filter((card) => !text(card.image_url || card.image)).length,
  });
  return pricedCards;
};

const activeProductFromMemory = (memory = {}) => {
  const preferences = memory?.preferences || {};
  return text(
    preferences.active_product_id ||
    preferences.selected_product_id ||
    preferences.last_product_id ||
    preferences.aiConversationMemoryV2?.lastMentionedProductId ||
    memory.activeProductId ||
    memory.selectedProductId ||
    memory.last_product_id ||
    memory.aiConversationMemoryV2?.lastMentionedProductId ||
    ""
  );
};

const presentationModelName = ({ explicitModel = null, cards = [] } = {}) => {
  if (explicitModel?.model === "jordan4") return "جوردن 4";
  const firstCard = cards[0] || {};
  const rawName = text(firstCard.base_name || firstCard.product_name || firstCard.name || firstCard.title);
  return rawName.replace(/\s+-\s+.*$/, "") || "الموديل";
};

const buildBaseText = ({ intent = "", cards = [], explicitModel = null, activeProductId = "" } = {}) => {
  if (intent === "greeting") return "\u0648\u0639\u0644\u064a\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645 \u0648\u0631\u062d\u0645\u0629 \u0627\u0644\u0644\u0647\u060c \u0623\u0647\u0644\u0627\u064b \u0628\u064a\u0643 \u064a\u0627 \u0641\u0646\u062f\u0645.";
  if (intent === "price_objection") {
    return activeProductId
      ? "\u0641\u0627\u0647\u0645\u0643. \u0644\u0648 \u0627\u0644\u0633\u0639\u0631 \u0645\u0634 \u0645\u0646\u0627\u0633\u0628 \u0623\u0642\u062f\u0631 \u0623\u0637\u0644\u0639\u0644\u0643 \u0628\u062f\u064a\u0644 \u0623\u0642\u0631\u0628 \u0644\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629."
      : "\u0641\u0627\u0647\u0645\u0643. \u0627\u0628\u0639\u062a \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0627\u0644\u0644\u064a \u0639\u0627\u064a\u0632\u0647 \u0648\u0623\u0634\u0648\u0641\u0644\u0643 \u0628\u062f\u064a\u0644 \u0623\u0631\u062e\u0635.";
  }
  if (cards.length) return (explicitModel || intent === "more_images")
    ? `أكيد يا فندم \n${presentationModelName({ explicitModel, cards })} متوفرة بالألوان دي:\n\nفيه لون عجبك أحجزهولك؟`
    : "\u062f\u064a \u0623\u0642\u0631\u0628 \u0627\u0644\u0646\u062a\u0627\u064a\u062c \u0627\u0644\u0645\u062a\u0627\u062d\u0629:";
  if (["product_search", "more_images"].includes(intent)) return "\u0645\u0634 \u0644\u0627\u0642\u064a \u0645\u0637\u0627\u0628\u0642\u0629 \u0648\u0627\u0636\u062d\u0629. \u0627\u0628\u0639\u062a \u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0623\u0648 \u0635\u0648\u0631\u0629 \u0623\u0648\u0636\u062d.";
  return "\u062a\u062d\u062a \u0623\u0645\u0631\u0643. \u0627\u0628\u0639\u062a \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0623\u0648 \u0627\u0644\u0633\u0624\u0627\u0644 \u0627\u0644\u0644\u064a \u0645\u062d\u062a\u0627\u062c\u0647.";
};

export const generateAiBrainV2Decision = async (normalizedInbound = {}, options = {}) => {
  const channel = normalizeChannel(normalizedInbound.channel || normalizedInbound.metadata?.channel || AI_AGENT_CHANNELS.WEB_CHAT);
  const originalMessage = text(
    normalizedInbound.original_message ||
      normalizedInbound.metadata?.original_message ||
      normalizedInbound.message_text ||
      normalizedInbound.message ||
      normalizedInbound.body ||
      normalizedInbound.text
  );
  const intentPayload = normalizeArabicIntentPayload(
    normalizedInbound.normalized_for_intent ||
      normalizedInbound.metadata?.normalized_for_intent ||
      normalizedInbound.text ||
      originalMessage
  );
  const message = text(intentPayload.normalizedForIntent || normalizeArabicForIntent(originalMessage));
  const productAlias = resolveProductAlias(originalMessage || message);
  const tenantId = options.tenantId || normalizedInbound.metadata?.tenant_id || normalizedInbound.metadata?.tenantId || 1;
  const memory = options.memory || normalizedInbound.metadata?.ai_memory || {};
  const memoryActiveProductId = activeProductFromMemory(memory);
  const memoryV2 = memory?.preferences?.aiConversationMemoryV2 || memory?.aiConversationMemoryV2 || null;
  const explicitModel = detectExplicitModel(message);
  traceAltFollowup("generateAiBrainV2Decision:memory", {
    message: originalMessage,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: intentPayload.normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
    memory_keys: Object.keys(memory || {}).sort(),
    memory_v2_keys: Object.keys(memoryV2 || {}).sort(),
    last_product_cards_present: asArray(memory?.last_product_cards).length > 0,
    lastShownProductCards_present: asArray(memory?.lastShownProductCards).length > 0,
    hasUsefulProductContext:
      Boolean(
        text(memory?.lastMentionedProductId || "") ||
        text(memory?.lastMentionedCanonicalProduct || "") ||
        asArray(memory?.lastShownProductCards).length ||
        asArray(memory?.last_product_cards).length ||
        asArray(memory?.lastProductCards).length ||
        asArray(memory?.preferences?.last_product_cards).length ||
        asArray(memory?.preferences?.lastProductCards).length ||
        asArray(memory?.preferences?.aiConversationMemoryV2?.lastShownProductCards).length ||
        asArray(memory?.aiConversationMemoryV2?.lastShownProductCards).length
      ),
  });
  const followupContextV2 = resolveFollowupContext({
    memory: memoryV2 || memory,
    messageText: originalMessage,
    normalizedPayload: intentPayload,
    intentPayload,
  });
  traceAltFollowup("generateAiBrainV2Decision:followupContext", {
    message: originalMessage,
    followup_context: followupContextV2,
    followup_type: followupContextV2?.type || "none",
  });
  const memoryForTurn = followupContextV2.type !== "none"
    ? {
        ...memory,
        preferences: {
          ...(memory?.preferences || {}),
          aiConversationMemoryV2: mergeConversationMemoryV2(
            memoryV2,
            buildConversationMemoryV2({
              existingMemory: memoryV2,
              messageText: originalMessage,
              normalizedPayload: intentPayload,
              intentPayload,
              aliasResult: productAlias,
              searchHints: buildAliasAwareSearchHints({ text: originalMessage || message, aliasResult: productAlias }),
              shownProducts: memoryCardsFromContext(memory),
              selectedProduct: memoryCardsFromContext(memory)[0] || null,
              selectedColor: followupContextV2.color || "",
              selectedSize: followupContextV2.size || "",
            })
          ),
        },
      }
      : memory;
  traceAltFollowup("classifyIntent:input", {
    message: originalMessage,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: intentPayload.normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
    product_query: text(normalizedInbound.product_query || normalizedInbound.productQuery || normalizedInbound.metadata?.product_query || normalizedInbound.metadata?.productQuery || options.productQuery || ""),
    product_cards_count: asArray(normalizedInbound.product_cards || normalizedInbound.productCards || options.productCards || []).length,
    attachments_count: asArray(normalizedInbound.attachments).length,
    explicit_model: explicitModel?.model || "",
  });
  const intent = classifyIntent({
    message,
    attachments: normalizedInbound.attachments,
    explicitModel,
    canonicalSignals: intentPayload.canonicalSignals,
    productQuery: normalizedInbound.product_query || normalizedInbound.productQuery || normalizedInbound.metadata?.product_query || normalizedInbound.metadata?.productQuery || options.productQuery || "",
    productCards: normalizedInbound.product_cards || normalizedInbound.productCards || options.productCards || [],
  });
  traceAltFollowup("classifyIntent:output", {
    message: originalMessage,
    intent,
  });
  const activeSize = text(memory?.activeSize || memory?.selectedSize || memory?.preferences?.activeSize || memory?.preferences?.selectedSize || "");
  const activeColor = text(memory?.activeColor || memory?.selectedColor || memory?.preferences?.activeColor || memory?.preferences?.selectedColor || "");
  console.log("[arabic-intent-signals]", {
    channel,
    original: originalMessage,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: intentPayload.normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[product-alias]", {
    channel,
    original: originalMessage,
    normalizedText: intentPayload.normalizedText,
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    confidence: productAlias.confidence,
  });
  console.log("[conversation-memory-v2]", {
    conversationId: text(normalizedInbound.externalConversationId || normalizedInbound.external_conversation_id || normalizedInbound.metadata?.session_id || ""),
    channel,
    original: originalMessage,
    normalizedText: intentPayload.normalizedText,
    memoryBeforeSummary: summarizeConversationMemoryV2(memoryV2),
    followupType: followupContextV2.type || "none",
    resolvedProductId: followupContextV2.productId || null,
    resolvedColor: followupContextV2.color || "",
    resolvedSize: followupContextV2.size || "",
    memoryUpdated: Boolean(followupContextV2.type && followupContextV2.type !== "none"),
  });
  console.info("AI_V2_FSM_ENTRY", {
    intent,
    message,
    originalMessage,
    activeProductId: memoryActiveProductId || "",
    activeSize,
    activeColor,
  });
  const followupDecision = buildFollowupDecisionFromMemoryV2({ message: originalMessage, memory: memoryForTurn, followupContext: followupContextV2 });
  if (followupDecision) {
    console.info("AI_BRAIN_V2_DECISION", {
      channel,
      conversation_id: text(normalizedInbound.externalConversationId || normalizedInbound.external_conversation_id || normalizedInbound.metadata?.session_id || ""),
      text_preview: message.slice(0, 160),
      intent: followupDecision.intent || "",
      explicit_model: explicitModel?.model || "",
      products_count: asArray(followupDecision.products).length,
      product_cards_count: asArray(followupDecision.product_cards).length,
      top_product_id: followupDecision.active_product_id || "",
      legacy_called: false,
      product_cards_preview: asArray(followupDecision.product_cards).slice(0, 6).map((card) => ({
        product_id: text(card?.product_id || card?.id || ""),
        variant_id: text(card?.variant_id || card?.selected_variant_id || card?.matched_variant_id || ""),
        color: text(card?.color || card?.matched_variant_color || ""),
        image_url: text(card?.image_url || card?.image || card?.main_image || ""),
        title: text(card?.title || card?.name || ""),
      })),
    });
    return followupDecision;
  }
  const postProductFsmDecision = buildPostProductFsmDecision({ message, memory: memoryForTurn, intent });
  if (postProductFsmDecision) {
    console.info("AI_BRAIN_V2_DECISION", {
      channel,
      conversation_id: text(normalizedInbound.externalConversationId || normalizedInbound.external_conversation_id || normalizedInbound.metadata?.session_id || ""),
      text_preview: message.slice(0, 160),
      intent: postProductFsmDecision.intent,
      explicit_model: explicitModel?.model || "",
      products_count: asArray(postProductFsmDecision.products).length,
      product_cards_count: asArray(postProductFsmDecision.product_cards).length,
      top_product_id: postProductFsmDecision.active_product_id || "",
      legacy_called: false,
      product_cards_preview: asArray(postProductFsmDecision.product_cards).slice(0, 6).map((card) => ({
        product_id: text(card?.product_id || card?.id || ""),
        variant_id: text(card?.variant_id || card?.selected_variant_id || card?.matched_variant_id || ""),
        color: text(card?.color || card?.matched_variant_color || ""),
        image_url: text(card?.image_url || card?.image || card?.main_image || ""),
        title: text(card?.title || card?.name || ""),
      })),
    });
    return postProductFsmDecision;
  }
  const shouldSearch = ["product_search", "more_images", "visual_search"].includes(intent) || Boolean(explicitModel);
  const candidates = shouldSearch ? await loadCandidateProducts({ tenantId, message, explicitModel }) : [];
  const normalizedPayload = normalizeArabicIntentPayload(message);
  const aliasResult = resolveProductAlias(message);
  const searchHints = buildAliasAwareSearchHints({ text: message, aliasResult });
  const ranked = rankProducts({ products: candidates, message, explicitModel, aliasResult, searchHints, intentPayload: normalizedPayload });
  const selectedProducts = ranked.filter((product) => Number(product.ai_brain_v2_score || 0) > 0).slice(0, 6);
  const presentationProducts = selectedProducts.length
    ? selectedProducts
    : (intent === "more_images" && memoryActiveProductId ? [{ id: memoryActiveProductId, product_id: memoryActiveProductId }] : []);
  const productCards = await buildPresentationProductCards({
    tenantId,
    selectedProducts: presentationProducts,
    explicitModel,
    forceColorPresentation: intent === "more_images",
  });
  const images = productCards
    .map((card) => ({
      id: text(card.image_id || card.image_url || card.product_id || card.id),
      url: text(card.image_url || card.url || card.image),
      image_url: text(card.image_url || card.url || card.image),
      product_id: text(card.product_id || card.id),
    }))
    .filter((image) => image.url);
  const activeProductId = text(productCards[0]?.product_id || productCards[0]?.id || activeProductFromMemory(memory));
  const responseText = buildBaseText({ intent, cards: productCards, explicitModel, activeProductId });
  const memoryUpdates = {
    ...(activeProductId ? {
      active_product_id: activeProductId,
      selected_product_id: activeProductId,
      last_product_id: activeProductId,
      last_product_cards: productCards,
    } : {}),
    last_intent: intent,
    ai_brain_version: "v2",
  };
  const actions = productCards.length ? ["view_product", "choose_size", "contact_support"] : ["contact_support"];
  const output = {
    text: responseText,
    answer: responseText,
    intent,
    detected_intent: intent,
    products: selectedProducts,
    suggested_products: productCards,
    product_cards: productCards,
    images,
    image_cards: images,
    quickReplies: [],
    quick_replies: [],
    actions,
    suggested_actions: actions,
    memoryUpdates,
    memory_updates: memoryUpdates,
    ai_memory_patch: { preferences: memoryUpdates },
    handoff: { needs_human_support: false, reason: "", conversation_status: "" },
    active_product_id: activeProductId,
    channel_reply: normalizeOutgoingChannelReply({ channel, response: { text: responseText, product_cards: productCards, image_cards: images, suggested_actions: actions } }),
    debug: {
      source: "aiBrainV2",
      engine: "ai_brain_v2",
      legacy_called: false,
      product_alias: {
        detected: Boolean(productAlias.canonicalProduct),
        canonicalProduct: productAlias.canonicalProduct,
        matchedAlias: productAlias.matchedAlias,
        confidence: productAlias.confidence,
      },
      explicit_model: explicitModel,
      ranked_candidates: ranked.slice(0, 20).map((product, index) => ({
        rank: index + 1,
        id: product.id,
        name: product.name || product.title || product.product_name || "",
        score: product.ai_brain_v2_score,
        reasons: product.ai_brain_v2_reasons,
      })),
    },
  };
  console.info("AI_BRAIN_V2_DECISION", {
    channel,
    conversation_id: text(normalizedInbound.externalConversationId || normalizedInbound.external_conversation_id || normalizedInbound.metadata?.session_id || ""),
    text_preview: message.slice(0, 160),
    intent,
    explicit_model: explicitModel?.model || "",
    products_count: selectedProducts.length,
    product_cards_count: productCards.length,
    top_product_id: productCards[0]?.product_id || productCards[0]?.id || "",
    legacy_called: false,
    product_cards_preview: asArray(productCards).slice(0, 6).map((card) => ({
      product_id: text(card?.product_id || card?.id || ""),
      variant_id: text(card?.variant_id || card?.selected_variant_id || card?.matched_variant_id || ""),
      color: text(card?.color || card?.matched_variant_color || ""),
      image_url: text(card?.image_url || card?.image || card?.main_image || ""),
      title: text(card?.title || card?.name || ""),
    })),
  });
  return output;
};

export default {
  generateAiBrainV2Decision,
};
