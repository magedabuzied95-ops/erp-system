import { buildAiMemoryContextSource, loadAiConversationMemory, resolveActiveProductContext } from "./aiConversationMemoryService.js";
import { buildReplyCorrectionContextSource, searchRelevantCorrections } from "./aiCorrectionMemoryService.js";
import { buildProductContext } from "./aiProductContext.js";
import { getAISettings, getAIToneInstruction } from "./aiSettingsService.js";
import { loadAiInbox, loadAiInboxMessages, loadAiInboxRecommendations } from "./aiSalesAgentService.js";
import { loadShippingZones } from "./storefrontShippingService.js";

const HARNESS_VERSION = "phase_2_unified_ai_harness_v1";
const harnessCache = new Map();

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeString = (value = "") => text(value).slice(0, 2000);

const sanitizeObject = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 5) return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitizeObject(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value !== "object") return value;

  return Object.entries(value).reduce((acc, [key, item]) => {
    if (/(?:api_key|secret|password|private_key|client_secret|access_token|refresh_token|webhook_secret|authorization)/i.test(key)) {
      return acc;
    }
    const sanitized = sanitizeObject(item, depth + 1);
    if (sanitized !== undefined) acc[key] = sanitized;
    return acc;
  }, {});
};

const normalizeRecentMessage = (message = {}) => ({
  id: message.id || null,
  session_id: text(message.session_id),
  sender_type: text(message.sender_type),
  message_type: text(message.message_type),
  customer_message: text(message.customer_message || message.message_text || ""),
  ai_answer: text(message.ai_answer || message.staff_message || ""),
  provider_message_id: text(message.provider_message_id),
  remote_jid: text(message.remote_jid),
  resolved_reply_jid: text(message.resolved_reply_jid),
  resolved_phone: text(message.resolved_phone),
  delivery_status: text(message.delivery_status),
  created_at: message.created_at || null,
});

const summarizeProduct = (product = {}) => {
  const variants = asArray(product.variants).slice(0, 8).map((variant) => ({
    id: variant?.id ?? variant?.variant_id ?? null,
    variant_id: variant?.variant_id ?? variant?.id ?? null,
    color: text(variant?.color || variant?.color_name || ""),
    size: text(variant?.size || ""),
    stock: numeric(variant?.stock ?? variant?.quantity ?? variant?.available_quantity, 0),
  }));

  return {
    id: product.id ?? product.product_id ?? null,
    product_id: product.product_id ?? product.id ?? null,
    name: text(product.name || product.title || product.product_name),
    price: numeric(product.price ?? product.final_price ?? product.sale_price ?? product.selling_price, 0),
    sale_price: numeric(product.sale_price ?? 0, 0),
    stock: numeric(product.total_stock ?? product.stock ?? 0, 0),
    availability: text(product.availability || product.stock_status || ""),
    image_url: text(product.image_url || product.variant_image_url || product.product_image_url || ""),
    product_url: text(product.product_url || product.url || ""),
    color: text(product.color || product.matched_variant_color || ""),
    size: text(product.size || product.matched_variant_size || ""),
    variant_id: product.variant_id ?? product.selected_variant_id ?? null,
    variants,
  };
};

const findConversation = ({ inbox = null, conversationId = "", fallbackConversation = null } = {}) => {
  const safeConversationId = text(conversationId);
  const candidates = [
    fallbackConversation,
    ...asArray(inbox?.conversations),
  ].filter(Boolean);

  return candidates.find((item) =>
    text(item.session_id) === safeConversationId ||
    text(item.conversation_id) === safeConversationId ||
    text(item.external_conversation_id) === safeConversationId ||
    text(item.external_customer_id) === safeConversationId ||
    text(item.conversation_key) === safeConversationId
  ) || fallbackConversation || null;
};

const latestCustomerMessage = (conversation = {}, recentMessages = []) =>
  [
    ...asArray(recentMessages).slice().reverse(),
    ...asArray(conversation.messages).slice().reverse(),
  ].find((message) => text(message.customer_message || message.message_text || message.last_message || message.ai_answer || ""))?.customer_message ||
  conversation.customer_message ||
  conversation.message_text ||
  conversation.latest_message_preview ||
  conversation.last_message ||
  "";

const buildRiskFlags = (message = "", conversation = {}) => {
  const value = text(message).toLowerCase();
  return {
    risky_intent: /(?:refund|return|exchange|cancel|chargeback|complaint|angry|mad|scam|problem|issue|broken|wrong|bad|defect|شكوى|مشكلة|غلط|استرجاع|استبدال|إلغاء|زعلان|متضايق|غضبان)/i.test(value),
    human_signal: ["human_takeover", "closed"].includes(text(conversation.conversation_status)),
  };
};

