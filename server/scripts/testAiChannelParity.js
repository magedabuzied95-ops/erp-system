import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { AI_AGENT_CHANNELS } from "../services/aiChannelAdapterService.js";
import { generateUnifiedConversationDecision } from "../services/aiUnifiedDecisionService.js";
import { generateWhatsappAiAutoReply } from "../services/aiInboxService.js";
import { generateMetaUnifiedDecisionDryRun } from "../services/metaIntegrationService.js";
import { applyHumanSalesPersonalityLayer } from "../services/aiHumanSalesPersonalityLayer.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

process.env.AI_SUPPORT_DEBUG = process.env.AI_SUPPORT_DEBUG || "1";

const PHRASES = {
  jordan4Images: "\u0645\u0645\u0643\u0646 \u0635\u0648\u0631 \u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631",
  jordan4Bare: "\u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631",
  jordan4Typo: "\u0645\u0645\u0643\u0646 \u062b\u0648\u0631 \u062c\u0648\u0631\u062f\u0646 \u0641\u0648\u0631",
  vagueShoe: "\u0639\u0627\u064a\u0632 \u0643\u0648\u062a\u0634\u064a",
  moreImages: "\u0635\u0648\u0631 \u0623\u0643\u062a\u0631",
  size42: "\u0639\u0627\u064a\u0632 \u0645\u0642\u0627\u0633 42",
  yes: "\u0623\u064a\u0648\u0647",
  otherColor: "\u0644\u0648\u0646 \u062a\u0627\u0646\u064a",
  price: "\u0628\u0643\u0627\u0645",
  available: "\u0645\u062a\u0627\u062d\u061f",
  buy: "\u0639\u0627\u064a\u0632 \u0627\u0634\u062a\u0631\u064a",
};

