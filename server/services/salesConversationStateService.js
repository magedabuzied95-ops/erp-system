import db from "../database/db.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value = "") => text(value).toLowerCase();

export const SALES_CONVERSATION_STATES = Object.freeze({
  DISCOVERY: "DISCOVERY",
  PRODUCT_MATCHED: "PRODUCT_MATCHED",
  SIZE_COLLECTION: "SIZE_COLLECTION",
  COLOR_COLLECTION: "COLOR_COLLECTION",
  PRICE_DISCUSSION: "PRICE_DISCUSSION",
  OBJECTION_HANDLING: "OBJECTION_HANDLING",
  DRAFT_ORDER: "DRAFT_ORDER",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  CONFIRMED_ORDER: "CONFIRMED_ORDER",
  FOLLOW_UP_NEEDED: "FOLLOW_UP_NEEDED",
  HUMAN_TAKEOVER: "HUMAN_TAKEOVER",
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
  hasAny(message, [
    "black", "white", "red", "blue", "green", "beige", "grey", "gray", "brown",
    "اسود", "أبيض", "ابيض", "احمر", "ازرق", "اخضر", "بيج", "رمادي", "بني",
  ]);

const explicitBudget = (message = "") =>
  hasAny(message, ["budget", "ميزانيه", "ميزانية", "في حدود", "لحد", "اقل من", "أقل من"]) ||
  /\b\d{3,7}\b/.test(text(message));

const explicitGender = (message = "") =>
  hasAny(message, ["men", "mens", "women", "womens", "ladies", "kids", "رجالي", "حريمي", "حريمى", "بناتي", "اطفال", "ولادي"]);

const explicitUsage = (message = "") =>
  hasAny(message, ["running", "runner", "casual", "daily", "sport", "training", "gym", "street", "outfit", "جري", "كاجوال", "يومي", "رياضه", "رياضة", "خروج", "خروجات"]);

const priceInquiry = (message = "") => hasAny(message, ["بكام", "السعر", "سعره", "price", "cost"]);
const paymentInquiry = (message = "") => hasAny(message, ["الدفع", "payment", "cash on delivery", "cod", "لينك", "فودافون", "انستا باي", "instapay"]);
const objectionInquiry = (message = "") => hasAny(message, ["غالي", "غاليه", "خصم", "ارخص", "اصلـي", "اصلي", "copy", "expensive", "discount", "cheaper"]);
const buyingIntent = (message = "") =>
  hasAny(message, ["احجز", "احجزه", "احجزهولي", "اطلب", "اعمل اوردر", "هاخده", "هاخدها", "تمام احجز", "order", "reserve", "checkout", "buy", "i'll take it"]);

const productLikeIntent = (message = "", memory = {}) => {
  const combined = `${text(message)} ${text(memory?.preferences?.last_product?.name)} ${text(memory?.preferences?.lastProductCard?.name)} ${text(memory?.customer_state)} ${text(memory?.preferences?.last_model_family)}`;
  return hasAny(combined, ["jordan", "nike", "adidas", "كوتشي", "سنيكر", "shoe", "shoes", "sneaker", "samba", "campus", "shox", "air force", "running", "sneakers"]);
};

const deriveMissingCriteria = ({ message = "", memory = {}, conversation = {} } = {}) => {
  const profile = conversation.customer_profile || {};
  const preferences = memory?.preferences || {};
  const missing = [];
  if (!explicitGender(message) && !text(profile.gender) && !text(preferences.gender)) missing.push("gender");
  if (!explicitUsage(message) && !text(preferences.favorite_style) && !asArray(preferences.preferred_styles).length) missing.push("usage");
  if (!explicitSize(message) && !text(profile.preferred_size) && !text(preferences.size)) missing.push("size");
  if (!explicitBudget(message) && !preferences.budget) missing.push("budget");
  if (!explicitColor(message) && !asArray(profile.preferred_colors).length && !asArray(preferences.preferred_colors).length) missing.push("color");
  return missing;
};

const stateFromMemory = (memory = {}) => {
  const preferences = memory?.preferences || {};
  return text(
    preferences.sales_engine_state ||
      preferences.conversation_stage ||
      preferences.current_state ||
      memory?.customer_state ||
      SALES_CONVERSATION_STATES.DISCOVERY
  ).toUpperCase();
};

const inferCurrentState = ({ message = "", memory = {}, conversation = {}, order = null, response = {}, journeyEvents = [] } = {}) => {
  const previous_state = stateFromMemory(memory);
  const customerProfile = conversation.customer_profile || {};
  const lastStateEvent = [...asArray(journeyEvents)].reverse().find((event) => event?.event_type === "STATE_CHANGED") || null;
  const baseContext = `${text(message)} ${text(conversation.latest_message_preview)} ${text(conversation.last_message)}`;
  const hasDraft = Boolean(conversation.draft_orders?.length || conversation.draft_order || order?.status === "draft" || response?.ai_order?.status === "ai_draft");
  const hasConfirmed = Boolean(order?.status === "confirmed" || response?.ai_order?.status === "confirmed" || conversation.confirmed_count > 0);
  const hasHuman = Boolean(conversation.human_takeover === true || conversation.needs_human_support === true || conversation.conversation_status === "human_takeover" || response?.needs_human_support);
  const askedPayment = paymentInquiry(baseContext);
  const askedPrice = priceInquiry(baseContext);
  const askedColor = explicitColor(baseContext);
  const askedSize = Boolean(explicitSize(baseContext));
  const objection = objectionInquiry(baseContext);
  const buying = buyingIntent(baseContext);
  const productIntent = productLikeIntent(baseContext, memory);
  const missingCriteria = deriveMissingCriteria({ message, memory, conversation });

  let current_state = SALES_CONVERSATION_STATES.DISCOVERY;
  let state_reason = "discovery_default";
  let confidence = 0.5;

  if (hasHuman) {
    current_state = SALES_CONVERSATION_STATES.HUMAN_TAKEOVER;
    state_reason = "human_takeover_detected";
    confidence = 0.98;
  } else if (hasConfirmed) {
    current_state = SALES_CONVERSATION_STATES.CONFIRMED_ORDER;
    state_reason = "confirmed_order_detected";
    confidence = 0.98;
  } else if (hasDraft) {
    current_state = SALES_CONVERSATION_STATES.DRAFT_ORDER;
    state_reason = "draft_order_present";
    confidence = 0.94;
  } else if (askedPayment) {
    current_state = SALES_CONVERSATION_STATES.PAYMENT_PENDING;
    state_reason = "payment_discussed";
    confidence = 0.88;
  } else if (objection) {
    current_state = SALES_CONVERSATION_STATES.OBJECTION_HANDLING;
    state_reason = "price_or_value_objection";
    confidence = 0.86;
  } else if (askedPrice) {
    current_state = SALES_CONVERSATION_STATES.PRICE_DISCUSSION;
    state_reason = "price_inquiry";
    confidence = 0.9;
  } else if (askedSize && askedColor) {
    current_state = SALES_CONVERSATION_STATES.PRODUCT_MATCHED;
    state_reason = "size_and_color_already_known";
    confidence = 0.84;
  } else if (askedSize) {
    current_state = SALES_CONVERSATION_STATES.SIZE_COLLECTION;
    state_reason = "size_inquiry";
    confidence = 0.84;
  } else if (askedColor) {
    current_state = SALES_CONVERSATION_STATES.COLOR_COLLECTION;
    state_reason = "color_inquiry";
    confidence = 0.82;
  } else if (buying || productIntent) {
    current_state = buying ? SALES_CONVERSATION_STATES.DRAFT_ORDER : (missingCriteria.length ? SALES_CONVERSATION_STATES.DISCOVERY : SALES_CONVERSATION_STATES.PRODUCT_MATCHED);
    state_reason = buying ? "buying_intent_detected" : (missingCriteria.length ? "needs_discovery_criteria" : "product_intent_detected");
    confidence = buying ? 0.92 : (missingCriteria.length ? 0.72 : 0.88);
  }

  if (current_state === SALES_CONVERSATION_STATES.DISCOVERY && lastStateEvent?.state_reason) {
    state_reason = lastStateEvent.state_reason;
  }

  return {
    current_state,
    previous_state,
    state_reason,
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    updated_at: new Date().toISOString(),
    channel: text(conversation.channel || conversation.source || "web_chat"),
    customer_id: text(conversation.external_customer_id || customerProfile.external_customer_id || conversation.profile_id || ""),
    conversation_id: text(conversation.session_id || conversation.conversation_id || ""),
    missing_criteria: missingCriteria,
  };
};

const ensureSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS ai_sales_conversation_states (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      conversation_id TEXT NOT NULL,
      customer_id TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'web_chat',
      current_state TEXT NOT NULL DEFAULT 'DISCOVERY',
      previous_state TEXT NOT NULL DEFAULT '',
      state_reason TEXT NOT NULL DEFAULT '',
      confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, conversation_id)
    )
  `);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS customer_id TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS current_state TEXT NOT NULL DEFAULT 'DISCOVERY'`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS previous_state TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS state_reason TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE ai_sales_conversation_states ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
};

