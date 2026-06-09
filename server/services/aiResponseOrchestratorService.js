import { buildAiPriceGuard } from "../utils/aiProductReplyGuards.js";
const text = (value = "") => String(value ?? "").trim();
const normalizeArabic = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

export const RESPONSE_CONVERSATION_STAGES = Object.freeze({
  GREETING: "GREETING",
  DISCOVERY: "DISCOVERY",
  PRODUCT_PRESENTATION: "PRODUCT_PRESENTATION",
  PRODUCT_PRESENTATION_FOLLOWUP: "PRODUCT_PRESENTATION_FOLLOWUP",
  COLOR_SELECTION: "COLOR_SELECTION",
  SIZE_SELECTION: "SIZE_SELECTION",
  OBJECTION_HANDLING: "OBJECTION_HANDLING",
  BUYING_INTENT: "BUYING_INTENT",
  CHECKOUT_COLLECTING: "CHECKOUT_COLLECTING",
  ORDER_CONFIRMATION: "ORDER_CONFIRMATION",
  HUMAN_HANDOFF: "HUMAN_HANDOFF",
});

const asArray = (value) => (Array.isArray(value) ? value : [value]).flat().map(text).filter(Boolean);
const unique = (items = [], limit = 12) => [...new Set(asArray(items))].slice(0, limit);
const sizeNumber = (value = "") => {
  const digits = text(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, "");
  const size = Number(digits);
  return Number.isFinite(size) && size > 0 ? size : null;
};
const sortSizeList = (items = []) =>
  unique(items, 20).sort((a, b) => {
    const sizeA = sizeNumber(a);
    const sizeB = sizeNumber(b);
    if (sizeA !== null && sizeB !== null) return sizeA - sizeB;
    if (sizeA !== null) return -1;
    if (sizeB !== null) return 1;
    return a.localeCompare(b);
  });
const joinSizes = (items = [], fallback = "") => {
  const sorted = sortSizeList(items);
  const numeric = sorted.map(sizeNumber);
  const continuous = numeric.length >= 3 && numeric.every((size) => size !== null) &&
    numeric.every((size, index) => index === 0 || size === numeric[index - 1] + 1);
  if (continuous) return `${numeric[0]} \u0625\u0644\u0649 ${numeric.at(-1)}`;
  return sorted.join("\u060c ") || fallback;
};
const joinList = (items = [], fallback = "") => unique(items, 8).join(", ") || fallback;
const PRODUCT_CONFIRMATION_CONFIDENCE_THRESHOLD = Number(process.env.AI_PRODUCT_CONFIRMATION_CONFIDENCE_THRESHOLD || 0.9);
const validPositivePrice = (value = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};
const productConfirmationGuard = ({ selectedProduct = {}, productContext = {}, price = "" } = {}) => {
  const hasProductId = Boolean(selectedProduct?.product_id || selectedProduct?.id || productContext.productId);
  const confidenceValue = Number(productContext.confidence ?? selectedProduct?.product_confirmation_confidence ?? selectedProduct?.visual_confidence_score ?? selectedProduct?.confidence);
  const confidence = Number.isFinite(confidenceValue) ? (confidenceValue > 1 ? confidenceValue / 100 : confidenceValue) : 1;
  const hasValidPrice = validPositivePrice(price || selectedProduct?.price || selectedProduct?.final_price || selectedProduct?.sale_price || productContext.price);
  const sourceConfirmed = productContext.productSourceConfirmed === true || selectedProduct?.product_source_confirmed === true || (!productContext.weakVisualMatch && hasProductId);
  const confirmed = hasProductId && confidence >= PRODUCT_CONFIRMATION_CONFIDENCE_THRESHOLD && hasValidPrice && sourceConfirmed;
  const blockedFields = confirmed ? [] : ["availability", "price", "sizes", "checkoutPrompt"];
  const reason = confirmed
    ? "confirmed_product_with_valid_price"
    : !hasProductId
      ? "missing_product_id"
      : !sourceConfirmed
        ? "product_source_unconfirmed"
        : confidence < PRODUCT_CONFIRMATION_CONFIDENCE_THRESHOLD
          ? "confidence_below_threshold"
          : "missing_valid_price";
  console.log("[product-confirmation-guard]", { hasProductId, confidence, hasValidPrice, blockedFields, reason });
  return { confirmed, blockedFields, reason };
};

