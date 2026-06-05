import db from "../database/db.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value = "") => text(value).toLowerCase();

export const SALES_JOURNEY_EVENT_TYPES = Object.freeze({
  PRODUCT_VIEWED: "PRODUCT_VIEWED",
  PRODUCT_MATCHED: "PRODUCT_MATCHED",
  PRICE_ASKED: "PRICE_ASKED",
  SIZE_ASKED: "SIZE_ASKED",
  SIZE_SELECTED: "SIZE_SELECTED",
  COLOR_SELECTED: "COLOR_SELECTED",
  IMAGES_REQUESTED: "IMAGES_REQUESTED",
  ALTERNATIVE_REQUESTED: "ALTERNATIVE_REQUESTED",
  OBJECTION_PRICE: "OBJECTION_PRICE",
  DRAFT_ORDER_CREATED: "DRAFT_ORDER_CREATED",
  PAYMENT_LINK_SENT: "PAYMENT_LINK_SENT",
  PAYMENT_PROOF_REQUESTED: "PAYMENT_PROOF_REQUESTED",
  ORDER_CONFIRMED: "ORDER_CONFIRMED",
  FOLLOW_UP_SENT: "FOLLOW_UP_SENT",
  HUMAN_TAKEOVER_STARTED: "HUMAN_TAKEOVER_STARTED",
  HUMAN_TAKEOVER_ENDED: "HUMAN_TAKEOVER_ENDED",
  STATE_CHANGED: "STATE_CHANGED",
});