export const upsertSalesConversationState = async ({ tenantId, conversation = {}, state = null, metadata = {}, clientOrPool = db } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return null;
  await ensureSchema(clientOrPool);
  const derived = state || inferCurrentState({ conversation });
  const result = await clientOrPool.query(
    `
    INSERT INTO ai_sales_conversation_states (
      tenant_id, conversation_id, customer_id, channel, current_state, previous_state, state_reason, confidence, metadata, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
    ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      channel = EXCLUDED.channel,
      previous_state = EXCLUDED.previous_state,
      current_state = EXCLUDED.current_state,
      state_reason = EXCLUDED.state_reason,
      confidence = EXCLUDED.confidence,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
    `,
    [
      safeTenantId,
      text(derived.conversation_id || conversation.session_id || conversation.conversation_id),
      text(derived.customer_id || conversation.external_customer_id || ""),
      text(derived.channel || conversation.channel || conversation.source || "web_chat"),
      text(derived.current_state || SALES_CONVERSATION_STATES.DISCOVERY),
      text(derived.previous_state || ""),
      text(derived.state_reason || ""),
      Math.max(0, Math.min(1, Number(derived.confidence || 0))),
      JSON.stringify({ ...(metadata || {}), ...(conversation.sales_intelligence || {}), missing_criteria: derived.missing_criteria || [] }),
    ]
  );
  return result.rows[0] || null;
};