const STAGE_RANK = Object.freeze({
  GREETING: 0,
  DISCOVERY: 1,
  PRODUCT_SEARCH: 2,
  PRODUCT_AVAILABILITY: 2,
  PRODUCT_PRESENTATION: 3,
  PRODUCT_PRESENTATION_FOLLOWUP: 3,
  COLOR_SELECTION: 4,
  SIZE_SELECTION: 5,
  SIZE_SELECTED: 6,
  BUYING_INTENT: 7,
  CHECKOUT_COLLECTING: 8,
  CHECKOUT: 8,
  ORDER_CONFIRMATION: 9,
  HUMAN_HANDOFF: 10,
  browsing: 1,
  product_selected: 3,
  product_details: 3,
  selecting_size: 5,
  size_selected: 6,
  buying_intent: 7,
  awaiting_booking_confirmation: 7,
  checkout_collecting: 8,
  checkout: 8,
  collecting_contact: 8,
  awaiting_checkout_info: 8,
  order_ready: 9,
  checkout_data_collected: 9,
  order_created: 9,
  order_confirmed: 9,
});

const normalizedStageKey = (stage = "") => text(stage).replace(/\s+/g, "_");
const stageRank = (stage = "") => {
  const key = normalizedStageKey(stage);
  return STAGE_RANK[key] ?? STAGE_RANK[key.toUpperCase()] ?? STAGE_RANK[key.toLowerCase()] ?? 0;
};
const stageAtLeast = (stage = "", minimum = "") => stageRank(stage) >= stageRank(minimum);
const isProductStage = (stage = "") => ["PRODUCT_PRESENTATION", "PRODUCT_SEARCH", "PRODUCT_AVAILABILITY", "PRODUCT_PRESENTATION_FOLLOWUP"].includes(normalizedStageKey(stage).toUpperCase());
const isConfirmationMessage = (message = "") => {
  const normalized = text(message)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:ايوه|ايوا|اه|تمام|ماشي|يلا|احجزه|احجزها|احجز|اطلبه|اطلبها|اطلب|هاته|هاتها|هات|اكمل|كمل|yes|ok|okay|continue|book|reserve)(?:\s+(?:تمام|ماشي|يلا|please|بليز|لو سمحت))*$/.test(normalized);
};

const applyStageLock = ({
  previousStage = "",
  proposedStage = "",
  replyCategory = "",
  intent = "",
  customerMessage = "",
  contextSwitchDetected = false,
  newProductDetected = false,
  newImageDetected = false,
} = {}) => {
  const bypassLock = contextSwitchDetected || newProductDetected || newImageDetected;
  const locked = stageAtLeast(previousStage, RESPONSE_CONVERSATION_STAGES.BUYING_INTENT);
  const productRegression = locked && !bypassLock && (isProductStage(proposedStage) || isProductStage(replyCategory) || ["PRODUCT_SEARCH", "VISUAL_SEARCH"].includes(intent));
  const confirmation = isConfirmationMessage(customerMessage);
  if (!productRegression) {
    console.log("[stage-manager]", {
      previousStage: previousStage || "",
      newStage: proposedStage || "",
      reason: "normal_progression",
    });
    return { replyCategory, nextConversationStage: proposedStage, stageLockApplied: false, stageRegressionBlocked: false };
  }

  const nextConversationStage = RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING;
  const nextReplyCategory = "CHECKOUT_COLLECTING";
  const reason = confirmation
    ? "confirmation_after_buying_intent"
    : "blocked_product_stage_regression_to_checkout";
  console.log("[stage-regression-blocked]", {
    previousStage,
    attemptedStage: proposedStage,
    attemptedReplyCategory: replyCategory,
    intent,
    message: customerMessage,
    newStage: nextConversationStage,
    reason,
  });
  console.log("[stage-manager]", {
    previousStage,
    newStage: nextConversationStage,
    reason,
  });
  return { replyCategory: nextReplyCategory, nextConversationStage, stageLockApplied: true, stageRegressionBlocked: true, reason };
};

