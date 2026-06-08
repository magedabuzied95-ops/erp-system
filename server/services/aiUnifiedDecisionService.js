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
  const tenantId = options.tenantId || inbound.metadata.tenant_id || inbound.metadata.tenantId || process.env.WHATSAPP_TENANT_ID || 1;
  const branchId = options.branchId ?? inbound.metadata.branch_id ?? inbound.metadata.branchId ?? null;
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
      },
    },
    attachments: inbound.attachments,
    memory: options.memory ?? inbound.metadata.ai_memory ?? null,
    productsContext: options.productsContext ?? inbound.metadata.products_context ?? null,
    providerMessageId: options.providerMessageId || inbound.metadata.provider_message_id || inbound.metadata.external_message_id || "",
  });

  return normalizeUnifiedDecisionOutput(decision, inbound);
};

export default {
  generateUnifiedConversationDecision,
  logUnifiedDecisionEarlyReturn,
  normalizeUnifiedDecisionOutput,
  normalizeUnifiedInbound,
};
