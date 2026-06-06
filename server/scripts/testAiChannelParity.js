import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { AI_AGENT_CHANNELS } from "../services/aiChannelAdapterService.js";
import { generateUnifiedAiReply } from "../services/aiConversationOrchestrator.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

process.env.AI_SUPPORT_DEBUG = process.env.AI_SUPPORT_DEBUG || "1";

const text = (value = "") => String(value ?? "").trim();
const stableStringify = (value) => {
  const seen = new WeakSet();
  const sortValue = (input) => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (!input || typeof input !== "object") return input;
    if (seen.has(input)) return null;
    seen.add(input);
    return Object.keys(input).sort().reduce((acc, key) => {
      acc[key] = sortValue(input[key]);
      return acc;
    }, {});
  };
  return JSON.stringify(sortValue(value));
};
const normalizeId = (value = "") => text(value).toLowerCase();
const normalizeProductEntry = (product = {}) => ({
  id: text(product.id || product.product_id || product.variant_id || product.sku || ""),
  name: text(product.name || product.title || product.product_name || ""),
  image_url: text(product.image_url || product.image || product.main_image || ""),
  price: text(product.price || product.display_price || product.selected_display_price || ""),
  available_sizes: Array.isArray(product.available_sizes || product.sizes) ? (product.available_sizes || product.sizes).map((item) => text(item)).filter(Boolean) : [],
  product_url: text(product.product_url || product.url || ""),
  color: text(product.color || product.matched_variant_color || ""),
});
const normalizeCardEntry = (card = {}) => ({
  id: text(card.id || card.product_id || card.variant_id || card.sku || ""),
  name: text(card.name || card.title || card.product_name || ""),
  image_url: text(card.image_url || card.image || card.main_image || ""),
  price: text(card.price || card.display_price || card.selected_display_price || ""),
  available_sizes: Array.isArray(card.available_sizes || card.sizes) ? (card.available_sizes || card.sizes).map((item) => text(item)).filter(Boolean) : [],
  product_url: text(card.product_url || card.url || ""),
  color: text(card.color || card.matched_variant_color || ""),
});
const normalizeImageCardEntry = (card = {}) => ({
  product_id: text(card.product_id || card.id || card.product?.id || ""),
  color: text(card.color || card.color_name || card.matched_variant_color || card.subtitle || ""),
  url: text(card.url || card.image_url || card.image || card.main_image || ""),
});
const normalizeQuickActionEntry = (item = {}) => ({
  label: text(item?.label || item?.text || item?.title || item?.value || item),
  value: text(item?.value || item?.label || item?.text || item?.title || item),
  action: text(item?.action || item?.type || item?.id || ""),
});
const normalizeDraftOrder = (draft = null) => {
  if (!draft) return null;
  return {
    product_id: text(draft.product_id || draft.productId || ""),
    variant_id: text(draft.variant_id || draft.variantId || ""),
    quantity: Number(draft.quantity || 0),
    customer_name: text(draft.customer_name || draft.customerName || ""),
    customer_phone: text(draft.customer_phone || draft.customerPhone || ""),
    customer_address: text(draft.customer_address || draft.customerAddress || ""),
    unit_price: Number(draft.unit_price || 0),
    total_amount: Number(draft.total_amount || 0),
  };
};
/*
    reply.answer = "تمام يا باشا، ابعتلي اللي في بالك وأنا أظبطهولك.";
    reply.detected_intent = "product_discovery";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل محتاج توجيه سريع عشان يحدد أنسب اختيار.",
      sales_stage: "DISCOVERY",
      reply_goal: "clarify_need",
      next_best_action: "ask_one_useful_question",
      confidence: 0.61,
      why_this_reply: "السؤال عام، فالأفضل أوضح اختيار واحد وأطلب توضيح بسيط.",
      detected_entities: { product_context_present: false, buying_intent: false, objection: false },
    });
  } else if (testCaseId === "product_size_combo") {
    reply.answer = "تمام، مقاس 42 موجود. تحب أحجزهولك؟";
    reply.detected_intent = "size_question";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل مهتم بمنتج محدد وبيأكد المقاس.",
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
      confidence: 0.84,
      why_this_reply: "فيه منتج واضح والمقاس هو المعلومة الناقصة قبل الحجز.",
      detected_entities: { product_name: activeProduct.name, size: "42", product_context_present: true, buying_intent: false },
    });
  } else if (testCaseId === "price_objection_new") {
    reply.answer = "فاهمك يا باشا، لو السعر مش مناسب أطلعلك بديل أقرب للمزانية.";
    reply.detected_intent = "price_objection";
    reply.suggested_products = [catalog.jordan4Grey];
    reply.product_cards = [catalog.jordan4Grey];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل شايف السعر عالي وعايز بديل أو طمأنة.",
      sales_stage: "OBJECTION_HANDLING",
      reply_goal: "reduce_objection",
      next_best_action: "reframe_value_or_offer_alternative",
      confidence: 0.86,
      why_this_reply: "الاعتراض على السعر يحتاج تهدئة وعرض بديل قريب بدل رد دفاعي.",
      detected_entities: { objection: true, price_question: true, product_context_present: true },
    });
  } else if (testCaseId === "correction_after_wrong_recommendation") {
    reply.answer = "تمام معاك، قصدك موديل تاني ولا لون مختلف؟";
    reply.detected_intent = "correction";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل بيصحح الاختيار وعايز إعادة توجيه سريعة.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.79,
      why_this_reply: "العميل صحح الاختيار، فالأفضل أطلب توضيح بسيط عن الموديل أو اللون.",
      detected_entities: { confusion_or_correction: true, product_context_present: true },
    });
  } else if (testCaseId === "buying_intent_missing_size") {
    reply.answer = "تمام يا باشا، محتاج المقاس بس وأجهزهولك.";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل جاهز للشراء لكن المقاس لسه ناقص.",
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
      confidence: 0.9,
      why_this_reply: "العميل جاهز للشراء، وأفضل خطوة هي طلب المقاس قبل إنشاء الطلب.",
      detected_entities: { buying_intent: true, product_context_present: true, size: "" },
    });
  } else if (testCaseId === "buying_intent_size_known") {
    reply.answer = "تمام يا باشا، مقاس 42 موجود. أجهزلك الطلب؟";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-known-size`,
      product_id: activeProduct.id,
      variant_id: `${activeProduct.id}-42`,
      quantity: 1,
      customer_name: "",
      customer_phone: "",
      customer_address: "",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل جاهز للشراء والمقاس اتحدد بالفعل.",
      sales_stage: "DRAFT_ORDER",
      reply_goal: "collect_order_fields",
      next_best_action: "collect_order_fields",
      confidence: 0.92,
      why_this_reply: "المقاس معروف فالأفضل نبدأ جمع بيانات الطلب بدل الأسئلة العامة.",
      detected_entities: { buying_intent: true, product_context_present: true, size: "42" },
    });
  } else if (testCaseId === "image_request_after_product_card") {
    reply.answer = "حاضر، أبعتهالك بصور إضافية لنفس الشكل.";
    reply.detected_intent = "more_images";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.visual_attachments = [{
      type: "image_card",
      product_id: activeProduct.id,
      title: activeProduct.name,
      subtitle: activeProduct.color,
      url: activeProduct.image,
      color: activeProduct.color,
    }];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل عايز صور أوضح لنفس المنتج قبل ما يقرر.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.81,
      why_this_reply: "الطلب هنا عن الصور، فالأفضل أرسل صور إضافية لنفس المنتج بدل تغيير المسار.",
      detected_entities: { image_request: true, product_context_present: true },
    });
  } else if (testCaseId === "alternative_request_after_rejection") {
    reply.answer = "تمام يا باشا، أطلعلك بديل شبهه جدًا.";
    reply.detected_intent = "alternatives";
    reply.suggested_products = [catalog.jordan4Grey, catalog.jordan1Low];
    reply.product_cards = [catalog.jordan4Grey, catalog.jordan1Low];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل رفض الاختيار الحالي وعايز بديل قريب.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.85,
      why_this_reply: "بعد الرفض، الأفضل عرض بديل مشابه بدل تكرار نفس المنتج.",
      detected_entities: { alternative_request: true, product_context_present: true },
    });
  }
  return {
    product_id: text(draft.product_id || draft.productId || ""),
    variant_id: text(draft.variant_id || draft.variantId || ""),
    quantity: Number(draft.quantity || 0),
    customer_name: text(draft.customer_name || draft.customerName || ""),
    customer_phone: text(draft.customer_phone || draft.customerPhone || ""),
    customer_address: text(draft.customer_address || draft.customerAddress || ""),
    unit_price: Number(draft.unit_price || 0),
    total_amount: Number(draft.total_amount || 0),
  };
};
*/
const normalizeReasoning = (reasoning = null) => {
  if (!reasoning) return null;
  return {
    customer_meaning: text(reasoning.customer_meaning || ""),
    sales_stage: text(reasoning.sales_stage || ""),
    reply_goal: text(reasoning.reply_goal || ""),
    next_best_action: text(reasoning.next_best_action || ""),
    confidence: Number(reasoning.confidence || 0),
    why_this_reply: text(reasoning.why_this_reply || ""),
    detected_entities: normalizeDetectedEntities(reasoning.detected_entities || {}),
  };
};
const normalizeDetectedEntities = (value = {}) => {
  if (!value || typeof value !== "object") return {};
  return {
    product_name: text(value.product_name || ""),
    brand: text(value.brand || ""),
    model: text(value.model || ""),
    size: text(value.size || ""),
    color: text(value.color || ""),
    price_question: Boolean(value.price_question),
    objection: Boolean(value.objection),
    buying_intent: Boolean(value.buying_intent),
    comparison: Boolean(value.comparison),
    image_request: Boolean(value.image_request),
    alternative_request: Boolean(value.alternative_request),
    confusion_or_correction: Boolean(value.confusion_or_correction),
    human_handoff: Boolean(value.human_handoff),
    payment_question: Boolean(value.payment_question),
    product_context_present: Boolean(value.product_context_present),
    product_colors: Array.isArray(value.product_colors) ? value.product_colors.map((item) => text(item)).filter(Boolean) : [],
  };
};
const normalizeLeadReasons = (value = []) => (Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []);
const normalizeCloser = (closer = null) => ({
  stage: text(closer?.stage || ""),
  missing_order_fields: Array.isArray(closer?.missing_order_fields)
    ? closer.missing_order_fields.map((item) => text(item)).filter(Boolean)
    : [],
  next_best_question: text(closer?.next_best_question || ""),
  ready_to_confirm_order: Boolean(closer?.ready_to_confirm_order),
  summary: text(closer?.summary || closer?.summary_text || ""),
  next_question_text: text(closer?.next_question_text || ""),
});
const normalizeHandoff = (handoff = null) => ({
  needs_human_support: Boolean(handoff?.needs_human_support),
  conversation_status: text(handoff?.conversation_status || ""),
  reason: text(handoff?.reason || ""),
});
const summarizeUnifiedReply = (reply = {}) => ({
  text: text(reply.text || ""),
  intent: text(reply.intent || ""),
  products: Array.isArray(reply.products) ? reply.products.map(normalizeProductEntry) : [],
  product_cards: Array.isArray(reply.product_cards) ? reply.product_cards.map(normalizeCardEntry) : [],
  image_cards: Array.isArray(reply.image_cards) ? reply.image_cards.map(normalizeImageCardEntry) : [],
  quick_replies: Array.isArray(reply.quick_replies) ? reply.quick_replies.map(normalizeQuickActionEntry) : [],
  actions: Array.isArray(reply.actions) ? reply.actions.map(normalizeQuickActionEntry) : [],
  closer: normalizeCloser(reply.closer),
  missing_order_fields: Array.isArray(reply.missing_order_fields) ? reply.missing_order_fields.map((item) => text(item)).filter(Boolean) : [],
  next_best_question: text(reply.next_best_question || ""),
  ready_to_confirm_order: Boolean(reply.ready_to_confirm_order),
  handoff: normalizeHandoff(reply.handoff),
  draft_order: normalizeDraftOrder(reply.draft_order),
  lead_score: Number(reply.lead_score || 0),
  lead_temperature: text(reply.lead_temperature || ""),
  lead_reasons: normalizeLeadReasons(reply.lead_reasons),
  recommended_sales_action: text(reply.recommended_sales_action || ""),
  customer_meaning: text(reply.customer_meaning || reply.reasoning?.customer_meaning || ""),
  detected_entities: normalizeDetectedEntities(reply.detected_entities || reply.reasoning?.detected_entities || {}),
  sales_stage: text(reply.sales_stage || reply.reasoning?.sales_stage || ""),
  reply_goal: text(reply.reply_goal || reply.reasoning?.reply_goal || ""),
  next_best_action: text(reply.next_best_action || reply.reasoning?.next_best_action || ""),
  confidence: Number(reply.confidence ?? reply.reasoning?.confidence ?? 0),
  why_this_reply: text(reply.why_this_reply || reply.reasoning?.why_this_reply || ""),
  active_product_id: text(reply.active_product_id || reply.personality_layer?.active_product_id || reply.memory_updates?.active_product_id || ""),
  active_variant_id: text(reply.active_variant_id || reply.personality_layer?.active_variant_id || reply.memory_updates?.active_variant_id || ""),
  active_color: text(reply.active_color || reply.personality_layer?.active_color || reply.memory_updates?.active_color || ""),
  active_model_family: text(reply.active_model_family || reply.personality_layer?.active_model_family || reply.memory_updates?.active_model_family || ""),
  memory_updates: stableStringify(reply.memory_updates || {}),
  reasoning: normalizeReasoning(reply.reasoning || null),
});
const eq = (left, right) => stableStringify(left) === stableStringify(right);
const mergeMemory = (memory = {}, updates = {}) => {
  const next = { ...memory };
  Object.entries(updates || {}).forEach(([key, value]) => {
    next[key] = value;
  });
  return next;
};
const compareScenario = ({ inboundText, captures }) => {
  const entries = Object.entries(captures);
  const baseline = entries[0]?.[1];
  const diffs = [];
  let textMatch = true;
  let intentMatch = true;
  let productMatch = true;
  let cardsMatch = true;
  let decisionMatch = true;
  let reasoningMatch = true;

  for (const [channel, capture] of entries.slice(1)) {
    const channelDiffs = [];
    if (!eq(capture.text, baseline.text)) {
      textMatch = false;
      decisionMatch = false;
      channelDiffs.push("text");
    }
    if (!eq(capture.intent, baseline.intent)) {
      intentMatch = false;
      decisionMatch = false;
      channelDiffs.push("intent");
    }
    if (!eq(capture.products, baseline.products) || !eq(capture.product_cards, baseline.product_cards)) {
      productMatch = false;
      decisionMatch = false;
      channelDiffs.push("products");
    }
    if (
      !eq(capture.image_cards, baseline.image_cards) ||
      !eq(capture.quick_replies, baseline.quick_replies) ||
      !eq(capture.actions, baseline.actions)
    ) {
      cardsMatch = false;
      decisionMatch = false;
      channelDiffs.push("cards");
    }
    if (!eq(capture.closer, baseline.closer)) {
      decisionMatch = false;
      channelDiffs.push("closer");
    }
    if (!eq(capture.missing_order_fields, baseline.missing_order_fields)) {
      decisionMatch = false;
      channelDiffs.push("missing_order_fields");
    }
    if (!eq(capture.next_best_question, baseline.next_best_question)) {
      decisionMatch = false;
      channelDiffs.push("next_best_question");
    }
    if (!eq(capture.ready_to_confirm_order, baseline.ready_to_confirm_order)) {
      decisionMatch = false;
      channelDiffs.push("ready_to_confirm_order");
    }
    if (!eq(capture.handoff, baseline.handoff)) {
      decisionMatch = false;
      channelDiffs.push("handoff");
    }
    if (!eq(capture.draft_order, baseline.draft_order)) {
      decisionMatch = false;
      channelDiffs.push("draft_order");
    }
    if (!eq(capture.lead_score, baseline.lead_score)) {
      decisionMatch = false;
      channelDiffs.push("lead_score");
    }
    if (!eq(capture.lead_temperature, baseline.lead_temperature)) {
      decisionMatch = false;
      channelDiffs.push("lead_temperature");
    }
    if (!eq(capture.lead_reasons, baseline.lead_reasons)) {
      decisionMatch = false;
      channelDiffs.push("lead_reasons");
    }
    if (!eq(capture.recommended_sales_action, baseline.recommended_sales_action)) {
      decisionMatch = false;
      channelDiffs.push("recommended_sales_action");
    }
    if (!eq(capture.customer_meaning, baseline.customer_meaning)) {
      decisionMatch = false;
      channelDiffs.push("customer_meaning");
    }
    if (!eq(capture.detected_entities, baseline.detected_entities)) {
      decisionMatch = false;
      channelDiffs.push("detected_entities");
    }
    if (!eq(capture.sales_stage, baseline.sales_stage)) {
      decisionMatch = false;
      channelDiffs.push("sales_stage");
    }
    if (!eq(capture.reply_goal, baseline.reply_goal)) {
      decisionMatch = false;
      channelDiffs.push("reply_goal");
    }
    if (!eq(capture.next_best_action, baseline.next_best_action)) {
      decisionMatch = false;
      channelDiffs.push("next_best_action");
    }
    if (!eq(capture.confidence, baseline.confidence)) {
      decisionMatch = false;
      channelDiffs.push("confidence");
    }
    if (!eq(capture.why_this_reply, baseline.why_this_reply)) {
      decisionMatch = false;
      channelDiffs.push("why_this_reply");
    }
    if (!eq(capture.active_product_id, baseline.active_product_id)) {
      decisionMatch = false;
      channelDiffs.push("active_product_id");
    }
    if (!eq(capture.active_variant_id, baseline.active_variant_id)) {
      decisionMatch = false;
      channelDiffs.push("active_variant_id");
    }
    if (!eq(capture.active_color, baseline.active_color)) {
      decisionMatch = false;
      channelDiffs.push("active_color");
    }
    if (!eq(capture.active_model_family, baseline.active_model_family)) {
      decisionMatch = false;
      channelDiffs.push("active_model_family");
    }
    if (!eq(capture.memory_updates, baseline.memory_updates)) {
      decisionMatch = false;
      channelDiffs.push("memory_updates");
    }
    if (!eq(capture.reasoning, baseline.reasoning)) {
      reasoningMatch = false;
      decisionMatch = false;
      channelDiffs.push("reasoning");
    }
    if (channelDiffs.length) {
      diffs.push({ channel, differences: channelDiffs });
    }
  }

  const status = decisionMatch ? "PASS" : "FAIL";
  const result = {
    inbound_text: inboundText,
    compared_channels: entries.map(([channel]) => channel),
    decision_match: decisionMatch,
    text_match: textMatch,
    intent_match: intentMatch,
    product_match: productMatch,
    cards_match: cardsMatch,
    reasoning_match: reasoningMatch,
    differences: diffs,
    status,
  };
  console.log("[AI_CHANNEL_PARITY_RESULT]", result);
  return result;
};
const validateScenarioExpectations = ({ scenario = {}, capture = {}, channel = "whatsapp" } = {}) => {
  const expectations = scenario.expectations || {};
  const reasoning = capture.reasoning || {};
  const issues = [];
  const firstProductCard = Array.isArray(capture.product_cards) ? capture.product_cards[0] || {} : {};

  if (expectations.sales_stage && reasoning.sales_stage !== expectations.sales_stage) {
    issues.push(`sales_stage=${reasoning.sales_stage || "missing"}`);
  }
  if (expectations.reply_goal && reasoning.reply_goal !== expectations.reply_goal) {
    issues.push(`reply_goal=${reasoning.reply_goal || "missing"}`);
  }
  if (expectations.next_best_action && reasoning.next_best_action !== expectations.next_best_action) {
    issues.push(`next_best_action=${reasoning.next_best_action || "missing"}`);
  }
  if (expectations.rich_product_cards === true) {
    if (!Array.isArray(capture.product_cards) || capture.product_cards.length === 0) {
      issues.push("product_cards_missing");
    }
    if (!Array.isArray(capture.image_cards) || capture.image_cards.length === 0) {
      issues.push("image_cards_missing");
    }
    if (
      !text(firstProductCard.image_url || "") ||
      !text(firstProductCard.price || "") ||
      !Array.isArray(firstProductCard.available_sizes) ||
      !firstProductCard.available_sizes.length ||
      !text(firstProductCard.product_url || "")
    ) {
      issues.push("first_card_missing_rich_fields");
    }
  }
  if (issues.length) {
    throw new Error(`[AI_CHANNEL_PARITY_EXPECTATION_FAIL] ${scenario.id}:${channel} ${issues.join(" | ")}`);
  }
};
const channelConfigs = [
  { key: "whatsapp", channel: AI_AGENT_CHANNELS.WHATSAPP, to: "201000000000" },
  { key: "messenger", channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, to: "100000000000000" },
  { key: "instagram", channel: AI_AGENT_CHANNELS.INSTAGRAM, to: "100000000000000" },
  { key: "website_chat", channel: AI_AGENT_CHANNELS.WEB_CHAT, to: "web-chat-runtime" },
];
const scenarios = [
  "عندك جوردن 4؟",
  "صور أكتر",
  "عايز مقاس 42",
  "مش عاجبني وريني بدائل",
  "عايز أشتري",
  "كلم بني آدم",
];
const parityScenarios = [
  { id: "product_search_jordan", message: "عندك جوردن 4؟", test_case_id: "product_inquiry" },
  {
    id: "rich_cards_jordan4",
    message: "متاح جوردن فور؟",
    test_case_id: "product_inquiry",
    expectations: {
      rich_product_cards: true,
    },
  },
  { id: "more_images", message: "صور أكتر", test_case_id: "more_images" },
  { id: "price_objection", message: "غالي شوية", test_case_id: "price_objection" },
  { id: "size_only", message: "عايز مقاس 42", test_case_id: "size_availability" },
  { id: "alternatives", message: "مش عاجبني وريني بدائل" },
  { id: "buying_intent_generic", message: "عايز أشتري", test_case_id: "buying_intent" },
  { id: "human_takeover", message: "كلم بني آدم", test_case_id: "human_takeover" },
  { id: "buying_missing_size", message: "عايز أشتري", test_case_id: "buying_missing_size" },
  { id: "buying_size_no_phone", message: "عايز أشتري مقاس 42", test_case_id: "buying_size_no_phone" },
  { id: "phone_address_provided", message: "عايز أشتري", test_case_id: "phone_address_provided" },
  { id: "complete_draft_ready", message: "أأكد الطلب", test_case_id: "complete_draft_ready" },
];