const normalizeArabic = (value = "") =>
  lower(value)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "ا")
    .replace(/\u0649/g, "ي")
    .replace(/\u0629/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (value = "", terms = []) => {
  const normalized = normalizeArabic(value);
  return terms.some((term) => normalized.includes(normalizeArabic(term)));
};

const explicitSize = (message = "") => {
  const match = text(message).match(/\b(3[5-9]|4[0-9]|5[0-2]|xs|s|m|l|xl|xxl|xxxl)\b/i);
  return match?.[1]?.toUpperCase() || "";
};

const explicitColor = (message = "") =>
  hasAny(message, ["black", "white", "red", "blue", "green", "beige", "grey", "gray", "brown", "اسود", "ابيض", "أبيض", "احمر", "ازرق", "اخضر", "بيج", "رمادي", "بني"]);

const explicitPrice = (message = "") => hasAny(message, ["بكام", "السعر", "سعره", "price", "cost"]);
const explicitPayment = (message = "") => hasAny(message, ["الدفع", "payment", "cod", "cash on delivery", "لينك", "فودافون", "انستا باي", "instapay"]);
const explicitAlternative = (message = "") => hasAny(message, ["بديل", "بدائل", "ارخص", "cheaper", "alternative", "similar"]);
const explicitImages = (message = "") => hasAny(message, ["صور", "photo", "image", "more images", "more photos", "ابعتلي صور", "وري", "show me"]);
const explicitObjection = (message = "") => hasAny(message, ["غالي", "غالية", "discount", "خصم", "غالي اوي", "expensive"]);
const explicitHuman = (state = {}) => Boolean(state.current_state === "HUMAN_TAKEOVER" || state.conversation_status === "human_takeover" || state.needs_human_support === true);

const dedupeKeyFor = ({ tenantId, conversationId, eventType, productId = "", variantId = "", metadata = {}, createdAt = "", channel = "" } = {}) =>
  [
    Number(tenantId) || 0,
    text(conversationId),
    text(eventType),
    text(productId),
    text(variantId),
    text(channel || ""),
    text(createdAt || ""),
    JSON.stringify(metadata || {}),
  ].join("|");

const normalizeEvent = (event = {}, fallback = {}) => ({
  event_type: text(event.event_type || event.type || fallback.event_type || ""),
  conversation_id: text(event.conversation_id || fallback.conversation_id || ""),
  customer_id: text(event.customer_id || fallback.customer_id || ""),
  product_id: event.product_id || fallback.product_id || null,
  variant_id: event.variant_id || fallback.variant_id || null,
  channel: text(event.channel || fallback.channel || "web_chat"),
  metadata: event.metadata || fallback.metadata || {},
  created_at: event.created_at || fallback.created_at || new Date().toISOString(),
});

const ensureSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ai_sales_journey_events (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      conversation_id TEXT NOT NULL,
      customer_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      product_id BIGINT NULL,
      variant_id BIGINT NULL,
      channel TEXT NOT NULL DEFAULT 'web_chat',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE ai_sales_journey_events ADD COLUMN IF NOT EXISTS customer_id TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE ai_sales_journey_events ADD COLUMN IF NOT EXISTS product_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE ai_sales_journey_events ADD COLUMN IF NOT EXISTS variant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE ai_sales_journey_events ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
  await clientOrPool.query(`ALTER TABLE ai_sales_journey_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE ai_sales_journey_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sales_journey_events_dedupe ON ai_sales_journey_events (tenant_id, dedupe_key) WHERE dedupe_key <> ''`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_sales_journey_events_tenant_conversation ON ai_sales_journey_events (tenant_id, conversation_id, created_at DESC)`);
};

const productFromConversation = (conversation = {}) =>
  conversation.current_product ||
  conversation.product ||
  conversation.channel_metadata?.product ||
  conversation.channel_metadata?.current_product ||
  conversation.channel_metadata?.last_viewed_product ||
  null;

const sizeFromConversation = (conversation = {}, message = "") =>
  explicitSize(message) ||
  text(conversation.customer_profile?.preferred_size) ||
  text(conversation.channel_metadata?.last_size) ||
  text(conversation.channel_metadata?.selected_size) ||
  "";

const colorFromConversation = (conversation = {}, message = "") =>
  explicitColor(message) ? text(message.match(/(?:black|white|red|blue|green|beige|grey|gray|brown|اسود|ابيض|احمر|ازرق|اخضر|بيج|رمادي|بني)/i)?.[0] || "") : "";

const buildEventsFromConversation = ({ conversation = {}, message = "", state = {}, response = {}, followUp = null, score = null, product = null, products = [] } = {}) => {
  const latestMessage = text(message || conversation.latest_message_preview || conversation.last_message);
  const conversationId = text(conversation.session_id || conversation.conversation_id || "");
  const customerId = text(conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "");
  const channel = text(conversation.channel || conversation.source || "web_chat");
  const selectedProduct = product || productFromConversation(conversation) || asArray(products)[0] || null;
  const events = [];

  if (selectedProduct?.id || selectedProduct?.product_id) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.PRODUCT_MATCHED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct.id || selectedProduct.product_id,
      variant_id: selectedProduct.variant_id || selectedProduct.selected_variant_id || null,
      channel,
      metadata: {
        reason: "product_context_present",
        score: selectedProduct.score || selectedProduct.match_score || null,
      },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (explicitPrice(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.PRICE_ASKED,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: { message: latestMessage },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  const size = sizeFromConversation(conversation, latestMessage);
  if (size && /(?:مقاس|size|sz|available|متاح)/i.test(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.SIZE_SELECTED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      variant_id: selectedProduct?.variant_id || null,
      channel,
      metadata: { size },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  } else if (/(?:مقاس|size|sz)/i.test(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.SIZE_ASKED,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: { message: latestMessage },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  const color = colorFromConversation(conversation, latestMessage);
  if (color) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.COLOR_SELECTED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      channel,
      metadata: { color },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (explicitImages(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.IMAGES_REQUESTED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      channel,
      metadata: { message: latestMessage },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (explicitAlternative(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.ALTERNATIVE_REQUESTED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      channel,
      metadata: { message: latestMessage },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (explicitObjection(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.OBJECTION_PRICE,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: { message: latestMessage },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (state.current_state === "DRAFT_ORDER" || conversation.draft_orders?.length || response?.ai_order?.status === "ai_draft") {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.DRAFT_ORDER_CREATED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      channel,
      metadata: { draft_order_count: conversation.draft_orders?.length || 0 },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (state.current_state === "PAYMENT_PENDING" || explicitPayment(latestMessage)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.PAYMENT_LINK_SENT,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      channel,
      metadata: { message: latestMessage },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (state.current_state === "CONFIRMED_ORDER" || conversation.confirmed_count > 0) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.ORDER_CONFIRMED,
      conversation_id: conversationId,
      customer_id: customerId,
      product_id: selectedProduct?.id || selectedProduct?.product_id || null,
      channel,
      metadata: { confirmed_count: conversation.confirmed_count || 0 },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (followUp?.follow_up_needed) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.FOLLOW_UP_SENT,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: followUp,
      created_at: followUp.suggested_follow_up_at || conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (explicitHuman(state)) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.HUMAN_TAKEOVER_STARTED,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: { reason: conversation.escalation_reason || conversation.ai_escalation_reason || "" },
      created_at: conversation.takeover_started_at || conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (state.previous_state === "HUMAN_TAKEOVER" && state.current_state !== "HUMAN_TAKEOVER") {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.HUMAN_TAKEOVER_ENDED,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: { next_state: state.current_state },
      created_at: conversation.returned_to_ai_at || conversation.updated_at || new Date().toISOString(),
    }));
  }

  if (state.current_state && state.previous_state && state.current_state !== state.previous_state) {
    events.push(normalizeEvent({
      event_type: SALES_JOURNEY_EVENT_TYPES.STATE_CHANGED,
      conversation_id: conversationId,
      customer_id: customerId,
      channel,
      metadata: {
        previous_state: state.previous_state,
        current_state: state.current_state,
        state_reason: state.state_reason || "",
        score: score?.score ?? null,
      },
      created_at: conversation.updated_at || new Date().toISOString(),
    }));
  }

  return events.filter((event) => event.event_type);
};

export const recordSalesJourneyEvents = async ({ tenantId, conversation = {}, state = {}, response = {}, followUp = null, score = null, product = null, products = [], message = "", clientOrPool = db } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return [];
  await ensureSchema(clientOrPool);
  const events = buildEventsFromConversation({ conversation, state, response, followUp, score, product, products, message });
  if (!events.length) return [];
  const inserted = [];
  for (const event of events) {
    const dedupeKey = dedupeKeyFor({
      tenantId: safeTenantId,
      conversationId: event.conversation_id,
      eventType: event.event_type,
      productId: event.product_id || "",
      variantId: event.variant_id || "",
      metadata: event.metadata || {},
      createdAt: event.created_at || "",
      channel: event.channel || "",
    });
    const result = await clientOrPool.query(
      `
      INSERT INTO ai_sales_journey_events (
        tenant_id, conversation_id, customer_id, event_type, product_id, variant_id, channel, metadata, dedupe_key, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, COALESCE($10::timestamp, NOW()))
      ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
      RETURNING *
      `,
      [
        safeTenantId,
        event.conversation_id,
        event.customer_id || "",
        event.event_type,
        event.product_id || null,
        event.variant_id || null,
        event.channel || "web_chat",
        JSON.stringify(event.metadata || {}),
        dedupeKey,
        event.created_at || null,
      ]
    );
    if (result.rows[0]) inserted.push(result.rows[0]);
  }
  return inserted;
};

export const loadRecentSalesJourneyEvents = async ({ tenantId, conversationId, limit = 8, clientOrPool = db } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !text(conversationId)) return [];
  await ensureSchema(clientOrPool);
  const result = await clientOrPool.query(
    `
    SELECT *
    FROM ai_sales_journey_events
    WHERE tenant_id = $1 AND conversation_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [safeTenantId, text(conversationId), Math.max(1, Math.min(20, Number(limit) || 8))]
  );
  return result.rows.map((row) => ({
    event_type: row.event_type,
    conversation_id: row.conversation_id,
    customer_id: row.customer_id || "",
    product_id: row.product_id || null,
    variant_id: row.variant_id || null,
    channel: row.channel || "web_chat",
    metadata: row.metadata || {},
    created_at: row.created_at,
  }));
};

export default {
  SALES_JOURNEY_EVENT_TYPES,
  recordSalesJourneyEvents,
  loadRecentSalesJourneyEvents,
  buildEventsFromConversation,
};
