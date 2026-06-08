import { AI_AGENT_CHANNELS, normalizeChannel } from "./aiChannelAdapterService.js";
import { generateAiBrainV2Decision } from "./aiBrainV2Service.js";
import { generateUnifiedAiReply } from "./aiConversationOrchestrator.js";
import { normalizeProductCards } from "./aiProductCards.js";
import { resolveCustomerDisplayPrice } from "../utils/customerDisplayPrice.js";
import { normalizeArabicForIntent, normalizeArabicIntentPayload, normalizeArabicMessage } from "../utils/arabicTextNormalizer.js";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";
import { rankProductCandidates } from "../utils/productMatchConfidence.js";
import {
  buildConversationMemoryV2,
  mergeConversationMemoryV2,
  resolveFollowupContext,
  summarizeConversationMemoryV2,
} from "../utils/aiConversationMemoryV2.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const normalizeImage = (item = {}) => ({
  ...item,
  id: text(item.id || item.image_id || item.product_id || item.url || item.image_url || item.image || ""),
  url: text(item.url || item.image_url || item.image || item.main_image || item.resolved_image_url || ""),
  product_id: text(item.product_id || item.product?.id || item.product?.product_id || item.id || ""),
});

const normalizeAction = (item = {}) => (
  item && typeof item === "object"
    ? item
    : { label: text(item), value: text(item) }
);

const normalizeArabic = (value = "") => normalizeArabicForIntent(value).replace(/[\u061f?]/g, "").trim();