const buildConversationSummary = (conversation = {}, message = "") =>
  sanitizeString(
    conversation.conversation_summary ||
    conversation.session_last_message ||
    conversation.latest_message_preview ||
    message ||
    ""
  );

const buildSafetyContext = ({ conversation = {}, latestMessage = "", correctionCount = 0, productContext = null, inventoryContext = null } = {}) => {
  const riskFlags = buildRiskFlags(latestMessage, conversation);
  const isHumanTakeover = ["human_takeover"].includes(text(conversation.conversation_status));
  const isClosed = ["closed"].includes(text(conversation.conversation_status));
  const missingCustomerMessage = !text(latestMessage);
  const correctionAvailable = correctionCount > 0;
  const productContextAvailable = Boolean(productContext);
  const inventoryContextAvailable = Boolean(inventoryContext?.products?.length || inventoryContext?.summary?.available_products > 0);
  const shouldRequireHumanReview =
    isHumanTakeover ||
    isClosed ||
    riskFlags.risky_intent ||
    (correctionAvailable && !productContextAvailable) ||
    (productContextAvailable && !inventoryContextAvailable && text(latestMessage).length > 0);

  return {
    is_human_takeover: isHumanTakeover,
    is_closed: isClosed,
    missing_customer_message: missingCustomerMessage,
    risky_intent: riskFlags.risky_intent,
    correction_available: correctionAvailable,
    product_context_available: productContextAvailable,
    inventory_context_available: inventoryContextAvailable,
    should_require_human_review: shouldRequireHumanReview,
  };
};

const buildSendMode = ({ sendMode = "", conversation = {} } = {}) => {
  const value = text(sendMode).toLowerCase();
  if (value) return value;
  if (["human_takeover", "closed"].includes(text(conversation.conversation_status))) return "review";
  return "compose";
};

export const getLastReplyHarnessDebug = ({ tenantId = null, conversationId = "" } = {}) => {
  const cacheKey = `${Number(tenantId) || 0}:${text(conversationId)}`;
  const cached = harnessCache.get(cacheKey) || null;
  return cached ? sanitizeObject(cached) : null;
};