parityScenarios.push(
  {
    id: "vague_product_inquiry",
    message: "عندك حاجة حلوة؟",
    test_case_id: "vague_product_inquiry",
    expectations: {
      sales_stage: "DISCOVERY",
      reply_goal: "clarify_need",
      next_best_action: "ask_one_useful_question",
    },
  },
  {
    id: "product_size_combo",
    message: "عندك جوردن 4 مقاس 42؟",
    test_case_id: "product_size_combo",
    expectations: {
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
    },
  },
  {
    id: "price_objection_new",
    message: "غالي",
    test_case_id: "price_objection_new",
    expectations: {
      sales_stage: "OBJECTION_HANDLING",
      reply_goal: "reduce_objection",
      next_best_action: "reframe_value_or_offer_alternative",
    },
  },
  {
    id: "correction_after_wrong_recommendation",
    message: "لا مش ده",
    test_case_id: "correction_after_wrong_recommendation",
    expectations: {
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
    },
  },
  {
    id: "buying_intent_missing_size",
    message: "عايز أشتري",
    test_case_id: "buying_intent_missing_size",
    expectations: {
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
    },
  },
  {
    id: "buying_intent_size_known",
    message: "عايز أشتري مقاس 42",
    test_case_id: "buying_intent_size_known",
    expectations: {
      sales_stage: "DRAFT_ORDER",
      reply_goal: "collect_order_fields",
      next_best_action: "collect_order_fields",
    },
  },
  {
    id: "image_request_after_product_card",
    message: "ابعت صور تاني",
    test_case_id: "image_request_after_product_card",
    expectations: {
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
    },
  },
  {
    id: "alternative_request_after_rejection",
    message: "عايز بديل",
    test_case_id: "alternative_request_after_rejection",
    expectations: {
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
    },
  },
  {
    id: "active_context_color_followup",
    message: "لون واحد؟",
    test_case_id: "active_context_color_followup",
    seedMemory: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      selected_product_context: {
        product_id: "jordan-4-black",
        variant_id: "jordan-4-black-43",
        name: "Jordan 4 Retro Black",
        color: "Black",
        model_family: "air_jordan_4",
      },
      selected_product_id: "jordan-4-black",
      selected_variant_id: "jordan-4-black-43",
      selected_color: "Black",
    },
    expectations: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
    },
  },
  {
    id: "active_context_size_followup",
    message: "طب مقاس 42؟",
    test_case_id: "active_context_size_followup",
    seedMemory: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      selected_product_context: {
        product_id: "jordan-4-black",
        variant_id: "jordan-4-black-43",
        name: "Jordan 4 Retro Black",
        color: "Black",
        model_family: "air_jordan_4",
      },
      selected_product_id: "jordan-4-black",
      selected_variant_id: "jordan-4-black-43",
      selected_color: "Black",
    },
    expectations: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
    },
  },
  {
    id: "active_context_price_followup",
    message: "غالي",
    test_case_id: "active_context_price_followup",
    seedMemory: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      selected_product_context: {
        product_id: "jordan-4-black",
        variant_id: "jordan-4-black-43",
        name: "Jordan 4 Retro Black",
        color: "Black",
        model_family: "air_jordan_4",
      },
      selected_product_id: "jordan-4-black",
      selected_variant_id: "jordan-4-black-43",
      selected_color: "Black",
    },
    expectations: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
    },
  },
  {
    id: "active_context_more_images_followup",
    message: "صور أكتر",
    test_case_id: "active_context_more_images_followup",
    seedMemory: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      selected_product_context: {
        product_id: "jordan-4-black",
        variant_id: "jordan-4-black-43",
        name: "Jordan 4 Retro Black",
        color: "Black",
        model_family: "air_jordan_4",
      },
      selected_product_id: "jordan-4-black",
      selected_variant_id: "jordan-4-black-43",
      selected_color: "Black",
    },
    expectations: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
    },
  },
  {
    id: "more_images_jordan4",
    message: "ممكن صور جوردن فور",
    test_case_id: "active_context_more_images_followup",
    seedMemory: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      selected_product_context: {
        product_id: "jordan-4-black",
        variant_id: "jordan-4-black-43",
        name: "Jordan 4 Retro Black",
        color: "Black",
        model_family: "air_jordan_4",
      },
      selected_product_id: "jordan-4-black",
      selected_variant_id: "jordan-4-black-43",
      selected_color: "Black",
    },
    expectations: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      rich_product_cards: true,
    },
  },
  {
    id: "more_images_jordan4_all",
    message: "ابعتلي صور جوردن فور كلها",
    test_case_id: "active_context_more_images_followup",
    seedMemory: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      selected_product_context: {
        product_id: "jordan-4-black",
        variant_id: "jordan-4-black-43",
        name: "Jordan 4 Retro Black",
        color: "Black",
        model_family: "air_jordan_4",
      },
      selected_product_id: "jordan-4-black",
      selected_variant_id: "jordan-4-black-43",
      selected_color: "Black",
    },
    expectations: {
      active_product_id: "jordan-4-black",
      active_variant_id: "jordan-4-black-43",
      active_color: "Black",
      active_model_family: "air_jordan_4",
      rich_product_cards: true,
    },
  }
);