const classifySharedShortcutIntent = (message = "") => {
  const raw = text(message);
  const intentPayload = normalizeArabicIntentPayload(raw);
  const normalized = intentPayload.normalizedForIntent;
  const signals = new Set(intentPayload.canonicalSignals || []);
  const hasSignal = (...names) => names.some((name) => signals.has(name));
  console.log("[arabic-intent-signals]", {
    original: intentPayload.originalText,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: normalized,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  if (hasSignal("yes", "confirm")) return "bare_confirmation";
  if (hasSignal("more_images")) return "more_images";
  if (hasSignal("color")) return "color_followup";
  if (hasSignal("size")) return "size_followup";
  if (hasSignal("buy")) return "buying_intent";
  if (hasSignal("price")) return "product_search";
  if (hasSignal("order_tracking")) return "product_search";
  if (hasSignal("thanks")) return "thanks";
  if (hasSignal("greeting")) return "greeting";
  if (hasSignal("no", "reject", "cancel")) return "bare_confirmation";
  if (/(\u0635\u0648\u0631|\u0635\u0648\u0631\u0647|\u0635\u0648\u0631\u0629|\u0627\u0628\u0639\u062a.*\u0635\u0648\u0631|\u0648\u0631\u064a\u0646\u064a|more\s+(photos|images)|photos?|images?)/i.test(raw)) return normalized.includes("\u0627\u0643\u062a\u0631") || /more\s+(photos|images)/i.test(raw) ? "more_images" : "image_request";
  if (/(\u0644\u0648\u0646|\u0627\u0644\u0648\u0627\u0646|\u0623\u0644\u0648\u0627\u0646|color|colors|colour|colours)/i.test(raw)) return "color_followup";
  if (/(\u0645\u0642\u0627\u0633|\u0645\u0642\u0627\u0633\u0627\u062a|size|sizes|available|availability)/i.test(raw)) return "size_followup";
  if (/(\u0639\u0627\u064a\u0632\s*[\u0627\u0623]?\u0634\u062a\u0631\u064a|[\u0627\u0623]?\u0634\u062a\u0631\u064a|buy|order|\u0627\u062d\u062c\u0632|\u062d\u062c\u0632)/i.test(raw)) return "buying_intent";
  if (/(\u0628\u0643\u0627\u0645|\u0643\u0627\u0645|\u0627\u0644\u0633\u0639\u0631|\u0633\u0639\u0631|price|\u0645\u062a\u0627\u062d|\u0645\u0648\u062c\u0648\u062f|available|in stock|\u062c\u0648\u0631\u062f\u0646|jordan|aj4|j4)/i.test(raw)) return "product_search";
  return "";
};

const hasClearProductModelRequest = (message = "") => {
  const normalized = normalizeArabic(message);
  return /(\u062c\u0648\u0631\u062f\u0646\s*(?:4|\u0664|\u06f4|\u0641\u0648\u0631)|jordan\s*4|jordan4|aj4|j4)/i.test(normalized);
};

const hasJordan4TraceTrigger = (message = "") => hasClearProductModelRequest(message);
const hasPriceObjectionTraceTrigger = (message = "") => /(\u063a\u0627\u0644\u064a|\u063a\u0627\u0644\u064a\u0647|expensive|price\s+high)/i.test(normalizeArabic(message));

const normalizeSizeToken = (value = "") =>
  text(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, "")
    .trim();

const extractRequestedSize = (message = "") => {
  const raw = text(message);
  const normalized = normalizeArabic(raw);
  const match =
    raw.match(/(?:\u0645\u0642\u0627\u0633|size|sizes?)\s*([0-9\u0660-\u0669\u06f0-\u06f9]{1,3})/i) ||
    normalized.match(/(?:\u0645\u0642\u0627\u0633|size|sizes?)\s*([0-9]{1,3})/i) ||
    raw.match(/\b([0-9\u0660-\u0669\u06f0-\u06f9]{2,3})\b/);
  return normalizeSizeToken(match?.[1] || "");
};

const memoryCardsFromContext = (memory = {}) => normalizeProductCards(
  [
    ...asArray(memory?.last_product_cards),
    ...asArray(memory?.lastProductCards),
    ...asArray(memory?.preferences?.last_product_cards),
    ...asArray(memory?.preferences?.lastProductCards),
  ],
  { limit: 24 }
);

const activeProductIdFromMemory = (memory = {}) =>
  text(
    memory?.active_product_id ||
      memory?.activeProductId ||
      memory?.selected_product_id ||
      memory?.selectedProductId ||
      memory?.last_product_id ||
      memory?.lastProductId ||
      memory?.selected_product?.product_id ||
      memory?.selected_product?.id ||
      memory?.selectedProduct?.product_id ||
      memory?.selectedProduct?.id ||
      memory?.preferences?.active_product_id ||
      memory?.preferences?.activeProductId ||
      memory?.preferences?.selected_product_id ||
      memory?.preferences?.selectedProductId ||
      memory?.preferences?.last_product_id ||
      memory?.preferences?.lastProductId ||
      ""
  );

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

const normalizeColorComparable = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[&+\/\\|]/g, " ")
    .replace(/\b(and|with)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const colorSelectionAliasGroups = [
  ["black red", ["black red", "black and red", "black & red", "\u0627\u0633\u0648\u062f \u0648\u0627\u062d\u0645\u0631", "\u0623\u0633\u0648\u062f \u0648\u0623\u062d\u0645\u0631", "\u0627\u0644\u0627\u0633\u0648\u062f \u0648\u0627\u0644\u0627\u062d\u0645\u0631", "\u0627\u0644\u0623\u0633\u0648\u062f \u0648\u0627\u0644\u0623\u062d\u0645\u0631", "\u0627\u0644\u0627\u0633\u0648\u062f \u0648\u0627\u062d\u0645\u0631", "\u0627\u0644\u0623\u0633\u0648\u062f \u0648\u0627\u062d\u0645\u0631"]],
  ["burgundy", ["burgundy", "burdgundy", "bordeaux", "bourdeaux", "\u0628\u0631\u062c\u0646\u062f\u064a", "\u0628\u0631\u062c\u0627\u0646\u062f\u064a", "\u0628\u0631\u063a\u0646\u062f\u064a", "\u0628\u0631\u062c\u0627\u0646\u062f\u0649", "\u0627\u0644\u0628\u0631\u062c\u0646\u062f\u064a", "\u0627\u0644\u0628\u0631\u062c\u0627\u0646\u062f\u064a", "\u0627\u0644\u0628\u0631\u063a\u0646\u062f\u064a", "\u0628\u0631\u062c\u0627\u0646\u062f\u064a"]],
  ["black", ["black", "blac", "\u0627\u0633\u0648\u062f", "\u0623\u0633\u0648\u062f", "\u0627\u0644\u0627\u0633\u0648\u062f", "\u0627\u0644\u0623\u0633\u0648\u062f", "\u0628\u0644\u0627\u0643"]],
  ["white", ["white", "whtie", "\u0627\u0628\u064a\u0636", "\u0623\u0628\u064a\u0636", "\u0627\u0644\u0627\u0628\u064a\u0636", "\u0627\u0644\u0623\u0628\u064a\u0636", "\u0648\u0627\u064a\u062a"]],
  ["grey", ["grey", "gray", "\u062c\u0631\u0627\u064a", "\u0631\u0645\u0627\u062f\u064a", "\u0631\u0635\u0627\u0635\u064a"]],
  ["navy", ["navy", "\u0643\u062d\u0644\u064a", "\u0643\u062d\u0644\u0649"]],
  ["blue", ["blue", "azraq", "\u0627\u0632\u0631\u0642", "\u0623\u0632\u0631\u0642", "\u0627\u0644\u0627\u0632\u0631\u0642", "\u0627\u0644\u0623\u0632\u0631\u0642"]],
  ["red", ["red", "\u0627\u062d\u0645\u0631", "\u0623\u062d\u0645\u0631", "\u0627\u0644\u0627\u062d\u0645\u0631", "\u0627\u0644\u0623\u062d\u0645\u0631", "\u0631\u064a\u062f"]],
  ["green", ["green", "\u0627\u062e\u0636\u0631", "\u0623\u062e\u0636\u0631", "\u0627\u0644\u0627\u062e\u0636\u0631", "\u0627\u0644\u0623\u062e\u0636\u0631"]],
  ["beige", ["beige", "\u0628\u064a\u062c"]],
  ["brown", ["brown", "\u0628\u0646\u064a"]],
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

const prettyModelName = (value = "") => {
  const name = text(value);
  if (/jordan\s*4|jordan4|aj4|j4/i.test(name) || /\u062c\u0648\u0631\u062f\u0646\s*4|\u062c\u0648\u0631\u062f\u0646\s*\u0641\u0648\u0631/i.test(name)) return "جوردن 4";
  return name;
};

const buildDirectColorSelectionDecision = ({ message = "", memory = {} } = {}) => {
  const requestedColorKey = detectSelectedColorKey(message);
  const rememberedCards = memoryCardsFromContext(memory);
  const activeProductId = activeProductIdFromMemory(memory);
  if (!requestedColorKey || !rememberedCards.length || !activeProductId) return null;

  const requestedSize = normalizeSizeToken(
    extractRequestedSize(message) ||
      memory?.activeSize ||
      memory?.selectedSize ||
      memory?.preferences?.activeSize ||
      memory?.preferences?.selectedSize ||
      ""
  );
  if (!requestedSize) return null;

  const sizeMatchedCards = rememberedCards.filter((card) => cardHasRequestedSize(card, requestedSize));
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
  const priceInfo = resolveCustomerDisplayPrice(selectedCard);
  const displayPrice = Number(priceInfo?.display_price || priceInfo?.selected_display_price || priceInfo?.price || 0);
  const selectedColor = text(selectedCard?.color || selectedCard?.matched_variant_color || selectedCard?.name || selectedCard?.title || "");
  const topProductId = text(selectedCard?.product_id || selectedCard?.id || activeProductId || "");
  const topVariantId = text(selectedCard?.variant_id || selectedCard?.selected_variant_id || selectedCard?.variant?.id || "");
  const sizeLabel = requestedSize;
  const replyText = [
    "تمام",
    "",
    modelName,
    `اللون: ${selectedColor}`,
    `المقاس: ${sizeLabel}`,
    "",
    `السعر: ${displayPrice > 0 ? `${displayPrice} جنيه` : "متاح عند الطلب"}`,
    "",
    "تحب أحجزهولك؟",
  ].join("\n");
  const normalizedCards = normalizeProductCards([selectedCard], { limit: 1 });
  const images = normalizedCards
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
    activeSize: sizeLabel,
    selectedSize: sizeLabel,
    active_size: sizeLabel,
    selected_size: sizeLabel,
    buyingStage: "color_selected",
    checkoutStage: "color_selected",
    nextRecommendedStage: "order_confirmation",
    selectionStage: "color_selected",
    resolvedQuestionType: "POST_PRODUCT_COLOR_SELECTED",
    replyDecisionReason: "v2_post_product_color_selected_direct_match",
    last_intent: "post_product_color_selected",
    ai_brain_version: "v2",
    last_product_cards: rememberedCards,
    lastProductCards: rememberedCards,
  };
  return {
    text: replyText,
    answer: replyText,
    intent: "post_product_color_selected",
    detected_intent: "post_product_color_selected",
    products: normalizedCards,
    suggested_products: normalizedCards,
    product_cards: normalizedCards,
    images,
    image_cards: images,
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
    active_size: sizeLabel,
    next_best_action: "confirm_order",
    reply_goal: "confirm_selected_variant",
    sales_stage: "COLOR_SELECTION",
    nextRecommendedStage: "order_confirmation",
    replyDecisionReason: "v2_post_product_color_selected_direct_match",
    debug: {
      source: "aiUnifiedDecisionService",
      engine: "ai_brain_v2",
      legacy_called: false,
      reason: "v2_post_product_color_selected_direct_match",
      requested_color: requestedColorKey,
      requested_size: sizeLabel,
      selected_variant_id: topVariantId,
      selected_product_id: topProductId,
      direct_color_selection_match: true,
    },
  };
};

const staleFollowupKeys = [
  "awaiting_alternative_choice",
  "awaitingAlternativeChoice",
  "awaiting_confirmation",
  "awaitingConfirmation",
  "awaiting_model_selection",
  "awaitingModelSelection",
  "pending_product_search_context",
  "pendingProductSearchContext",
  "awaiting_customer_action",
  "awaitingCustomerAction",
];

const staleProductContextKeys = [
  "last_product_cards",
  "lastProductCards",
  "last_product",
  "lastProduct",
  "lastProductCard",
  "last_product_id",
  "last_product_name",
  "selected_product",
  "selectedProduct",
  "selected_product_context",
  "selectedProductContext",
  "selected_product_id",
  "selectedProductId",
  "selected_color",
  "selectedColor",
  "selected_size",
  "selectedSize",
  "active_product_id",
  "activeProductId",
  "active_variant_id",
  "activeVariantId",
  "active_color",
  "activeColor",
  "active_size",
  "activeSize",
  "alternative_flow",
  "last_shown_image_cards",
  "lastRecommendedProductIds",
  "lastVisualQuery",
  "lastVisualFeatures",
  "lastVisualMatches",
  "rejectedVisualMatches",
  "rejectedProductIds",
  "rejectedModelNames",
  "currentRequestedModel",
  "currentRequestedModelName",
  "pendingAlternativeForModel",
  "pendingAlternativeCategory",
  "pendingAlternativeSourceMessage",
  "pendingAlternativeBrand",
  "pendingAlternativePrice",
];

const clearKeys = (source = {}, keys = []) => {
  if (!source || typeof source !== "object") return source;
  const next = { ...source };
  for (const key of keys) {
    if (key in next) delete next[key];
  }
  return next;
};

const sanitizeMemoryForClearProductRequest = (memory = null, inbound = {}) => {
  if (!memory || typeof memory !== "object" || !hasClearProductModelRequest(inbound.text)) return memory;
  const preferences = memory.preferences && typeof memory.preferences === "object" ? memory.preferences : {};
  const sanitizedRoot = clearKeys(memory, [...staleFollowupKeys, ...staleProductContextKeys]);
  const sanitizedPreferences = clearKeys(preferences, [
    ...staleFollowupKeys,
    ...staleProductContextKeys,
    "last_clarification_type",
    "last_clarification_expected_values",
    "last_ai_question",
    "last_bot_message",
  ]);
  return {
    ...sanitizedRoot,
    preferences: sanitizedPreferences,
  };
};

const summarizeMemoryForLog = (memory = null) => {
  const preferences = memory?.preferences || {};
  const read = (...keys) => {
    for (const key of keys) {
      const value = preferences?.[key] ?? memory?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  };
  const lastCards = read("last_product_cards", "lastProductCards");
  const selectedProduct = read("selected_product", "selectedProduct", "selected_product_context", "selectedProductContext", "last_product", "lastProduct", "lastProductCard");
  const selectedProductIds = [
    read("selected_product_ids", "selectedProductIds"),
    read("selected_product_id", "selectedProductId"),
    read("active_product_id", "activeProductId"),
    read("last_product_id"),
    selectedProduct?.product_id,
    selectedProduct?.id,
  ].flatMap((value) => (Array.isArray(value) ? value : [value])).map(text).filter(Boolean);
  return {
    previousIntent: text(preferences.last_intent || preferences.lastIntent || memory?.last_intent || ""),
    pending_product_search_context: read("pending_product_search_context", "pendingProductSearchContext") || null,
    pendingProductSearchContext: read("pending_product_search_context", "pendingProductSearchContext") || null,
    hasPendingClassification: Boolean(read("pending_product_search_context", "pendingProductSearchContext")),
    last_product_cards: Array.isArray(lastCards) ? lastCards.slice(0, 5) : [],
    lastProductCardsCount: Array.isArray(lastCards) ? lastCards.length : 0,
    selected_product: selectedProduct || null,
    selectedProductId: text(read("selected_product_id", "selectedProductId", "last_product_id") || selectedProduct?.product_id || selectedProduct?.id || ""),
    selected_product_ids: [...new Set(selectedProductIds)].slice(0, 12),
    activeProductId: text(read("active_product_id", "activeProductId", "selected_product_id", "selectedProductId", "last_product_id") || selectedProduct?.product_id || selectedProduct?.id || ""),
    last_product_id: text(read("last_product_id") || ""),
    selected_color: text(read("selected_color", "selectedColor", "active_color", "activeColor")),
    selected_size: text(read("selected_size", "selectedSize", "active_size", "activeSize")),
    awaiting_alternative_choice: Boolean(read("awaiting_alternative_choice", "awaitingAlternativeChoice")),
    awaiting_confirmation: Boolean(read("awaiting_confirmation", "awaitingConfirmation")),
    awaiting_model_selection: Boolean(read("awaiting_model_selection", "awaitingModelSelection")),
    awaitingCustomerAction: text(read("awaiting_customer_action", "awaitingCustomerAction")),
    last_intent: text(read("last_intent", "lastIntent")),
    memory_keys: memory && typeof memory === "object" ? Object.keys(memory).sort() : [],
    preference_keys: preferences && typeof preferences === "object" ? Object.keys(preferences).sort() : [],
  };
};

const productIds = (items = []) => asArray(items)
  .map((item) => text(item?.id || item?.product_id || item?.product?.id || ""))
  .filter(Boolean)
  .slice(0, 8);

const actionNames = (items = []) => asArray(items)
  .map((item) => text(item?.action || item?.type || item?.value || item?.label || item))
  .filter(Boolean)
  .slice(0, 8);

const applySharedShortcutMetadata = ({ decision = {}, inbound = {} } = {}) => {
  const shortcutIntent = classifySharedShortcutIntent(inbound.text || inbound.normalized_for_intent || inbound.originalText || "");
  if (!shortcutIntent) return decision;
  const debug = {
    ...(decision.debug || {}),
    shared_shortcut_handler: shortcutIntent,
    shared_shortcut_owner: "aiUnifiedDecisionService",
    clear_product_model_request: hasClearProductModelRequest(inbound.text),
  };
  return {
    ...decision,
    debug,
  };
};

const logProductAliasDetection = ({ channel = "", original = "", normalizedText = "" } = {}) => {
  const alias = resolveProductAlias(original || normalizedText || "");
  console.log("[product-alias]", {
    channel,
    original,
    normalizedText,
    canonicalProduct: alias.canonicalProduct,
    matchedAlias: alias.matchedAlias,
    confidence: alias.confidence,
  });
  return alias;
};

export const normalizeUnifiedInbound = (normalizedInbound = {}) => {
  const metadata = normalizedInbound.metadata && typeof normalizedInbound.metadata === "object"
    ? normalizedInbound.metadata
    : {};
  const originalText = text(
    normalizedInbound.original_message ||
      metadata.original_message ||
      normalizedInbound.message_text ||
      normalizedInbound.message ||
      normalizedInbound.body ||
      normalizedInbound.text
  );
  const normalizedText = text(
    normalizedInbound.normalized_for_intent ||
      metadata.normalized_for_intent ||
      normalizeArabicForIntent(originalText)
  );
  const channel = normalizeChannel(
    normalizedInbound.channel ||
      metadata.channel ||
      AI_AGENT_CHANNELS.WEB_CHAT
  );
  const externalConversationId = text(
    normalizedInbound.externalConversationId ||
      normalizedInbound.external_conversation_id ||
      metadata.externalConversationId ||
      metadata.external_conversation_id ||
      metadata.session_id ||
      normalizedInbound.sessionId ||
      normalizedInbound.session_id
  );
  const externalCustomerId = text(
    normalizedInbound.externalCustomerId ||
      normalizedInbound.external_customer_id ||
      metadata.externalCustomerId ||
      metadata.external_customer_id ||
      metadata.customer_id ||
      metadata.customer_phone
  );
  const customerName = text(
    normalizedInbound.customerName ||
      normalizedInbound.customer_name ||
      metadata.customerName ||
      metadata.customer_name
  );
  const intentPayload = normalizeArabicIntentPayload(
    originalText ||
      normalizedInbound.normalized_for_intent ||
      metadata.normalized_for_intent ||
      normalizedInbound.text ||
      ""
  );
  const productAlias = logProductAliasDetection({
    channel: normalizeChannel(normalizedInbound.channel || metadata.channel || AI_AGENT_CHANNELS.WEB_CHAT),
    original: originalText,
    normalizedText: intentPayload.normalizedText,
  });
  const aliasSearchHints = buildAliasAwareSearchHints({ text: originalText || intentPayload.normalizedForIntent, aliasResult: productAlias });
  return {
    channel,
    externalConversationId,
    externalCustomerId,
    customerName,
    text: normalizedText || intentPayload.normalizedForIntent,
    originalText,
    normalized_message: text(
      normalizedInbound.normalized_message ||
        metadata.normalized_message ||
        normalizeArabicMessage(originalText)
    ),
    normalized_for_intent: normalizedText || intentPayload.normalizedForIntent,
    canonical_signals: intentPayload.canonicalSignals,
    intent_tokens: intentPayload.intentTokens,
    productAliasDetected: Boolean(productAlias.canonicalProduct),
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    aliasConfidence: productAlias.confidence,
    productQueryHints: aliasSearchHints.productQueryHints,
    aliasSearchTerms: aliasSearchHints.searchTerms,
    attachments: asArray(normalizedInbound.attachments),
    metadata: {
      ...metadata,
      original_message: originalText,
      normalized_message: text(
        normalizedInbound.normalized_message ||
          metadata.normalized_message ||
          normalizeArabicMessage(originalText)
      ),
      normalized_for_intent: normalizedText || intentPayload.normalizedForIntent,
      canonical_signals: intentPayload.canonicalSignals,
      intent_tokens: intentPayload.intentTokens,
      productAliasDetected: Boolean(productAlias.canonicalProduct),
      canonicalProduct: productAlias.canonicalProduct,
      matchedAlias: productAlias.matchedAlias,
      aliasConfidence: productAlias.confidence,
      productQueryHints: aliasSearchHints.productQueryHints,
      aliasSearchTerms: aliasSearchHints.searchTerms,
    },
  };
};

export const normalizeUnifiedDecisionOutput = (decision = {}, context = {}) => {
  const channelReply = decision?.channel_reply && typeof decision.channel_reply === "object"
    ? decision.channel_reply
    : {};
  const products = asArray(decision.products?.length ? decision.products : decision.suggested_products);
  const productCards = asArray(decision.product_cards?.length ? decision.product_cards : channelReply.product_cards);
  const images = [
    ...asArray(decision.images),
    ...asArray(decision.image_cards),
    ...asArray(decision.visual_attachments),
    ...asArray(channelReply.image_cards),
  ].map(normalizeImage).filter((item) => item.url || item.product_id);
  const memoryUpdates = decision.memoryUpdates ||
    decision.memory_updates ||
    decision.ai_memory_patch ||
    decision.memory_patch ||
    {};
  const actions = asArray(decision.actions?.length ? decision.actions : decision.suggested_actions).map(normalizeAction);
  const quickReplies = asArray(decision.quickReplies?.length ? decision.quickReplies : decision.quick_replies).map(normalizeAction);
  const handoff = decision.handoff && typeof decision.handoff === "object"
    ? decision.handoff
    : {
        needs_human_support: decision.needs_human_support === true,
        reason: text(decision.fallback_reason || decision.reason || ""),
        conversation_status: text(decision.conversation_status || ""),
      };

  const intent = text(
    (decision.intent && typeof decision.intent === "object" ? decision.intent.type : decision.intent) ||
      decision.detected_intent ||
      decision.detectedIntent
  );
  const normalizedPayload = normalizeArabicIntentPayload(
    context.originalText ||
      decision.originalText ||
      decision.text ||
      decision.answer ||
      channelReply.text ||
      ""
  );
  const aliasResult = {
    canonicalProduct: decision.canonicalProduct ?? context.canonicalProduct ?? null,
    matchedAlias: decision.matchedAlias ?? context.matchedAlias ?? null,
    confidence: decision.aliasConfidence ?? context.aliasConfidence ?? 0,
    searchTerms: decision.aliasSearchTerms ?? context.aliasSearchTerms ?? [],
  };
  const searchHints = {
    canonicalProduct: aliasResult.canonicalProduct,
    searchTerms: aliasResult.searchTerms,
    productQueryHints: decision.productQueryHints ?? context.productQueryHints ?? [],
  };
  const rankedProducts = products.length
    ? rankProductCandidates({
        candidates: products,
        text: normalizedPayload.originalText || "",
        normalizedPayload,
        aliasResult,
        searchHints,
        intentPayload: normalizedPayload,
      })
    : { bestMatch: null, rankedCandidates: [], confidence: 0, fallbackRecommended: true };
  const rankedProductCards = productCards.length
    ? rankProductCandidates({
        candidates: productCards,
        text: normalizedPayload.originalText || "",
        normalizedPayload,
        aliasResult,
        searchHints,
        intentPayload: normalizedPayload,
      })
    : { bestMatch: null, rankedCandidates: [], confidence: 0, fallbackRecommended: true };
  const finalProducts = rankedProducts.bestMatch ? rankedProducts.rankedCandidates : products;
  const finalProductCards = rankedProductCards.bestMatch ? rankedProductCards.rankedCandidates : productCards;
  console.log("[product-match-confidence]", {
    original: normalizedPayload.originalText || "",
    normalizedText: normalizedPayload.normalizedText || "",
    canonicalProduct: aliasResult.canonicalProduct,
    candidateCount: Math.max(products.length, productCards.length),
    bestMatchId: rankedProducts.bestMatch?.id || rankedProductCards.bestMatch?.id || rankedProducts.bestMatch?.product_id || rankedProductCards.bestMatch?.product_id || null,
    bestMatchName: rankedProducts.bestMatch?.name || rankedProductCards.bestMatch?.name || rankedProducts.bestMatch?.title || rankedProductCards.bestMatch?.title || "",
    confidence: Math.max(rankedProducts.confidence || 0, rankedProductCards.confidence || 0),
    reasons: rankedProducts.bestMatch?.product_match_reasons || rankedProductCards.bestMatch?.product_match_reasons || [],
    fallbackRecommended: rankedProducts.fallbackRecommended && rankedProductCards.fallbackRecommended,
    channel: context.channel || decision.channel || "",
  });

  return {
    ...decision,
    text: text(decision.text || channelReply.text || decision.answer),
    answer: text(decision.answer || decision.text || channelReply.text),
    intent,
    detected_intent: text(decision.detected_intent || intent),
    products: finalProducts,
    suggested_products: asArray(
      decision.suggested_products?.length
        ? (rankedProducts.bestMatch ? finalProducts : decision.suggested_products)
        : finalProducts
    ),
    images,
    image_cards: images,
    quickReplies,
    quick_replies: quickReplies,
    actions,
    suggested_actions: actions,
    memoryUpdates,
    memory_updates: memoryUpdates,
    handoff,
    debug: {
      ...(decision.debug || {}),
      channel: context.channel || decision.channel || "",
      conversation_id: context.externalConversationId || decision.conversation_id || decision.session_id || "",
      source: "aiUnifiedDecisionService",
      product_alias: {
        detected: decision.productAliasDetected ?? context.productAliasDetected ?? false,
        canonicalProduct: decision.canonicalProduct ?? context.canonicalProduct ?? null,
        matchedAlias: decision.matchedAlias ?? context.matchedAlias ?? null,
        confidence: decision.aliasConfidence ?? context.aliasConfidence ?? 0,
        searchTerms: decision.aliasSearchTerms ?? context.aliasSearchTerms ?? [],
        productQueryHints: decision.productQueryHints ?? context.productQueryHints ?? [],
      },
      rawDecision: decision,
    },
    product_cards: finalProductCards,
  };
};

export const logUnifiedDecisionEarlyReturn = ({
  channel = "",
  reason = "",
  intent = "",
  text: messageText = "",
  conversationId = "",
  metadata = {},
} = {}) => {
  console.warn("AI_CHANNEL_DIVERGENCE_EARLY_RETURN", {
    channel: normalizeChannel(channel || metadata.channel || ""),
    reason: text(reason),
    intent: text(intent),
    text_preview: text(messageText).slice(0, 160),
    conversation_id: text(conversationId || metadata.conversation_id || metadata.external_conversation_id || metadata.session_id),
    skipped_unified_decision: true,
  });
};

export const generateUnifiedConversationDecision = async (normalizedInbound = {}, options = {}) => {
  const inbound = normalizeUnifiedInbound(normalizedInbound);
  const rawMemory = options.memory ?? inbound.metadata.ai_memory ?? null;
  const effectiveMemory = sanitizeMemoryForClearProductRequest(rawMemory, inbound);
  const memoryV2 = rawMemory?.preferences?.aiConversationMemoryV2 || rawMemory?.aiConversationMemoryV2 || null;
  const intentPayload = normalizeArabicIntentPayload(inbound.text);
  const followupContextV2 = resolveFollowupContext({
    memory: memoryV2,
    messageText: inbound.text,
    normalizedPayload: intentPayload,
    intentPayload,
  });
  const effectiveMemoryWithV2 = followupContextV2.type !== "none"
    ? {
        ...effectiveMemory,
        preferences: {
          ...(effectiveMemory?.preferences || {}),
          aiConversationMemoryV2: mergeConversationMemoryV2(
            memoryV2,
            buildConversationMemoryV2({
              existingMemory: memoryV2,
              messageText: inbound.text,
              normalizedPayload: intentPayload,
              intentPayload,
              shownProducts: Array.isArray(effectiveMemory?.last_products) ? effectiveMemory.last_products : [],
              selectedProduct: Array.isArray(effectiveMemory?.last_products) ? effectiveMemory.last_products[0] || null : null,
              selectedColor: followupContextV2.color || "",
              selectedSize: followupContextV2.size || "",
            })
          ),
        },
      }
    : effectiveMemory;
  const memorySummary = summarizeMemoryForLog(rawMemory);
  const effectiveMemorySummary = summarizeMemoryForLog(effectiveMemory);
  const tenantId = options.tenantId || inbound.metadata.tenant_id || inbound.metadata.tenantId || process.env.WHATSAPP_TENANT_ID || 1;
  const branchId = options.branchId ?? inbound.metadata.branch_id ?? inbound.metadata.branchId ?? null;

  console.info("AI_MEMORY_SNAPSHOT", {
    channel: inbound.channel,
    conversation_id: inbound.externalConversationId,
    conversationId: inbound.externalConversationId,
    pending_product_search_context: memorySummary.pending_product_search_context,
    last_product_cards: memorySummary.last_product_cards,
    last_product_cards_count: memorySummary.lastProductCardsCount,
    selected_product: memorySummary.selected_product,
    selected_color: memorySummary.selected_color,
    selected_size: memorySummary.selected_size,
    awaiting_alternative_choice: memorySummary.awaiting_alternative_choice,
    awaiting_confirmation: memorySummary.awaiting_confirmation,
    awaiting_model_selection: memorySummary.awaiting_model_selection,
    last_intent: memorySummary.last_intent || memorySummary.previousIntent,
    memory_keys: memorySummary.memory_keys,
    preference_keys: memorySummary.preference_keys,
    effective: {
      pending_product_search_context: effectiveMemorySummary.pending_product_search_context,
      last_product_cards_count: effectiveMemorySummary.lastProductCardsCount,
      selected_product: effectiveMemorySummary.selected_product,
      selected_color: effectiveMemorySummary.selected_color,
      selected_size: effectiveMemorySummary.selected_size,
      awaiting_alternative_choice: effectiveMemorySummary.awaiting_alternative_choice,
      awaiting_confirmation: effectiveMemorySummary.awaiting_confirmation,
      awaiting_model_selection: effectiveMemorySummary.awaiting_model_selection,
      memory_keys: effectiveMemorySummary.memory_keys,
      preference_keys: effectiveMemorySummary.preference_keys,
    },
    explicit_model_request: hasClearProductModelRequest(inbound.text),
  });
  console.info("[conversation-memory-v2]", {
    conversationId: inbound.externalConversationId,
    channel: inbound.channel,
    original: inbound.text,
    normalizedText: normalizeArabic(inbound.text),
    memoryBeforeSummary: summarizeConversationMemoryV2(memoryV2),
    followupType: followupContextV2.type || "none",
    resolvedProductId: followupContextV2.productId || null,
    resolvedColor: followupContextV2.color || "",
    resolvedSize: followupContextV2.size || "",
    memoryUpdated: Boolean(followupContextV2.type && followupContextV2.type !== "none"),
  });

  console.info("AI_UNIFIED_DECISION_INPUT", {
    channel: inbound.channel,
    text: inbound.text,
    normalizedText: normalizeArabic(inbound.text),
    externalConversationId: inbound.externalConversationId,
    externalCustomerId: inbound.externalCustomerId,
    conversationId: inbound.externalConversationId,
    hasAttachments: inbound.attachments.length > 0,
    metadataSource: text(inbound.metadata.source || inbound.metadata.adapter_channel || inbound.metadata.channel || ""),
    metadata: {
      source: text(inbound.metadata.source || inbound.metadata.adapter_channel || inbound.metadata.channel || ""),
    },
    previousIntent: memorySummary.previousIntent,
    memorySummary,
    effectiveMemorySummary,
    clearedPendingClassification: memorySummary.hasPendingClassification && !effectiveMemorySummary.hasPendingClassification,
  });

  if (hasJordan4TraceTrigger(inbound.text)) {
    console.log("AI_PRODUCT_MATCH_TRACE", {
      stage: "unified_decision_entry",
      raw_text: inbound.text,
      normalized_text: normalizeArabic(inbound.text),
      channel: inbound.channel,
      tenant_id: tenantId,
      conversation_id: inbound.externalConversationId,
      external_customer_id: inbound.externalCustomerId,
      entered_product_matcher: false,
      failure_reason: "",
      note: "earliest unified entry trace before orchestrator/product matching",
    });
  }

  let decision = null;
  const directColorSelectionDecision = buildDirectColorSelectionDecision({ message: inbound.text, memory: rawMemory || effectiveMemoryWithV2 });
  if (directColorSelectionDecision) {
    console.info("AI_V2_DIRECT_COLOR_SELECTION_MATCH", {
      channel: inbound.channel,
      message: inbound.text,
      normalizedText: normalizeArabic(inbound.text),
      conversation_id: inbound.externalConversationId,
      activeProductId: activeProductIdFromMemory(rawMemory || effectiveMemory),
      activeSize: normalizeSizeToken((rawMemory || effectiveMemory)?.activeSize || (rawMemory || effectiveMemory)?.selectedSize || (rawMemory || effectiveMemory)?.preferences?.activeSize || (rawMemory || effectiveMemory)?.preferences?.selectedSize || ""),
      activeColor: text((rawMemory || effectiveMemory)?.activeColor || (rawMemory || effectiveMemory)?.selectedColor || (rawMemory || effectiveMemory)?.preferences?.activeColor || (rawMemory || effectiveMemory)?.preferences?.selectedColor || ""),
      matchedColor: text(directColorSelectionDecision.active_color || ""),
      matchedSize: text(directColorSelectionDecision.active_size || ""),
      productCardsCount: asArray(directColorSelectionDecision.product_cards).length,
      productIds: productIds(directColorSelectionDecision.product_cards || []),
    });
    decision = directColorSelectionDecision;
  } else {
    try {
      decision = await generateAiBrainV2Decision({
        ...inbound,
        metadata: {
          ...inbound.metadata,
          channel: inbound.channel,
          external_conversation_id: inbound.externalConversationId,
          external_customer_id: inbound.externalCustomerId,
          customer_name: inbound.customerName,
          ai_memory: effectiveMemoryWithV2,
          aiConversationMemoryV2: memoryV2,
          followup_context_v2: followupContextV2,
        },
      }, {
        ...options,
        tenantId,
        branchId,
        memory: effectiveMemoryWithV2,
        providerMessageId: options.providerMessageId || inbound.metadata.provider_message_id || inbound.metadata.external_message_id || "",
      });
    } catch (error) {
    const allowLegacyFallback = ["1", "true", "yes", "on"].includes(String(process.env.AI_BRAIN_V2_LEGACY_FALLBACK || "").trim().toLowerCase());
    console.error("AI_BRAIN_V2_ERROR", {
      channel: inbound.channel,
      conversation_id: inbound.externalConversationId,
      text_preview: inbound.text.slice(0, 160),
      message: error?.message || String(error),
      legacy_fallback_enabled: allowLegacyFallback,
    });
    if (!allowLegacyFallback) throw error;
    console.warn("AI_BRAIN_V2_LEGACY_FALLBACK_USED", {
      channel: inbound.channel,
      conversation_id: inbound.externalConversationId,
      reason: error?.message || "v2_error",
    });
    decision = await generateUnifiedAiReply({
      tenantId,
      branchId,
      channel: inbound.channel,
      conversation: {
        id: inbound.externalConversationId,
        session_id: inbound.externalConversationId,
        customer_name: inbound.customerName,
        customer_phone: inbound.externalCustomerId,
      },
      customer: {
        id: inbound.metadata.customer_id || inbound.externalCustomerId,
        name: inbound.customerName,
        phone: inbound.metadata.customer_phone || inbound.externalCustomerId,
      },
      message: {
        text: inbound.text || "Customer sent an attachment",
        provider_message_id: inbound.metadata.provider_message_id || inbound.metadata.external_message_id || "",
        metadata: {
          ...inbound.metadata,
          channel: inbound.channel,
          external_conversation_id: inbound.externalConversationId,
          external_customer_id: inbound.externalCustomerId,
          customer_name: inbound.customerName,
          ai_memory: effectiveMemoryWithV2,
          aiConversationMemoryV2: memoryV2,
          followup_context_v2: followupContextV2,
        },
      },
      attachments: inbound.attachments,
      memory: effectiveMemoryWithV2,
      productsContext: options.productsContext ?? inbound.metadata.products_context ?? null,
      providerMessageId: options.providerMessageId || inbound.metadata.provider_message_id || inbound.metadata.external_message_id || "",
    });
    }
  }

  const output = normalizeUnifiedDecisionOutput(applySharedShortcutMetadata({ decision, inbound }), inbound);
  console.info("AI_UNIFIED_DECISION_OUTPUT", {
    channel: inbound.channel,
    intent: output.intent || output.detected_intent || "",
    textPreview: text(output.text || output.answer || output.channel_reply?.text || "").slice(0, 180),
    productIds: productIds([...(output.products || []), ...(output.product_cards || [])]),
    imageCount: asArray(output.images || output.image_cards).length,
    action: actionNames(output.actions || output.suggested_actions)[0] || text(output.next_action || output.nextAction || output.debug?.next_best_action || ""),
    nextAction: text(output.next_action || output.nextAction || output.debug?.next_best_action || ""),
    reason: text(output.debug?.shared_shortcut_handler || output.debug?.reason || output.reason || output.debug?.source || ""),
    debugSource: text(output.debug?.source || ""),
  });
  if (hasPriceObjectionTraceTrigger(inbound.text)) {
    const outputProductIds = productIds([...(output.products || []), ...(output.product_cards || []), ...(output.channel_reply?.product_cards || [])]);
    const outputImageCards = asArray(output.images || output.image_cards || output.channel_reply?.image_cards);
    console.info("AI_PRICE_OBJECTION_CONTEXT", {
      message_text: inbound.text,
      channel: inbound.channel,
      conversation_id: inbound.externalConversationId,
      activeProductId: text(
        output.activeProductId ||
        output.active_product_id ||
        output.memoryUpdates?.active_product_id ||
        output.memory_updates?.active_product_id ||
        effectiveMemorySummary.activeProductId ||
        memorySummary.activeProductId ||
        ""
      ),
      last_product_id: text(
        output.memoryUpdates?.last_product_id ||
        output.memory_updates?.last_product_id ||
        effectiveMemorySummary.last_product_id ||
        memorySummary.last_product_id ||
        ""
      ),
      selected_product_ids: outputProductIds.length ? outputProductIds : effectiveMemorySummary.selected_product_ids || memorySummary.selected_product_ids || [],
      product_cards_sent: outputProductIds.length || outputImageCards.length,
      reply_reason: text(
        output.debug?.shared_shortcut_handler ||
        output.debug?.reason ||
        output.reason ||
        output.reply_reason ||
        output.replyReason ||
        output.debug?.source ||
        ""
      ),
    });
  }
  if (
    hasJordan4TraceTrigger(inbound.text) &&
    !asArray(output.products).length &&
    !asArray(output.product_cards).length &&
    !asArray(output.images || output.image_cards).length
  ) {
    console.warn("AI_EARLY_RETURN_BEFORE_PRODUCT_TRACE", {
      channel: inbound.channel,
      message_text: inbound.text,
      intent: output.intent || output.detected_intent || "",
      reason: text(output.debug?.early_return_reason || output.fallbackReason || output.fallback_reason || output.reason || "no_product_payload_after_unified_decision"),
      conversation_id: inbound.externalConversationId,
    });
  }
  return output;
};

export default {
  generateUnifiedConversationDecision,
  logUnifiedDecisionEarlyReturn,
  normalizeUnifiedDecisionOutput,
  normalizeUnifiedInbound,
};