const TEMPLATES = Object.freeze({
  GREETING: [
    { id: "greeting_1", weight: 4, text: "\u0648\u0639\u0644\u064a\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\n\u0623\u0642\u062f\u0631 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0623\u0648 \u0627\u0644\u0645\u0648\u062f\u064a\u0644\u0627\u062a \u0623\u0648 \u0627\u0644\u0628\u062d\u062b \u0628\u0635\u0648\u0631\u0629." },
    { id: "greeting_2", weight: 3, text: "\u0623\u0647\u0644\u0627 \u0628\u064a\u0643\n\u062f\u0648\u0631 \u0639\u0644\u0649 \u0623\u064a \u0645\u0648\u062f\u064a\u0644 \u0628\u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0627\u0628\u0639\u062a \u0635\u0648\u0631\u0629 \u0648\u0623\u0646\u0627 \u0623\u0633\u0627\u0639\u062f\u0643." },
    { id: "greeting_3", weight: 3, text: "\u0648\u0639\u0644\u064a\u0643\u0645 \u0627\u0644\u0633\u0644\u0627\u0645\u060c \u062a\u062d\u062a \u0623\u0645\u0631\u0643.\n\u062a\u062d\u0628 \u062a\u0633\u0623\u0644 \u0639\u0646 \u0645\u0648\u062f\u064a\u0644 \u0645\u0639\u064a\u0646\u061f" },
  ],
  PRODUCT_PRESENTATION: [
    { id: "product_presentation_1", weight: 4, text: "أيوه متاح ✅\n\nالسعر: {price} جنيه" },
    { id: "product_presentation_2", weight: 3, text: "موجود حاليًا ✅\n\nالسعر: {price} جنيه" },
  ],
  PRODUCT_PRESENTATION_FOLLOWUP: [
    { id: "product_presentation_followup_1", weight: 3, text: "\u0644\u0648 \u0639\u0646\u062f\u0643 \u0645\u0642\u0627\u0633 \u0645\u0639\u064a\u0646 \u0642\u0648\u0644\u064a \u0639\u0644\u064a\u0647." },
    { id: "product_presentation_followup_2", weight: 3, text: "\u062a\u062d\u0628 \u0623\u062a\u0623\u0643\u062f\u0644\u0643 \u0645\u0646 \u0645\u0642\u0627\u0633 \u0645\u0639\u064a\u0646\u061f" },
    { id: "product_presentation_followup_3", weight: 3, text: "\u0645\u062d\u062a\u0627\u062c \u062a\u0639\u0631\u0641 \u062a\u0648\u0627\u0641\u0631 \u0645\u0642\u0627\u0633 \u0645\u0639\u064a\u0646\u061f" },
    { id: "product_presentation_followup_4", weight: 3, text: "\u0642\u0648\u0644\u064a \u0645\u0642\u0627\u0633\u0643 \u0648\u0623\u0646\u0627 \u0623\u062a\u0623\u0643\u062f\u0644\u0643." },
  ],
  SIZE_AVAILABLE: [
    { id: "size_available_1", weight: 4, text: "أيوه {size} متوفر ✅\nتحب أحجزهولك؟" },
    { id: "size_available_2", weight: 3, text: "تمام، {size} موجود\nأجهزهولك؟" },
    { id: "size_available_3", weight: 3, text: "موجود في المقاس ده ✅\nتحب نكمل الطلب؟" },
  ],
  SIZE_UNAVAILABLE: [
    { id: "size_unavailable_1", weight: 3, text: "للأسف {size} مش متوفر حاليًا.\nالمتاح: {sizes}" },
    { id: "size_unavailable_2", weight: 2, text: "{size} خلصان دلوقتي.\nأقدر أشوفلك من المتاح: {sizes}" },
    { id: "size_unavailable_3", weight: 2, text: "مش موجود في {size} حاليًا.\nالمقاسات اللي عندي: {sizes}" },
  ],
  COLOR_SELECTION: [
    { id: "color_selection_1", weight: 3, text: "فيه كذا لون متاح" },
    { id: "color_selection_2", weight: 3, text: "أيوه، الألوان المتاحة دي" },
    { id: "color_selection_3", weight: 3, text: "دي الألوان اللي موجودة حاليًا" },
    { id: "color_selection_4", weight: 2, text: "تمام، هوريك الألوان المتاحة" },
  ],
  ASK_SIZE: [
    { id: "ask_size_1", weight: 3, text: "تمام، تحب أنهي مقاس؟ المتاح: {sizes}" },
    { id: "ask_size_2", weight: 3, text: "أختارلك أنهي مقاس؟ المتاح حاليًا: {sizes}" },
    { id: "ask_size_3", weight: 3, text: "المقاسات المتاحة: {sizes}\nتحب أنهي واحد؟" },
  ],
  OBJECTION_PRICE: [
    { id: "objection_price_1", weight: 3, text: "فاهمك، هو سعره أعلى شوية عشان خامته وتقفيله كويسين.\nلو تحب أشوفلك حاجة أقرب لميزانيتك." },
    { id: "objection_price_2", weight: 3, text: "معاك حق تسأل، السعر واضح على الموديل والمتاح منه.\nلو الميزانية أقل أقدر أشوفلك اختيار أرخص." },
    { id: "objection_price_3", weight: 3, text: "لو السعر عالي عليك، أقدر أرشحلك حاجة شبهه بس بسعر أقل." },
  ],
  CHECKOUT_COLLECTING: [
    { id: "checkout_collecting_1", weight: 3, text: "تمام، ابعتلي الاسم ورقم الموبايل والعنوان ونكمل الطلب." },
    { id: "checkout_collecting_2", weight: 2, text: "أجهزهولك. محتاج الاسم ورقم التليفون والعنوان." },
    { id: "checkout_collecting_3", weight: 2, text: "تمام، نكمل الطلب.\nابعت الاسم والموبايل والعنوان." },
  ],
  HUMAN_HANDOFF: [
    { id: "human_handoff_1", weight: 2, text: "تمام، هحوّلك لحد من الفريق يساعدك." },
    { id: "human_handoff_2", weight: 2, text: "حاضر، حد من خدمة العملاء هيتابع معاك." },
  ],
});