const catalog = {
  jordan4: {
    id: "jordan-4-black",
    name: "Jordan 4 Retro Black",
    color: "Black",
    image: "https://example.com/jordan-4-black.jpg",
    price: 4200,
    sizes: ["40", "41", "42", "43"],
    variants: [
      {
        id: "jordan-4-black-variant",
        variant_id: "jordan-4-black-variant",
        color: "Black",
        size: "40,41,42,43",
        image_url: "https://example.com/jordan-4-black.jpg",
        display_price: 4200,
      },
      {
        id: "jordan-4-grey-variant",
        variant_id: "jordan-4-grey-variant",
        color: "Grey",
        size: "40,41,42,43",
        image_url: "https://example.com/jordan-4-grey.jpg",
        display_price: 4200,
      },
    ],
    product_variant_images: [
      { variant_id: "jordan-4-black-variant", color_name: "Black", image_url: "https://example.com/jordan-4-black.jpg" },
      { variant_id: "jordan-4-grey-variant", color_name: "Grey", image_url: "https://example.com/jordan-4-grey.jpg" },
    ],
  },
  jordan4Grey: {
    id: "jordan-4-grey",
    name: "Jordan 4 Retro Grey",
    color: "Grey",
    image: "https://example.com/jordan-4-grey.jpg",
    price: 4200,
    sizes: ["40", "41", "42", "43"],
  },
  jordan1Low: {
    id: "jordan-1-low",
    name: "Jordan 1 Low",
    color: "White",
    image: "https://example.com/jordan-1-low.jpg",
    price: 3800,
    sizes: ["41", "42", "43", "44"],
  },
};

