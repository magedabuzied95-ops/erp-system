const text = (value = "") => String(value ?? "").trim();

export const RESPONSE_CONVERSATION_STAGES = Object.freeze({
  GREETING: "GREETING",
  DISCOVERY: "DISCOVERY",
  PRODUCT_PRESENTATION: "PRODUCT_PRESENTATION",
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
const joinList = (items = [], fallback = "") => unique(items, 8).join(", ") || fallback;

const TEMPLATES = Object.freeze({
  PRODUCT_PRESENTATION: [
    { id: "product_presentation_1", weight: 4, text: "أيوه متاح ✅\nالسعر: {price} جنيه\nالمتاح حاليًا: {sizes}\nتحب أشوفلك مقاس معين؟" },
    { id: "product_presentation_2", weight: 3, text: "موجود حاليًا\nسعره {price} جنيه\nالمقاسات المتاحة: {sizes}" },
    { id: "product_presentation_3", weight: 3, text: "أيوه موجود، ودي التفاصيل\nالسعر: {price}\nالمتاح: {sizes}" },
    { id: "product_presentation_4", weight: 2, text: "لقيته عندي ✅\nالسعر {price} جنيه\nالمقاسات: {sizes}" },
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

const chooseWeightedTemplate = (category, recentTemplateIds = []) => {
  const templates = TEMPLATES[category] || TEMPLATES.PRODUCT_PRESENTATION;
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
    replyCategory === "COLOR_SELECTION" ? RESPONSE_CONVERSATION_STAGES.COLOR_SELECTION :
    replyCategory === "ASK_SIZE" || replyCategory.startsWith("SIZE_") ? RESPONSE_CONVERSATION_STAGES.SIZE_SELECTION :
    replyCategory === "CHECKOUT_COLLECTING" ? RESPONSE_CONVERSATION_STAGES.CHECKOUT_COLLECTING :
    STAGE_BY_INTENT[intent] || conversationStage || RESPONSE_CONVERSATION_STAGES.DISCOVERY;
  const sizeList = joinList(availableSizes, "هراجعهولك");
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