const STAGE_BY_INTENT = Object.freeze({
  GREETING: RESPONSE_CONVERSATION_STAGES.GREETING,
  PRODUCT_SEARCH: RESPONSE_CONVERSATION_STAGES.PRODUCT_PRESENTATION,
  VISUAL_SEARCH: RESPONSE_CONVERSATION_STAGES.PRODUCT_PRESENTATION,
  COLOR_REQUEST: RESPONSE_CONVERSATION_STAGES.COLOR_SELECTION,
  SIZE_CHECK: RESPONSE_CONVERSATION_STAGES.SIZE_SELECTION,
  PRICE_OBJECTION: RESPONSE_CONVERSATION_STAGES.OBJECTION_HANDLING,
  BUYING_INTENT: RESPONSE_CONVERSATION_STAGES.BUYING_INTENT,
  CHECKOUT: RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING,
  ORDER_CONFIRMATION: RESPONSE_CONVERSATION_STAGES.ORDER_CONFIRMATION,
  HUMAN_AGENT: RESPONSE_CONVERSATION_STAGES.HUMAN_HANDOFF,
});

const POLISHED_PRODUCT_PRESENTATION_TEMPLATES = [
  { id: "product_presentation_polished_1", weight: 4, text: "\u0623\u064a\u0648\u0647 \u0645\u062a\u0627\u062d \u2705\n\n\u0627\u0644\u0633\u0639\u0631: {price} \u062c\u0646\u064a\u0647" },
  { id: "product_presentation_polished_2", weight: 3, text: "\u0645\u0648\u062c\u0648\u062f \u062d\u0627\u0644\u064a\u064b\u0627 \u2705\n\n\u0627\u0644\u0633\u0639\u0631: {price} \u062c\u0646\u064a\u0647" },
];

