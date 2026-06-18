const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const byteLength = (value = "") => {
  try {
    return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? {}), "utf8");
  } catch {
    return 0;
  }
};

const clone = (value) => {
  if (!value || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const summarizeRecentMessage = (message = {}) => ({
  id: message.id || null,
  session_id: text(message.session_id),
  sender_type: text(message.sender_type),
  message_type: text(message.message_type),
  customer_message: text(message.customer_message || message.message_text || message.last_message || "").slice(0, 320),
  ai_answer: text(message.ai_answer || message.staff_message || "").slice(0, 220),
  delivery_status: text(message.delivery_status),
  created_at: message.created_at || null,
});

const summarizeCorrection = (correction = {}) => ({
  id: correction.id || null,
  correction_type: text(correction.correction_type),
  product_id: correction.product_id || null,
  channel: text(correction.channel),
  customer_question: text(correction.customer_question).slice(0, 260),
  ai_wrong_answer: text(correction.ai_wrong_answer).slice(0, 220),
  employee_correct_answer: text(correction.employee_correct_answer).slice(0, 320),
});

const summarizeProduct = (product = {}) => ({
  id: product.id || product.product_id || null,
  product_id: product.product_id || product.id || null,
  name: text(product.name || product.title || product.product_name),
  brand: text(product.brand || product.brand_name || ""),
  category: text(product.category || product.category_name || ""),
  price: Number(product.price ?? product.sale_price ?? product.final_price ?? product.selling_price ?? 0) || 0,
  available_sizes: asArray(product.available_sizes || product.sizes || product.size_options).map(text).filter(Boolean).slice(0, 8),
  available_colors: asArray(product.available_colors || product.colors || product.color_options).map(text).filter(Boolean).slice(0, 8),
  stock_summary: text(product.stock_summary || product.availability || product.stock_status || ""),
});

const summarizeMemory = (memory = {}) => {
  const preferences = memory?.preferences || {};
  return {
    preferences: {
      size: text(preferences.size || preferences.selected_size || preferences.active_size || preferences.preferred_size || ""),
      color: text(preferences.color || preferences.selected_color || preferences.active_color || preferences.preferred_color || ""),
      last_ai_action: text(preferences.last_ai_action || preferences.pending_action || ""),
      last_bot_message: text(preferences.last_bot_message || "").slice(0, 220),
      pendingAlternativeForModel: text(preferences.pendingAlternativeForModel || ""),
      currentRequestedModel: text(preferences.currentRequestedModel || ""),
    },
    lastAction: text(memory?.lastAction || memory?.last_action || ""),
    lastBotMessage: text(memory?.last_bot_message || memory?.lastBotMessage || "").slice(0, 220),
    lastProducts: asArray(memory?.last_products).slice(0, 4).map((item) => summarizeProduct(item)),
    active_model_family: text(memory?.active_model_family || ""),
    last_model_family: text(memory?.last_model_family || ""),
    customer_phone: text(memory?.customer_phone || ""),
  };
};

const summarizeReplyHarness = (harness = {}) => ({
  tenant_id: harness.tenant_id || null,
  conversation_id: text(harness.conversation_id),
  channel: text(harness.channel),
  send_mode: text(harness.send_mode),
  latest_customer_message: text(harness.latest_customer_message).slice(0, 320),
  trace: {
    harness_version: text(harness?.trace?.harness_version || ""),
    sources_used: asArray(harness?.trace?.sources_used).slice(0, 10),
    corrections_count: Number(harness?.trace?.corrections_count || 0),
    products_loaded: Number(harness?.trace?.products_loaded || 0),
    tool_warnings_count: Number(harness?.trace?.tool_warnings_count || 0),
    tools_ms: Number(harness?.trace?.tools_ms || 0),
    harness_ms: Number(harness?.trace?.harness_ms || 0),
  },
  tool_context: {
    product_facts: summarizeProduct(harness?.tool_context?.product_facts || {}),
    inventory_facts: {
      available_sizes: asArray(harness?.tool_context?.inventory_facts?.available_sizes).map(text).filter(Boolean).slice(0, 8),
      available_colors: asArray(harness?.tool_context?.inventory_facts?.available_colors).map(text).filter(Boolean).slice(0, 8),
      in_stock: Boolean(harness?.tool_context?.inventory_facts?.in_stock),
      low_stock: Boolean(harness?.tool_context?.inventory_facts?.low_stock),
    },
    shipping_facts: {
      shipping_rules: text(harness?.tool_context?.shipping_facts?.shipping_rules || ""),
      estimated_delivery: text(harness?.tool_context?.shipping_facts?.estimated_delivery || ""),
    },
    policy_facts: {
      return_policy: text(harness?.tool_context?.policy_facts?.return_policy || "").slice(0, 220),
      exchange_policy: text(harness?.tool_context?.policy_facts?.exchange_policy || "").slice(0, 220),
      payment_rules: text(harness?.tool_context?.policy_facts?.payment_rules || "").slice(0, 220),
    },
    order_facts: {
      order_id: harness?.tool_context?.order_facts?.order_id || null,
      order_number: text(harness?.tool_context?.order_facts?.order_number || ""),
      order_status: text(harness?.tool_context?.order_facts?.order_status || ""),
    },
  },
  correction_context: {
    query: text(harness?.correction_context?.query || "").slice(0, 260),
    corrections: asArray(harness?.correction_context?.corrections).slice(0, 3).map((item) => summarizeCorrection(item)),
    sources: asArray(harness?.correction_context?.sources).slice(0, 3),
  },
  product_context: {
    active_product: summarizeProduct(harness?.product_context?.active_product || {}),
    recommendations: asArray(harness?.product_context?.recommendations).slice(0, 6).map((item) => summarizeProduct(item)),
    recommendation_rows: asArray(harness?.product_context?.recommendation_rows).slice(0, 6).map((item) => summarizeProduct(item)),
    source: text(harness?.product_context?.source || ""),
    available_count: Number(harness?.product_context?.available_count || 0),
  },
  memory_context: summarizeMemory(harness?.memory_context?.raw || harness?.memory_context || {}),
  recent_messages: asArray(harness?.recent_messages).slice(0, 4).map((item) => summarizeRecentMessage(item)),
});

export const compressAiReplyPromptPayload = ({
  message = "",
  response = {},
  intent = {},
  memory = {},
  context = {},
  harness = null,
  recent_messages = [],
  product_context = null,
  correction_context = null,
} = {}) => {
  const payloadBefore = {
    message: text(message),
    response: clone(response || {}),
    intent: clone(intent || {}),
    memory: clone(memory || {}),
    context: clone(context || {}),
    harness: clone(harness || {}),
    recent_messages: clone(recent_messages || []),
    product_context: clone(product_context || null),
    correction_context: clone(correction_context || null),
  };

  const compressedHarness = summarizeReplyHarness(harness || response?.reply_harness || {});
  const compressedResponse = {
    ...clone(response || {}),
    reply_harness: compressedHarness,
    employee_corrections: asArray(response?.employee_corrections).slice(0, 3).map((item) => summarizeCorrection(item)),
    employee_correction_sources: asArray(response?.employee_correction_sources).slice(0, 3),
    suggested_products: asArray(response?.suggested_products).slice(0, 6).map((item) => summarizeProduct(item)),
    product_cards: asArray(response?.product_cards).slice(0, 6).map((item) => summarizeProduct(item)),
    visual_attachments: asArray(response?.visual_attachments).slice(0, 4).map((item) => ({
      type: text(item?.type || ""),
      title: text(item?.title || ""),
      items: asArray(item?.items).slice(0, 4).map((product) => summarizeProduct(product)),
    })),
    product_context: summarizeProduct(response?.product_context || {}),
  };

  const compressedContext = {
    ...clone(context || {}),
    reply_harness: compressedHarness,
    harness_trace: compressedHarness.trace,
    tool_context: compressedHarness.tool_context,
    recent_messages: asArray(recent_messages).slice(0, 4).map((item) => summarizeRecentMessage(item)),
    memory: summarizeMemory(memory || {}),
  };

  const payloadAfter = {
    message: text(message),
    response: compressedResponse,
    intent: clone(intent || {}),
    memory: summarizeMemory(memory || {}),
    context: compressedContext,
    harness: compressedHarness,
    recent_messages: asArray(recent_messages).slice(0, 4).map((item) => summarizeRecentMessage(item)),
    product_context: summarizeProduct(product_context || response?.product_context || {}),
    correction_context: {
      query: text(correction_context?.query || response?.employee_correction_query || ""),
      corrections: asArray(correction_context?.corrections || response?.employee_corrections || []).slice(0, 3).map((item) => summarizeCorrection(item)),
    },
  };

  const prompt_bytes_before = byteLength(payloadBefore);
  const prompt_bytes_after = byteLength(payloadAfter);
  const reduction_percent = prompt_bytes_before > 0
    ? Math.max(0, Math.min(100, Number((((prompt_bytes_before - prompt_bytes_after) / prompt_bytes_before) * 100).toFixed(2))))
    : 0;

  return {
    prompt_bytes_before,
    prompt_bytes_after,
    reduction_percent,
    compressed_response: compressedResponse,
    compressed_context: compressedContext,
    prompt_bundle: payloadAfter,
    optimization_report: {
      prompt_bytes_before,
      prompt_bytes_after,
      reduction_percent,
      bytes_saved: Math.max(0, prompt_bytes_before - prompt_bytes_after),
    },
  };
};

export default {
  compressAiReplyPromptPayload,
};
