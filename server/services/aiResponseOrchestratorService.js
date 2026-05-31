const text = (value = "") => String(value ?? "").trim();

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
    { id: "objection_price_2", weight: 3, text: "معاك حق تسأل، ده من الموديلات اللي خامتها حلوة مقابل السعر.\nتحب أطلعلك بديل أقل؟" },
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
} = {}) => {
  const replyCategory = inferReplyCategory({ intent, customerMessage, selectedSize, availableSizes, productContext });
  const recentReplyTemplateIds = asArray(customerMemory.recentReplyTemplateIds || previousReplies.map((reply) => reply.templateId)).slice(-8);
  const recentReplyCategories = asArray(customerMemory.recentReplyCategories).slice(-8);
  const { template, antiRepetitionApplied } = chooseWeightedTemplate(replyCategory, recentReplyTemplateIds);
  const nextConversationStage =
    replyCategory === "OBJECTION_PRICE" ? RESPONSE_CONVERSATION_STAGES.OBJECTION_HANDLING :
    replyCategory === "PRODUCT_PRESENTATION_FOLLOWUP" ? RESPONSE_CONVERSATION_STAGES.PRODUCT_PRESENTATION_FOLLOWUP :
    replyCategory === "COLOR_SELECTION" ? RESPONSE_CONVERSATION_STAGES.COLOR_SELECTION :
    replyCategory === "ASK_SIZE" || replyCategory.startsWith("SIZE_") ? RESPONSE_CONVERSATION_STAGES.SIZE_SELECTION :
    replyCategory === "CHECKOUT_COLLECTING" ? RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING :
    STAGE_BY_INTENT[intent] || conversationStage || RESPONSE_CONVERSATION_STAGES.DISCOVERY;
  const sizeList = joinSizes(availableSizes, "هراجعهولك");
  const colorList = joinList(availableColors, "المتاح هبعتهولك");
  const replyText = interpolate(template.text, {
    product: selectedProduct?.name || selectedProduct?.title || productContext.productName || "",
    color: selectedColor,
    size: selectedSize,
    sizes: sizeList,
    colors: colorList,
    price: text(price).replace(/\s*جنيه\s*$/i, ""),
    customerName: customerProfile?.firstName || customerProfile?.name || "",
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
    memoryPatch: {
      lastReplyTemplateId: template.id,
      lastReplyCategory: replyCategory,
      recentReplyTemplateIds: unique([...recentReplyTemplateIds, template.id], 8),
      recentReplyCategories: unique([...recentReplyCategories, replyCategory], 8),
      conversationStage: nextConversationStage,
    },
    debug: {
      responseOrchestratorUsed: true,
      replyCategory,
      templateId: template.id,
      ctaType: shouldStartCheckout ? "checkout_details" : shouldSuggestAlternatives ? "suggest_alternatives" : shouldAskSize ? "ask_size" : "none",
      nextConversationStage,
      antiRepetitionApplied,
    },
  };
};