const chooseWeightedTemplate = (category, recentTemplateIds = []) => {
  const templates = category === "PRODUCT_PRESENTATION"
    ? POLISHED_PRODUCT_PRESENTATION_TEMPLATES
    : TEMPLATES[category] || POLISHED_PRODUCT_PRESENTATION_TEMPLATES;
  const recent = new Set(asArray(recentTemplateIds));
  let pool = templates.filter((template) => !recent.has(template.id));
  let antiRepetitionApplied = pool.length !== templates.length;
  if (!pool.length) {
    pool = templates.filter((template) => template.id !== asArray(recentTemplateIds).at(-1));
    antiRepetitionApplied = true;
  }
  if (!pool.length) pool = templates;
  const total = pool.reduce((sum, template) => sum + Number(template.weight || 1), 0);
  let cursor = Math.random() * total;
  for (const template of pool) {
    cursor -= Number(template.weight || 1);
    if (cursor <= 0) return { template, antiRepetitionApplied };
  }
  return { template: pool[0], antiRepetitionApplied };
};

const interpolate = (template = "", values = {}) =>
  template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = values[key];
    if (Array.isArray(value)) return joinList(value, "-");
    return text(value) || "-";
  });

const compressionMemory = (memory = {}) =>
  memory.conversationCompression && typeof memory.conversationCompression === "object" ? memory.conversationCompression : {};

const activeCompressionState = (memory = {}, selectedProduct = {}, productContext = {}) => {
  const productId = text(selectedProduct?.product_id || selectedProduct?.id || productContext.productId || memory.activeProductId || memory.selectedProductId || memory.lastProductCard?.product_id || "");
  const variantId = text(selectedProduct?.variant_id || productContext.variantId || memory.activeVariantId || memory.selectedVariantId || memory.lastProductCard?.variant_id || "");
  const color = text(selectedProduct?.color || memory.activeColor || memory.selectedColor || memory.lastProductCard?.color || "").toLowerCase();
  const exactKey = [productId || "product", variantId || "variant", color || "color"].join(":");
  const store = compressionMemory(memory);
  return store[exactKey] || Object.values(store).find((entry) => text(entry?.productId) === productId) || {};
};

