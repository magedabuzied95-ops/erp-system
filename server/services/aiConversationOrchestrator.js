import { AI_AGENT_CHANNELS, normalizeChannel, normalizeOutgoingChannelReply, sendMetaPageReply, sendWhatsAppCloudReply } from "./aiChannelAdapterService.js";
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
  const handoff = {
    needs_human_support: response?.needs_human_support === true || response?.handoff?.needs_human_support === true,
    conversation_status: text(response?.conversation_status || response?.status || conversation?.status || ""),
    reason: text(response?.fallback_reason || response?.reason || response?.handoff?.reason || earlyReturnReason || ""),
  };
  const draftOrder = response?.draft_order || response?.ai_order || response?.order_draft || null;
  const salesIntelligence = response?.sales_intelligence || null;
  const salesState = response?.sales_state || response?.sales_conversation_state || salesIntelligence?.state || null;
  const journeyEvents = asArray(response?.journey_events || response?.sales_journey_events || salesIntelligence?.journeyEvents);
  const conversion = response?.conversion || response?.conversion_probability || salesIntelligence?.conversion || {};
  const followUp = response?.follow_up || response?.follow_up_recommendation || salesIntelligence?.followUp || {};
  const closer = response?.closer || response?.proactive_closer || salesIntelligence?.closer || {};
  const channelAdapterPayload = {
    channel: normalizedChannel,
    text: text(response?.answer || response?.text || channelReply.text),
    intent: text(response?.detected_intent || response?.intent?.type || response?.intent || response?.detectedIntent || ""),
    product_cards: productCards,
    image_cards: imageCards,
    quick_replies: quickReplies,
    actions,
    draft_order: draftOrder,
    sales_state: salesState,
    journey_events: journeyEvents,
    conversion,
    follow_up: followUp,
    closer,
  };
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
    quick_replies: quickReplies,
    actions,
    sales_state: salesState,
    journey_events: journeyEvents,
    conversion,
    follow_up: followUp,
    closer,
    memory_updates: memoryUpdates,
    draft_order: draftOrder,
    handoff,
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
      has_memory: Boolean(memory),
      attachments_count: countItems(attachments),
      raw_channel_reply_text: text(channelReply.text),
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
    inbound_text: text(messageText || unifiedReply.text || unifiedReply.channel_reply?.text || ""),
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
    logOrchestrator("AI_CHANNEL_ADAPTER_RESULT", {
      tenant_id: tenantId,
      channel: normalizedChannel,
      conversation_id: text(replySource?.conversation_id || replySource?.session_id || ""),
      provider_message_id: text(replySource?.provider_message_id || ""),
      inbound_text: text(messageText || unifiedReply.text || unifiedReply.channel_reply?.text || ""),
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
  logOrchestrator("AI_CHANNEL_ADAPTER_RESULT", {
    tenant_id: tenantId,
    channel: normalizedChannel,
    conversation_id: text(replySource?.conversation_id || replySource?.session_id || ""),
    provider_message_id: text(replySource?.provider_message_id || ""),
    inbound_text: text(messageText || unifiedReply.text || unifiedReply.channel_reply?.text || ""),
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