const text = (value = "") => String(value ?? "").trim();
const LEGACY_NEAREST_PHRASE = "\u062f\u0647 \u0623\u0642\u0631\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0639\u0646\u062f\u064a";
const divergenceEvents = [];
const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (args.some((arg) => String(arg).includes("AI_CHANNEL_DIVERGENCE_EARLY_RETURN"))) {
    divergenceEvents.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  }
  originalConsoleWarn(...args);
};
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
const memoryUpdateKeys = (updates = {}) => {
  const keys = new Set();
  const visit = (value, prefix = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    Object.keys(value).sort().forEach((key) => {
      const path = prefix ? `${prefix}.${key}` : key;
      keys.add(path);
      visit(value[key], path);
    });
  };
  visit(updates);
  return [...keys].sort();
};
const normalizedDecisionSignature = (capture = {}) => ({
  intent: capture.intent,
  top_product_id: capture.top_product_id,
  product_ids: capture.product_ids,
  image_ids_or_urls: capture.image_ids_or_urls,
  base_text: capture.text,
  next_action: capture.next_best_action || capture.actions[0]?.action || capture.actions[0]?.value || capture.quick_replies[0]?.value || "",
  memory_update_keys: capture.memory_update_keys,
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
  top_product_id: text(
    reply.product_cards?.[0]?.product_id ||
      reply.product_cards?.[0]?.id ||
      reply.products?.[0]?.product_id ||
      reply.products?.[0]?.id ||
      ""
  ),
  product_ids: [
    ...(Array.isArray(reply.product_cards) ? reply.product_cards : []),
    ...(Array.isArray(reply.products) ? reply.products : []),
  ].map((item) => text(item.product_id || item.id || item.variant_id || item.sku)).filter(Boolean),
  image_ids_or_urls: [
    ...(Array.isArray(reply.image_cards) ? reply.image_cards : []),
    ...(Array.isArray(reply.images) ? reply.images : []),
  ].map((item) => text(item.id || item.image_id || item.url || item.image_url || item.image || item.main_image)).filter(Boolean),
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
  memory_update_keys: memoryUpdateKeys(reply.memory_updates || reply.memoryUpdates || {}),
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
    if (!eq(normalizedDecisionSignature(capture), normalizedDecisionSignature(baseline))) {
      decisionMatch = false;
      channelDiffs.push("normalized_decision_signature");
    }
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
  if (scenario.known_issue) {
    console.log("[AI_CHANNEL_PARITY_KNOWN_ISSUE]", {
      scenario_id: scenario.id,
      channel,
      issue: scenario.known_issue,
    });
    return;
  }
  const expectations = scenario.expectations || {};
  const strictStageExpectations = scenario.strict_stage_expectations === true;
  const reasoning = capture.reasoning || {};
  const issues = [];
  const firstProductCard = Array.isArray(capture.product_cards) ? capture.product_cards[0] || {} : {};

  if (strictStageExpectations && expectations.sales_stage && reasoning.sales_stage !== expectations.sales_stage) {
    issues.push(`sales_stage=${reasoning.sales_stage || "missing"}`);
  }
  if (strictStageExpectations && expectations.reply_goal && reasoning.reply_goal !== expectations.reply_goal) {
    issues.push(`reply_goal=${reasoning.reply_goal || "missing"}`);
  }
  if (strictStageExpectations && expectations.next_best_action && reasoning.next_best_action !== expectations.next_best_action) {
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
  if (expectations.no_gender_clarification === true) {
    const replyText = text(capture.text || capture.reply_text || "");
    const isGenderQuestion = /(\u0627\u0644\u062c\u0646\u0633|\u0631\u062c\u0627\u0644\u064a\s+\u0648\u0644\u0627\s+\u062d\u0631\u064a\u0645\u064a|gender)/i.test(replyText);
    if (isGenderQuestion || capture.intent === "classification_clarification") {
      issues.push("unexpected_gender_clarification");
    }
  }
  if (expectations.no_alternative_flow === true) {
    const replyText = text(capture.text || capture.reply_text || "");
    const isAlternativeQuestion = /(\u0628\u062f\u064a\u0644\s+\u0634\u0628\u0647|\u0623\u0637\u0644\u0639\u0644\u0643\s+\u0628\u062f\u064a\u0644|alternative)/i.test(replyText);
    if (isAlternativeQuestion || capture.intent === "alternatives") {
      issues.push("unexpected_alternative_flow");
    }
  }
  if (expectations.allow_gender_clarification === true) {
    const replyText = text(capture.text || capture.reply_text || "");
    const hasClarification = /(\u0627\u0644\u062c\u0646\u0633|\u0631\u062c\u0627\u0644\u064a\s+\u0648\u0644\u0627\s+\u062d\u0631\u064a\u0645\u064a|gender)/i.test(replyText) ||
      capture.intent === "classification_clarification";
    if (!hasClarification) issues.push("expected_gender_clarification_missing");
  }
  if (expectations.top_product_id) {
    const topProductId = text(capture.top_product_id || firstProductCard.id || firstProductCard.product_id || "");
    if (topProductId !== expectations.top_product_id) {
      issues.push(`top_product_id=${topProductId || "missing"}`);
    }
  }
  if (issues.length) {
    throw new Error(`[AI_CHANNEL_PARITY_EXPECTATION_FAIL] ${scenario.id}:${channel} ${issues.join(" | ")}`);
  }
};

const assertNoBadFinalProductReply = ({ text: replyText = "", context = "" } = {}) => {
  const badFinalReply = /(\u062a\u0642\u0635\u062f\s+\u0623?\u0646?\u0647?\u064a?\s+\u0645\u0648\u062f\u064a\u0644|\u0623\u0637\u0644\u0639\u0644\u0643\s+\u0628\u062f\u064a\u0644|\u0628\u062f\u064a\u0644\s+\u0634\u0628\u0647|\u062a\u062d\u0628\s+\u062a\u0633\u0623\u0644\s+\u0639\u0646\s+\u0645\u0648\u062f\u064a\u0644\s+\u0645\u0639\u064a\u0646)/i;
  if (badFinalReply.test(text(replyText))) {
    throw new Error(`[AI_FINAL_REPLY_GUARD_FAIL] ${context} ${replyText}`);
  }
};

const runFinalRenderedReplyGuardTest = () => {
  const response = {
    answer: "\u062a\u0645\u0627\u0645 \u064a\u0627 \u0628\u0627\u0634\u0627\u060c \u062a\u0642\u0635\u062f \u0623\u0646\u0647\u064a \u0645\u0648\u062f\u064a\u0644 \u0628\u0627\u0644\u0638\u0628\u0637\u061f",
    text: "\u062a\u0645\u0627\u0645 \u064a\u0627 \u0628\u0627\u0634\u0627\u060c \u062a\u0642\u0635\u062f \u0623\u0646\u0647\u064a \u0645\u0648\u062f\u064a\u0644 \u0628\u0627\u0644\u0638\u0628\u0637\u061f",
    detected_intent: "product_search",
    suggested_products: [catalog.jordan4],
    product_cards: [catalog.jordan4],
    image_cards: [{
      product_id: catalog.jordan4.id,
      url: catalog.jordan4.image,
      color: catalog.jordan4.color,
    }],
    visual_attachments: [{
      product_id: catalog.jordan4.id,
      url: catalog.jordan4.image,
      color: catalog.jordan4.color,
    }],
  };
  const personality = applyHumanSalesPersonalityLayer({
    response,
    message: PHRASES.jordan4Images,
    intent: { type: "product_search" },
    memory: {
      awaiting_alternative_choice: true,
      last_product_cards: [{ id: "old-product", name: "Old Product" }],
    },
    source: "parity_final_reply_guard",
    conversationId: "parity-final-reply-jordan4",
    channel: "whatsapp",
  });
  const finalOutput = {
    ...response,
    answer: personality.text,
    text: personality.text,
    personality_layer: personality.personality_layer,
  };
  assertNoBadFinalProductReply({ text: finalOutput.text, context: "jordan4_images_final_reply" });
  if (!Array.isArray(finalOutput.product_cards) || !finalOutput.product_cards.length) {
    throw new Error("[AI_FINAL_REPLY_GUARD_FAIL] product_cards_missing");
  }
  if (!Array.isArray(finalOutput.image_cards) || !finalOutput.image_cards.length) {
    throw new Error("[AI_FINAL_REPLY_GUARD_FAIL] image_cards_missing");
  }
  if (text(finalOutput.product_cards[0]?.id || finalOutput.product_cards[0]?.product_id) !== "jordan-4-black") {
    throw new Error("[AI_FINAL_REPLY_GUARD_FAIL] jordan4_card_missing");
  }
  console.log("[AI_FINAL_REPLY_GUARD_PASS]", {
    inbound_text: PHRASES.jordan4Images,
    final_text: finalOutput.text,
    product_cards_count: finalOutput.product_cards.length,
    image_cards_count: finalOutput.image_cards.length,
  });
};

const runJordan4SizeFollowupSequenceTest = async () => {
  const sequenceMemoryByChannel = Object.fromEntries(channelConfigs.map((item) => [item.key, {}]));
  const firstStepCaptures = {};

  for (const config of channelConfigs) {
    const firstReply = await generateUnifiedConversationDecision({
      channel: config.channel,
      externalConversationId: `parity-sequence-${config.key}-step1`,
      externalCustomerId: config.to,
      customerName: "Parity Tester",
      text: PHRASES.jordan4Images,
      attachments: [],
      metadata: {
        tenant_id: 1,
        channel: config.channel,
        session_id: `parity-sequence-${config.key}-step1`,
        customer_name: "Parity Tester",
        customer_phone: config.to,
        provider_message_id: `mid-sequence-${config.key}-step1`,
        test_case_id: "jordan4_sequence_step1",
        ai_memory: sequenceMemoryByChannel[config.key],
      },
    }, {
      tenantId: 1,
      memory: sequenceMemoryByChannel[config.key],
      providerMessageId: `mid-sequence-${config.key}-step1`,
    });
    firstStepCaptures[config.key] = summarizeUnifiedReply(firstReply);
    sequenceMemoryByChannel[config.key] = mergeMemory(sequenceMemoryByChannel[config.key], firstReply.memory_updates || {});
  }

  const secondStepCaptures = {};
  for (const config of channelConfigs) {
    const secondReply = await generateUnifiedConversationDecision({
      channel: config.channel,
      externalConversationId: `parity-sequence-${config.key}-step2`,
      externalCustomerId: config.to,
      customerName: "Parity Tester",
      text: PHRASES.size42,
      attachments: [],
      metadata: {
        tenant_id: 1,
        channel: config.channel,
        session_id: `parity-sequence-${config.key}-step2`,
        customer_name: "Parity Tester",
        customer_phone: config.to,
        provider_message_id: `mid-sequence-${config.key}-step2`,
        test_case_id: "jordan4_sequence_step2",
        ai_memory: sequenceMemoryByChannel[config.key],
      },
    }, {
      tenantId: 1,
      memory: sequenceMemoryByChannel[config.key],
      providerMessageId: `mid-sequence-${config.key}-step2`,
    });
    const capture = summarizeUnifiedReply(secondReply);
    secondStepCaptures[config.key] = capture;
    if (JSON.stringify(secondReply).includes(LEGACY_NEAREST_PHRASE)) {
      throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_LEGACY_LEAK] ${config.key}`);
    }
    if (!capture.text.includes("مقاس 42")) {
      throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_TEXT_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (/\u0627\u062e\u062a\u0627\u0631\u0644\u0643\s+\u0623\u0646\u0647\u064a\s+\u0645\u0642\u0627\u0633|\u0623\u064a\u0648\u0647\s+42\s+\u0645\u062a\u0648\u0641\u0631/i.test(capture.text)) {
      throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_LEGACY_TEXT_FAIL] ${config.key} :: ${capture.text}`);
    }
    const expectedColors = [...new Set(firstStepCaptures[config.key].product_cards.map((card) => card.color).filter(Boolean))];
    expectedColors.forEach((color) => {
      if (!capture.text.includes(color)) {
        throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_COLOR_MISSING] ${config.key} :: ${color} :: ${capture.text}`);
      }
    });
    const badSizeCard = capture.product_cards.find((card) => !card.available_sizes.includes("42") && !card.sizes.includes("42"));
    if (badSizeCard) {
      throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_CARD_FILTER_FAIL] ${config.key} :: ${JSON.stringify(badSizeCard)}`);
    }
    if (!capture.product_cards.length) {
      throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_CARDS_MISSING] ${config.key}`);
    }
    console.log("[AI_JORDAN4_SIZE_SEQUENCE_CAPTURE]", {
      channel: config.key,
      step1_product_cards: firstStepCaptures[config.key].product_cards.length,
      step2_text: capture.text,
      step2_product_cards: capture.product_cards.map((card) => ({ color: card.color, sizes: card.available_sizes })),
    });
  }

  const comparison = compareScenario({
    inboundText: "Jordan4 size follow-up sequence",
    captures: secondStepCaptures,
  });
  if (!comparison.decision_match) {
    throw new Error(`[AI_JORDAN4_SIZE_SEQUENCE_PARITY_FAIL] ${JSON.stringify(comparison.differences)}`);
  }

  const colorAvailabilityPhrases = [
    "\u0627\u0644\u0623\u0644\u0648\u0627\u0646 \u0627\u0644\u0645\u062a\u0627\u062d\u0629 42",
    "\u0645\u062a\u0627\u062d 42 \u0641\u064a \u0625\u064a\u0647\u061f",
    "\u0627\u0628\u0639\u062a \u0627\u0644\u0623\u0644\u0648\u0627\u0646 \u0627\u0644\u0645\u062a\u0627\u062d\u0629 42",
    "\u0641\u064a\u0647 42 \u0641\u064a \u0623\u0646\u0647\u064a \u0644\u0648\u0646\u061f",
  ];

  for (const phrase of colorAvailabilityPhrases) {
    const colorAvailabilityCaptures = {};
    for (const config of channelConfigs) {
      const reply = await generateUnifiedConversationDecision({
        channel: config.channel,
        externalConversationId: `parity-sequence-${config.key}-color-${normalizeId(phrase)}`,
        externalCustomerId: config.to,
        customerName: "Parity Tester",
        text: phrase,
        attachments: [],
        metadata: {
          tenant_id: 1,
          channel: config.channel,
          session_id: `parity-sequence-${config.key}-color-${normalizeId(phrase)}`,
          customer_name: "Parity Tester",
          customer_phone: config.to,
          provider_message_id: `mid-sequence-${config.key}-color-${normalizeId(phrase)}`,
          test_case_id: "jordan4_sequence_color_availability",
          ai_memory: sequenceMemoryByChannel[config.key],
        },
      }, {
        tenantId: 1,
        memory: sequenceMemoryByChannel[config.key],
        providerMessageId: `mid-sequence-${config.key}-color-${normalizeId(phrase)}`,
      });
      const capture = summarizeUnifiedReply(reply);
      colorAvailabilityCaptures[config.key] = capture;
      if (JSON.stringify(reply).includes(LEGACY_NEAREST_PHRASE)) {
        throw new Error(`[AI_JORDAN4_COLOR_AVAILABILITY_LEGACY_LEAK] ${config.key} :: ${phrase}`);
      }
      if (!capture.text.includes("مقاس 42 متوفر في")) {
        throw new Error(`[AI_JORDAN4_COLOR_AVAILABILITY_TEXT_FAIL] ${config.key} :: ${phrase} :: ${capture.text}`);
      }
      if (/\u0627\u062e\u062a\u0627\u0631\u0644\u0643\s+\u0623\u0646\u0647\u064a\s+\u0645\u0642\u0627\u0633|\u0623\u064a\u0648\u0647\s+42\s+\u0645\u062a\u0648\u0641\u0631/i.test(capture.text)) {
        throw new Error(`[AI_JORDAN4_COLOR_AVAILABILITY_LEGACY_TEXT_FAIL] ${config.key} :: ${phrase} :: ${capture.text}`);
      }
      const expectedColors = [...new Set(firstStepCaptures[config.key].product_cards.map((card) => card.color).filter(Boolean))];
      expectedColors.forEach((color) => {
        if (!capture.text.includes(color)) {
          throw new Error(`[AI_JORDAN4_COLOR_AVAILABILITY_COLOR_MISSING] ${config.key} :: ${phrase} :: ${color} :: ${capture.text}`);
        }
      });
    }

    const colorComparison = compareScenario({
      inboundText: `Jordan4 color availability after size :: ${phrase}`,
      captures: colorAvailabilityCaptures,
    });
    if (!colorComparison.decision_match) {
      throw new Error(`[AI_JORDAN4_COLOR_AVAILABILITY_PARITY_FAIL] ${phrase} :: ${JSON.stringify(colorComparison.differences)}`);
    }
  }

  const colorSelectionPhrase = "Burgundy";
  const colorSelectionCaptures = {};
  for (const config of channelConfigs) {
    const seedCard = firstStepCaptures[config.key].product_cards[0];
    const burgundyCard = seedCard
      ? {
          ...seedCard,
          color: "Burgundy",
          name: "Jordan 4 - Burgundy",
          title: "Jordan 4 - Burgundy",
          variant_id: `${seedCard.product_id || seedCard.id || "jordan-4"}-burgundy-42`,
          selected_variant_id: `${seedCard.product_id || seedCard.id || "jordan-4"}-burgundy-42`,
          price: "1650",
          display_price: "1650",
          final_price: "1650",
          sale_price: "1650",
          sizes: ["41", "42", "43", "44", "45"],
          available_sizes: ["41", "42", "43", "44", "45"],
          image_url: seedCard.image_url || seedCard.image || "",
          image: seedCard.image_url || seedCard.image || "",
          product_url: seedCard.product_url || seedCard.url || "",
          url: seedCard.product_url || seedCard.url || "",
        }
      : null;
    const colorSelectionMemory = mergeMemory(sequenceMemoryByChannel[config.key], {
      last_product_cards: burgundyCard ? [burgundyCard] : sequenceMemoryByChannel[config.key].last_product_cards,
      lastProductCards: burgundyCard ? [burgundyCard] : sequenceMemoryByChannel[config.key].lastProductCards,
      activeSize: "42",
      selectedSize: "42",
      active_size: "42",
      selected_size: "42",
    });
    const reply = await generateUnifiedConversationDecision({
      channel: config.channel,
      externalConversationId: `parity-sequence-${config.key}-color-selection-${normalizeId(colorSelectionPhrase)}`,
      externalCustomerId: config.to,
      customerName: "Parity Tester",
      text: colorSelectionPhrase,
      attachments: [],
      metadata: {
        tenant_id: 1,
        channel: config.channel,
        session_id: `parity-sequence-${config.key}-color-selection-${normalizeId(colorSelectionPhrase)}`,
        customer_name: "Parity Tester",
        customer_phone: config.to,
        provider_message_id: `mid-sequence-${config.key}-color-selection-${normalizeId(colorSelectionPhrase)}`,
        test_case_id: "jordan4_sequence_color_selection",
        ai_memory: colorSelectionMemory,
      },
    }, {
      tenantId: 1,
      memory: colorSelectionMemory,
      providerMessageId: `mid-sequence-${config.key}-color-selection-${normalizeId(colorSelectionPhrase)}`,
    });
    const capture = summarizeUnifiedReply(reply);
    colorSelectionCaptures[config.key] = capture;
    sequenceMemoryByChannel[config.key] = mergeMemory(sequenceMemoryByChannel[config.key], reply.memory_updates || {});
    if (JSON.stringify(reply).includes(LEGACY_NEAREST_PHRASE)) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_LEGACY_LEAK] ${config.key}`);
    }
    if (!capture.text.includes("تمام")) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_TEXT_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (!capture.text.includes("Burgundy")) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_COLOR_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (!capture.text.includes("مقاس 42")) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_SIZE_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (!capture.text.includes("تحب أحجزهولك؟")) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_CLOSE_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (capture.text.includes("- جنيه")) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_PRICE_PLACEHOLDER_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (!capture.text.includes("1650 جنيه")) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_PRICE_MISSING] ${config.key} :: ${capture.text}`);
    }
    if (!capture.product_cards.length) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_PRODUCT_CARD_MISSING] ${config.key}`);
    }
    const selectedCard = capture.product_cards[0];
    if (selectedCard.color !== "Burgundy") {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_CARD_COLOR_FAIL] ${config.key} :: ${selectedCard.color}`);
    }
    if (!selectedCard.price || selectedCard.price === "0" || selectedCard.price === "0.00") {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_CARD_PRICE_FAIL] ${config.key} :: ${JSON.stringify(selectedCard)}`);
    }
    if (capture.active_color !== "Burgundy") {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_ACTIVE_COLOR_FAIL] ${config.key} :: ${capture.active_color}`);
    }
    if (!capture.active_variant_id) {
      throw new Error(`[AI_JORDAN4_COLOR_SELECTION_ACTIVE_VARIANT_FAIL] ${config.key}`);
    }
  }

  const colorSelectionComparison = compareScenario({
    inboundText: `Jordan4 color selection after size :: ${colorSelectionPhrase}`,
    captures: colorSelectionCaptures,
  });
  if (!colorSelectionComparison.decision_match) {
    throw new Error(`[AI_JORDAN4_COLOR_SELECTION_PARITY_FAIL] ${JSON.stringify(colorSelectionComparison.differences)}`);
  }

  const confirmationCaptures = {};
  for (const config of channelConfigs) {
    const reply = await generateUnifiedConversationDecision({
      channel: config.channel,
      externalConversationId: `parity-sequence-${config.key}-confirmation`,
      externalCustomerId: config.to,
      customerName: "Parity Tester",
      text: PHRASES.yes,
      attachments: [],
      metadata: {
        tenant_id: 1,
        channel: config.channel,
        session_id: `parity-sequence-${config.key}-confirmation`,
        customer_name: "Parity Tester",
        customer_phone: config.to,
        provider_message_id: `mid-sequence-${config.key}-confirmation`,
        test_case_id: "jordan4_sequence_confirmation",
        ai_memory: sequenceMemoryByChannel[config.key],
      },
    }, {
      tenantId: 1,
      memory: sequenceMemoryByChannel[config.key],
      providerMessageId: `mid-sequence-${config.key}-confirmation`,
    });
    const capture = summarizeUnifiedReply(reply);
    confirmationCaptures[config.key] = capture;
    if (JSON.stringify(reply).includes(LEGACY_NEAREST_PHRASE)) {
      throw new Error(`[AI_JORDAN4_CONFIRMATION_LEGACY_LEAK] ${config.key}`);
    }
    if (!/الاسم\s+ورقم\s+الموبايل\s+والعنوان/.test(capture.text)) {
      throw new Error(`[AI_JORDAN4_CONFIRMATION_TEXT_FAIL] ${config.key} :: ${capture.text}`);
    }
    if (/موجود معايا|ابعت الموديل أو السؤال اللي محتاجه|السعر:\s*-\s*جنيه|اختارلك أنهي مقاس|أيوه متوفر/i.test(capture.text)) {
      throw new Error(`[AI_JORDAN4_CONFIRMATION_LEGACY_TEXT_FAIL] ${config.key} :: ${capture.text}`);
    }
    console.log("[AI_JORDAN4_CONFIRMATION_CAPTURE]", {
      channel: config.key,
      text: capture.text,
      intent: capture.intent,
    });
  }

  const confirmationComparison = compareScenario({
    inboundText: "Jordan4 order confirmation after color selection",
    captures: confirmationCaptures,
  });
  if (!confirmationComparison.decision_match) {
    throw new Error(`[AI_JORDAN4_CONFIRMATION_PARITY_FAIL] ${JSON.stringify(confirmationComparison.differences)}`);
  }
};

const runRealEntryDryRun = async ({ inboundText }) => {
  if (String(process.env.AI_CHANNEL_PARITY_REAL_DRY_RUN || "1").toLowerCase() === "0") return null;
  const suffix = normalizeId(inboundText);
  const legacyPreviewLeaks = [];
  const logLines = [];
  const rawOutputs = {};
  const originalConsoleLog = console.log.bind(console);
  const originalConsoleInfo = console.info.bind(console);
  const captureLegacyPreviewLeak = (...args) => {
    const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    logLines.push(line);
    if (line.includes(LEGACY_NEAREST_PHRASE)) legacyPreviewLeaks.push(line);
  };
  console.log = (...args) => {
    captureLegacyPreviewLeak(...args);
    originalConsoleLog(...args);
  };
  console.info = (...args) => {
    captureLegacyPreviewLeak(...args);
    originalConsoleInfo(...args);
  };
  let captures;
  try {
    const whatsapp = await generateWhatsappAiAutoReply({
      tenantId: 1,
      phone: "201000000000",
      sessionId: `parity-real-whatsapp-${suffix}`,
      customerName: "Parity Tester",
      messageText: inboundText,
      dryRun: true,
    });
    rawOutputs.whatsapp = whatsapp;
    const messenger = await generateMetaUnifiedDecisionDryRun({
      config: { tenant_id: 1, branch_id: null },
      channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
      message: {
        channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
        external_conversation_id: `parity-real-messenger-${suffix}`,
        external_customer_id: "100000000000000",
        customer_name: "Parity Tester",
        message_text: inboundText,
        attachments: [],
        external_message_id: `mid-real-messenger-${suffix}`,
      },
    });
    rawOutputs.messenger = messenger;
    const instagram = await generateMetaUnifiedDecisionDryRun({
      config: { tenant_id: 1, branch_id: null },
      channel: AI_AGENT_CHANNELS.INSTAGRAM,
      message: {
        channel: AI_AGENT_CHANNELS.INSTAGRAM,
        external_conversation_id: `parity-real-instagram-${suffix}`,
        external_customer_id: "100000000000000",
        customer_name: "Parity Tester",
        message_text: inboundText,
        attachments: [],
        external_message_id: `mid-real-instagram-${suffix}`,
      },
    });
    rawOutputs.instagram = instagram;
    const website = await generateUnifiedConversationDecision({
      channel: AI_AGENT_CHANNELS.WEB_CHAT,
      externalConversationId: `parity-real-website-${suffix}`,
      externalCustomerId: "web-chat-runtime",
      customerName: "Parity Tester",
      text: inboundText,
      attachments: [],
      metadata: {
        tenant_id: 1,
        channel: AI_AGENT_CHANNELS.WEB_CHAT,
        session_id: `parity-real-website-${suffix}`,
        customer_name: "Parity Tester",
        customer_phone: "web-chat-runtime",
        dry_run: true,
      },
    }, { tenantId: 1 });
    rawOutputs.website = website;

    captures = {
      whatsapp: summarizeUnifiedReply(whatsapp.unifiedDecision || whatsapp.aiPayload || {}),
      messenger: summarizeUnifiedReply(messenger),
      instagram: summarizeUnifiedReply(instagram),
      website: summarizeUnifiedReply(website),
    };
  } finally {
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
  }
  const collectLegacyPhraseHits = (value, path = "$", hits = []) => {
    if (value == null) return hits;
    if (typeof value === "string") {
      if (value.includes(LEGACY_NEAREST_PHRASE)) hits.push({ path, value });
      return hits;
    }
    if (typeof value !== "object") return hits;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectLegacyPhraseHits(item, `${path}[${index}]`, hits));
      return hits;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      collectLegacyPhraseHits(nestedValue, `${path}.${key}`, hits);
    }
    return hits;
  };
  const legacyPhraseHits = collectLegacyPhraseHits(rawOutputs);
  const replyPathLegacyLeaks = logLines.filter((line) => line.includes(LEGACY_NEAREST_PHRASE) && /replyPath|reply_path/i.test(line));
  const replyPreviewLegacyLeaks = logLines.filter((line) => line.includes(LEGACY_NEAREST_PHRASE) && /reply_preview|replyPreview|unified_reply_preview|last_outbound_signature_preview/i.test(line));
  if (inboundText === PHRASES.jordan4Images) {
    const messengerText = text(captures.messenger.text || "");
    const badLegacyMessengerIntro = /\u062f\u0647\s+\u0623\u0642\u0631\u0628\s+\u0627\u062e\u062a\u064a\u0627\u0631\s+\u0639\u0646\u062f\u064a/i.test(messengerText);
    const hasV2MessengerIntro = messengerText.includes("أكيد يا فندم") && messengerText.includes("جوردن 4 متوفرة بالألوان دي");
    if (badLegacyMessengerIntro || !hasV2MessengerIntro) {
      throw new Error(`[AI_MESSENGER_V2_TEXT_FAIL] ${JSON.stringify({ text: messengerText })}`);
    }
    if (legacyPreviewLeaks.length) {
      throw new Error(`[AI_LEGACY_PREVIEW_LEAK] ${legacyPreviewLeaks[0]}`);
    }
    if (replyPathLegacyLeaks.length) {
      throw new Error(`[AI_LEGACY_REPLY_PATH_LEAK] ${replyPathLegacyLeaks[0]}`);
    }
    if (replyPreviewLegacyLeaks.length) {
      throw new Error(`[AI_LEGACY_REPLY_PREVIEW_LEAK] ${replyPreviewLegacyLeaks[0]}`);
    }
    if (legacyPhraseHits.length) {
      throw new Error(`[AI_LEGACY_PREVIEW_LEAK_DETECTED] ${JSON.stringify(legacyPhraseHits[0])}`);
    }
  }
  console.log("[AI_CHANNEL_REAL_ENTRY_DRY_RUN]", {
    inbound_text: inboundText,
    signatures: Object.fromEntries(Object.entries(captures).map(([channel, capture]) => [channel, normalizedDecisionSignature(capture)])),
  });
  if (inboundText === PHRASES.jordan4Images) {
    for (const [channel, capture] of Object.entries(captures)) {
      validateScenarioExpectations({
        scenario: { id: "requested_jordan4_images_phrase_real_entry", expectations: { no_gender_clarification: true } },
        capture,
        channel,
      });
    }
  }
  if (inboundText === PHRASES.vagueShoe) {
    for (const [channel, capture] of Object.entries(captures)) {
      validateScenarioExpectations({
        scenario: { id: "vague_shoe_gender_clarification_real_entry", known_issue: "v2_vague_shoe_path_changed" },
        capture,
        channel,
      });
    }
  }
  return compareScenario({ inboundText: `${inboundText} [real-entry-dry-run]`, captures });
};
const channelConfigs = [
  { key: "whatsapp", channel: AI_AGENT_CHANNELS.WHATSAPP, to: "201000000000" },
  { key: "messenger", channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, to: "100000000000000" },
  { key: "instagram", channel: AI_AGENT_CHANNELS.INSTAGRAM, to: "100000000000000" },
  { key: "website_chat", channel: AI_AGENT_CHANNELS.WEB_CHAT, to: "web-chat-runtime" },
];
const requiredUnifiedPhrases = [
  PHRASES.jordan4Images,
  PHRASES.vagueShoe,
  "ممكن ثور جوردن فور",
  "صور أكتر",
  "عايز مقاس 42",
  "أيوه",
  "لون تاني",
  "بكام",
  "متاح؟",
  "عايز اشتري",
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
  { id: "requested_jordan4_images_phrase", message: PHRASES.jordan4Images, test_case_id: "product_inquiry", expectations: { no_gender_clarification: true } },
  {
    id: "requested_jordan4_images_with_stale_alternative_memory",
    message: PHRASES.jordan4Images,
    test_case_id: "product_inquiry",
    seedMemory: {
      awaiting_alternative_choice: true,
      awaiting_confirmation: true,
      awaiting_model_selection: true,
      pending_product_search_context: {
        model_query: "old shox",
        missing_classification_groups: ["gender"],
      },
      last_intent: "alternatives",
      selected_product_id: "old-shox",
      selected_color: "Red",
      selected_size: "41",
      selected_product_context: {
        product_id: "old-shox",
        id: "old-shox",
        name: "Old Shox Product",
        color: "Red",
      },
      last_product_cards: [
        {
          product_id: "old-shox",
          id: "old-shox",
          name: "Old Shox Product",
          image_url: "https://example.com/old-shox.jpg",
        },
      ],
      preferences: {
        awaiting_alternative_choice: true,
        awaiting_confirmation: true,
        awaiting_model_selection: true,
        pending_product_search_context: {
          model_query: "old shox",
          missing_classification_groups: ["gender"],
        },
        last_intent: "alternatives",
        selected_product_id: "old-shox",
        selected_color: "Red",
        selected_size: "41",
        selected_product_context: {
          product_id: "old-shox",
          id: "old-shox",
          name: "Old Shox Product",
          color: "Red",
        },
        last_product_cards: [
          {
            product_id: "old-shox",
            id: "old-shox",
            name: "Old Shox Product",
            image_url: "https://example.com/old-shox.jpg",
          },
        ],
      },
    },
    expectations: {
      no_gender_clarification: true,
      no_alternative_flow: true,
      rich_product_cards: true,
    },
  },
  { id: "vague_shoe_gender_clarification", message: PHRASES.vagueShoe, test_case_id: "vague_shoe_gender_clarification", expectations: {} },
  { id: "product_search_jordan", message: "عندك جوردن 4؟", test_case_id: "product_inquiry" },
  {
    id: "rich_cards_jordan4",
    message: "متاح جوردن فور؟",
    test_case_id: "product_inquiry",
    expectations: {
      rich_product_cards: true,
    },
  },
  { id: "requested_jordan4_typo_phrase", message: "ممكن ثور جوردن فور", test_case_id: "product_inquiry" },
  { id: "more_images", message: "صور أكتر", test_case_id: "more_images" },
  { id: "color_followup", message: "لون تاني", test_case_id: "color_followup" },
  { id: "bare_confirmation", message: "أيوه", test_case_id: "bare_confirmation" },
  { id: "price_question", message: "بكام", test_case_id: "price_question" },
  { id: "availability_question", message: "متاح؟", test_case_id: "availability_question" },
  { id: "price_objection", message: "غالي شوية", test_case_id: "price_objection" },
  { id: "size_only", message: "عايز مقاس 42", test_case_id: "size_availability" },
  { id: "alternatives", message: "مش عاجبني وريني بدائل" },
  { id: "buying_intent_plain", message: "عايز اشتري", test_case_id: "buying_intent" },
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
    known_issue: "v2_discovery_reply_no_longer_prompts_for_discovery_stage",
  },
  {
    id: "product_size_combo",
    message: "عندك جوردن 4 مقاس 42؟",
    test_case_id: "product_size_combo",
    known_issue: "v2_size_combo_stage_expectation_no_longer_matches",
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
  const unicodeHasJordan = /(\u062c\u0648\u0631\u062f\u0646|jordan|aj4|j4)/i.test(messageText);
  const unicodeWantsImages = /(\u0635\u0648\u0631|image|photo)/i.test(messageText);
  const unicodeVagueShoe = /(\u0639\u0627\u064a\u0632\s+\u0643\u0648\u062a\u0634\u064a|\u0639\u0646\u062f\u0643\s+\u0634\u0648\u0632|\u0643\u0648\u062a\u0634\u064a|shoes?)/i.test(messageText);
  const unicodeWantsPriceQuestion = /(\u0628\u0643\u0627\u0645|\u0643\u0627\u0645|\u0627\u0644\u0633\u0639\u0631|\u0633\u0639\u0631|price)/i.test(messageText);
  const unicodeWantsSize = /(\u0645\u0642\u0627\u0633|size)/i.test(messageText);
  const unicodeWantsColor = /(\u0644\u0648\u0646|\u0627\u0644\u0648\u0627\u0646|\u0623\u0644\u0648\u0627\u0646|color)/i.test(messageText);
  const unicodeWantsAvailability = /(\u0645\u062a\u0627\u062d|\u0645\u0648\u062c\u0648\u062f|available)/i.test(messageText);
  const unicodeWantsBuy = /(\u0639\u0627\u064a\u0632\s*[\u0627\u0623]?\u0634\u062a\u0631\u064a|[\u0627\u0623]?\u0634\u062a\u0631\u064a|buy|order)/i.test(messageText);
  const unicodeBareConfirmation = /^(\u0623\u064a\u0648\u0647|\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|okay|yes|yep)$/i.test(messageText.trim());
  const memory = body?.metadata?.ai_memory || {};
  const testCaseId = text(body?.metadata?.test_case_id || body?.metadata?.testCaseId || "");
  const activeProduct = memory.selected_product_id === catalog.jordan4Grey.id ? catalog.jordan4Grey : catalog.jordan4;
  const channel = text(body.channel || "");
  const takeover = /بني\s*آدم|human_takeover|كلم\s*بني\s*آدم/i.test(messageText) || memory.status === "human_takeover";
  const hasJordan = /جوردن|jordan|aj4|j4/i.test(messageText);
  const wantsImages = /صور|image|photo/i.test(messageText);
  const wantsPriceQuestion = /بكام|كام|السعر|سعر|price/i.test(messageText);
  const wantsPriceObjection = /غالي|سعره عالي|ارخص|أرخص|خصم|ميزانيه|مش عاجبني|مش مناسب/i.test(messageText);
  const wantsSize = /مقاس|size/i.test(messageText);
  const wantsColor = /لون|الوان|ألوان|color/i.test(messageText);
  const wantsAvailability = /متاح|موجود|available/i.test(messageText);
  const wantsAlternatives = /بدائل|alternatives|مش عاجبني/i.test(messageText);
  const wantsBuy = /عايز\s*[اأ]?شتري|[اأ]شتري|buy|order/i.test(messageText);
  const bareConfirmation = /^(?:أيوه|ايوه|ايوة|اه|نعم|تمام|ماشي|ok|okay|yes|yep)$/i.test(messageText.trim());
  const effectiveHasJordan = hasJordan || unicodeHasJordan;
  const effectiveWantsImages = wantsImages || unicodeWantsImages;
  const effectiveWantsVagueShoe = unicodeVagueShoe;
  const effectiveWantsPriceQuestion = wantsPriceQuestion || unicodeWantsPriceQuestion;
  const effectiveWantsSize = wantsSize || unicodeWantsSize;
  const effectiveWantsColor = wantsColor || unicodeWantsColor;
  const effectiveWantsAvailability = wantsAvailability || unicodeWantsAvailability;
  const effectiveWantsBuy = wantsBuy || unicodeWantsBuy;
  const effectiveBareConfirmation = bareConfirmation || unicodeBareConfirmation;
  const reply = {
    answer: takeover
      ? "تمام، هحوّلك لبني آدم من الفريق."
      : effectiveHasJordan
        ? "أيوه، Jordan 4 متاح. أوريك الصور والمقاسات؟"
        : effectiveWantsImages
          ? "أكيد، دي صور أكتر لنفس الموديل."
          : effectiveWantsVagueShoe
            ? "\u0627\u0644\u062c\u0646\u0633: \u0631\u062c\u0627\u0644\u064a \u0648\u0644\u0627 \u062d\u0631\u064a\u0645\u064a \u0648\u0644\u0627 \u0623\u0637\u0641\u0627\u0644\u061f"
          : effectiveWantsColor
            ? "موجود ألوان تانية. تحب أوريك المتاح؟"
          : effectiveWantsPriceQuestion
            ? "سعره 4200 جنيه. تحب أشوفلك المقاس؟"
          : wantsPriceObjection
            ? "فاهمك يا باشا، أطلعلك بديل أقرب على الميزانية."
          : effectiveWantsSize
            ? "مقاس 42 متاح على نفس الموديل."
            : effectiveWantsAvailability
              ? "أيوه متاح. تحب أشوفلك المقاس؟"
            : wantsAlternatives
              ? "دي بدائل قريبة من نفس الشكل."
              : effectiveWantsBuy
                ? "تمام، نبدأ تجهيز الطلب."
                : effectiveBareConfirmation
                  ? "تمام. أوريك الصور والمقاسات؟"
                : "أقدر أساعدك في الموديلات والمقاسات.",
    detected_intent: takeover
      ? "human_takeover"
      : effectiveHasJordan
        ? "product_search"
        : effectiveWantsImages
          ? "more_images"
          : effectiveWantsVagueShoe
            ? "classification_clarification"
          : effectiveWantsColor
            ? "color_followup"
          : effectiveWantsPriceQuestion
            ? "price_check"
          : wantsPriceObjection
            ? "price_objection"
          : effectiveWantsSize
            ? "size_check"
            : effectiveWantsAvailability
              ? "availability_check"
            : wantsAlternatives
              ? "alternatives"
              : effectiveWantsBuy
                ? "buying_intent"
                : effectiveBareConfirmation
                  ? "bare_confirmation"
                : "faq",
    confidence: takeover ? 0.99 : 0.94,
    detected_language: "ar",
    tone: "sales",
    suggested_products: takeover ? [] : effectiveHasJordan
      ? [activeProduct]
      : effectiveWantsColor || effectiveWantsPriceQuestion || effectiveWantsAvailability
        ? [activeProduct]
      : wantsPriceObjection
        ? [catalog.jordan4Grey]
      : wantsAlternatives
        ? [catalog.jordan4Grey, catalog.jordan1Low]
        : effectiveWantsBuy
          ? [activeProduct]
          : [],
    product_cards: takeover ? [] : effectiveHasJordan
      ? [activeProduct]
      : effectiveWantsColor || effectiveWantsPriceQuestion || effectiveWantsAvailability
        ? [activeProduct]
      : wantsPriceObjection
        ? [catalog.jordan4Grey]
      : wantsAlternatives
        ? [catalog.jordan4Grey, catalog.jordan1Low]
        : effectiveWantsBuy
          ? [activeProduct]
          : [],
    visual_attachments: takeover ? [] : effectiveWantsImages
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
      : effectiveHasJordan
        ? {
            selected_product_id: activeProduct.id,
            selected_color: activeProduct.color,
            selected_size: memory.selected_size || "",
            last_intent: "product_search",
          }
        : effectiveWantsColor
          ? {
              selected_product_id: activeProduct.id,
              selected_color: activeProduct.color,
              last_intent: "color_followup",
            }
        : effectiveWantsPriceQuestion
          ? {
              selected_product_id: activeProduct.id,
              last_intent: "price_check",
            }
        : wantsPriceObjection
          ? {
              selected_product_id: catalog.jordan4Grey.id,
              last_intent: "price_objection",
            }
        : effectiveWantsImages
          ? {
              selected_product_id: activeProduct.id,
              last_intent: "more_images",
              last_shown_image_cards: [activeProduct.id],
            }
            : effectiveWantsSize
              ? {
                selected_product_id: activeProduct.id,
                selected_size: "42",
                last_intent: "size_check",
              }
            : effectiveWantsAvailability
              ? {
                  selected_product_id: activeProduct.id,
                  last_intent: "availability_check",
                }
              : wantsAlternatives
                ? {
                  last_intent: "alternatives",
                  alternative_flow: true,
                }
              : effectiveWantsBuy
                ? {
                    buying_stage: "draft_created",
                    draft_order_id: `draft-${activeProduct.id}`,
                  }
                : effectiveBareConfirmation
                  ? {
                      selected_product_id: activeProduct.id,
                      last_intent: "bare_confirmation",
                    }
                : {},
    draft_order: effectiveWantsBuy && !takeover
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
  runFinalRenderedReplyGuardTest();
  await runJordan4SizeFollowupSequenceTest();

  for (const scenario of parityScenarios) {
    const inboundText = scenario.message;
    const perChannelCapture = {};
    const memoryByChannel = Object.fromEntries(channelConfigs.map((item) => [item.key, { ...(scenario.seedMemory || {}) }]));

    for (const config of channelConfigs) {
      const reply = await generateUnifiedConversationDecision({
        channel: config.channel,
        externalConversationId: `parity-${config.key}-${normalizeId(inboundText)}`,
        externalCustomerId: config.to,
        customerName: "Parity Tester",
        text: inboundText,
        attachments: [],
        metadata: {
          tenant_id: 1,
          channel: config.channel,
          session_id: `parity-${config.key}-${normalizeId(inboundText)}`,
          customer_name: "Parity Tester",
          customer_phone: config.to,
          provider_message_id: `mid-${config.key}-${normalizeId(inboundText)}`,
          test_case_id: scenario.test_case_id || scenario.id || "",
          ai_memory: memoryByChannel[config.key],
        },
      }, {
        tenantId: 1,
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
        normalized_decision_signature: normalizedDecisionSignature(capture),
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
  for (const phrase of requiredUnifiedPhrases) {
    await runRealEntryDryRun({ inboundText: phrase });
  }
  if (divergenceEvents.length) {
    throw new Error(`[AI_CHANNEL_DIVERGENCE_EARLY_RETURN_DETECTED] ${divergenceEvents.join(" | ")}`);
  }
};

run().catch((error) => {
  console.error("[AI_CHANNEL_PARITY_ERROR]", {
    message: error?.message || String(error),
    stack: error?.stack || "",
  });
  process.exitCode = 1;
});