const compressReply = ({ replyText = "", replyCategory = "", customerMessage = "", selectedSize = "", customerMemory = {}, selectedProduct = {}, productContext = {} } = {}) => {
  const state = activeCompressionState(customerMemory, selectedProduct, productContext);
  const suppressedFields = [];
  let reason = "";
  let nextText = text(replyText);
  const asksPrice = /كام|بكام|السعر|سعره|price|how much/i.test(customerMessage);
  const checkoutLocked = stageAtLeast(customerMemory.checkoutStage || customerMemory.buyingStage || customerMemory.conversationStage || "", RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING);
  const currentPrice = text(selectedProduct?.price || selectedProduct?.final_price || selectedProduct?.sale_price || productContext.price || "");
  const priceChanged = Boolean(state.price && currentPrice && text(state.price) !== currentPrice);
  if (replyCategory.startsWith("SIZE_") && state.shownSizes && selectedSize) {
    nextText = replyCategory === "SIZE_AVAILABLE" ? `${selectedSize} متوفر ✅` : "المقاس ده غير متاح.";
    suppressedFields.push("price", "sizes", "productCard", "checkoutPrompt");
    reason = "size_answer_after_sizes_shown";
  } else if (checkoutLocked && !asksPrice) {
    nextText = nextText
      .split(/\n+/)
      .filter((line) => !/(السعر|المتاح|المقاسات|موجود|متاح|تحب أ?حجز|أجهزهولك|نكمل الطلب|احجز)/i.test(line))
      .join("\n")
      .trim() || nextText;
    suppressedFields.push("price", "sizes", "availability", "productPresentation", "checkoutPrompt");
    reason = "checkout_collecting_no_product_repetition";
  } else {
    if (state.shownPrice && !asksPrice && !priceChanged) {
      const before = nextText;
      nextText = nextText.split(/\n+/).filter((line) => !/السعر|بكام|price/i.test(line)).join("\n").trim();
      if (nextText !== before) suppressedFields.push("price");
    }
    if (state.shownSizes && !replyCategory.startsWith("SIZE_")) {
      const before = nextText;
      nextText = nextText.split(/\n+/).filter((line) => !/المتاح|المقاسات|sizes/i.test(line)).join("\n").trim();
      if (nextText !== before) suppressedFields.push("sizes");
    }
    if (state.shownCheckoutPrompt) {
      const before = nextText;
      nextText = nextText.split(/\n+/).filter((line) => !/تحب أ?حجز|أجهزهولك|نكمل الطلب/i.test(line)).join("\n").trim();
      if (nextText !== before) suppressedFields.push("checkoutPrompt");
    }
    if (suppressedFields.length) reason = "previously_shown_product_fields";
  }
  return {
    replyText: nextText || text(replyText),
    compressionApplied: suppressedFields.length > 0,
    suppressedFields,
    reason,
  };
};

const inferReplyCategory = ({ intent = "", customerMessage = "", selectedSize = "", availableSizes = [], productContext = {} } = {}) => {
  const normalized = text(customerMessage).toLowerCase();
  if (intent === "GREETING") return "GREETING";
  if (intent === "PRODUCT_PRESENTATION_FOLLOWUP") return "PRODUCT_PRESENTATION_FOLLOWUP";
  if (/غالي|غالية|السعر عالي|expensive|price high/.test(normalized) || intent === "PRICE_OBJECTION") return "OBJECTION_PRICE";
  if (intent === "COLOR_REQUEST") return "COLOR_SELECTION";
  if (intent === "CHECKOUT") return "CHECKOUT_COLLECTING";
  if (intent === "BUYING_INTENT" && !selectedSize && asArray(availableSizes).length) return "ASK_SIZE";
  if (intent === "SIZE_CHECK" && selectedSize) return productContext.sizeAvailable === false ? "SIZE_UNAVAILABLE" : "SIZE_AVAILABLE";
  if (intent === "SIZE_CHECK") return "ASK_SIZE";
  return "PRODUCT_PRESENTATION";
};