export const loadSalesConversationState = async ({ tenantId, conversationId, clientOrPool = db } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !text(conversationId)) return null;
  await ensureSchema(clientOrPool);
  const result = await clientOrPool.query(
    `SELECT * FROM ai_sales_conversation_states WHERE tenant_id = $1 AND conversation_id = $2 LIMIT 1`,
    [safeTenantId, text(conversationId)]
  );
  return result.rows[0] || null;
};

export const buildSalesDiscoveryQuestions = ({ conversation = {}, memory = {}, state = null, maxQuestions = 2 } = {}) => {
  const derived = state || inferCurrentState({ conversation, memory });
  const missing = asArray(derived.missing_criteria);
  const labels = {
    gender: "رجالي ولا حريمي؟",
    usage: "تحبه كاجوال ولا للجري؟",
    size: "مقاسك كام؟",
    budget: "ميزانيتك في حدود كام؟",
    color: "تحب لون معين ولا أوريك المتاح؟",
  };
  return missing.slice(0, maxQuestions).map((item) => labels[item]).filter(Boolean);
};

export const buildSalesStateBadge = (state = {}) => {
  const currentState = text(state.current_state || SALES_CONVERSATION_STATES.DISCOVERY);
  return {
    current_state: currentState,
    label: currentState.replace(/_/g, " "),
    tone: currentState === SALES_CONVERSATION_STATES.CONFIRMED_ORDER ? "emerald" : currentState === SALES_CONVERSATION_STATES.HUMAN_TAKEOVER ? "amber" : currentState === SALES_CONVERSATION_STATES.OBJECTION_HANDLING ? "rose" : "cyan",
    state_reason: text(state.state_reason || ""),
    confidence: Math.max(0, Math.min(1, Number(state.confidence || 0))),
  };
};

export const inferSalesConversationState = inferCurrentState;

export default {
  SALES_CONVERSATION_STATES,
  inferSalesConversationState,
  buildSalesDiscoveryQuestions,
  buildSalesStateBadge,
  upsertSalesConversationState,
  loadSalesConversationState,
};
