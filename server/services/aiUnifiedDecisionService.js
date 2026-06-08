import { AI_AGENT_CHANNELS, normalizeChannel } from "./aiChannelAdapterService.js";
import { generateUnifiedAiReply } from "./aiConversationOrchestrator.js";

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

const normalizeArabic = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u061f?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const classifySharedShortcutIntent = (message = "") => {
  const raw = text(message);
  const normalized = normalizeArabic(raw);
  if (/^(\u0627\u064a\u0648\u0647|\u0627\u064a\u0648\u0629|\u0627\u0647|\u0646\u0639\u0645|\u062a\u0645\u0627\u0645|\u0645\u0627\u0634\u064a|ok|okay|yes|yep)$/i.test(normalized)) return "bare_confirmation";
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

const sanitizeMemoryForClearProductRequest = (memory = null, inbound = {}) => {
  if (!memory || typeof memory !== "object" || !hasClearProductModelRequest(inbound.text)) return memory;
  const preferences = memory.preferences && typeof memory.preferences === "object" ? memory.preferences : {};
  if (!preferences.pending_product_search_context && !preferences.last_clarification_type && !preferences.last_clarification_expected_values) return memory;
  const sanitizedPreferences = { ...preferences };
  delete sanitizedPreferences.pending_product_search_context;
  delete sanitizedPreferences.last_clarification_type;
  delete sanitizedPreferences.last_clarification_expected_values;
  return {
    ...memory,
    preferences: sanitizedPreferences,
  };
};

const summarizeMemoryForLog = (memory = null) => {
  const preferences = memory?.preferences || {};
  return {
    previousIntent: text(preferences.last_intent || preferences.lastIntent || memory?.last_intent || ""),
    hasPendingClassification: Boolean(preferences.pending_product_search_context),
    lastProductId: text(preferences.last_product_id || preferences.last_product?.product_id || preferences.lastProductCard?.product_id || ""),
    awaitingCustomerAction: text(preferences.awaiting_customer_action || ""),
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
  const shortcutIntent = classifySharedShortcutIntent(inbound.text);
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

export const normalizeUnifiedInbound = (normalizedInbound = {}) => {
  const metadata = normalizedInbound.metadata && typeof normalizedInbound.metadata === "object"
    ? normalizedInbound.metadata
    : {};
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
  return {
    channel,
    externalConversationId,
    externalCustomerId,
    customerName,
    text: text(normalizedInbound.text || normalizedInbound.message_text || normalizedInbound.message || normalizedInbound.body),
    attachments: asArray(normalizedInbound.attachments),
    metadata,
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

  return {
    ...decision,
    text: text(decision.text || channelReply.text || decision.answer),
    answer: text(decision.answer || decision.text || channelReply.text),
    intent,
    detected_intent: text(decision.detected_intent || intent),
    products,
    suggested_products: asArray(decision.suggested_products?.length ? decision.suggested_products : products),
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
      rawDecision: decision,
    },
    product_cards: productCards,
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
  const memorySummary = summarizeMemoryForLog(rawMemory);
  const effectiveMemorySummary = summarizeMemoryForLog(effectiveMemory);
  const tenantId = options.tenantId || inbound.metadata.tenant_id || inbound.metadata.tenantId || process.env.WHATSAPP_TENANT_ID || 1;
  const branchId = options.branchId ?? inbound.metadata.branch_id ?? inbound.metadata.branchId ?? null;

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

  const decision = await generateUnifiedAiReply({
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
        ai_memory: effectiveMemory,
      },
    },
    attachments: inbound.attachments,
    memory: effectiveMemory,
    productsContext: options.productsContext ?? inbound.metadata.products_context ?? null,
    providerMessageId: options.providerMessageId || inbound.metadata.provider_message_id || inbound.metadata.external_message_id || "",
  });

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
  return output;
};

export default {
  generateUnifiedConversationDecision,
  logUnifiedDecisionEarlyReturn,
  normalizeUnifiedDecisionOutput,
  normalizeUnifiedInbound,
};
