import { AI_AGENT_CHANNELS, normalizeChannel, normalizeOutgoingChannelReply, sendMetaPageReply, sendWhatsAppCloudReply } from "./aiChannelAdapterService.js";
import { appendAiGeneratedSupportReply } from "./aiSupportLogService.js";
import { normalizeWhatsappSessionId } from "./aiInboxService.js";
import { normalizeProductCards } from "./aiProductCards.js";
import { buildSalesConversationIntelligence } from "./aiSalesAgentService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const json = (value) => JSON.stringify(value === undefined ? null : value);

const aiSupportBaseUrl = () =>
  text(
    process.env.INTERNAL_AI_SUPPORT_URL ||
      process.env.AI_SUPPORT_INTERNAL_URL ||
      process.env.AI_SUPPORT_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 8000}`
  ).replace(/\/+$/, "");

const uniqueBy = (items = [], keyFn = (item) => text(item?.id || item?.product_id || item?.name || item?.title)) => {
  const seen = new Set();
  return asArray(items).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const countItems = (value) => (Array.isArray(value) ? value.length : value ? 1 : 0);
const normalizeLeadText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniqueTextList = (values = []) => [...new Set(asArray(values).map((item) => text(item)).filter(Boolean))];
const normalizeTranscriptSessionId = (channel = "", sessionId = "", to = "") => {
  if (normalizeChannel(channel) !== AI_AGENT_CHANNELS.WHATSAPP) return text(sessionId || to);
  return normalizeWhatsappSessionId(sessionId || to, to);
};

const persistWhatsappTranscriptRow = async ({
  tenantId = null,
  channel = AI_AGENT_CHANNELS.WHATSAPP,
  sessionId = "",
  to = "",
  reply = {},
  replyText = "",
  productCards = [],
  deliveryStatus = "sent",
  deliveryError = "",
  externalMessageId = "",
  sourcePath = "ai_conversation_orchestrator_whatsapp_send",
  insertSource = "ai_conversation_orchestrator",
} = {}) => {
  if (normalizeChannel(channel) !== AI_AGENT_CHANNELS.WHATSAPP) return null;
  const safeSessionId = normalizeTranscriptSessionId(channel, sessionId, to);
  if (!tenantId || !safeSessionId) return null;
  const cards = asArray(productCards).length ? productCards : asArray(reply?.product_cards || reply?.suggested_products);
  try {
    return await appendAiGeneratedSupportReply({
      tenantId,
      sessionId: safeSessionId,
      answer: text(replyText || reply?.text || ""),
      confidence: Number(reply?.confidence || reply?.channel_reply?.confidence || 0) || 0,
      detectedIntent: text(reply?.detected_intent || reply?.intent || reply?.channel_reply?.response_type || "whatsapp_ai_reply"),
      suggestedProducts: cards,
      visualAttachments: asArray(reply?.visual_attachments || reply?.image_cards),
      suggestedActions: asArray(reply?.suggested_actions || reply?.actions),
      productCards: cards,
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus,
      deliveryError,
      externalMessageId,
      sourcePath,
      insertSource,
    });
  } catch (error) {
    console.warn("[ai-orchestrator][whatsapp-transcript-save-failed]", {
      tenant_id: tenantId,
      session_id: safeSessionId,
      status: deliveryStatus,
      error: error?.message || String(error),
    });
    return null;
  }
};

const collectProducts = (response = {}) =>
  uniqueBy([
    ...asArray(response.suggested_products),
    ...asArray(response.product_cards),
    ...asArray(response.channel_reply?.product_cards),
    ...asArray(response.unified_reply?.product_cards),
  ]);

const collectActions = (response = {}) => uniqueBy([
  ...asArray(response.actions),
  ...asArray(response.suggested_actions),
  ...asArray(response.quick_funnel?.actions),
], (item) => text(item?.id || item?.action || item?.label || item?.text || item));

const collectQuickReplies = (response = {}) =>
  uniqueBy([
    ...asArray(response.quick_replies),
    ...asArray(response.suggested_quick_replies),
    ...asArray(response.quick_funnel?.options),
  ].map((item) => {
    if (typeof item === "string") return { label: item, value: item };
    return {
      label: text(item?.label || item?.text || item?.title || item?.value || ""),
      value: text(item?.value || item?.label || item?.text || item?.title || ""),
    };
  }), (item) => `${item.label}:${item.value}`);

const collectImageCards = (response = {}, productCards = []) => {
  const cards = [
    ...asArray(response.image_cards || response.visual_cards || response.unified_reply?.image_cards),
    ...asArray(response.visual_attachments).flatMap((attachment) => {
      const url = text(attachment?.url || attachment?.image_url || attachment?.image || "");
      if (!url) return [];
      return [{
        type: text(attachment?.type || "image_card"),
        url,
        title: text(attachment?.title || attachment?.name || attachment?.caption || ""),
        subtitle: text(attachment?.subtitle || attachment?.description || ""),
      }];
    }),
    ...asArray(productCards).map((product) => ({
      type: "product_image_card",
      url: text(product.image_url || product.image || product.main_image || product.thumbnail || ""),
      title: text(product.name || product.title || product.product_name || ""),
      subtitle: text(product.color || product.variant_name || product.sku || ""),
    })).filter((card) => card.url),
  ].map((card) => ({
    type: text(card?.type || "image_card"),
    url: text(card?.url || card?.image_url || card?.image || card?.main_image || ""),
    title: text(card?.title || card?.name || card?.caption || ""),
    subtitle: text(card?.subtitle || card?.description || ""),
  })).filter((card) => card.url);

  return uniqueBy(cards, (card) => `${card.type}:${card.url}:${card.title}:${card.subtitle}`);
};

const calculateLeadScoring = ({
  messageText = "",
  intent = "",
  response = {},
  closer = {},
  handoff = {},
  draftOrder = null,
  products = [],
  productCards = [],
  memoryUpdates = {},
  conversationStageAwareness = null,
  buyingIntentAwareness = null,
} = {}) => {
  const normalizedMessage = normalizeLeadText(messageText);
  const normalizedIntent = normalizeLeadText(intent || response?.detected_intent || response?.intent?.type || response?.intent || "");
  const normalizedProducts = asArray(products);
  const normalizedProductCards = asArray(productCards);
  const reasons = [];

  const hasHumanRequest =
    handoff?.needs_human_support === true ||
    conversationStageAwareness?.is_handoff === true ||
    /(بني ادم|بني آدم|human|agent|موظف|حد من الفريق|كلم حد|كلم واحد|عايز اكلم|عايز اكلم بني ادم|كلم بني ادم)/i.test(normalizedMessage);
  const angryComplaint =
    /(شكوى|مشكلة|غلط|مضايق|زعلان|مستاء|اسوأ|سيء|سيئة|مزعج|complaint|angry|mad|scam|نصب|حرام|مش عاجبني)/i.test(normalizedMessage) ||
    normalizedIntent.includes("complaint") ||
    normalizedIntent.includes("angry") ||
    normalizedIntent.includes("negative");
  if (hasHumanRequest || angryComplaint) {
    if (hasHumanRequest) reasons.push("human_request");
    if (angryComplaint) reasons.push("angry_complaint");
    return {
      lead_score: 0,
      lead_temperature: "cold",
      lead_reasons: uniqueTextList(reasons),
      recommended_sales_action: "escalate_to_human",
    };
  }

  const isBuyingIntent =
    buyingIntentAwareness?.detected === true ||
    conversationStageAwareness?.is_buying_intent === true ||
    closer?.ready_to_confirm_order === true ||
    /(عايز اشتري|عايز أشتري|عاوز اشتري|عاوز أشتري|أشتري|اشتري|order|checkout|كمل الطلب|احجزه|احجزها|عايز أخلص)/i.test(normalizedMessage) ||
    normalizedIntent.includes("buying_intent") ||
    normalizedIntent.includes("checkout") ||
    normalizedIntent.includes("order") ||
    normalizedIntent.includes("close_sale");
  const priceIntent =
    /(سعر|price|غالي|غاليه|ارخص|أرخص|خصم|discount|ميزانية|ميزانيه|سعره عالي|سعره غالي|مش مناسب)/i.test(normalizedMessage) ||
    normalizedIntent.includes("price") ||
    normalizedIntent.includes("objection");
  const sizeIntent =
    /(مقاس|size|نمرة|نمرة\s*\d+|مقاس\s*\d+)/i.test(normalizedMessage) ||
    normalizedIntent.includes("size") ||
    normalizedIntent.includes("availability");
  const moreImagesIntent =
    /(صور اكتر|صور أكتر|صور تانية|صور تانيه|more images|show more images|ابعت صور|شوف الصور|image)/i.test(normalizedMessage) ||
    normalizedIntent.includes("more_images") ||
    normalizedIntent.includes("image");
  const productInquiry =
    /(جوردن|jordan|aj4|j4|موديل|product|منتج|عندك|متاح|available)/i.test(normalizedMessage) ||
    normalizedIntent.includes("product") ||
    normalizedIntent.includes("faq") ||
    normalizedProducts.length > 0 ||
    normalizedProductCards.length > 0;

  let score = 10;
  if (productInquiry) {
    score = Math.max(score, 40);
    reasons.push("product_inquiry");
  } else {
    reasons.push("greeting_or_general");
  }
  if (priceIntent) {
    score = Math.max(score, 55);
    reasons.push(priceIntent && /(غالي|غاليه|سعره عالي|مش مناسب)/i.test(normalizedMessage) ? "price_objection" : "price_interest");
  }
  if (sizeIntent) {
    score = Math.max(score, 70);
    reasons.push("size_availability");
  }
  if (moreImagesIntent) {
    score = Math.max(score, 60);
    reasons.push("more_images");
  }
  if (isBuyingIntent) {
    score = Math.max(score, 90);
    reasons.push("buying_intent");
  }

  const hasProductContext = Boolean(normalizedProducts.length || normalizedProductCards.length || draftOrder?.product_id || draftOrder?.variant_id);
  if (hasProductContext) reasons.push("product_context_present");

  const hasSize =
    Boolean(draftOrder?.size || draftOrder?.selected_size || memoryUpdates?.selected_size) ||
    /(مقاس\s*\d+|size\s*\d+)/i.test(normalizedMessage);
  const hasColor =
    Boolean(draftOrder?.color || draftOrder?.selected_color || memoryUpdates?.selected_color) ||
    /(لون|black|white|grey|gray|red|blue|green|pink|beige|navy)/i.test(normalizedMessage);
  const hasName =
    Boolean(draftOrder?.customer_name || draftOrder?.name || draftOrder?.first_name || memoryUpdates?.customer_name) ||
    /(اسمي|اسمى|الاسم)/i.test(normalizedMessage);
  const hasPhone =
    Boolean(draftOrder?.customer_phone || draftOrder?.phone || memoryUpdates?.customer_phone) ||
    /(01\d{9})/.test(normalizedMessage);
  const hasAddress =
    Boolean(draftOrder?.customer_address || draftOrder?.address || memoryUpdates?.customer_address) ||
    /(العنوان|عنواني|address)/i.test(normalizedMessage);

  if (hasSize) {
    score += 5;
    reasons.push("provided_size");
  }
  if (hasColor) {
    score += 5;
    reasons.push("provided_color");
  }
  if (hasName) {
    score += 5;
    reasons.push("provided_name");
  }
  if (hasPhone) {
    score += 10;
    reasons.push("provided_phone");
  }
  if (hasAddress) {
    score += 5;
    reasons.push("provided_address");
  }

  if (isBuyingIntent && hasProductContext && hasSize && hasPhone && hasAddress) {
    score = Math.max(score, 95);
    reasons.push("ready_to_confirm_order");
  }

  score = Math.max(0, Math.min(100, score));
  const leadTemperature =
    score <= 25 ? "cold" :
    score <= 50 ? "warm" :
    score <= 75 ? "hot" :
    "ready_to_buy";

  const recommendedSalesAction =
    score <= 25 ? "continue_conversation" :
    score <= 50 ? "show_best_options" :
    score <= 75 ? "ask_next_order_field" :
    "confirm_order_or_handoff";

  return {
    lead_score: score,
    lead_temperature: leadTemperature,
    lead_reasons: uniqueTextList(reasons),
    recommended_sales_action: recommendedSalesAction,
  };
};

export const buildUnifiedAiReplyPayload = ({
  tenantId = null,
  branchId = null,
  channel = AI_AGENT_CHANNELS.WEB_CHAT,
  conversation = {},
  customer = {},
  message = {},
  attachments = [],
  memory = null,
  productsContext = null,
  providerMessageId = "",
  response = {},
  earlyReturnReason = "",
  source = "",
} = {}) => {
  const normalizedChannel = normalizeChannel(channel);
  const products = normalizeProductCards(collectProducts(response), { limit: 12 });
  const channelReply = response?.channel_reply || normalizeOutgoingChannelReply({ channel: normalizedChannel, response });
  const productCards = normalizeProductCards(channelReply.product_cards?.length ? channelReply.product_cards : products, { limit: 12 });
  const imageCards = collectImageCards(response, productCards);
  const actions = collectActions(response);
  const quickReplies = collectQuickReplies(response);
  const memoryUpdates = response?.memory_updates || response?.ai_memory_patch || response?.memory_patch || {};
  const activeProductId = text(
    response?.active_product_id ||
      response?.personality_layer?.active_product_id ||
      response?.personalityLayer?.active_product_id ||
      memoryUpdates?.active_product_id ||
      memoryUpdates?.preferences?.active_product_id ||
      ""
  );
  const activeVariantId = text(
    response?.active_variant_id ||
      response?.personality_layer?.active_variant_id ||
      response?.personalityLayer?.active_variant_id ||
      memoryUpdates?.active_variant_id ||
      memoryUpdates?.preferences?.active_variant_id ||
      ""
  );
  const activeColor = text(
    response?.active_color ||
      response?.personality_layer?.active_color ||
      response?.personalityLayer?.active_color ||
      memoryUpdates?.active_color ||
      memoryUpdates?.preferences?.active_color ||
      ""
  );
  const activeModelFamily = text(
    response?.active_model_family ||
      response?.personality_layer?.active_model_family ||
      response?.personalityLayer?.active_model_family ||
      memoryUpdates?.active_model_family ||
      memoryUpdates?.preferences?.active_model_family ||
      ""
  );
  const selectedProductContext =
    response?.selected_product_context ||
    response?.personality_layer?.selected_product_context ||
    response?.personalityLayer?.selected_product_context ||
    memoryUpdates?.selected_product_context ||
    memoryUpdates?.preferences?.selected_product_context ||
    null;
  const handoff = {
    needs_human_support: response?.needs_human_support === true || response?.handoff?.needs_human_support === true,
    conversation_status: text(response?.conversation_status || response?.status || conversation?.status || ""),
    reason: text(response?.fallback_reason || response?.reason || response?.handoff?.reason || earlyReturnReason || ""),
  };
  const replyVariations = asArray(response?.reply_variations || response?.replyVariations);
  const conversationStageAwareness = response?.conversation_stage_awareness || response?.conversationStageAwareness || null;
  const buyingIntentAwareness = response?.buying_intent_awareness || response?.buyingIntentAwareness || null;
  const personalityLayer = response?.personality_layer || response?.personalityLayer || null;
  const customerMeaning = text(response?.customer_meaning || response?.reasoning?.customer_meaning || response?.reply_reasoning?.customer_meaning || "");
  const detectedEntities = response?.detected_entities || response?.reasoning?.detected_entities || response?.reply_reasoning?.detected_entities || {};
  const salesStage = text(response?.sales_stage || response?.reasoning?.sales_stage || response?.reply_reasoning?.sales_stage || "");
  const replyGoal = text(response?.reply_goal || response?.reasoning?.reply_goal || response?.reply_reasoning?.reply_goal || "");
  const nextBestAction = text(response?.next_best_action || response?.reasoning?.next_best_action || response?.reply_reasoning?.next_best_action || "");
  const reasoningConfidence = Number(response?.confidence ?? response?.reasoning?.confidence ?? response?.reply_reasoning?.confidence ?? 0) || 0;
  const whyThisReply = text(response?.why_this_reply || response?.reasoning?.why_this_reply || response?.reply_reasoning?.why_this_reply || "");
  const missingOrderFields = asArray(response?.missing_order_fields || response?.missingOrderFields || response?.closer?.missing_order_fields || response?.closer?.missingOrderFields);
  const nextBestQuestion = text(response?.next_best_question || response?.nextBestQuestion || response?.closer?.next_best_question || response?.closer?.nextBestQuestion || "");
  const readyToConfirmOrder = Boolean(response?.ready_to_confirm_order ?? response?.readyToConfirmOrder ?? response?.closer?.ready_to_confirm_order ?? response?.closer?.readyToConfirmOrder ?? false);
  const draftOrder = response?.draft_order || response?.ai_order || response?.order_draft || null;
  const salesIntelligence = response?.sales_intelligence || null;
  const salesState = response?.sales_state || response?.sales_conversation_state || salesIntelligence?.state || null;
  const journeyEvents = asArray(response?.journey_events || response?.sales_journey_events || salesIntelligence?.journeyEvents);
  const conversion = response?.conversion || response?.conversion_probability || salesIntelligence?.conversion || {};
  const followUp = response?.follow_up || response?.follow_up_recommendation || salesIntelligence?.followUp || {};
  const suggestedActions = asArray(response?.suggested_actions || response?.actions || response?.channel_reply?.suggested_actions || response?.channel_reply?.actions);
  const firstCard = productCards[0] || {};
  console.info("[RICH_PRODUCT_CARDS_READY]", {
    channel: normalizedChannel,
    conversation_id: text(conversation?.id || conversation?.session_id || conversation?.conversation_id || message?.session_id || message?.conversation_id || ""),
    product_cards_count: productCards.length,
    image_cards_count: imageCards.length,
    first_card: {
      product_id: text(firstCard.product_id || firstCard.id || ""),
      variant_id: text(firstCard.variant_id || firstCard.selected_variant_id || firstCard.matched_variant_id || ""),
      name: text(firstCard.name || firstCard.title || firstCard.product_name || ""),
      color: text(firstCard.color || firstCard.matched_variant_color || ""),
      price: text(firstCard.price || ""),
      available_sizes: asArray(firstCard.available_sizes || firstCard.sizes).map((item) => text(item)).filter(Boolean),
      product_url: text(firstCard.product_url || firstCard.url || ""),
      image_url: text(firstCard.image_url || firstCard.image || firstCard.main_image || ""),
    },
  });
  const closer = {
    ...(response?.closer || response?.proactive_closer || salesIntelligence?.closer || {}),
    stage: text(
      response?.closer?.stage ||
      response?.conversation_stage_awareness?.stage ||
      response?.conversationStageAwareness?.stage ||
      response?.personality_layer?.stage ||
      response?.personalityLayer?.stage ||
      salesIntelligence?.state?.current_state ||
      ""
    ),
    missing_order_fields: missingOrderFields,
    next_best_question: nextBestQuestion,
    ready_to_confirm_order: readyToConfirmOrder,
    summary: text(response?.closer?.summary || response?.closer?.summary_text || response?.summary || response?.summary_text || ""),
    next_question_text: text(response?.closer?.next_question_text || response?.next_question_text || ""),
  };
  const channelAdapterPayload = {
    channel: normalizedChannel,
    text: text(response?.answer || response?.text || channelReply.text),
    intent: text(response?.detected_intent || response?.intent?.type || response?.intent || response?.detectedIntent || ""),
    product_cards: productCards,
    image_cards: imageCards,
    quick_replies: [],
    actions: [],
    suggested_actions: suggestedActions,
    draft_order: draftOrder,
    sales_state: salesState,
    journey_events: journeyEvents,
    conversion,
    follow_up: followUp,
    closer,
  };
  console.info("[CHANNEL_CARD_PAYLOAD]", {
    channel: normalizedChannel,
    conversation_id: text(conversation?.id || conversation?.session_id || conversation?.conversation_id || message?.session_id || message?.conversation_id || ""),
    product_cards_count: productCards.length,
    image_cards_count: imageCards.length,
    first_card: {
      product_id: text(firstCard.product_id || firstCard.id || ""),
      variant_id: text(firstCard.variant_id || firstCard.selected_variant_id || firstCard.matched_variant_id || ""),
      name: text(firstCard.name || firstCard.title || firstCard.product_name || ""),
      color: text(firstCard.color || firstCard.matched_variant_color || ""),
      price: text(firstCard.price || ""),
      available_sizes: asArray(firstCard.available_sizes || firstCard.sizes).map((item) => text(item)).filter(Boolean),
      product_url: text(firstCard.product_url || firstCard.url || ""),
      image_url: text(firstCard.image_url || firstCard.image || firstCard.main_image || ""),
    },
  });
  return {
    tenant_id: tenantId,
    branch_id: branchId,
    channel: normalizedChannel,
    conversation_id: text(conversation?.id || conversation?.session_id || conversation?.conversation_id || message?.session_id || message?.conversation_id || ""),
    provider_message_id: text(providerMessageId || message?.provider_message_id || message?.external_message_id || message?.message_id || ""),
    text: text(response?.answer || response?.text || channelReply.text),
    intent: text(response?.detected_intent || response?.intent?.type || response?.intent || response?.detectedIntent || ""),
    confidence: Number(response?.confidence ?? response?.intent_confidence ?? response?.intent?.confidence ?? 0) || 0,
    language: text(response?.detected_language || response?.language || message?.language || customer?.language || ""),
    tone: text(response?.tone || response?.ai_tone || response?.reply_tone || ""),
    products,
    product_cards: productCards,
    image_cards: imageCards,
    quick_replies: [],
    actions: [],
    suggested_actions: suggestedActions,
    active_product_id: activeProductId,
    active_variant_id: activeVariantId,
    active_color: activeColor,
    active_model_family: activeModelFamily,
    selected_product_context: selectedProductContext,
    sales_state: salesState,
    journey_events: journeyEvents,
    conversion,
    follow_up: followUp,
    closer,
    missing_order_fields: missingOrderFields,
    next_best_question: nextBestQuestion,
    ready_to_confirm_order: readyToConfirmOrder,
    memory_updates: memoryUpdates,
    active_product_id: activeProductId,
    active_variant_id: activeVariantId,
    active_color: activeColor,
    active_model_family: activeModelFamily,
    selected_product_context: selectedProductContext,
    draft_order: draftOrder,
    handoff,
    reply_variations: replyVariations,
    conversation_stage_awareness: conversationStageAwareness,
    buying_intent_awareness: buyingIntentAwareness,
    personality_layer: personalityLayer,
    customer_meaning: customerMeaning,
    detected_entities: detectedEntities,
    sales_stage: salesStage,
    reply_goal: replyGoal,
    next_best_action: nextBestAction,
    confidence: reasoningConfidence,
    why_this_reply: whyThisReply,
    reasoning: response?.reasoning || response?.reply_reasoning || null,
    channel_adapter_payload: channelAdapterPayload,
    sales_intelligence: salesIntelligence,
    debug: {
      ...(response?.debug || {}),
      source,
      early_return_reason: text(earlyReturnReason || response?.debug?.early_return_reason || ""),
      products_count: products.length,
      product_cards_count: productCards.length,
      image_cards_count: imageCards.length,
      actions_count: actions.length,
      quick_replies_count: quickReplies.length,
      suggested_actions_count: suggestedActions.length,
      has_memory: Boolean(memory),
      attachments_count: countItems(attachments),
      raw_channel_reply_text: text(channelReply.text),
      reply_variations_count: replyVariations.length,
      personality_stage: text(conversationStageAwareness?.stage || personalityLayer?.stage || ""),
      missing_order_fields_count: missingOrderFields.length,
      ready_to_confirm_order: readyToConfirmOrder,
      active_product_id: activeProductId,
      active_variant_id: activeVariantId,
      active_color: activeColor,
      active_model_family: activeModelFamily,
    },
    channel_reply: channelReply,
    raw_response: response,
  };
};

const buildLogPayload = (payload = {}) => ({
  channel: text(payload.channel || ""),
  conversation_id: text(payload.conversation_id || payload.conversation?.id || payload.message?.session_id || payload.message?.conversation_id || ""),
  provider_message_id: text(payload.provider_message_id || payload.message?.provider_message_id || ""),
  tenant_id: payload.tenant_id ?? payload.tenantId ?? null,
  branch_id: payload.branch_id ?? payload.branchId ?? null,
  inbound_text: text(payload.inbound_text || payload.message_text || payload.message?.text || payload.message?.body || ""),
  intent: text(payload.intent || payload.response?.detected_intent || ""),
  products_count: countItems(payload.products),
  product_cards_count: countItems(payload.product_cards),
  image_cards_count: countItems(payload.image_cards),
  actions_count: countItems(payload.actions),
  early_return_reason: text(payload.early_return_reason || payload.earlyReturnReason || payload.response?.debug?.early_return_reason || ""),
});

const logOrchestrator = (event, payload = {}) => {
  console.log(`[${event}]`, buildLogPayload(payload));
};

const logReasoningFailureRootCause = ({
  intent = "",
  activeProductId = "",
  activeVariantId = "",
  generatedReasoningText = "",
  generatedProductCardsCount = 0,
  generatedImageCardsCount = 0,
  failureReason = "",
  fallbackReplyUsed = false,
  message = "",
} = {}) => {
  console.log("[REASONING_FAILURE_ROOT_CAUSE]", {
    stage: "generateUnifiedAiReply",
    intent: text(intent),
    active_product_id: text(activeProductId),
    active_variant_id: text(activeVariantId),
    generated_reasoning_text: text(generatedReasoningText),
    generated_product_cards_count: Number(generatedProductCardsCount) || 0,
    generated_image_cards_count: Number(generatedImageCardsCount) || 0,
    failure_reason: text(failureReason),
    fallback_reply_used: Boolean(fallbackReplyUsed),
    message: text(message),
  });
};

const fetchUnifiedAiSupportReply = async ({
  tenantId,
  branchId = null,
  channel = AI_AGENT_CHANNELS.WEB_CHAT,
  conversation = {},
  customer = {},
  message = {},
  attachments = [],
  memory = null,
  productsContext = null,
  providerMessageId = "",
} = {}) => {
  const normalizedChannel = normalizeChannel(channel);
  const sessionId = text(conversation?.id || conversation?.session_id || conversation?.conversation_id || message?.session_id || message?.conversation_id || "");
  const bodyText = text(message?.text || message?.message_text || message?.body || "");
  const url = `${aiSupportBaseUrl()}/api/ai-support/chat`;
  logOrchestrator("AI_ORCHESTRATOR_ENTER", {
    tenant_id: tenantId,
    branch_id: branchId,
    channel: normalizedChannel,
    conversation_id: sessionId,
    provider_message_id: providerMessageId,
    inbound_text: bodyText,
    intent: text(message?.intent || ""),
    products: productsContext,
    products_count: countItems(productsContext?.products || productsContext?.product_cards || productsContext?.suggested_products),
    product_cards_count: countItems(productsContext?.product_cards),
    image_cards_count: countItems(productsContext?.image_cards),
    actions_count: countItems(productsContext?.actions),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": String(tenantId || ""),
    },
    body: json({
      tenant_id: tenantId,
      branch_id: branchId,
      channel: normalizedChannel,
      session_id: sessionId,
      message: bodyText || "Customer sent an attachment",
      attachments,
      metadata: {
        ...(message?.metadata && typeof message.metadata === "object" ? message.metadata : {}),
        tenant_id: tenantId,
        branch_id: branchId,
        channel: normalizedChannel,
        session_id: sessionId,
        customer_name: text(customer?.name || customer?.customer_name || conversation?.customer_name || ""),
        customer_id: text(customer?.id || customer?.customer_id || conversation?.customer_id || ""),
        customer_phone: text(customer?.phone || customer?.phone_number || conversation?.customer_phone || ""),
        provider_message_id: text(providerMessageId || message?.provider_message_id || ""),
        ai_memory: memory,
        products_context: productsContext,
      },
    }),
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    logOrchestrator("AI_ORCHESTRATOR_DECISION", {
      tenant_id: tenantId,
      branch_id: branchId,
      channel: normalizedChannel,
      conversation_id: sessionId,
      provider_message_id: providerMessageId,
      inbound_text: bodyText,
      intent: text(raw?.detected_intent || raw?.intent?.type || ""),
      products_count: countItems(raw?.suggested_products || raw?.product_cards),
      product_cards_count: countItems(raw?.product_cards),
      image_cards_count: countItems(raw?.visual_attachments),
      actions_count: countItems(raw?.suggested_actions),
      early_return_reason: text(raw?.fallback_reason || raw?.reason || "request_failed"),
    });
    logReasoningFailureRootCause({
      intent: text(raw?.detected_intent || raw?.intent?.type || message?.intent || ""),
      activeProductId: text(productsContext?.active_product_id || productsContext?.selected_product_id || productsContext?.selected_product_context?.product_id || ""),
      activeVariantId: text(productsContext?.active_variant_id || productsContext?.selected_variant_id || productsContext?.selected_product_context?.variant_id || ""),
      generatedReasoningText: text(raw?.answer || raw?.text || raw?.channel_reply?.text || ""),
      generatedProductCardsCount: countItems(raw?.product_cards || raw?.suggested_products || raw?.channel_reply?.product_cards),
      generatedImageCardsCount: countItems(raw?.image_cards || raw?.visual_attachments),
      failureReason: text(raw?.fallback_reason || raw?.reason || "request_failed"),
      fallbackReplyUsed: true,
      message: bodyText,
    });
    throw Object.assign(new Error(raw?.message || "Unified AI support request failed"), {
      status: response.status,
      responseBody: raw,
    });
  }
  const salesProducts = collectProducts(raw);
  const salesIntelligence = await buildSalesConversationIntelligence({
    tenantId,
    conversation: {
      ...conversation,
      id: sessionId,
      session_id: sessionId,
      channel: normalizedChannel,
      source: normalizedChannel,
      latest_message_preview: bodyText,
      last_message: bodyText,
    },
    messages: [{
      customer_message: bodyText,
      message_text: bodyText,
      last_message: bodyText,
      channel: normalizedChannel,
      created_at: new Date().toISOString(),
    }],
    draftOrders: asArray(raw.draft_order ? [raw.draft_order] : raw.draft_orders),
    conversationFollowups: asArray(raw.follow_up ? [raw.follow_up] : raw.follow_ups),
    recommendations: salesProducts,
    selectedProduct: salesProducts[0] || productsContext?.selected_product || null,
    currentStateRow: raw.sales_conversation_state || null,
    existingJourneyEvents: asArray(raw.journey_events || raw.sales_journey_events),
    channel: normalizedChannel,
    providerMessageId: text(providerMessageId || message?.provider_message_id || ""),
    traceReason: "unified_ai_support_reply",
  }).catch(() => null);
  const unified = buildUnifiedAiReplyPayload({
    tenantId,
    branchId,
    channel: normalizedChannel,
    conversation: { ...conversation, session_id: sessionId },
    customer,
    message: { ...message, text: bodyText, session_id: sessionId, provider_message_id: providerMessageId },
    attachments,
    memory,
    productsContext,
    providerMessageId,
    response: {
      ...raw,
      sales_intelligence: salesIntelligence || raw.sales_intelligence || null,
      sales_state: salesIntelligence?.state || raw.sales_state || raw.sales_conversation_state || null,
      sales_conversation_state: salesIntelligence?.state || raw.sales_conversation_state || null,
      journey_events: salesIntelligence?.journeyEvents || raw.journey_events || raw.sales_journey_events || [],
      conversion: salesIntelligence?.conversion || raw.conversion || raw.conversion_probability || {},
      follow_up: salesIntelligence?.followUp || raw.follow_up || raw.follow_up_recommendation || {},
      closer: salesIntelligence?.closer || raw.closer || raw.proactive_closer || {},
      draft_order: raw.draft_order || raw.ai_order || raw.order_draft || null,
      suggested_actions: raw.suggested_actions || raw.actions || [],
    },
    source: "ai_support_route",
  });
  const leadScoring = calculateLeadScoring({
    messageText: bodyText,
    intent: unified.intent,
    response: {
      ...raw,
      closer: unified.closer,
      handoff: unified.handoff,
      draft_order: unified.draft_order,
      memory_updates: unified.memory_updates,
    },
    closer: unified.closer,
    handoff: unified.handoff,
    draftOrder: unified.draft_order,
    products: unified.products,
    productCards: unified.product_cards,
    memoryUpdates: unified.memory_updates,
    conversationStageAwareness: unified.conversation_stage_awareness,
    buyingIntentAwareness: unified.buying_intent_awareness,
  });
  unified.lead_score = leadScoring.lead_score;
  unified.lead_temperature = leadScoring.lead_temperature;
  unified.lead_reasons = leadScoring.lead_reasons;
  unified.recommended_sales_action = leadScoring.recommended_sales_action;
  unified.debug = {
    ...(unified.debug || {}),
    lead_score: leadScoring.lead_score,
    lead_temperature: leadScoring.lead_temperature,
    lead_reasons: leadScoring.lead_reasons,
    recommended_sales_action: leadScoring.recommended_sales_action,
  };
  const generatedReasoningText = text(
    raw?.reasoning_reply_engine?.text ||
      raw?.reasoning?.reply_text ||
      raw?.answer ||
      raw?.text ||
      unified?.text ||
      ""
  );
  const generatedImageCardsCount = countItems(raw?.image_cards || raw?.visual_attachments || raw?.channel_reply?.image_cards || raw?.channel_reply?.visual_attachments);
  const failureReason = text(raw?.fallback_reason || raw?.reason || raw?.debug?.early_return_reason || unified?.debug?.early_return_reason || "");
  const fallbackReplyUsed =
    Boolean(failureReason) ||
    !text(generatedReasoningText) ||
    (generatedReasoningText.length > 0 && generatedReasoningText === text(raw?.product_context?.name || raw?.product_context?.title || raw?.suggested_products?.[0]?.name || raw?.suggested_products?.[0]?.title || raw?.product_cards?.[0]?.name || raw?.product_cards?.[0]?.title || ""));
  if (fallbackReplyUsed || failureReason) {
    logReasoningFailureRootCause({
      intent: unified.intent,
      activeProductId: unified.active_product_id,
      activeVariantId: unified.active_variant_id,
      generatedReasoningText,
      generatedProductCardsCount: unified.product_cards.length,
      generatedImageCardsCount,
      failureReason: failureReason || "reasoning_degraded_output",
      fallbackReplyUsed,
      message: bodyText,
    });
  }
  logOrchestrator("AI_ORCHESTRATOR_DECISION", {
    tenant_id: tenantId,
    branch_id: branchId,
    channel: normalizedChannel,
    conversation_id: unified.conversation_id,
    provider_message_id: unified.provider_message_id,
    inbound_text: bodyText,
    intent: unified.intent,
    products_count: unified.products.length,
    product_cards_count: unified.product_cards.length,
    image_cards_count: unified.image_cards.length,
    actions_count: unified.actions.length,
    early_return_reason: unified.debug?.early_return_reason || "",
  });
  logOrchestrator("AI_UNIFIED_REPLY_READY", {
    tenant_id: tenantId,
    branch_id: branchId,
    channel: normalizedChannel,
    conversation_id: unified.conversation_id,
    provider_message_id: unified.provider_message_id,
    intent: unified.intent,
    products_count: unified.products.length,
    product_cards_count: unified.product_cards.length,
    image_cards_count: unified.image_cards.length,
    actions_count: unified.actions.length,
    early_return_reason: unified.debug?.early_return_reason || "",
  });
  return unified;
};

const sendUnifiedReplyThroughChannelAdapter = async ({ channel = AI_AGENT_CHANNELS.WEB_CHAT, to = "", reply = {}, messageText = "", tenantId = null } = {}) => {
  const normalizedChannel = normalizeChannel(channel);
  const adapterUsed =
    normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP
      ? "whatsappAdapter"
      : [AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS.INSTAGRAM].includes(normalizedChannel)
        ? "metaAdapter"
        : "websiteChatAdapter";
  const replySource = reply?.channel_reply ? reply : reply?.unified_reply ? reply.unified_reply : reply;
  const unifiedReply = replySource?.channel_reply
    ? replySource
    : { ...replySource, channel_reply: normalizeOutgoingChannelReply({ channel: normalizedChannel, response: replySource }) };
  logOrchestrator("AI_CHANNEL_ADAPTER_SEND", {
    tenant_id: tenantId,
    channel: normalizedChannel,
    conversation_id: text(replySource?.conversation_id || replySource?.session_id || ""),
    provider_message_id: text(replySource?.provider_message_id || ""),
    inbound_text: text(messageText || ""),
    outbound_text_preview: text(unifiedReply.text || unifiedReply.channel_reply?.text || "").slice(0, 180),
    intent: text(replySource?.intent || replySource?.detected_intent || ""),
    products_count: countItems(replySource?.products || replySource?.suggested_products),
    product_cards_count: countItems(replySource?.product_cards || replySource?.channel_reply?.product_cards),
    image_cards_count: countItems(replySource?.image_cards || replySource?.visual_attachments),
    actions_count: countItems(replySource?.actions || replySource?.suggested_actions),
    early_return_reason: text(replySource?.debug?.early_return_reason || ""),
    adapter_used: adapterUsed,
  });
  let result = null;
  try {
    if (normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP) {
      result = await sendWhatsAppCloudReply({ to, reply: unifiedReply.channel_reply, messageText: messageText || unifiedReply.text || unifiedReply.channel_reply?.text || "" });
    } else if ([AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS.INSTAGRAM].includes(normalizedChannel)) {
      result = await sendMetaPageReply({ channel: normalizedChannel, to, reply: unifiedReply.channel_reply, messageText: messageText || unifiedReply.text || unifiedReply.channel_reply?.text || "" });
    } else {
      result = {
        sent: true,
        reply: unifiedReply.channel_reply,
        messageText: messageText || unifiedReply.text || "",
      };
    }
  } catch (error) {
    result = {
      sent: false,
      error: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
    };
    if (normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP) {
      await persistWhatsappTranscriptRow({
        tenantId,
        channel: normalizedChannel,
        sessionId: replySource?.conversation_id || replySource?.session_id || "",
        to,
        reply: unifiedReply.channel_reply,
        replyText: messageText || unifiedReply.text || unifiedReply.channel_reply?.text || "",
        productCards: asArray(replySource?.product_cards || unifiedReply.channel_reply?.product_cards || replySource?.suggested_products),
        deliveryStatus: "failed",
        deliveryError: error?.message || String(error),
        externalMessageId: "",
        sourcePath: "ai_conversation_orchestrator_whatsapp_send_failed",
        insertSource: "ai_conversation_orchestrator",
      });
    }
    logOrchestrator("AI_CHANNEL_ADAPTER_RESULT", {
      tenant_id: tenantId,
      channel: normalizedChannel,
      conversation_id: text(replySource?.conversation_id || replySource?.session_id || ""),
      provider_message_id: text(replySource?.provider_message_id || ""),
      inbound_text: text(messageText || ""),
      outbound_text_preview: text(unifiedReply.text || unifiedReply.channel_reply?.text || "").slice(0, 180),
      intent: text(replySource?.intent || replySource?.detected_intent || ""),
      products_count: countItems(replySource?.products || replySource?.suggested_products),
      product_cards_count: countItems(replySource?.product_cards || replySource?.channel_reply?.product_cards),
      image_cards_count: countItems(replySource?.image_cards || replySource?.visual_attachments),
      actions_count: countItems(replySource?.actions || replySource?.suggested_actions),
      early_return_reason: text(replySource?.debug?.early_return_reason || ""),
      adapter_used: adapterUsed,
      send_result: result,
    });
    throw error;
  }
  if (normalizedChannel === AI_AGENT_CHANNELS.WHATSAPP) {
    await persistWhatsappTranscriptRow({
      tenantId,
      channel: normalizedChannel,
      sessionId: replySource?.conversation_id || replySource?.session_id || "",
      to,
      reply: unifiedReply.channel_reply,
      replyText: messageText || unifiedReply.text || unifiedReply.channel_reply?.text || "",
      productCards: asArray(replySource?.product_cards || unifiedReply.channel_reply?.product_cards || replySource?.suggested_products),
      deliveryStatus: result?.sent ? "sent" : "failed",
      deliveryError: result?.sent ? "" : result?.error || "",
      externalMessageId: result?.results?.[0]?.messages?.[0]?.id || result?.results?.[0]?.message_id || result?.results?.[0]?.messageId || "",
      sourcePath: "ai_conversation_orchestrator_whatsapp_send",
      insertSource: "ai_conversation_orchestrator",
    });
  }
  logOrchestrator("AI_CHANNEL_ADAPTER_RESULT", {
    tenant_id: tenantId,
    channel: normalizedChannel,
    conversation_id: text(replySource?.conversation_id || replySource?.session_id || ""),
    provider_message_id: text(replySource?.provider_message_id || ""),
    inbound_text: text(messageText || ""),
    outbound_text_preview: text(unifiedReply.text || unifiedReply.channel_reply?.text || "").slice(0, 180),
    intent: text(replySource?.intent || replySource?.detected_intent || ""),
    products_count: countItems(replySource?.products || replySource?.suggested_products),
    product_cards_count: countItems(replySource?.product_cards || replySource?.channel_reply?.product_cards),
    image_cards_count: countItems(replySource?.image_cards || replySource?.visual_attachments),
    actions_count: countItems(replySource?.actions || replySource?.suggested_actions),
    early_return_reason: text(replySource?.debug?.early_return_reason || ""),
    adapter_used: adapterUsed,
    send_result: result,
  });
  return result;
};

export {
  fetchUnifiedAiSupportReply as generateUnifiedAiReply,
  sendUnifiedReplyThroughChannelAdapter,
};

export default {
  generateUnifiedAiReply: fetchUnifiedAiSupportReply,
  buildUnifiedAiReplyPayload,
  sendUnifiedReplyThroughChannelAdapter,
};