export const orchestrateAiResponse = ({
  intent = "",
  conversationStage = "",
  customerMessage = "",
  productContext = {},
  selectedProduct = null,
  selectedColor = "",
  selectedSize = "",
  availableSizes = [],
  availableColors = [],
  price = "",
  customerMemory = {},
  previousReplies = [],
  customerProfile = {},
  contextSwitchDetected = false,
  newProductDetected = false,
  newImageDetected = false,
  source = "",
  channel = "",
} = {}) => {
  console.info("[ai-orchestrator-input]", {
    channel: text(channel),
    source: text(source),
    normalized_message: normalizeArabic(customerMessage),
    detected_intent: text(intent),
    reply_preview: "",
    produced_by: "aiResponseOrchestratorService",
  });
  let replyCategory = inferReplyCategory({ intent, customerMessage, selectedSize, availableSizes, productContext });
  const recentReplyTemplateIds = asArray(customerMemory.recentReplyTemplateIds || previousReplies.map((reply) => reply.templateId)).slice(-8);
  const recentReplyCategories = asArray(customerMemory.recentReplyCategories).slice(-8);
  const proposedConversationStage =
    replyCategory === "OBJECTION_PRICE" ? RESPONSE_CONVERSATION_STAGES.OBJECTION_HANDLING :
    replyCategory === "PRODUCT_PRESENTATION_FOLLOWUP" ? RESPONSE_CONVERSATION_STAGES.PRODUCT_PRESENTATION_FOLLOWUP :
    replyCategory === "COLOR_SELECTION" ? RESPONSE_CONVERSATION_STAGES.COLOR_SELECTION :
    replyCategory === "ASK_SIZE" || replyCategory.startsWith("SIZE_") ? RESPONSE_CONVERSATION_STAGES.SIZE_SELECTION :
    replyCategory === "CHECKOUT_COLLECTING" ? RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING :
    STAGE_BY_INTENT[intent] || conversationStage || RESPONSE_CONVERSATION_STAGES.DISCOVERY;
  const stageDecision = applyStageLock({
    previousStage: conversationStage,
    proposedStage: proposedConversationStage,
    replyCategory,
    intent,
    customerMessage,
    contextSwitchDetected,
    newProductDetected,
    newImageDetected,
  });
  replyCategory = stageDecision.replyCategory;
  const nextConversationStage = stageDecision.nextConversationStage;
  const { template, antiRepetitionApplied } = chooseWeightedTemplate(replyCategory, recentReplyTemplateIds);
  const sizeList = joinSizes(availableSizes, "هراجعهولك");
  const colorList = joinList(availableColors, "المتاح هبعتهولك");
  const rawReplyText = interpolate(template.text, {
    product: selectedProduct?.name || selectedProduct?.title || productContext.productName || "",
    color: selectedColor,
    size: selectedSize,
    sizes: sizeList,
    colors: colorList,
    price: text(price).replace(/\s*جنيه\s*$/i, ""),
    customerName: customerProfile?.firstName || customerProfile?.name || "",
  });
  const confirmationGuard = productConfirmationGuard({ selectedProduct, productContext, price });
  const priceGuard = buildAiPriceGuard({
    productId: selectedProduct?.product_id || selectedProduct?.id || productContext.productId || null,
    variantId: selectedProduct?.variant_id || productContext.variantId || null,
    rawPrice: price,
    product: selectedProduct || {},
    productContext,
    memory: customerMemory,
    messageText: customerMessage,
    route: "ai_response_orchestrator",
  });
  const presentationPriorityIntent = ["PRODUCT_SEARCH", "VISUAL_SEARCH"].includes(text(intent).toUpperCase());
  const hasPresentationContext = Boolean(
    selectedProduct?.product_id ||
    selectedProduct?.id ||
    productContext.productId ||
    productContext.productName ||
    selectedProduct?.title ||
    selectedProduct?.name
  );
  const safePresentationReply = priceGuard.safeReplyText || rawReplyText;
  if (["PRODUCT_PRESENTATION", "ASK_SIZE", "SIZE_AVAILABLE"].includes(replyCategory) && !confirmationGuard.confirmed && !(presentationPriorityIntent && hasPresentationContext && priceGuard.renderedPrice)) {
    return {
      replyText: safePresentationReply,
      replyCategory: "PRODUCT_PRESENTATION_FOLLOWUP",
      templateId: "product_confirmation_guard",
      nextConversationStage,
      ctaType: "none",
      shouldSendProductCards: false,
      shouldAskSize: false,
      shouldSuggestAlternatives: true,
      shouldStartCheckout: false,
      antiRepetitionApplied,
      compressionApplied: true,
      suppressedFields: confirmationGuard.blockedFields,
      compressionReason: confirmationGuard.reason,
      memoryPatch: {
        lastReplyTemplateId: "product_confirmation_guard",
        lastReplyCategory: "PRODUCT_PRESENTATION_FOLLOWUP",
        recentReplyTemplateIds: unique([...recentReplyTemplateIds, "product_confirmation_guard"], 8),
        recentReplyCategories: unique([...recentReplyCategories, "PRODUCT_PRESENTATION_FOLLOWUP"], 8),
        conversationStage: RESPONSE_CONVERSATION_STAGES.PRODUCT_PRESENTATION_FOLLOWUP,
      },
      debug: {
        responseOrchestratorUsed: true,
        replyCategory: "PRODUCT_PRESENTATION_FOLLOWUP",
        templateId: "product_confirmation_guard",
        ctaType: "none",
        nextConversationStage: RESPONSE_CONVERSATION_STAGES.PRODUCT_PRESENTATION_FOLLOWUP,
        antiRepetitionApplied,
        compressionApplied: true,
        suppressedFields: confirmationGuard.blockedFields,
        reason: confirmationGuard.reason,
        stageLockApplied: stageDecision.stageLockApplied === true,
        stageRegressionBlocked: stageDecision.stageRegressionBlocked === true,
      },
    };
  }
  const compressed = compressReply({
    replyText: rawReplyText,
    replyCategory,
    customerMessage,
    selectedSize,
    customerMemory,
    selectedProduct,
    productContext,
  });
  if (compressed.compressionApplied) {
    console.log("[conversation-compression]", {
      compressionApplied: true,
      suppressedFields: compressed.suppressedFields,
      replyCategory,
      reason: compressed.reason,
    });
  }
  const replyText = compressed.replyText;
  console.info("[ai-orchestrator-output]", {
    channel: text(channel),
    source: text(source),
    normalized_message: normalizeArabic(customerMessage),
    detected_intent: text(intent),
    reply_preview: text(replyText).slice(0, 180),
    produced_by: "aiResponseOrchestratorService",
  });
  const shouldSuggestAlternatives = ["OBJECTION_PRICE", "SIZE_UNAVAILABLE"].includes(replyCategory) || productContext.weakVisualMatch === true || productContext.productUnavailable === true;
  const shouldAskSize = replyCategory === "ASK_SIZE" || (replyCategory === "PRODUCT_PRESENTATION" && asArray(availableSizes).length > 0);
  const shouldStartCheckout = replyCategory === "CHECKOUT_COLLECTING";
  return {
    replyText,
    replyCategory,
    templateId: template.id,
    nextConversationStage,
    ctaType: shouldStartCheckout ? "checkout_details" : shouldSuggestAlternatives ? "suggest_alternatives" : shouldAskSize ? "ask_size" : "none",
    shouldSendProductCards: ["PRODUCT_PRESENTATION", "COLOR_SELECTION"].includes(replyCategory),
    shouldAskSize,
    shouldSuggestAlternatives,
    shouldStartCheckout,
    antiRepetitionApplied,
    compressionApplied: compressed.compressionApplied,
    suppressedFields: compressed.suppressedFields,
    compressionReason: compressed.reason,
    memoryPatch: {
      lastReplyTemplateId: template.id,
      lastReplyCategory: replyCategory,
      recentReplyTemplateIds: unique([...recentReplyTemplateIds, template.id], 8),
      recentReplyCategories: unique([...recentReplyCategories, replyCategory], 8),
      conversationStage: nextConversationStage,
      ...(nextConversationStage === RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING
        ? { checkoutStage: "checkout_collecting", buyingStage: "checkout_collecting" }
        : nextConversationStage === RESPONSE_CONVERSATION_STAGES.BUYING_INTENT
          ? { buyingStage: "buying_intent" }
          : {}),
    },
    debug: {
      responseOrchestratorUsed: true,
      replyCategory,
      templateId: template.id,
      ctaType: shouldStartCheckout ? "checkout_details" : shouldSuggestAlternatives ? "suggest_alternatives" : shouldAskSize ? "ask_size" : "none",
      nextConversationStage,
      antiRepetitionApplied,
      compressionApplied: compressed.compressionApplied,
      suppressedFields: compressed.suppressedFields,
      reason: compressed.reason,
      stageLockApplied: stageDecision.stageLockApplied === true,
      stageRegressionBlocked: stageDecision.stageRegressionBlocked === true,
    },
  };
};