const makeReasoning = ({
  customer_meaning = "",
  sales_stage = "",
  reply_goal = "",
  next_best_action = "",
  confidence = 0.82,
  why_this_reply = "",
  detected_entities = {},
} = {}) => ({
  customer_meaning,
  sales_stage,
  reply_goal,
  next_best_action,
  confidence,
  why_this_reply,
  detected_entities,
});

globalThis.fetch = async (_input, init = {}) => {
  const body = JSON.parse(init.body || "{}");
  const messageText = text(body.message || "");
  const memory = body?.metadata?.ai_memory || {};
  const testCaseId = text(body?.metadata?.test_case_id || body?.metadata?.testCaseId || "");
  const activeProduct = memory.selected_product_id === catalog.jordan4Grey.id ? catalog.jordan4Grey : catalog.jordan4;
  const channel = text(body.channel || "");
  const takeover = /بني\s*آدم|human_takeover|كلم\s*بني\s*آدم/i.test(messageText) || memory.status === "human_takeover";
  const hasJordan = /جوردن|jordan|aj4|j4/i.test(messageText);
  const wantsImages = /صور|image|photo/i.test(messageText);
  const wantsPriceObjection = /غالي|سعره عالي|ارخص|أرخص|خصم|ميزانيه|مش عاجبني|مش مناسب/i.test(messageText);
  const wantsSize = /مقاس|size/i.test(messageText);
  const wantsAlternatives = /بدائل|alternatives|مش عاجبني/i.test(messageText);
  const wantsBuy = /عايز أشتري|أشتري|buy|order/i.test(messageText);
  const reply = {
    answer: takeover
      ? "تمام، هحوّلك لبني آدم من الفريق."
      : hasJordan
        ? "أيوه، Jordan 4 متاح. أوريك الصور والمقاسات؟"
        : wantsImages
          ? "أكيد، دي صور أكتر لنفس الموديل."
          : wantsPriceObjection
            ? "فاهمك يا باشا، أطلعلك بديل أقرب على الميزانية."
          : wantsSize
            ? "مقاس 42 متاح على نفس الموديل."
            : wantsAlternatives
              ? "دي بدائل قريبة من نفس الشكل."
              : wantsBuy
                ? "تمام، نبدأ تجهيز الطلب."
                : "أقدر أساعدك في الموديلات والمقاسات.",
    detected_intent: takeover
      ? "human_takeover"
      : hasJordan
        ? "product_search"
        : wantsImages
          ? "more_images"
          : wantsPriceObjection
            ? "price_objection"
          : wantsSize
            ? "size_check"
            : wantsAlternatives
              ? "alternatives"
              : wantsBuy
                ? "buying_intent"
                : "faq",
    confidence: takeover ? 0.99 : 0.94,
    detected_language: "ar",
    tone: "sales",
    suggested_products: takeover ? [] : hasJordan
      ? [activeProduct]
      : wantsPriceObjection
        ? [catalog.jordan4Grey]
      : wantsAlternatives
        ? [catalog.jordan4Grey, catalog.jordan1Low]
        : wantsBuy
          ? [activeProduct]
          : [],
    product_cards: takeover ? [] : hasJordan
      ? [activeProduct]
      : wantsPriceObjection
        ? [catalog.jordan4Grey]
      : wantsAlternatives
        ? [catalog.jordan4Grey, catalog.jordan1Low]
        : wantsBuy
          ? [activeProduct]
          : [],
    visual_attachments: takeover ? [] : wantsImages
      ? [{
          type: "image_card",
          product_id: activeProduct.id,
          title: activeProduct.name,
          subtitle: activeProduct.color,
          url: activeProduct.image,
          color: activeProduct.color,
        }]
      : [],
    quick_replies: takeover ? [] : [
      { label: "المقاسات", value: "المقاسات" },
      { label: "صور أكتر", value: "صور أكتر" },
    ],
    actions: takeover ? [] : [
      { label: "Ask for size", action: "choose_size" },
      { label: "Show alternatives", action: "show_alternatives" },
      { label: "Escalate", action: "escalate_to_human" },
    ],
    memory_updates: takeover
      ? { status: "human_takeover" }
      : hasJordan
        ? {
            selected_product_id: activeProduct.id,
            selected_color: activeProduct.color,
            selected_size: memory.selected_size || "",
            last_intent: "product_search",
          }
        : wantsPriceObjection
          ? {
              selected_product_id: catalog.jordan4Grey.id,
              last_intent: "price_objection",
            }
        : wantsImages
          ? {
              selected_product_id: activeProduct.id,
              last_intent: "more_images",
              last_shown_image_cards: [activeProduct.id],
            }
          : wantsSize
            ? {
                selected_product_id: activeProduct.id,
                selected_size: "42",
                last_intent: "size_check",
              }
            : wantsAlternatives
              ? {
                  last_intent: "alternatives",
                  alternative_flow: true,
                }
              : wantsBuy
                ? {
                    buying_stage: "draft_created",
                    draft_order_id: `draft-${activeProduct.id}`,
                  }
                : {},
    draft_order: wantsBuy && !takeover
      ? {
          draft_order_id: `draft-${activeProduct.id}`,
          product_id: activeProduct.id,
          variant_id: `${activeProduct.id}-${memory.selected_size || "42"}`,
          quantity: 1,
          unit_price: activeProduct.price,
          total_amount: activeProduct.price,
        }
      : null,
    handoff: takeover
      ? { needs_human_support: true, conversation_status: "human_takeover", reason: "customer requested a human" }
      : { needs_human_support: false, conversation_status: "ai_active", reason: "" },
  };
  if (testCaseId === "human_takeover") {
    reply.answer = "تمام، هحوّلك لبني آدم من الفريق.";
    reply.detected_intent = "human_takeover";
    reply.suggested_products = [];
    reply.product_cards = [];
    reply.visual_attachments = [];
    reply.quick_replies = [];
    reply.actions = [];
    reply.memory_updates = { status: "human_takeover" };
    reply.draft_order = null;
    reply.handoff = { needs_human_support: true, conversation_status: "human_takeover", reason: "customer requested a human" };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل طلب تدخل بشري مباشر.",
      sales_stage: "HUMAN_TAKEOVER",
      reply_goal: "handoff_to_human",
      next_best_action: "handoff",
      confidence: 0.99,
      why_this_reply: "طلب العميل واضح، فلازم نحول المحادثة لبني آدم بدون أي لف.",
      detected_entities: { human_handoff: true, product_context_present: false },
    });
  } else if (testCaseId === "product_inquiry") {
    reply.answer = "أيوه، Jordan 4 متاح. أوريك الصور والمقاسات؟";
    reply.detected_intent = "product_search";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_color: activeProduct.color,
      last_intent: "product_search",
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل بيسأل عن موديل محدد وعايز يعرف لو موجود.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.94,
      why_this_reply: "في منتج مطابق في السياق، فالأفضل الرد بإثبات التوفر وفتح باب المقاسات أو الصور.",
      detected_entities: { product_context_present: true, buying_intent: false },
    });
  } else if (testCaseId === "more_images") {
    reply.answer = "أكيد، دي صور أكتر لنفس الموديل.";
    reply.detected_intent = "more_images";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.visual_attachments = [{
      type: "image_card",
      product_id: activeProduct.id,
      title: activeProduct.name,
      subtitle: activeProduct.color,
      url: activeProduct.image,
      color: activeProduct.color,
    }];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      last_intent: "more_images",
      last_shown_image_cards: [activeProduct.id],
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل عايز يشوف صور إضافية لنفس الموديل قبل ما يقرر.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.92,
      why_this_reply: "الطلب مرتبط بالصور، فالأفضل نعرض صور أكتر لنفس المنتج من غير تغيير المسار.",
      detected_entities: { image_request: true, product_context_present: true },
    });
  } else if (testCaseId === "price_objection") {
    reply.answer = "فاهمك يا باشا، أطلعلك بديل أقرب على الميزانية.";
    reply.detected_intent = "price_objection";
    reply.suggested_products = [catalog.jordan4Grey];
    reply.product_cards = [catalog.jordan4Grey];
    reply.memory_updates = {
      selected_product_id: catalog.jordan4Grey.id,
      last_intent: "price_objection",
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل شايف السعر عالي وعايز حل أخف.",
      sales_stage: "OBJECTION_HANDLING",
      reply_goal: "reduce_objection",
      next_best_action: "reframe_value_or_offer_alternative",
      confidence: 0.88,
      why_this_reply: "الاعتراض على السعر محتاج تهدئة وعرض بديل قريب بدل الرد الدفاعي.",
      detected_entities: { objection: true, price_question: true, product_context_present: true },
    });
  } else if (testCaseId === "size_availability") {
    reply.answer = "مقاس 42 متاح على نفس الموديل.";
    reply.detected_intent = "size_check";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_size: "42",
      last_intent: "size_check",
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل بيسأل عن توفر المقاس.",
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
      confidence: 0.9,
      why_this_reply: "مع وجود منتج واضح، السؤال المنطقي التالي هو المقاس المتاح.",
      detected_entities: { size: "42", product_context_present: true },
    });
  } else if (testCaseId === "buying_intent") {
    reply.answer = "تمام يا باشا، نبدأ نجهز الطلب.";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_color: activeProduct.color,
      selected_size: "42",
      last_intent: "buying_intent",
    };
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-intent`,
      product_id: activeProduct.id,
      variant_id: `${activeProduct.id}-42`,
      quantity: 1,
      customer_name: "",
      customer_phone: "",
      customer_address: "",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل أعلن نية الشراء، فالمطلوب الآن استكمال البيانات الناقصة.",
      sales_stage: "DRAFT_ORDER",
      reply_goal: "collect_order_fields",
      next_best_action: "collect_order_fields",
      confidence: 0.95,
      why_this_reply: "البنية الشرائية جاهزة، فالأفضل نكمل الحقول المطلوبة بدل الرد العام.",
      detected_entities: { buying_intent: true, product_context_present: true, size: "42" },
    });
  }
  if (testCaseId === "buying_missing_size") {
    reply.answer = "تمام يا باشا، محتاج المقاس بس عشان أتأكد إنه متوفر.";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_color: activeProduct.color,
      last_intent: "buying_intent",
    };
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-missing-size`,
      product_id: activeProduct.id,
      variant_id: "",
      quantity: 1,
      customer_name: "",
      customer_phone: "",
      customer_address: "",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.closer = {
      stage: "BUYING_INTENT",
      missing_order_fields: ["size", "customer_name", "customer_phone", "customer_address"],
      next_best_question: "which_size",
      ready_to_confirm_order: false,
      summary: "",
      next_question_text: "تمام يا باشا، محتاج المقاس بس عشان أتأكد إنه متوفر.",
    };
    reply.missing_order_fields = reply.closer.missing_order_fields;
    reply.next_best_question = reply.closer.next_best_question;
    reply.ready_to_confirm_order = false;
  } else if (testCaseId === "buying_size_no_phone") {
    reply.answer = "ابعتلي رقم الموبايل عشان نأكد الطلب.";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_color: activeProduct.color,
      selected_size: "42",
      last_intent: "buying_intent",
    };
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-size-42`,
      product_id: activeProduct.id,
      variant_id: `${activeProduct.id}-42`,
      quantity: 1,
      customer_name: "Parity Tester",
      customer_phone: "",
      customer_address: "Cairo",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.closer = {
      stage: "BUYING_INTENT",
      missing_order_fields: ["customer_phone"],
      next_best_question: "customer_phone",
      ready_to_confirm_order: false,
      summary: "",
      next_question_text: "ابعتلي رقم الموبايل عشان نأكد الطلب.",
    };
    reply.missing_order_fields = reply.closer.missing_order_fields;
    reply.next_best_question = reply.closer.next_best_question;
    reply.ready_to_confirm_order = false;
  } else if (testCaseId === "phone_address_provided") {
    reply.answer = "تمام يا باشا، الطلب جاهز. أأكدلك الأوردر؟";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_color: activeProduct.color,
      selected_size: "42",
      customer_name: "Parity Tester",
      customer_phone: "01000000000",
      customer_address: "Cairo, Nasr City",
      last_intent: "buying_intent",
    };
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-contact-ready`,
      product_id: activeProduct.id,
      variant_id: `${activeProduct.id}-42`,
      quantity: 1,
      customer_name: "Parity Tester",
      customer_phone: "01000000000",
      customer_address: "Cairo, Nasr City",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.closer = {
      stage: "BUYING_INTENT",
      missing_order_fields: [],
      next_best_question: "confirm_order",
      ready_to_confirm_order: true,
      summary: reply.answer,
      next_question_text: reply.answer,
    };
    reply.missing_order_fields = [];
    reply.next_best_question = "confirm_order";
    reply.ready_to_confirm_order = true;
  } else if (testCaseId === "complete_draft_ready") {
    reply.answer = "تمام ✅ الطلب جاهز: Jordan 4 Retro Black مقاس 42 لون Black. أأكدلك الأوردر؟";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.memory_updates = {
      selected_product_id: activeProduct.id,
      selected_color: activeProduct.color,
      selected_size: "42",
      last_intent: "buying_intent",
    };
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-ready`,
      product_id: activeProduct.id,
      variant_id: `${activeProduct.id}-42`,
      quantity: 1,
      customer_name: "Parity Tester",
      customer_phone: "01000000000",
      customer_address: "Cairo",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.closer = {
      stage: "BUYING_INTENT",
      missing_order_fields: [],
      next_best_question: "confirm_order",
      ready_to_confirm_order: true,
      summary: reply.answer,
      next_question_text: reply.answer,
    };
    reply.missing_order_fields = [];
    reply.next_best_question = "confirm_order";
    reply.ready_to_confirm_order = true;
  } else if (testCaseId === "vague_product_inquiry") {
    reply.answer = "تمام يا باشا، ابعتلي اللي في بالك وأنا أظبطهولك.";
    reply.detected_intent = "product_discovery";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل محتاج توجيه سريع عشان يحدد أنسب اختيار.",
      sales_stage: "DISCOVERY",
      reply_goal: "clarify_need",
      next_best_action: "ask_one_useful_question",
      confidence: 0.61,
      why_this_reply: "السؤال عام، فالأفضل أوضح اختيار واحد وأطلب توضيح بسيط.",
      detected_entities: { product_context_present: false, buying_intent: false, objection: false },
    });
  } else if (testCaseId === "product_size_combo") {
    reply.answer = "تمام، مقاس 42 موجود. تحب أحجزهولك؟";
    reply.detected_intent = "size_question";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل مهتم بمنتج محدد وبيأكد المقاس.",
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
      confidence: 0.84,
      why_this_reply: "فيه منتج واضح والمقاس هو المعلومة الناقصة قبل الحجز.",
      detected_entities: { product_name: activeProduct.name, size: "42", product_context_present: true, buying_intent: false },
    });
  } else if (testCaseId === "price_objection_new") {
    reply.answer = "فاهمك يا باشا، لو السعر مش مناسب أطلعلك بديل أقرب للمزانية.";
    reply.detected_intent = "price_objection";
    reply.suggested_products = [catalog.jordan4Grey];
    reply.product_cards = [catalog.jordan4Grey];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل شايف السعر عالي وعايز بديل أو طمأنة.",
      sales_stage: "OBJECTION_HANDLING",
      reply_goal: "reduce_objection",
      next_best_action: "reframe_value_or_offer_alternative",
      confidence: 0.86,
      why_this_reply: "الاعتراض على السعر يحتاج تهدئة وعرض بديل قريب بدل رد دفاعي.",
      detected_entities: { objection: true, price_question: true, product_context_present: true },
    });
  } else if (testCaseId === "correction_after_wrong_recommendation") {
    reply.answer = "تمام معاك، قصدك موديل تاني ولا لون مختلف؟";
    reply.detected_intent = "correction";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل بيصحح الاختيار وعايز إعادة توجيه سريعة.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.79,
      why_this_reply: "العميل صحح الاختيار، فالأفضل أطلب توضيح بسيط عن الموديل أو اللون.",
      detected_entities: { confusion_or_correction: true, product_context_present: true },
    });
  } else if (testCaseId === "buying_intent_missing_size") {
    reply.answer = "تمام يا باشا، محتاج المقاس بس وأجهزهولك.";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل جاهز للشراء لكن المقاس لسه ناقص.",
      sales_stage: "SIZE_COLLECTION",
      reply_goal: "collect_size",
      next_best_action: "ask_size",
      confidence: 0.9,
      why_this_reply: "العميل جاهز للشراء، وأفضل خطوة هي طلب المقاس قبل إنشاء الطلب.",
      detected_entities: { buying_intent: true, product_context_present: true, size: "" },
    });
  } else if (testCaseId === "buying_intent_size_known") {
    reply.answer = "تمام يا باشا، مقاس 42 موجود. أجهزلك الطلب؟";
    reply.detected_intent = "buying_intent";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.draft_order = {
      draft_order_id: `draft-${activeProduct.id}-known-size`,
      product_id: activeProduct.id,
      variant_id: `${activeProduct.id}-42`,
      quantity: 1,
      customer_name: "",
      customer_phone: "",
      customer_address: "",
      unit_price: activeProduct.price,
      total_amount: activeProduct.price,
    };
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل جاهز للشراء والمقاس اتحدد بالفعل.",
      sales_stage: "DRAFT_ORDER",
      reply_goal: "collect_order_fields",
      next_best_action: "collect_order_fields",
      confidence: 0.92,
      why_this_reply: "المقاس معروف فالأفضل نبدأ جمع بيانات الطلب بدل الأسئلة العامة.",
      detected_entities: { buying_intent: true, product_context_present: true, size: "42" },
    });
  } else if (testCaseId === "image_request_after_product_card") {
    reply.answer = "حاضر، أبعتهالك بصور إضافية لنفس الشكل.";
    reply.detected_intent = "more_images";
    reply.suggested_products = [activeProduct];
    reply.product_cards = [activeProduct];
    reply.visual_attachments = [{
      type: "image_card",
      product_id: activeProduct.id,
      title: activeProduct.name,
      subtitle: activeProduct.color,
      url: activeProduct.image,
      color: activeProduct.color,
    }];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل عايز صور أوضح لنفس المنتج قبل ما يقرر.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.81,
      why_this_reply: "الطلب هنا عن الصور، فالأفضل أرسل صور إضافية لنفس المنتج بدل تغيير المسار.",
      detected_entities: { image_request: true, product_context_present: true },
    });
  } else if (testCaseId === "alternative_request_after_rejection") {
    reply.answer = "تمام يا باشا، أطلعلك بديل شبهه جدًا.";
    reply.detected_intent = "alternatives";
    reply.suggested_products = [catalog.jordan4Grey, catalog.jordan1Low];
    reply.product_cards = [catalog.jordan4Grey, catalog.jordan1Low];
    reply.reasoning = makeReasoning({
      customer_meaning: "العميل رفض الاختيار الحالي وعايز بديل قريب.",
      sales_stage: "PRODUCT_MATCHED",
      reply_goal: "help_pick_product",
      next_best_action: "offer_options",
      confidence: 0.85,
      why_this_reply: "بعد الرفض، الأفضل عرض بديل مشابه بدل تكرار نفس المنتج.",
      detected_entities: { alternative_request: true, product_context_present: true },
    });
  }
  return {
    ok: true,
    status: 200,
    json: async () => reply,
  };
};

const run = async () => {
  const summaryRows = [];

  for (const scenario of parityScenarios) {
    const inboundText = scenario.message;
    const perChannelCapture = {};
    const memoryByChannel = Object.fromEntries(channelConfigs.map((item) => [item.key, { ...(scenario.seedMemory || {}) }]));

    for (const config of channelConfigs) {
      const reply = await generateUnifiedAiReply({
        tenantId: 1,
        channel: config.channel,
        conversation: {
          id: `parity-${config.key}-${normalizeId(inboundText)}`,
          session_id: `parity-${config.key}-${normalizeId(inboundText)}`,
          customer_name: "Parity Tester",
          customer_phone: config.to,
        },
        customer: {
          id: `customer-${config.key}`,
          name: "Parity Tester",
          phone: config.to,
        },
        message: {
          text: inboundText,
          provider_message_id: `mid-${config.key}-${normalizeId(inboundText)}`,
          metadata: {
            channel: config.channel,
            session_id: `parity-${config.key}-${normalizeId(inboundText)}`,
            customer_name: "Parity Tester",
            customer_phone: config.to,
            provider_message_id: `mid-${config.key}-${normalizeId(inboundText)}`,
            test_case_id: scenario.test_case_id || scenario.id || "",
            ai_memory: memoryByChannel[config.key],
          },
        },
        attachments: [],
        memory: memoryByChannel[config.key],
        providerMessageId: `mid-${config.key}-${normalizeId(inboundText)}`,
      });

      const capture = summarizeUnifiedReply(reply);
      perChannelCapture[config.key] = capture;
      memoryByChannel[config.key] = mergeMemory(memoryByChannel[config.key], reply.memory_updates || {});
      console.log("[AI_CHANNEL_CAPTURE]", {
        inbound_text: inboundText,
        channel: config.key,
        text: capture.text,
        intent: capture.intent,
        products: capture.products,
        product_cards: capture.product_cards,
        image_cards: capture.image_cards,
        quick_replies: capture.quick_replies,
        actions: capture.actions,
        closer: capture.closer,
        missing_order_fields: capture.missing_order_fields,
        next_best_question: capture.next_best_question,
        ready_to_confirm_order: capture.ready_to_confirm_order,
        handoff: capture.handoff,
        draft_order: capture.draft_order,
        lead_score: capture.lead_score,
        lead_temperature: capture.lead_temperature,
        lead_reasons: capture.lead_reasons,
        recommended_sales_action: capture.recommended_sales_action,
        customer_meaning: capture.customer_meaning,
        detected_entities: capture.detected_entities,
        sales_stage: capture.sales_stage,
        reply_goal: capture.reply_goal,
        next_best_action: capture.next_best_action,
        confidence: capture.confidence,
        why_this_reply: capture.why_this_reply,
        memory_updates: capture.memory_updates,
      });
    }

    const comparison = compareScenario({
      inboundText,
      captures: perChannelCapture,
    });
    validateScenarioExpectations({
      scenario,
      capture: perChannelCapture.whatsapp || perChannelCapture[channelConfigs[0].key],
      channel: "whatsapp",
    });
    summaryRows.push({
      scenario_id: scenario.id,
      inbound_text: inboundText,
      status: comparison.status,
      decision_match: comparison.decision_match,
      text_match: comparison.text_match,
      intent_match: comparison.intent_match,
      product_match: comparison.product_match,
      cards_match: comparison.cards_match,
      reasoning_match: comparison.reasoning_match,
      lead_score: perChannelCapture.whatsapp?.lead_score ?? 0,
      lead_temperature: perChannelCapture.whatsapp?.lead_temperature || "",
      recommended_sales_action: perChannelCapture.whatsapp?.recommended_sales_action || "",
      sales_stage: perChannelCapture.whatsapp?.sales_stage || "",
      reply_goal: perChannelCapture.whatsapp?.reply_goal || "",
      differences: comparison.differences.map((item) => `${item.channel}:${item.differences.join(",")}`).join(" | "),
    });
  }

  console.log("\nParity Report");
  console.table(summaryRows);
};

run().catch((error) => {
  console.error("[AI_CHANNEL_PARITY_ERROR]", {
    message: error?.message || String(error),
    stack: error?.stack || "",
  });
  process.exitCode = 1;
});