export const buildReplyHarness = async ({
  tenantId,
  conversationId,
  conversation = null,
  latestCustomerMessage: latestCustomerMessageInput = "",
  recentMessages = [],
  sendMode = "",
  channel = "",
  req = null,
} = {}) => {
  const startedAt = Date.now();
  const safeTenantId = Number(tenantId) || null;
  const safeConversationId = text(conversationId || conversation?.session_id || conversation?.conversation_id || conversation?.external_conversation_id);
  const warnings = [];
  const sourcesUsed = [];

  let inboxConversation = conversation || null;
  let inbox = null;
  let messages = asArray(recentMessages);

  if (!inboxConversation && safeTenantId && safeConversationId) {
    try {
      inbox = await loadAiInbox({ tenantId: safeTenantId, filter: "all", limit: 100, messageLimit: 12, summaryOnly: false });
      sourcesUsed.push("aiSalesAgentService.loadAiInbox");
      inboxConversation = findConversation({ inbox, conversationId: safeConversationId });
    } catch (error) {
      warnings.push(`loadAiInbox failed: ${error?.message || String(error)}`);
    }
  } else if (inboxConversation) {
    inbox = { conversations: [inboxConversation] };
  }

  if (!messages.length && safeTenantId && safeConversationId) {
    try {
      const payload = await loadAiInboxMessages({ tenantId: safeTenantId, conversationId: safeConversationId, limit: 12 });
      sourcesUsed.push("aiSalesAgentService.loadAiInboxMessages");
      messages = asArray(payload.messages);
    } catch (error) {
      warnings.push(`loadAiInboxMessages failed: ${error?.message || String(error)}`);
    }
  }

  const resolvedConversation = inboxConversation || findConversation({ inbox, conversationId: safeConversationId }) || conversation || null;
  const resolvedChannel = text(channel || resolvedConversation?.channel || resolvedConversation?.source || resolvedConversation?.session_channel || "web_chat");
  const latestMessage = text(latestCustomerMessageInput || latestCustomerMessage(resolvedConversation || {}, messages));
  const conversationSummary = buildConversationSummary(resolvedConversation || {}, latestMessage);

  let aiSettings = null;
  let shippingZones = null;
  let memory = null;
  let recommendations = [];
  let inboxRecommendationResult = null;
  let corrections = [];
  let correctionSources = [];
  let productContext = null;

  try {
    if (safeTenantId && safeConversationId) {
      memory = await loadAiConversationMemory({
        tenantId: safeTenantId,
        sessionId: safeConversationId,
        customerPhone: resolvedConversation?.phone || resolvedConversation?.customer_profile?.phone || "",
      });
      sourcesUsed.push("aiConversationMemoryService.loadAiConversationMemory");
    }
  } catch (error) {
    warnings.push(`loadAiConversationMemory failed: ${error?.message || String(error)}`);
  }

  try {
    aiSettings = await getAISettings();
    sourcesUsed.push("aiSettingsService.getAISettings");
  } catch (error) {
    warnings.push(`getAISettings failed: ${error?.message || String(error)}`);
  }

  try {
    shippingZones = await loadShippingZones();
    sourcesUsed.push("storefrontShippingService.loadShippingZones");
  } catch (error) {
    warnings.push(`loadShippingZones failed: ${error?.message || String(error)}`);
  }

  if (!corrections.length && safeTenantId && latestMessage) {
    try {
      corrections = await searchRelevantCorrections({
        tenantId: safeTenantId,
        query: latestMessage,
        limit: 3,
      });
      sourcesUsed.push("aiCorrectionMemoryService.searchRelevantCorrections");
    } catch (error) {
      warnings.push(`searchRelevantCorrections failed: ${error?.message || String(error)}`);
    }
  }

  if (!correctionSources.length && corrections.length) {
    correctionSources = buildReplyCorrectionContextSource(corrections, latestMessage);
  }

  const currentProduct = resolvedConversation?.current_product || resolvedConversation?.product || recommendations[0] || memory?.selected_product_context || null;
  if (!currentProduct) {
    try {
      if (safeTenantId) {
        inboxRecommendationResult = await loadAiInboxRecommendations({
          tenantId: safeTenantId,
          conversationId: safeConversationId,
          limit: 8,
        });
        sourcesUsed.push("aiSalesAgentService.loadAiInboxRecommendations");
        recommendations = asArray(inboxRecommendationResult?.products);
      }
    } catch (error) {
      warnings.push(`loadAiInboxRecommendations failed: ${error?.message || String(error)}`);
    }
  }

  const productSource = resolvedConversation?.current_product || resolvedConversation?.product || recommendations[0] || memory?.selected_product_context || null;
  try {
    productContext = productSource ? buildProductContext(productSource) : null;
    if (productContext) sourcesUsed.push("aiProductContext.buildProductContext");
  } catch (error) {
    warnings.push(`buildProductContext failed: ${error?.message || String(error)}`);
  }

  const recentMessagesNormalized = asArray(messages).slice(0, 12).map(normalizeRecentMessage);
  const memoryContext = {
    raw: sanitizeObject(memory),
    source: buildAiMemoryContextSource(memory),
    active_product_context: resolveActiveProductContext({
      current: memory,
      message: latestMessage,
      metadata: {
        channel: resolvedChannel,
        session_id: safeConversationId,
      },
      suggestedProducts: recommendations,
    }),
  };

  const inventoryContext = {
    products: recommendations.map(summarizeProduct),
    summary: {
      products_loaded: recommendations.length || (productContext ? 1 : 0),
      available_products: recommendations.filter((item) => Number(item?.total_stock ?? item?.stock ?? 0) > 0).length + (productContext && Number(productContext?.inStock) ? 1 : 0),
      out_of_stock_products: recommendations.filter((item) => Number(item?.total_stock ?? item?.stock ?? 0) <= 0).length,
    },
  };

  const orderContext = {
    draft_orders: asArray(resolvedConversation?.draft_orders).slice(0, 10),
    draft_order: resolvedConversation?.draft_order || null,
    confirmed_count: Number(resolvedConversation?.confirmed_count || 0),
    draft_count: Number(resolvedConversation?.draft_count || 0),
    followups: asArray(resolvedConversation?.followups).slice(0, 10),
    sales_state: resolvedConversation?.sales_conversation_state || null,
    sales_intelligence: resolvedConversation?.sales_intelligence || null,
    journey_events: asArray(resolvedConversation?.sales_journey_events).slice(0, 10),
  };

  const shippingContext = {
    shipping_zones: asArray(shippingZones?.zones).slice(0, 20),
    default_price: Number(shippingZones?.defaultPrice || 0),
    default_provider: text(shippingZones?.defaultProvider || ""),
    quote: null,
  };

  const policyContext = {
    ai_settings: aiSettings ? {
      autoReplyMode: text(aiSettings.autoReplyMode || ""),
      tone: text(aiSettings.tone || ""),
      safety: sanitizeObject(aiSettings.safety || {}),
      debug: sanitizeObject(aiSettings.debug || {}),
    } : null,
    tone_instruction: aiSettings ? getAIToneInstruction(aiSettings.tone) : "",
    shipping_policy: shippingZones ? {
      default_price: Number(shippingZones.defaultPrice || 0),
      default_provider: text(shippingZones.defaultProvider || ""),
      zones_count: asArray(shippingZones.zones).length,
    } : null,
  };

  const customer = {
    name: text(
      resolvedConversation?.customer_name ||
      resolvedConversation?.session_customer_name ||
      resolvedConversation?.customer_profile?.name ||
      resolvedConversation?.customer_profile?.first_name ||
      ""
    ),
    phone: text(
      resolvedConversation?.phone ||
      resolvedConversation?.customer_profile?.phone ||
      memory?.customer_phone ||
      ""
    ),
    avatar_url: text(resolvedConversation?.customer_avatar_url || resolvedConversation?.customer_profile?.avatar_url || ""),
    external_customer_id: text(resolvedConversation?.external_customer_id || resolvedConversation?.customer_profile?.external_customer_id || ""),
    lead_status: text(resolvedConversation?.lead_status || resolvedConversation?.customer_profile?.lead_status || "new"),
    profile: sanitizeObject(resolvedConversation?.customer_profile || {}),
  };

  const safetyContext = buildSafetyContext({
    conversation: resolvedConversation || {},
    latestMessage,
    correctionCount: corrections.length,
    productContext,
    inventoryContext,
  });

  const businessContext = {
    ai_enabled: resolvedConversation?.ai_enabled !== false,
    conversation_status: text(resolvedConversation?.conversation_status || resolvedConversation?.status || "ai_active"),
    lead_status: text(resolvedConversation?.lead_status || customer.lead_status || "new"),
    customer_profile: sanitizeObject(resolvedConversation?.customer_profile || {}),
    assigned_user: sanitizeObject(resolvedConversation?.assigned_user || resolvedConversation?.assigned_to || null),
    messages_count: Number(resolvedConversation?.message_count || recentMessagesNormalized.length || 0),
    unread_count: Number(resolvedConversation?.unread_count || 0),
    current_product: sanitizeObject(resolvedConversation?.current_product || null),
    sales_state: sanitizeObject(resolvedConversation?.sales_conversation_state || null),
    sales_intelligence: sanitizeObject(resolvedConversation?.sales_intelligence || null),
    followups: asArray(resolvedConversation?.followups).slice(0, 10).map(sanitizeObject),
    draft_orders: asArray(resolvedConversation?.draft_orders).slice(0, 10).map(sanitizeObject),
    system_events: asArray(resolvedConversation?.system_events).slice(0, 10).map(sanitizeObject),
    channel_metadata: sanitizeObject(resolvedConversation?.channel_metadata || {}),
  };

  const trace = {
    harness_version: HARNESS_VERSION,
    sources_used: [...new Set(sourcesUsed)],
    corrections_count: corrections.length,
    recent_messages_count: recentMessagesNormalized.length,
    memory_loaded: Boolean(memory),
    products_loaded: recommendations.length || (productContext ? 1 : 0),
    policies_loaded: Boolean(aiSettings || shippingZones),
    warnings,
    elapsed_ms: Date.now() - startedAt,
  };

  const harness = {
    tenant_id: safeTenantId,
    conversation_id: safeConversationId,
    channel: resolvedChannel,
    customer,
    latest_customer_message: latestMessage,
    conversation_summary: conversationSummary,
    recent_messages: recentMessagesNormalized,
    business_context: sanitizeObject(businessContext),
    product_context: sanitizeObject({
      active_product: productContext,
      recommendations: recommendations.map(summarizeProduct),
      source: inboxRecommendationResult?.intent || "",
      available_count: recommendations.length,
    }),
    inventory_context: sanitizeObject(inventoryContext),
    order_context: sanitizeObject(orderContext),
    shipping_context: sanitizeObject(shippingContext),
    policy_context: sanitizeObject(policyContext),
    correction_context: sanitizeObject({
      query: latestMessage,
      correction_available: corrections.length > 0,
      corrections: corrections.slice(0, 3),
      sources: correctionSources.slice(0, 3),
    }),
    memory_context: sanitizeObject(memoryContext),
    safety_context: safetyContext,
    send_mode: buildSendMode({ sendMode, conversation: resolvedConversation || {} }),
    trace,
  };

  const cacheKey = `${safeTenantId || 0}:${safeConversationId}`;
  harnessCache.set(cacheKey, harness);
  return harness;
};

export default {
  buildReplyHarness,
  getLastReplyHarnessDebug,
};
