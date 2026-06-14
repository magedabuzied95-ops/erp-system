import db from "../database/db.js";
import { resolveCustomerDisplayPrice } from "../utils/customerDisplayPrice.js";
import { getPerfContext } from "../utils/perfDebug.js";
import { emitToRooms } from "../utils/socket.js";
import { resolveAiProductUrl } from "./aiProductEligibilityService.js";
import {
  appendAiGeneratedSupportReply,
  appendManualAiSupportReply,
  getAiSupportConversationState,
  ensureAiSupportLogSchema,
} from "./aiSupportLogService.js";
import { pushAIEvent } from "./aiEventLogger.js";
import { resolveIntent } from "./aiIntentResolver.js";
import { buildProductContext, ensureProductLinkInReply } from "./aiProductContext.js";
import { buildCrossSellUpsellSuggestions } from "./crossSellUpsellService.js";
import { scoreConversationConversion } from "./conversionScoringService.js";
import { buildFollowUpRecommendation } from "./followUpRecommendationService.js";
import {
  getConversationMemory,
  updateConversationMemory,
} from "./aiConversationMemory.js";
import { ensureAiConversationMemorySchema } from "./aiConversationMemoryService.js";
import { extractShoeSize } from "./aiMessageExtractors.js";
import { guardAIReply } from "./aiSafetyGuard.js";
import { detectEscalation } from "./aiEscalationDetector.js";
import { getAISettings, getAIToneInstruction } from "./aiSettingsService.js";
import { buildHumanizedReply } from "./aiHumanizedReplies.js";
import {
  aiProductSqlExclusionClause,
  filterAiEligibleProducts,
} from "./aiProductEligibilityService.js";
import {
  detectSalesProductUnderstanding,
  gateRelevantProducts,
} from "./aiSalesOrchestratorService.js";
import {
  buildSalesDiscoveryQuestions,
  buildSalesStateBadge,
  inferSalesConversationState,
  upsertSalesConversationState,
} from "./salesConversationStateService.js";
import { loadRecentSalesJourneyEvents, recordSalesJourneyEvents } from "./salesJourneyEventService.js";
import { buildProactiveCloserPlan } from "./proactiveCloserService.js";
import { composeAiSalesReply } from "./aiSalesReplyComposerService.js";
import { isLikelyMessageLikeName, resolveMessengerConversationDisplayName } from "./aiChannelAdapterService.js";

let schemaReadyPromise = null;
let aiInboxSchemaReadyPromise = null;
let aiInboxSchemaEnsured = false;

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const int = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};
const json = (value) => JSON.stringify(value === undefined ? null : value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const uniqueArray = (items = []) => [...new Set(asArray(items).map((item) => text(item)).filter(Boolean))];
const isRegressionTestContext = () => Boolean(getPerfContext()?.is_regression_test || getPerfContext()?.dry_run);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, numeric(value, 0)));
const maskIdForLog = (value = "") => {
  const safe = text(value);
  if (!safe) return "";
  if (safe.length <= 8) return "***";
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
};

const normalizeConversationMemory = (conversation = {}) => ({
  preferences: {
    ...(conversation.customer_profile?.preferred_size ? { size: conversation.customer_profile.preferred_size } : {}),
    ...(conversation.customer_profile?.preferred_colors?.length ? { preferred_colors: conversation.customer_profile.preferred_colors } : {}),
    ...(conversation.customer_profile?.preferred_models?.length ? { preferred_models: conversation.customer_profile.preferred_models } : {}),
    ...(conversation.customer_profile?.memory_score ? { memory_score: conversation.customer_profile.memory_score } : {}),
    ...(conversation.customer_profile?.external_customer_id ? { external_customer_id: conversation.customer_profile.external_customer_id } : {}),
  },
  customer_state: conversation.sales_conversation_state?.current_state || conversation.sales_intelligence?.state?.current_state || "",
});

export const buildSalesConversationIntelligence = async ({
  tenantId,
  conversation,
  messages = [],
  draftOrders = [],
  conversationFollowups = [],
  recommendations = [],
  selectedProduct = null,
  currentStateRow = null,
  existingJourneyEvents = [],
  channel = "",
  providerMessageId = "",
  traceReason = "",
} = {}) => {
  const lastCustomerMessage = [...messages].reverse().find((message) => text(message.customer_message || message.message_text || message.last_message));
  const latestMessage = text(lastCustomerMessage?.customer_message || lastCustomerMessage?.message_text || conversation.latest_message_preview || conversation.last_message);
  const memory = normalizeConversationMemory(conversation);
  const conversationDraft = draftOrders[0] || conversation.draft_order || null;
  const latestOrder = conversationDraft || null;
  const state = inferSalesConversationState({
    message: latestMessage,
    conversation,
    memory,
    order: latestOrder,
    response: conversationDraft ? { ai_order: { status: conversationDraft.ai_agent_status || "ai_draft" } } : {},
    journeyEvents: existingJourneyEvents,
  });
  const currentStateMatches = currentStateRow
    && text(currentStateRow.current_state) === text(state.current_state)
    && text(currentStateRow.previous_state) === text(state.previous_state)
    && text(currentStateRow.state_reason) === text(state.state_reason)
    && Math.round(Number(currentStateRow.confidence || 0) * 1000) === Math.round(Number(state.confidence || 0) * 1000);
  const persistedState = currentStateMatches
    ? currentStateRow
    : await upsertSalesConversationState({
        tenantId,
        conversation,
        state,
        metadata: {
          last_message: latestMessage,
          has_draft_order: draftOrders.length > 0,
          has_followup: conversationFollowups.length > 0,
          selected_product_id: selectedProduct?.id || selectedProduct?.product_id || "",
          state_reason: state.state_reason,
          missing_criteria: state.missing_criteria || [],
        },
      }).catch(() => currentStateRow || state);
  const statePayload = persistedState || currentStateRow || state;
  const stateBadge = buildSalesStateBadge({
    current_state: statePayload.current_state || state.current_state,
    state_reason: statePayload.state_reason || state.state_reason,
    confidence: statePayload.confidence || state.confidence,
  });
  const followUp = buildFollowUpRecommendation({
    conversation,
    state: statePayload,
    journeyEvents: existingJourneyEvents,
    score: null,
    memory,
    message: latestMessage,
  });
  const score = scoreConversationConversion({
    conversation,
    state: statePayload,
    journeyEvents: existingJourneyEvents,
    followUp,
    products: recommendations,
    memory,
    message: latestMessage,
  });
  const closer = buildProactiveCloserPlan({
    conversation,
    state: statePayload,
    score,
    journeyEvents: existingJourneyEvents,
    products: recommendations,
    followUp,
  });
  const journeyEvents = asArray(existingJourneyEvents).length
    ? asArray(existingJourneyEvents)
    : await loadRecentSalesJourneyEvents({
        tenantId,
        conversationId: conversation.session_id,
        limit: 8,
      }).catch(() => []);
  const derivedEvents = currentStateMatches && asArray(existingJourneyEvents).length
    ? []
    : await recordSalesJourneyEvents({
        tenantId,
        conversation,
        state: statePayload,
        followUp,
        score,
        product: selectedProduct,
        products: recommendations,
        message: latestMessage,
      }).catch(() => []);
  const recentJourneyEvents = [...derivedEvents, ...journeyEvents]
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))
    .slice(0, 8);
  const discoveryQuestions = buildSalesDiscoveryQuestions({
    conversation,
    memory,
    state: statePayload,
    maxQuestions: 2,
  });
  const crossSellSuggestions = buildCrossSellUpsellSuggestions({
    conversation,
    products: recommendations,
    state: statePayload,
    selectedProduct,
    score,
  });
  if (text(traceReason)) {
    console.info("[SALES_ENGINE_CHANNEL_TRACE]", {
      channel: text(channel || conversation.channel || conversation.source || "web_chat"),
      conversation_id: text(conversation.session_id || ""),
      provider_message_id: text(providerMessageId || ""),
      sales_state: text(statePayload.current_state || state.current_state || ""),
      conversion_score: Number(score?.score ?? 0) || 0,
      recommended_action: text(closer?.recommended_action || followUp?.recommended_action || score?.recommended_action || "CONTINUE"),
      product_cards_count: asArray(recommendations).length,
      draft_order_id: draftOrders[0]?.id || conversation.draft_order?.id || conversation.draft_order_id || "",
      trace_reason: text(traceReason || ""),
    });
  }
  return {
    state: {
      ...statePayload,
      current_state: statePayload.current_state || state.current_state,
      previous_state: statePayload.previous_state || state.previous_state,
      state_reason: statePayload.state_reason || state.state_reason,
      confidence: Number(statePayload.confidence ?? state.confidence ?? 0),
      updated_at: statePayload.updated_at || new Date().toISOString(),
      channel: text(statePayload.channel || conversation.channel || conversation.source || "web_chat"),
      customer_id: text(statePayload.customer_id || conversation.external_customer_id || ""),
      conversation_id: text(conversation.session_id || ""),
      badge: stateBadge,
      discovery_questions: discoveryQuestions,
    },
    journeyEvents: recentJourneyEvents,
    conversion: score,
    followUp,
    crossSellSuggestions,
    closer,
  };
};

const tableColumnCache = new Map();

const getTableColumns = async (tableName = "") => {
  const table = text(tableName);
  if (!table) return new Set();
  if (tableColumnCache.has(table)) return tableColumnCache.get(table);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ANY (current_schemas(false))
      AND table_name = $1
    `,
    [table]
  ).catch(() => ({ rows: [] }));
  const columns = new Set(result.rows.map((row) => text(row.column_name)).filter(Boolean));
  tableColumnCache.set(table, columns);
  return columns;
};

const DEFAULT_SETTINGS = {
  agent_name: "AI Sales Agent",
  personality: "egyptian_sales_rep",
  tone_intensity: 0.72,
  egyptian_tone_level: 0.72,
  emoji_level: 0.2,
  reply_length: "balanced",
  sales_pressure: "medium",
  allowed_phrases: ["أيوه يا فندم", "تمام", "اختيار حلو", "أرشحلك"],
  preferred_phrases: ["أيوه يا فندم", "تمام", "اختيار حلو", "أرشحلك"],
  forbidden_phrases: ["أنا مساعد ذكي", "كنموذج لغوي", "لا أستطيع"],
  allow_auto_draft_creation: true,
  require_human_approval_before_confirm: false,
  allow_discount_promises: false,
  max_discount_percent: 0,
  cod_availability_text: "الدفع عند الاستلام متاح حسب المنطقة وسياسة الشحن.",
  exchange_return_policy_text: "الاستبدال أو الاسترجاع حسب سياسة المتجر وحالة المنتج.",
  delivery_policy_text: "التوصيل بيتحدد حسب المحافظة والمنطقة ويتأكد قبل الشحن.",
  followups_enabled: true,
  followup_cooldown_hours: 24,
  abandoned_followup_minutes: 45,
  max_followups_per_customer: 3,
  stop_followups_after_rejection: true,
  followup_templates: [
    "لسه مهتم بالموديل؟ أقدر أراجعلك المقاس واللون المتاح.",
    "لو محتاج بدائل قريبة من نفس الشكل ابعتلي المقاس والميزانية.",
  ],
  confidence_threshold: 0.62,
  auto_order_threshold: 0.84,
  discount_permission: false,
  escalation_rules: ["complaint", "discount", "return_exchange", "payment_issue", "unsupported_area"],
  handoff_rules: {
    angry_customer: true,
    low_confidence: true,
    discount_request: true,
    return_exchange_complaint: true,
    stock_conflict: true,
    payment_issue: true,
  },
  suggested_replies_enabled: true,
  suggested_reply_count: 3,
  suggested_replies_tone_source: "ai_settings",
  require_takeover_before_suggestions: true,
};

const OBJECTION_RULES = [
  { type: "price_high", terms: ["السعر غالي", "غالي", "expensive"], action: "cheaper_alternatives" },
  { type: "discount", terms: ["فيه خصم", "خصم", "اخر سعر", "آخر سعر", "discount"], action: "handoff" },
  { type: "quality", terms: ["خامته", "الخامة", "quality", "material"], action: "quality_value" },
  { type: "authenticity", terms: ["أصلي", "اصلي", "original", "authentic"], action: "policy_context" },
  { type: "exchange", terms: ["استبدال", "استرجاع", "ينفع استبدال", "return", "exchange"], action: "policy_context" },
  { type: "delivery_cost", terms: ["التوصيل بكام", "شحن بكام", "delivery cost"], action: "shipping_context" },
  { type: "delivery_eta", terms: ["هيوصل امتى", "يوصل امتى", "delivery time"], action: "shipping_context" },
  { type: "sizes", terms: ["مقاسات تانية", "مقاس تاني", "sizes"], action: "variant_suggestions" },
  { type: "cheaper", terms: ["فيه أرخص", "فيه ارخص", "ارخص", "cheaper"], action: "cheaper_alternatives" },
  { type: "cod", terms: ["الدفع عند الاستلام", "cod", "cash on delivery"], action: "payment_context" },
  { type: "complaint", terms: ["شكوى", "مشكلة", "زعلان", "مش عاجبني"], action: "handoff" },
];

const RESPONSE_VARIANTS = {
  opener: ["تمام", "بص", "حاضر", "جميل"],
  softAvailability: ["المتاح منه كويس دلوقتي", "فيه منه مقاسات شغالة", "خليني أظبطلك المتاح منه"],
  value: ["خامته عملية وشكله شيك في اللبس", "متوفر بسعر واضح ومناسب", "اختيار مضمون لو عايز حاجة تعيش معاك"],
  close: ["تحب أشوفلك مقاسك؟", "مقاسك كام؟", "تحب أشوفك الألوان والمقاسات؟"],
};

const pick = (items = [], seed = "") => {
  const list = asArray(items).filter(Boolean);
  if (!list.length) return "";
  const value = [...String(seed)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return list[value % list.length];
};

export const ensureAiSalesAgentSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_agent_settings (
          tenant_id BIGINT PRIMARY KEY,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS visual_attachments JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'ai_active'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS customer_avatar_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS takeover_started_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS returned_to_ai_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS staff_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(40) NOT NULL DEFAULT 'customer'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS manual_message BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS staff_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS staff_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS delivery_error TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS customer_avatar_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS sentiment TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS product_cards JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS detected_intent TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS sentiment TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS detected_intent TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS sentiment TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_customer_profiles (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          first_name TEXT NOT NULL DEFAULT '',
          last_name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          source_channel TEXT NOT NULL DEFAULT '',
          external_customer_id TEXT NOT NULL DEFAULT '',
          profile_pic_url TEXT NOT NULL DEFAULT '',
          preferred_size TEXT NOT NULL DEFAULT '',
          preferred_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
          preferred_models JSONB NOT NULL DEFAULT '[]'::jsonb,
          favorite_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
          budget_range JSONB NOT NULL DEFAULT '{}'::jsonb,
          viewed_products JSONB NOT NULL DEFAULT '[]'::jsonb,
          abandoned_products JSONB NOT NULL DEFAULT '[]'::jsonb,
          order_history JSONB NOT NULL DEFAULT '[]'::jsonb,
          support_history JSONB NOT NULL DEFAULT '[]'::jsonb,
          city_area TEXT NOT NULL DEFAULT '',
          conversation_summary TEXT NOT NULL DEFAULT '',
          customer_sentiment TEXT NOT NULL DEFAULT 'neutral',
          memory_score INTEGER NOT NULL DEFAULT 0,
          last_profile_sync_at TIMESTAMP NULL,
          last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, phone)
        )
      `);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_customer_memories (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          profile_id BIGINT NULL REFERENCES ai_customer_profiles(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL DEFAULT '',
          memory_type TEXT NOT NULL DEFAULT 'preference',
          memory_key TEXT NOT NULL DEFAULT '',
          memory_value JSONB NOT NULL DEFAULT '{}'::jsonb,
          score INTEGER NOT NULL DEFAULT 0,
          last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_customer_interactions (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          profile_id BIGINT NULL REFERENCES ai_customer_profiles(id) ON DELETE SET NULL,
          session_id TEXT NOT NULL DEFAULT '',
          source_channel TEXT NOT NULL DEFAULT 'web_chat',
          channel TEXT NOT NULL DEFAULT 'web_chat',
          customer_name TEXT NOT NULL DEFAULT '',
          last_message TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          ai_response TEXT NOT NULL DEFAULT '',
          intent_type TEXT NOT NULL DEFAULT '',
          detected_intent TEXT NOT NULL DEFAULT '',
          sentiment TEXT NOT NULL DEFAULT 'neutral',
          confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
          intent_confidence NUMERIC(5,2),
          detected_language TEXT,
          handoff_to_human BOOLEAN DEFAULT FALSE,
          resolution_status TEXT DEFAULT 'open',
          ai_response_time_ms INTEGER,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_followup_tasks (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          profile_id BIGINT NULL REFERENCES ai_customer_profiles(id) ON DELETE SET NULL,
          session_id TEXT NOT NULL DEFAULT '',
          source_channel TEXT NOT NULL DEFAULT 'web_chat',
          trigger_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          scheduled_at TIMESTAMP NOT NULL,
          last_sent_at TIMESTAMP NULL,
          cooldown_until TIMESTAMP NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS manual_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS sent_internal_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS manual_ready_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS stopped_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_followup_tasks ADD COLUMN IF NOT EXISTS action_by BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_interactions ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS source_channel TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS external_customer_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS profile_pic_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS last_profile_sync_at TIMESTAMP NULL`);
      await clientOrPool.query(`UPDATE ai_customer_interactions SET detected_intent = intent_type WHERE COALESCE(detected_intent, '') = '' AND COALESCE(intent_type, '') <> ''`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_customer_profiles_tenant_seen ON ai_customer_profiles (tenant_id, last_seen_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_interactions_tenant_created ON ai_customer_interactions (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_followups_tenant_status ON ai_followup_tasks (tenant_id, status, scheduled_at)`);
      await ensureAiInboxSchema(clientOrPool);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const ensureAiInboxSchema = async (clientOrPool = db) => {
  if (aiInboxSchemaEnsured) return;
  if (clientOrPool === db && aiInboxSchemaReadyPromise) return aiInboxSchemaReadyPromise;
  const runEnsure = async () => {
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS ai_channel_conversations (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        channel TEXT NOT NULL,
        external_conversation_id TEXT NOT NULL,
        external_customer_id TEXT NOT NULL DEFAULT '',
        is_group BOOLEAN NOT NULL DEFAULT FALSE,
        ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_avatar_url TEXT NOT NULL DEFAULT '',
        last_message TEXT NOT NULL DEFAULT '',
        customer_profile_id BIGINT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_message_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, channel, external_conversation_id)
      )
    `);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS external_customer_id TEXT NOT NULL DEFAULT ''`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS customer_avatar_url TEXT NOT NULL DEFAULT ''`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP NULL`);
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS ai_channel_event_logs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        channel TEXT NOT NULL,
        direction TEXT NOT NULL,
        external_customer_id TEXT NOT NULL DEFAULT '',
        conversation_id TEXT NOT NULL DEFAULT '',
        message_preview TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await clientOrPool.query(`ALTER TABLE ai_channel_event_logs ADD COLUMN IF NOT EXISTS conversation_id TEXT NOT NULL DEFAULT ''`);
    await clientOrPool.query(`ALTER TABLE ai_channel_event_logs ADD COLUMN IF NOT EXISTS message_preview TEXT NOT NULL DEFAULT ''`);
    await clientOrPool.query(`ALTER TABLE ai_channel_event_logs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT ''`);
  };
  if (clientOrPool !== db) return runEnsure();
  aiInboxSchemaReadyPromise = runEnsure()
    .then(() => {
      aiInboxSchemaEnsured = true;
    })
    .catch((error) => {
      aiInboxSchemaReadyPromise = null;
      throw error;
    });
  return aiInboxSchemaReadyPromise;
};

export const getAiAgentSettings = async ({ tenantId }) => {
  await ensureAiSalesAgentSchema();
  const result = await db.query(`SELECT settings FROM ai_agent_settings WHERE tenant_id = $1`, [tenantId]);
  const stored = result.rows[0]?.settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    handoff_rules: { ...DEFAULT_SETTINGS.handoff_rules, ...(stored.handoff_rules || {}) },
    preferred_phrases: asArray(stored.preferred_phrases || stored.allowed_phrases || DEFAULT_SETTINGS.preferred_phrases),
    allowed_phrases: asArray(stored.allowed_phrases || stored.preferred_phrases || DEFAULT_SETTINGS.allowed_phrases),
    forbidden_phrases: asArray(stored.forbidden_phrases || DEFAULT_SETTINGS.forbidden_phrases),
    followup_templates: asArray(stored.followup_templates || DEFAULT_SETTINGS.followup_templates),
    discount_permission: stored.discount_permission ?? stored.allow_discount_promises ?? DEFAULT_SETTINGS.discount_permission,
    allow_discount_promises: stored.allow_discount_promises ?? stored.discount_permission ?? DEFAULT_SETTINGS.allow_discount_promises,
    followup_cooldown_hours: stored.followup_cooldown_hours ?? stored.cooldown_hours ?? DEFAULT_SETTINGS.followup_cooldown_hours,
    tone_intensity: stored.tone_intensity ?? stored.egyptian_tone_level ?? DEFAULT_SETTINGS.tone_intensity,
    egyptian_tone_level: stored.egyptian_tone_level ?? stored.tone_intensity ?? DEFAULT_SETTINGS.egyptian_tone_level,
  };
};

export const updateAiAgentSettings = async ({ tenantId, settings = {} }) => {
  await ensureAiSalesAgentSchema();
  const next = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    handoff_rules: { ...DEFAULT_SETTINGS.handoff_rules, ...(settings?.handoff_rules || {}) },
    allowed_phrases: asArray(settings.allowed_phrases || settings.preferred_phrases || DEFAULT_SETTINGS.allowed_phrases),
    preferred_phrases: asArray(settings.preferred_phrases || settings.allowed_phrases || DEFAULT_SETTINGS.preferred_phrases),
    forbidden_phrases: asArray(settings.forbidden_phrases || DEFAULT_SETTINGS.forbidden_phrases),
    followup_templates: asArray(settings.followup_templates || DEFAULT_SETTINGS.followup_templates),
    discount_permission: settings.allow_discount_promises === true,
    allow_discount_promises: settings.allow_discount_promises === true,
    max_discount_percent: Math.max(0, Math.min(100, numeric(settings.max_discount_percent, 0))),
    suggested_reply_count: Math.max(1, Math.min(3, int(settings.suggested_reply_count, DEFAULT_SETTINGS.suggested_reply_count))),
    max_followups_per_customer: Math.max(0, int(settings.max_followups_per_customer, DEFAULT_SETTINGS.max_followups_per_customer)),
    followup_cooldown_hours: Math.max(1, int(settings.followup_cooldown_hours ?? settings.cooldown_hours, DEFAULT_SETTINGS.followup_cooldown_hours)),
    egyptian_tone_level: clamp(settings.egyptian_tone_level ?? settings.tone_intensity ?? DEFAULT_SETTINGS.egyptian_tone_level, 0, 1),
    tone_intensity: clamp(settings.egyptian_tone_level ?? settings.tone_intensity ?? DEFAULT_SETTINGS.tone_intensity, 0, 1),
    emoji_level: clamp(settings.emoji_level ?? DEFAULT_SETTINGS.emoji_level, 0, 1),
  };
  const result = await db.query(
    `
    INSERT INTO ai_agent_settings (tenant_id, settings, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
    RETURNING settings
    `,
    [tenantId, json(next)]
  );
  console.log("[ai-agent] settings updated", { tenantId });
  return { ...DEFAULT_SETTINGS, ...(result.rows[0]?.settings || {}) };
};

export const detectSalesObjection = (message = "") => {
  const normalized = lower(message);
  return OBJECTION_RULES.find((rule) => rule.terms.some((term) => normalized.includes(lower(term)))) || null;
};

const sentimentFromMessage = (message = "") => {
  const normalized = lower(message);
  if (["شكوى", "زعلان", "وحش", "مشكلة", "غالي جدا", "مش عاجب"].some((term) => normalized.includes(term))) return "negative";
  if (["تمام", "حلو", "هاخده", "ممتاز", "جامد"].some((term) => normalized.includes(term))) return "positive";
  return "neutral";
};

const leadTypeFrom = ({ memoryScore = 0, sentiment = "neutral", needsHumanSupport = false, draftCount = 0, confirmedCount = 0, followupDue = false } = {}) => {
  const score = numeric(memoryScore, 0);
  if (String(sentiment || "").toLowerCase() === "negative") return "Complaint";
  if (confirmedCount > 0 && score >= 70) return "VIP";
  if (needsHumanSupport) return "Complaint";
  if (draftCount > 0 || score >= 75) return "Hot Lead";
  if (followupDue || score >= 45) return "Warm Lead";
  return "Cold Lead";
};

const leadBadgeKey = (leadType = "") => lower(leadType).replace(/\s+/g, "_");

const isGroupJid = (value = "") => /@g\.us$/i.test(text(value));

const isWhatsAppGroupConversation = (row = {}, conversationId = "") => {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return Boolean(
    row?.is_group === true ||
    isGroupJid(row?.external_conversation_id) ||
    isGroupJid(row?.external_customer_id) ||
    isGroupJid(row?.session_id) ||
    isGroupJid(row?.remote_jid) ||
    isGroupJid(metadata.remote_jid) ||
    isGroupJid(metadata.remoteJid) ||
    isGroupJid(metadata.chat_id) ||
    isGroupJid(metadata.chatId) ||
    isGroupJid(metadata.conversation_id) ||
    isGroupJid(metadata.conversationId) ||
    isGroupJid(conversationId)
  );
};

const whatsappInboxGroupFilterSql = (sessionAlias = "s", conversationAlias = "c") => `
  NOT (
    COALESCE(${conversationAlias}.channel, ${sessionAlias}.channel, ${sessionAlias}.source) = 'whatsapp'
    AND (
      COALESCE(${conversationAlias}.is_group, FALSE) = TRUE
      OR COALESCE(${conversationAlias}.external_conversation_id, '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.external_customer_id, '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.metadata->>'remote_jid', '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.metadata->>'remoteJid', '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.metadata->>'chat_id', '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.metadata->>'chatId', '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.metadata->>'conversation_id', '') LIKE '%@g.us%'
      OR COALESCE(${conversationAlias}.metadata->>'conversationId', '') LIKE '%@g.us%'
      OR COALESCE(${sessionAlias}.session_id, '') LIKE '%@g.us%'
      OR COALESCE(${sessionAlias}.source, '') = 'whatsapp' AND COALESCE(${sessionAlias}.session_id, '') LIKE '%@g.us%'
    )
  )
`;

export const normalizeInboxMessage = (row = {}) => ({
  id: row.id,
  session_id: row.session_id,
  channel: row.channel || "",
  external_message_id: row.external_message_id || "",
  dedupe_key: row.dedupe_key || "",
  customer_message: row.customer_message || row.message_text || "",
  ai_answer: row.ai_answer || "",
  staff_message: row.staff_message || "",
  sender_type: row.sender_type || (row.staff_message ? "staff" : "customer"),
  manual_message: row.manual_message === true,
  staff_user_id: row.staff_user_id || null,
  staff_user_name: row.staff_user_name || "",
  delivery_status: row.delivery_status || "",
  delivery_error: row.delivery_error || "",
  confidence: Number(row.confidence || 0),
  needs_human_support: row.needs_human_support === true,
  detected_intent: row.detected_intent || "",
  suggested_products: asArray(row.suggested_products),
  visual_attachments: asArray(row.visual_attachments),
  suggested_actions: asArray(row.suggested_actions),
  created_at: row.created_at,
  system_events: [
    row.needs_human_support ? { type: "handoff", label: "Human handoff requested", created_at: row.created_at } : null,
    row.detected_intent === "order_draft_created" ? { type: "draft_created", label: "Draft created", created_at: row.created_at } : null,
  ].filter(Boolean),
});

const buildCustomerProfilePayload = ({ conversation = {}, memories = [] } = {}) => {
  const profile = conversation.customer_profile || {};
  const memoryValues = memories.map((item) => item.memory_value || {});
  const firstName = text(profile.first_name || conversation.first_name || "");
  const lastName = text(profile.last_name || conversation.last_name || "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return {
    id: profile.id || conversation.profile_id || null,
    name: fullName || firstName || conversation.customer_name || "",
    first_name: firstName,
    last_name: lastName,
    avatar_url: profile.profile_pic_url || conversation.profile_pic_url || conversation.customer_avatar_url || conversation.session_customer_avatar_url || conversation.channel_metadata?.profile_pic || conversation.channel_metadata?.messenger_profile?.profile_pic || "",
    profile_pic_url: profile.profile_pic_url || conversation.profile_pic_url || conversation.customer_avatar_url || conversation.session_customer_avatar_url || conversation.channel_metadata?.profile_pic || conversation.channel_metadata?.messenger_profile?.profile_pic || "",
    external_customer_id: profile.external_customer_id || conversation.external_customer_id || "",
    source_channel: profile.source_channel || conversation.channel || conversation.source || "",
    phone: profile.phone || conversation.phone || "",
    city_area: profile.city_area || conversation.city_area || "",
    preferred_size: profile.preferred_size || uniqueArray(memoryValues.flatMap((item) => item.sizes || item.preferred_sizes || [])).join(", "),
    preferred_colors: uniqueArray([...(profile.preferred_colors || []), ...memoryValues.flatMap((item) => item.colors || item.preferred_colors || [])]),
    preferred_models: uniqueArray([...(profile.preferred_models || []), ...memoryValues.flatMap((item) => item.models || item.product_terms || [])]),
    viewed_products: asArray(profile.viewed_products),
    abandoned_products: asArray(profile.abandoned_products),
    previous_orders: asArray(profile.order_history),
    sentiment_history: memories
      .filter((item) => item.memory_type === "sentiment" || item.memory_key === "sentiment")
      .map((item) => ({ value: item.memory_value, score: item.score, at: item.last_seen_at || item.created_at })),
    memory_notes: memories.map((item) => ({
      id: item.id,
      type: item.memory_type,
      key: item.memory_key,
      value: item.memory_value,
      score: item.score,
      last_seen_at: item.last_seen_at,
    })),
    conversation_summary: profile.conversation_summary || "",
    customer_sentiment: profile.customer_sentiment || conversation.customer_sentiment || "neutral",
    memory_score: numeric(profile.memory_score ?? conversation.memory_score, 0),
  };
};

const extractFirstName = (name = "") => text(name).split(/\s+/).filter(Boolean)[0] || "";

const summarizeProducts = (products = []) =>
  asArray(products).slice(0, 8).map((product) => ({
    id: product.id || product.product_id,
    name: product.name || product.title || "",
    price: resolveCustomerDisplayPrice(product).display_price || numeric(product.price ?? product.sale_price ?? product.product_price, 0),
  })).filter((product) => product.id || product.name);

export const upsertAiCustomerProfile = async ({ tenantId, sessionId = "", metadata = {}, message = "", response = {} } = {}) => {
  if (isRegressionTestContext()) {
    console.info("[ai-agent:dry-run-skip]", { action: "upsertAiCustomerProfile" });
    return null;
  }
  await ensureAiSalesAgentSchema();
  const phone = text(metadata.customer_phone || metadata.phone || "").replace(/[^\d+]/g, "");
  if (!tenantId || !phone) return null;
  const channel = text(metadata.channel || "").toLowerCase();
  const isMessengerChannel = ["facebook_messenger", "facebook", "messenger", "instagram"].includes(channel);
  const firstNameSource = isMessengerChannel
    ? text(
        metadata.messenger_profile?.name ||
          metadata.sender_name ||
          metadata.profile_name ||
          metadata.contact_name ||
          metadata.external_sender_name ||
          metadata.external_contact_name ||
          metadata.customer_profile_name ||
          metadata.full_name ||
          ""
      )
    : text(metadata.customer_name || metadata.full_name || "");
  const firstName = isMessengerChannel && isLikelyMessageLikeName(firstNameSource) ? "" : extractFirstName(firstNameSource);
  const products = summarizeProducts(response.suggested_products);
  const sentiment = sentimentFromMessage(message);
  const memoryScore = Math.min(100, 20 + products.length * 5 + (response.ai_order ? 30 : 0) + (sentiment === "positive" ? 10 : 0));
  const result = await db.query(
    `
    INSERT INTO ai_customer_profiles (
      tenant_id, first_name, phone, viewed_products, city_area, conversation_summary,
      customer_sentiment, memory_score, last_seen_at, updated_at
    )
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,NOW(),NOW())
    ON CONFLICT (tenant_id, phone) DO UPDATE SET
      first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), ai_customer_profiles.first_name),
      viewed_products = (
        SELECT COALESCE(jsonb_agg(DISTINCT item), '[]'::jsonb)
        FROM jsonb_array_elements(ai_customer_profiles.viewed_products || EXCLUDED.viewed_products) AS item
      ),
      city_area = COALESCE(NULLIF(EXCLUDED.city_area, ''), ai_customer_profiles.city_area),
      conversation_summary = COALESCE(NULLIF(EXCLUDED.conversation_summary, ''), ai_customer_profiles.conversation_summary),
      customer_sentiment = EXCLUDED.customer_sentiment,
      memory_score = GREATEST(ai_customer_profiles.memory_score, EXCLUDED.memory_score),
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [
      tenantId,
      firstName,
      phone,
      json(products),
      text(metadata.city_area || metadata.area),
      text(response.answer || message).slice(0, 500),
      sentiment,
      memoryScore,
    ]
  );
  const profile = result.rows[0];
  await db.query(
    `
    INSERT INTO ai_customer_interactions (
      tenant_id, profile_id, session_id, source_channel, message, ai_response,
      intent_type, detected_intent, sentiment, confidence, intent_confidence, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    `,
    [
      tenantId,
      profile.id,
      text(sessionId),
      text(metadata.channel || "web_chat"),
      text(message),
      text(response.answer),
      text(response.detected_intent),
      text(response.detected_intent),
      sentiment,
      numeric(response.confidence, 0),
      numeric(response.confidence, 0),
      json({ suggested_products: products, ai_order: response.ai_order || null }),
    ]
  );
  console.log("[ai-agent:memory] profile updated", { tenantId, profile_id: profile.id, sentiment });
  return profile;
};

export const composeObjectionReply = ({ message = "", product = null, settings = DEFAULT_SETTINGS } = {}) => {
  const objection = detectSalesObjection(message);
  if (!objection) return null;
  const opener = pick(settings.allowed_phrases?.length ? settings.allowed_phrases : RESPONSE_VARIANTS.opener, `${message}:${objection.type}`);
  const name = product?.name || "الموديل ده";
  if (objection.action === "handoff") {
    if (objection.type === "discount" && (settings.allow_discount_promises === true || settings.discount_permission === true)) {
      const maxDiscount = numeric(settings.max_discount_percent, 0);
      return {
        answer: maxDiscount > 0
          ? `${opener}، أقدر أراجعلك خصم لحد ${maxDiscount}% حسب سياسة المتجر قبل تأكيد الأوردر.`
          : `${opener}، أقدر أراجعلك لو فيه عرض متاح قبل تأكيد الأوردر.`,
        needs_human_support: false,
        suggested_actions: ["show_similar_products"],
        objection_type: objection.type,
      };
    }
    return {
      answer: `${opener}، النقطة دي محتاجة تأكيد من الفريق عشان نديك أفضل حل مضبوط. هحوّلك لحد يراجعها معاك.`,
      needs_human_support: true,
      suggested_actions: ["contact_support"],
      objection_type: objection.type,
    };
  }
  if (objection.action === "cheaper_alternatives") {
    return {
      answer: `${opener}، فاهمك. ${name} قيمته حلوة، بس أقدر أرشحلك بدائل أرخص بنفس اللوك تقريبًا. مقاسك كام؟`,
      needs_human_support: false,
      suggested_actions: ["show_similar_products"],
      objection_type: objection.type,
    };
  }
  if (objection.action === "variant_suggestions") {
    return {
      answer: `${opener}، أشيكلك على المقاسات المتاحة. قولّي مقاسك الأساسي ولو ينفع معاك مقاس قريب منه.`,
      needs_human_support: false,
      suggested_actions: ["choose_size"],
      objection_type: objection.type,
    };
  }
  const line =
    objection.action === "quality_value"
      ? `${name} خامته عملية ومناسب للبس اليومي، والأهم إن المقاس لو مضبوط هيديك شكل حلو في الرجل.`
      : objection.action === "shipping_context"
        ? "التوصيل بيتحسب حسب المحافظة والمنطقة، وابعتلي منطقتك أقولك الأنسب."
        : objection.action === "payment_context"
          ? "الدفع عند الاستلام متاح حسب المنطقة وحالة العميل، ابعتلي رقمك ومنطقتك ونأكدها."
          : "السياسة بتتأكد حسب حالة المنتج والطلب، أقدر أوصلك بفريق الدعم لو محتاج تفاصيل دقيقة.";
  return {
    answer: `${opener}، ${line}`,
    needs_human_support: false,
    suggested_actions: ["show_similar_products"],
    objection_type: objection.type,
  };
};

export const humanizeSalesResponse = async ({ tenantId, message = "", response = {} } = {}) => {
  const settings = await getAiAgentSettings({ tenantId }).catch(() => DEFAULT_SETTINGS);
  let answer = text(response.answer);
  const products = [
    ...asArray(response.suggested_products),
    ...asArray(response.product_cards),
    ...asArray(response.channel_reply?.product_cards),
  ];
  const firstProduct = products[0] || null;
  const objectionReply = composeObjectionReply({ message, product: firstProduct, settings });
  if (objectionReply) {
    return {
      ...response,
      ...objectionReply,
      confidence: Math.max(numeric(response.confidence, 0), 0.7),
      detected_intent: objectionReply.objection_type,
      sales_agent: { objection_type: objectionReply.objection_type, humanized: true },
    };
  }
  if (products.length && answer) {
    const name = firstProduct?.name || firstProduct?.title || "";
    const price = resolveCustomerDisplayPrice(firstProduct || {}).display_price || numeric(firstProduct?.price ?? firstProduct?.sale_price ?? firstProduct?.product_price, 0);
    const opener = pick(settings.allowed_phrases?.length ? settings.allowed_phrases : RESPONSE_VARIANTS.opener, message);
    const valueLine = pick(RESPONSE_VARIANTS.value, `${message}:${name}`);
    if (!/أنا مساعد ذكي|كنموذج لغوي/i.test(answer)) {
      answer = `${opener}، ${name ? `${name} ` : ""}${price ? `سعره ${price} جنيه. ` : ""}${valueLine}. ${pick(RESPONSE_VARIANTS.close, message)}`;
    }
  }
  const lengthMode = text(settings.reply_length || "balanced");
  if (lengthMode === "short") {
    answer = answer.split(/\n+/).slice(0, 2).join("\n").split(/(?<=[.!؟])\s+/).slice(0, 2).join(" ").trim();
  }
  if (numeric(settings.emoji_level, 0) <= 0.05) {
    answer = answer.replace(/[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/gu, "").trim();
  }
  for (const phrase of asArray(settings.forbidden_phrases)) {
    if (phrase) answer = answer.replaceAll(phrase, "").trim();
  }
  return {
    ...response,
    answer,
    sales_agent: {
      humanized: true,
      personality: settings.personality,
      tone_intensity: settings.tone_intensity,
    },
  };
};

export const scheduleAiFollowupIfNeeded = async ({ tenantId, sessionId = "", metadata = {}, response = {} } = {}) => {
  if (isRegressionTestContext()) {
    console.info("[ai-agent:dry-run-skip]", { action: "scheduleAiFollowupIfNeeded" });
    return null;
  }
  await ensureAiSalesAgentSchema();
  if (!tenantId || !sessionId) return null;
  if (response.needs_human_support || response.ai_order?.status === "confirmed") return null;
  const settings = await getAiAgentSettings({ tenantId }).catch(() => DEFAULT_SETTINGS);
  if (settings.followups_enabled === false) return null;
  const customerRejected = ["مش مهتم", "لا شكرا", "لا شكرًا", "stop", "unsubscribe", "مش عايز"].some((term) => lower(response.answer || metadata.last_customer_message || "").includes(lower(term)));
  if (settings.stop_followups_after_rejection !== false && customerRejected) return null;
  const products = summarizeProducts(response.suggested_products);
  if (!products.length && response.detected_intent !== "order_collecting_details") return null;
  const existing = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ai_followup_tasks
    WHERE tenant_id = $1 AND session_id = $2
    `,
    [tenantId, text(sessionId)]
  );
  if (int(existing.rows[0]?.count, 0) >= int(settings.max_followups_per_customer, DEFAULT_SETTINGS.max_followups_per_customer)) return null;
  const triggerType = response.detected_intent === "order_collecting_details" ? "abandoned_order_details" : "viewed_product_without_purchase";
  const result = await db.query(
    `
    INSERT INTO ai_followup_tasks (
      tenant_id, session_id, source_channel, trigger_type, scheduled_at, cooldown_until, payload
    )
    VALUES (
      $1, $2, $3, $4,
      NOW() + ($5::int * INTERVAL '1 minute'),
      NOW() + ($6::int * INTERVAL '1 hour'),
      $7::jsonb
    )
    RETURNING *
    `,
    [
      tenantId,
      text(sessionId),
      text(metadata.channel || "web_chat"),
      triggerType,
      int(settings.abandoned_followup_minutes, 45),
      int(settings.followup_cooldown_hours, 24),
      json({ products, last_answer: response.answer || "", metadata }),
    ]
  );
  console.log("[ai-agent:followup] scheduled", { tenantId, sessionId, trigger_type: triggerType });
  return result.rows[0] || null;
};

export const loadAiInboxMessages = async ({ tenantId, conversationId, limit = 30, before = "" } = {}) => {
  await ensureAiSalesAgentSchema();
  await ensureAiInboxSchema();
  const safeConversationId = text(conversationId);
  if (isGroupJid(safeConversationId)) {
    return { messages: [], total: 0, has_more: false, next_before: "" };
  }
  const conversationMeta = await db.query(
    `
    SELECT c.*, s.session_id
    FROM ai_channel_conversations c
    LEFT JOIN ai_support_sessions s ON s.tenant_id = c.tenant_id AND s.session_id = c.external_conversation_id
    WHERE c.tenant_id = $1
      AND c.external_conversation_id = $2
    LIMIT 1
    `,
    [tenantId, safeConversationId]
  );
  if (isWhatsAppGroupConversation(conversationMeta.rows[0] || {}, safeConversationId)) {
    return { messages: [], total: 0, has_more: false, next_before: "" };
  }
  const messageLimit = Math.min(100, Math.max(1, int(limit, 30)));
  const params = [tenantId, safeConversationId, messageLimit];
  const beforeClause = before
    ? (() => {
        params.push(before);
        return `AND created_at < $${params.length}`;
      })()
    : "";
  const result = await db.query(
    `
    SELECT *
    FROM (
      SELECT *
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        ${beforeClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    ) recent_messages
    ORDER BY created_at ASC, id ASC
    `,
    params
  );
  const countResult = await db.query(
    `
    SELECT COUNT(*)::int AS total
    FROM ai_support_messages
    WHERE tenant_id = $1
      AND session_id = $2
    `,
    [tenantId, safeConversationId]
  );
  const messages = result.rows.map(normalizeInboxMessage);
  const oldest = messages[0] || null;
  const total = Number(countResult.rows[0]?.total || 0);
  return {
    messages,
    total,
    has_more: before ? messages.length === messageLimit : total > messages.length,
    next_before: oldest?.created_at || "",
  };
};

export const loadAiInbox = async ({ tenantId, filter = "all", limit = 50, search = "", messageLimit = 30 } = {}) => {
  await ensureAiSalesAgentSchema();
  await ensureAiConversationMemorySchema();
  await ensureAiSupportLogSchema();
  const clauses = ["s.tenant_id = $1"];
  const params = [tenantId, Math.min(1000, Math.max(1, int(limit, 50)))];
  const inboxMessageLimit = Math.min(100, Math.max(1, int(messageLimit, 30)));
  const normalizedFilter = lower(filter || "all");
  const searchTerm = text(search);
  clauses.push(whatsappInboxGroupFilterSql("s", "c"));
  if (normalizedFilter === "hot_leads") clauses.push("(COALESCE(o.draft_count, 0) > 0 OR COALESCE(p.memory_score, 0) >= 75)");
  if (normalizedFilter === "complaints") clauses.push("(m.needs_human_support = TRUE OR COALESCE(p.customer_sentiment, '') = 'negative')");
  if (["human_handoff", "human_takeover", "needs_human"].includes(normalizedFilter)) clauses.push("(s.status = 'human_takeover' OR m.needs_human_support = TRUE)");
  if (normalizedFilter === "waiting_customers") clauses.push("s.updated_at < NOW() - INTERVAL '15 minutes'");
  if (normalizedFilter === "closed") clauses.push("s.status = 'closed'");
  if (["draft_orders", "ai_drafts"].includes(normalizedFilter)) clauses.push("COALESCE(o.draft_count, 0) > 0");
  if (normalizedFilter === "confirmed_orders") clauses.push("COALESCE(o.confirmed_count, 0) > 0");
  if (["abandoned", "follow_up_due"].includes(normalizedFilter)) clauses.push("COALESCE(f.due_followup_count, 0) > 0");
  if (["facebook", "facebook_messenger", "messenger"].includes(normalizedFilter)) clauses.push("COALESCE(c.channel, s.channel, s.source) = 'facebook_messenger'");
  if (["instagram", "instagram_dm"].includes(normalizedFilter)) clauses.push("COALESCE(c.channel, s.channel, s.source) = 'instagram'");
  if (normalizedFilter === "ai_replied") clauses.push("COALESCE(m.ai_answer, '') <> ''");
  if (normalizedFilter === "unread") clauses.push("(m.sender_type = 'customer' OR m.needs_human_support = TRUE OR s.status = 'human_takeover')");
  if (searchTerm) {
    params.push(`%${searchTerm.toLowerCase()}%`);
    const idx = params.length;
    clauses.push(`(
      LOWER(COALESCE(s.customer_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(c.customer_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(p.first_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(p.phone, '')) LIKE $${idx}
      OR LOWER(COALESCE(c.external_customer_id, '')) LIKE $${idx}
      OR LOWER(COALESCE(s.session_id, '')) LIKE $${idx}
      OR LOWER(COALESCE(m.customer_message, m.message_text, s.last_message, c.last_message, '')) LIKE $${idx}
    )`);
  }
  const result = await db.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (session_id) *
      FROM ai_support_messages
      WHERE tenant_id = $1
      ORDER BY session_id, created_at DESC
    ),
    latest_interaction AS (
      SELECT DISTINCT ON (session_id) session_id, profile_id
      FROM ai_customer_interactions
      WHERE tenant_id = $1
      ORDER BY session_id, created_at DESC
    ),
    latest_event AS (
      SELECT DISTINCT ON (conversation_id) conversation_id, created_at AS last_webhook_event_at, status AS last_webhook_status
      FROM ai_channel_event_logs
      WHERE tenant_id = $1
      ORDER BY conversation_id, created_at DESC, id DESC
    )
    SELECT
      s.session_id,
      s.source,
      s.channel AS session_channel,
      s.customer_name AS session_customer_name,
      s.customer_avatar_url AS session_customer_avatar_url,
      s.last_message AS session_last_message,
      s.status AS conversation_status,
      s.assigned_user_id,
      s.assigned_user_name,
      s.takeover_started_at,
      s.returned_to_ai_at,
      s.closed_at,
      s.escalation_reason,
      s.last_escalation_keyword,
      s.escalated_at,
      s.updated_at,
      COALESCE(c.ai_enabled, s.ai_enabled, TRUE) AS ai_enabled,
      COALESCE(c.channel, s.channel, s.source) AS channel,
      c.external_customer_id,
      c.external_conversation_id,
      c.customer_avatar_url,
      c.metadata AS channel_metadata,
      acm.preferences AS conversation_memory_preferences,
      acm.last_products AS conversation_memory_last_products,
      acm.shopping_intent AS conversation_memory_shopping_intent,
      acm.lead_quality_score AS conversation_memory_lead_quality_score,
      acm.engagement_score AS conversation_memory_engagement_score,
      acm.intent_score AS conversation_memory_intent_score,
      acm.updated_at AS conversation_memory_updated_at,
      COALESCE(c.last_message_at, s.updated_at) AS last_message_at,
      e.last_webhook_event_at,
      e.last_webhook_status,
      m.customer_message,
      m.message_text,
      m.channel AS message_channel,
      m.sender_type AS latest_sender_type,
      m.ai_answer,
      m.confidence,
      m.needs_human_support,
      m.detected_intent,
      m.suggested_products,
      m.visual_attachments,
      p.id AS profile_id,
      p.first_name,
      p.last_name,
      p.profile_pic_url,
      p.external_customer_id AS profile_external_customer_id,
      p.source_channel AS profile_source_channel,
      p.phone,
      p.customer_sentiment,
      p.memory_score,
      p.city_area,
      p.preferred_size,
      p.preferred_colors,
      p.preferred_models,
      p.viewed_products,
      p.abandoned_products,
      p.order_history,
      p.conversation_summary,
      COALESCE(o.draft_count, 0)::int AS draft_count,
      COALESCE(o.confirmed_count, 0)::int AS confirmed_count,
      COALESCE(f.due_followup_count, 0)::int AS due_followup_count
    FROM ai_support_sessions s
    LEFT JOIN latest m ON m.session_id = s.session_id AND m.tenant_id = s.tenant_id
    LEFT JOIN ai_channel_conversations c ON c.tenant_id = s.tenant_id AND c.channel = s.channel AND c.external_conversation_id = s.session_id
    LEFT JOIN ai_conversation_memories acm ON acm.tenant_id = s.tenant_id AND acm.session_id = s.session_id
    LEFT JOIN latest_event e ON e.conversation_id = s.session_id
    LEFT JOIN latest_interaction li ON li.session_id = s.session_id
    LEFT JOIN ai_customer_profiles p ON p.id = COALESCE(c.customer_profile_id, li.profile_id) AND p.tenant_id = s.tenant_id
    LEFT JOIN (
      SELECT ai_agent_conversation_id, COUNT(*) FILTER (WHERE ai_agent_status = 'ai_draft') AS draft_count, COUNT(*) FILTER (WHERE ai_agent_status = 'confirmed') AS confirmed_count
      FROM orders
      WHERE tenant_id = $1 AND ai_agent_status IS NOT NULL
      GROUP BY ai_agent_conversation_id
    ) o ON o.ai_agent_conversation_id = s.session_id
    LEFT JOIN (
      SELECT session_id, COUNT(*) FILTER (WHERE status = 'pending' AND scheduled_at <= NOW()) AS due_followup_count
      FROM ai_followup_tasks
      WHERE tenant_id = $1
      GROUP BY session_id
    ) f ON f.session_id = s.session_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE WHEN COALESCE(c.channel, s.channel, s.source) IN ('facebook_messenger', 'instagram') THEN 0 ELSE 1 END,
      COALESCE(c.last_message_at, s.updated_at) DESC,
      s.updated_at DESC
    LIMIT $2
    `,
    params
  );
  const conversations = result.rows;
  const sessionIds = conversations.map((item) => item.session_id).filter(Boolean);
  const profileIds = conversations.map((item) => item.profile_id).filter(Boolean);
  const [messagesResult, memoriesResult, draftsResult, conversationFollowupsResult] = sessionIds.length
    ? await Promise.all([
        db.query(
          `
          SELECT *
          FROM (
            SELECT
              msg.*,
              COUNT(*) OVER (PARTITION BY msg.session_id)::int AS total_messages,
              ROW_NUMBER() OVER (PARTITION BY msg.session_id ORDER BY msg.created_at DESC, msg.id DESC)::int AS recent_rank
            FROM ai_support_messages msg
            WHERE msg.tenant_id = $1 AND msg.session_id = ANY($2::text[])
          ) ranked_messages
          WHERE recent_rank <= $3
          ORDER BY session_id ASC, created_at ASC, id ASC
          `,
          [tenantId, sessionIds, inboxMessageLimit]
        ),
        profileIds.length
          ? db.query(
              `
              SELECT *
              FROM ai_customer_memories
              WHERE tenant_id = $1 AND profile_id = ANY($2::bigint[])
              ORDER BY last_seen_at DESC, created_at DESC
              LIMIT 300
              `,
              [tenantId, profileIds]
            )
          : Promise.resolve({ rows: [] }),
        db.query(
          `
          SELECT
            o.*,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id', oi.id,
              'product_id', oi.product_id,
              'variant_id', oi.variant_id,
              'product_name', oi.product_name,
              'variant_name', oi.variant_name,
              'quantity', oi.quantity,
              'price', COALESCE(oi.price, oi.sale_price, 0),
              'total_amount', oi.total_amount,
              'stock', pv.stock,
              'stock_status', CASE WHEN pv.id IS NULL THEN 'unknown' WHEN COALESCE(pv.stock, 0) >= COALESCE(oi.quantity, 0) THEN 'in_stock' ELSE 'stock_conflict' END
            ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
          FROM orders o
          LEFT JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE o.tenant_id = $1
            AND o.ai_agent_status IS NOT NULL
            AND o.ai_agent_conversation_id = ANY($2::text[])
          GROUP BY o.id
          ORDER BY o.created_at DESC
          `,
          [tenantId, sessionIds]
        ),
        db.query(
          `
          SELECT *
          FROM ai_followup_tasks
          WHERE tenant_id = $1 AND session_id = ANY($2::text[])
          ORDER BY scheduled_at DESC
          `,
          [tenantId, sessionIds]
        ),
      ])
    : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

  const messagesBySession = new Map();
  const messageTotalsBySession = new Map();
  messagesResult.rows.forEach((row) => {
    const list = messagesBySession.get(row.session_id) || [];
    list.push(normalizeInboxMessage(row));
    messagesBySession.set(row.session_id, list);
    messageTotalsBySession.set(row.session_id, Number(row.total_messages || list.length));
  });
  const memoriesByProfile = new Map();
  memoriesResult.rows.forEach((row) => {
    const list = memoriesByProfile.get(row.profile_id) || [];
    list.push(row);
    memoriesByProfile.set(row.profile_id, list);
  });
  const draftsBySession = new Map();
  draftsResult.rows.forEach((row) => {
    const list = draftsBySession.get(row.ai_agent_conversation_id) || [];
    list.push(row);
    draftsBySession.set(row.ai_agent_conversation_id, list);
  });
  const followupsBySession = new Map();
  conversationFollowupsResult.rows.forEach((row) => {
    const list = followupsBySession.get(row.session_id) || [];
    list.push(row);
    followupsBySession.set(row.session_id, list);
  });

  const followups = await db.query(
    `
    SELECT *
    FROM ai_followup_tasks
    WHERE tenant_id = $1
    ORDER BY scheduled_at DESC
    LIMIT 30
    `,
    [tenantId]
  );
  const [salesStatesResult, salesJourneyEventsResult] = sessionIds.length
    ? await Promise.all([
        db.query(
          `
          SELECT *
          FROM ai_sales_conversation_states
          WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])
          `,
          [tenantId, sessionIds]
        ).catch(() => ({ rows: [] })),
        db.query(
          `
          SELECT *
          FROM ai_sales_journey_events
          WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])
          ORDER BY created_at DESC, id DESC
          LIMIT 500
          `,
          [tenantId, sessionIds]
        ).catch(() => ({ rows: [] })),
      ])
    : [{ rows: [] }, { rows: [] }];
  const salesStateByConversation = new Map();
  salesStatesResult.rows.forEach((row) => {
    salesStateByConversation.set(row.conversation_id, row);
  });
  const salesJourneyEventsByConversation = new Map();
  salesJourneyEventsResult.rows.forEach((row) => {
    const list = salesJourneyEventsByConversation.get(row.conversation_id) || [];
    list.push({
      event_type: row.event_type,
      conversation_id: row.conversation_id,
      customer_id: row.customer_id || "",
      product_id: row.product_id || null,
      variant_id: row.variant_id || null,
      channel: row.channel || "web_chat",
      metadata: row.metadata || {},
      created_at: row.created_at,
    });
    salesJourneyEventsByConversation.set(row.conversation_id, list);
  });

  const enriched = await Promise.all(conversations.map(async (conversation) => {
    const memories = memoriesByProfile.get(conversation.profile_id) || [];
    const messages = messagesBySession.get(conversation.session_id) || [];
    const totalMessages = messageTotalsBySession.get(conversation.session_id) || messages.length;
    const draftOrders = draftsBySession.get(conversation.session_id) || [];
    const conversationFollowups = followupsBySession.get(conversation.session_id) || [];
    const currentStateRow = salesStateByConversation.get(conversation.session_id) || null;
    const existingJourneyEvents = salesJourneyEventsByConversation.get(conversation.session_id) || [];
    const leadType = leadTypeFrom({
      memoryScore: conversation.memory_score,
      sentiment: conversation.customer_sentiment,
      needsHumanSupport: conversation.needs_human_support || conversation.conversation_status === "human_takeover",
      draftCount: conversation.draft_count,
      confirmedCount: conversation.confirmed_count,
      followupDue: conversation.due_followup_count > 0,
    });
    const customerProfile = buildCustomerProfilePayload({
      conversation: {
        ...conversation,
        customer_profile: {
          id: conversation.profile_id,
          first_name: conversation.first_name,
          last_name: conversation.last_name,
          profile_pic_url: conversation.profile_pic_url || conversation.customer_avatar_url || conversation.channel_metadata?.messenger_profile?.profile_pic || "",
          external_customer_id: conversation.profile_external_customer_id || conversation.external_customer_id || "",
          source_channel: conversation.profile_source_channel || conversation.channel || "",
          phone: conversation.phone,
          city_area: conversation.city_area,
          preferred_size: conversation.preferred_size,
          preferred_colors: asArray(conversation.preferred_colors),
          preferred_models: asArray(conversation.preferred_models),
          viewed_products: asArray(conversation.viewed_products),
          abandoned_products: asArray(conversation.abandoned_products),
          order_history: asArray(conversation.order_history),
          conversation_summary: conversation.conversation_summary,
          customer_sentiment: conversation.customer_sentiment,
          memory_score: conversation.memory_score,
        },
      },
      memories,
    });
    const conversationAiMemory = buildDashboardAiMemory(conversation);
    const rememberedProducts = productsFromDashboardMemory(conversationAiMemory);
    const selectedProduct = conversation.current_product || conversation.product || conversation.channel_metadata?.current_product || conversation.channel_metadata?.last_viewed_product || rememberedProducts[0] || null;
    const projectedCurrentIntent = text(
      conversation.detected_intent ||
      conversationAiMemory.preferences?.last_intent ||
      conversationAiMemory.preferences?.lastIntent ||
      conversationAiMemory.last_intent ||
      conversationAiMemory.lastIntent ||
      conversation.conversation_memory_shopping_intent ||
      ""
    );
    const salesIntelligence = await buildSalesConversationIntelligence({
      tenantId,
      conversation: {
        ...conversation,
        customer_profile: customerProfile,
        current_product: selectedProduct,
        product: selectedProduct,
        ai_memory: conversationAiMemory,
      },
      messages,
      draftOrders,
      conversationFollowups,
      recommendations: rememberedProducts,
      selectedProduct,
      currentStateRow,
      existingJourneyEvents,
    }).catch(() => ({
      state: {
        current_state: "DISCOVERY",
        previous_state: "",
        state_reason: "",
        confidence: 0.5,
        updated_at: new Date().toISOString(),
        channel: conversation.channel || conversation.source || "web_chat",
        customer_id: conversation.external_customer_id || "",
        conversation_id: conversation.session_id || "",
        badge: buildSalesStateBadge({ current_state: "DISCOVERY", state_reason: "", confidence: 0.5 }),
        discovery_questions: [],
      },
      journeyEvents: existingJourneyEvents,
      conversion: { score: 0, level: "low", reasons: [], risk_flags: [], recommended_action: "CONTINUE_CONVERSATION" },
      followUp: { follow_up_needed: false, follow_up_reason: "", suggested_follow_up_message: "", suggested_follow_up_at: "" },
      crossSellSuggestions: [],
      closer: { last_closer_action: "", last_closer_at: "", recommended_action: "CONTINUE", suggested_message: "", reasons: [], should_offer_closer: false },
    }));
    const resolvedChannel = text(conversation.channel || conversation.session_channel || conversation.source);
    const isMessengerConversation = ["facebook_messenger", "facebook", "messenger"].includes(lower(resolvedChannel));
    const messengerDisplayName = isMessengerConversation
      ? resolveMessengerConversationDisplayName({
          customerName: conversation.session_customer_name || conversation.customer_name || "",
          customerProfile: {
            first_name: conversation.first_name,
            last_name: conversation.last_name,
            name: conversation.channel_metadata?.messenger_profile?.name || conversation.channel_metadata?.customer_profile?.name || "",
            external_customer_id: conversation.profile_external_customer_id || conversation.external_customer_id || "",
          },
          metadata: conversation.channel_metadata || {},
          externalCustomerId: conversation.profile_external_customer_id || conversation.external_customer_id || "",
        })
      : "";
    const systemEvents = [
      conversation.conversation_status === "human_takeover" ? {
        type: "human_takeover",
        label: conversation.escalation_reason ? `Escalated to human: ${conversation.escalation_reason}` : "Human takeover started",
        created_at: conversation.takeover_started_at || conversation.updated_at,
      } : null,
      conversation.returned_to_ai_at ? {
        type: "return_to_ai",
        label: "Returned to AI",
        created_at: conversation.returned_to_ai_at,
      } : null,
      conversation.conversation_status === "closed" ? {
        type: "closed",
        label: "Conversation closed",
        created_at: conversation.closed_at || conversation.updated_at,
      } : null,
      ...asArray(messages).flatMap((message) => message.system_events || []),
      ...draftOrders.map((order) => ({
        type: order.ai_agent_status === "confirmed" ? "confirmed" : order.ai_agent_status === "human_handoff" ? "handoff" : "draft_created",
        label: order.ai_agent_status === "confirmed" ? "Order confirmed" : order.ai_agent_status === "human_handoff" ? "Assigned to human" : "Draft order created",
        order_id: order.id,
        created_at: order.updated_at || order.created_at,
      })),
    ].filter(Boolean).sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
    return {
      ...conversation,
      source: conversation.source || conversation.channel || "web_chat",
      channel: conversation.channel || conversation.session_channel || conversation.source || "web_chat",
      customer_name: messengerDisplayName || customerProfile.name || conversation.session_customer_name || conversation.first_name || conversation.external_customer_id || "",
      sender_name: isMessengerConversation ? messengerDisplayName : conversation.sender_name || "",
      profile_name: isMessengerConversation ? messengerDisplayName : conversation.profile_name || "",
      contact_name: isMessengerConversation ? messengerDisplayName : conversation.contact_name || "",
      external_sender_name: conversation.external_sender_name || "",
      external_contact_name: conversation.external_contact_name || "",
      customer_avatar_url: customerProfile.avatar_url || conversation.customer_avatar_url || "",
      last_message: conversation.customer_message || conversation.message_text || conversation.session_last_message || "",
      latest_message_preview: conversation.customer_message || conversation.message_text || conversation.ai_answer || conversation.session_last_message || "",
      external_customer_id: conversation.external_customer_id || "",
      external_conversation_id: conversation.external_conversation_id || conversation.session_id,
      is_live_meta: ["facebook_messenger", "instagram"].includes(conversation.channel || conversation.session_channel || conversation.source),
      live_badge: ["facebook_messenger", "instagram"].includes(conversation.channel || conversation.session_channel || conversation.source) ? "Live Meta" : "",
      last_message_at: conversation.last_message_at || conversation.updated_at,
      last_webhook_event_at: conversation.last_webhook_event_at || null,
      last_webhook_status: conversation.last_webhook_status || "",
      channel_metadata: conversation.channel_metadata || {},
      ai_memory: conversationAiMemory,
      current_product: selectedProduct,
      product: selectedProduct,
      detected_intent: projectedCurrentIntent || conversation.detected_intent || "",
      current_intent: projectedCurrentIntent || conversation.detected_intent || "",
      customer_profile: customerProfile,
      messages,
      message_count: totalMessages,
      older_messages_available: totalMessages > messages.length,
      next_messages_before: messages[0]?.created_at || "",
      memories,
      followups: conversationFollowups,
      draft_orders: draftOrders,
      draft_order: draftOrders[0] || null,
      sales_conversation_state: salesIntelligence.state,
      sales_journey_events: salesIntelligence.journeyEvents,
      conversion_probability: salesIntelligence.conversion,
      follow_up_recommendation: salesIntelligence.followUp,
      cross_sell_suggestions: salesIntelligence.crossSellSuggestions,
      proactive_closer: salesIntelligence.closer,
      sales_intelligence: salesIntelligence,
      system_events: systemEvents,
      status: conversation.conversation_status || "ai_active",
      conversation_status: conversation.conversation_status || "ai_active",
      assigned_user: conversation.assigned_user_id || conversation.assigned_user_name
        ? {
            id: conversation.assigned_user_id || null,
            name: conversation.assigned_user_name || "",
          }
        : null,
      ai_paused: ["human_takeover", "closed"].includes(conversation.conversation_status),
      human_takeover: conversation.conversation_status === "human_takeover",
      escalation_reason: conversation.escalation_reason || "",
      ai_escalation_reason: conversation.escalation_reason || "",
      last_escalation_keyword: conversation.last_escalation_keyword || "",
      escalated_at: conversation.escalated_at || null,
      takeover_started_at: conversation.takeover_started_at,
      returned_to_ai_at: conversation.returned_to_ai_at,
      closed_at: conversation.closed_at,
      lead_type: leadType,
      lead_badge: leadBadgeKey(leadType),
      lead_score: Math.max(numeric(conversation.memory_score, 0), numeric(conversation.conversation_memory_lead_quality_score, 0), numeric(conversation.conversation_memory_intent_score, 0)),
      unread: conversation.latest_sender_type === "customer" || conversation.needs_human_support === true || conversation.conversation_status === "human_takeover",
      waiting: conversation.due_followup_count > 0 || (conversation.updated_at && Date.now() - new Date(conversation.updated_at).getTime() > 15 * 60 * 1000),
      last_activity_at: conversation.last_message_at || conversation.updated_at,
    };
  }));
  return { conversations: enriched, followups: followups.rows };
};

const followupSuggestedMessage = (task = {}, settings = DEFAULT_SETTINGS) => {
  const payload = task.payload || {};
  const products = asArray(payload.products);
  const productName = text(products[0]?.name || products[0]?.title || products[0]?.product_name);
  const template = asArray(settings.followup_templates).find(Boolean) || DEFAULT_SETTINGS.followup_templates[0];
  if (text(task.manual_message)) return text(task.manual_message);
  if (text(payload.suggested_message || payload.followup_message)) return text(payload.suggested_message || payload.followup_message);
  if (productName) return `لسه مهتم بـ ${productName}؟ أقدر أراجعلك المقاس واللون المتاح وأقولك السعر الحقيقي قبل ما نكمل.`;
  if (text(template)) return text(template);
  return "لسه مهتم بالمنتج؟ ابعتلي المقاس أو اللون المطلوب وأراجعلك المتاح قبل ما نكمل.";
};

const normalizeFollowupTask = (row = {}, settings = DEFAULT_SETTINGS) => {
  const status = text(row.status || "pending");
  const scheduledAt = row.scheduled_at ? new Date(row.scheduled_at) : null;
  const due = ["pending", "snoozed"].includes(status) && scheduledAt && scheduledAt.getTime() <= Date.now();
  const bucket = due
    ? "due"
    : ["pending", "snoozed"].includes(status)
      ? "scheduled"
      : ["sent", "sent_internal", "manual_ready", "completed", "done"].includes(status)
        ? "completed"
        : "stopped";
  return {
    ...row,
    status,
    bucket,
    is_due: due,
    suggested_message: followupSuggestedMessage(row, settings),
    customer: {
      id: row.profile_id || null,
      name: text(row.customer_name || row.first_name) || "Customer",
      phone: text(row.customer_phone || row.phone),
      sentiment: text(row.customer_sentiment || "neutral"),
      memory_score: numeric(row.memory_score, 0),
    },
    conversation: {
      session_id: row.session_id,
      status: row.conversation_status || "unknown",
      assigned_user_id: row.assigned_user_id || null,
      assigned_user_name: row.assigned_user_name || "",
      closed_at: row.closed_at || null,
      updated_at: row.conversation_updated_at || null,
    },
    ready_label: status === "sent_internal" ? "Internal note sent" : "Ready to send manually",
  };
};

export const listAiFollowups = async ({ tenantId, status = "all", limit = 100 } = {}) => {
  await ensureAiSalesAgentSchema();
  const settings = await getAiAgentSettings({ tenantId }).catch(() => DEFAULT_SETTINGS);
  const normalizedStatus = lower(status || "all");
  const clauses = ["f.tenant_id = $1"];
  const params = [tenantId, Math.min(200, Math.max(1, int(limit, 100)))];
  if (normalizedStatus === "due") clauses.push("f.status IN ('pending', 'snoozed') AND f.scheduled_at <= NOW()");
  if (normalizedStatus === "scheduled") clauses.push("f.status IN ('pending', 'snoozed') AND f.scheduled_at > NOW()");
  if (normalizedStatus === "completed") clauses.push("f.status IN ('sent', 'sent_internal', 'manual_ready', 'completed', 'done')");
  if (normalizedStatus === "stopped") clauses.push("f.status IN ('stopped', 'cancelled', 'rejected')");
  const result = await db.query(
    `
    SELECT
      f.*,
      p.first_name AS customer_name,
      p.phone AS customer_phone,
      p.customer_sentiment,
      p.memory_score,
      s.status AS conversation_status,
      s.assigned_user_id,
      s.assigned_user_name,
      s.closed_at,
      s.updated_at AS conversation_updated_at
    FROM ai_followup_tasks f
    LEFT JOIN ai_customer_profiles p ON p.id = f.profile_id AND p.tenant_id = f.tenant_id
    LEFT JOIN ai_support_sessions s ON s.tenant_id = f.tenant_id AND s.session_id = f.session_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE WHEN f.status IN ('pending', 'snoozed') AND f.scheduled_at <= NOW() THEN 0 ELSE 1 END,
      f.scheduled_at ASC,
      f.updated_at DESC
    LIMIT $2
    `,
    params
  );
  const followups = result.rows.map((row) => normalizeFollowupTask(row, settings));
  const countResult = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status IN ('pending', 'snoozed') AND scheduled_at <= NOW())::int AS due,
      COUNT(*) FILTER (WHERE status IN ('pending', 'snoozed') AND scheduled_at > NOW())::int AS scheduled,
      COUNT(*) FILTER (WHERE status IN ('sent', 'sent_internal', 'manual_ready', 'completed', 'done'))::int AS completed,
      COUNT(*) FILTER (WHERE status IN ('stopped', 'cancelled', 'rejected'))::int AS stopped
    FROM ai_followup_tasks
    WHERE tenant_id = $1
    `,
    [tenantId]
  );
  return {
    followups,
    counts: countResult.rows[0] || {},
  };
};

const loadFollowupForAction = async ({ tenantId, id }) => {
  const result = await db.query(
    `
    SELECT f.*, s.status AS conversation_status, s.id AS session_ref_id
    FROM ai_followup_tasks f
    LEFT JOIN ai_support_sessions s ON s.tenant_id = f.tenant_id AND s.session_id = f.session_id
    WHERE f.tenant_id = $1 AND f.id = $2
    LIMIT 1
    `,
    [tenantId, id]
  );
  const task = result.rows[0] || null;
  if (!task) throw Object.assign(new Error("Follow-up not found"), { status: 404 });
  return task;
};

const appendForcedClosedFollowupNote = async ({ tenantId, sessionId, sessionRefId, message, staffUserId, staffUserName } = {}) => {
  const result = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id,
      tenant_id,
      user_id,
      session_id,
      message_text,
      customer_message,
      ai_answer,
      confidence,
      needs_human_support,
      sources_used,
      suggested_products,
      visual_attachments,
      suggested_actions,
      detected_intent,
      fallback_reason,
      staff_message,
      sender_type,
      manual_message,
      staff_user_id,
      staff_user_name,
      source_path,
      insert_source
    )
    VALUES ($1, $2, $3, $4, $5, '', '', 1, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'manual_followup_note', 'forced_closed_conversation', $5, 'staff', TRUE, $3, $6, $7, $8)
    RETURNING *
    `,
    [sessionRefId || null, tenantId, staffUserId || null, sessionId, text(message), text(staffUserName), "manual_admin", "ai_sales_agent"]
  );
  console.info("[ai-support-insert]", {
    source: "manual_message_insert",
    session_id: sessionId,
    channel: "manual_followup_note",
    message_id: result.rows[0]?.id || null,
  });
  return result.rows[0] || null;
};

export const sendAiFollowupManual = async ({
  tenantId,
  id,
  message = "",
  staffUserId = null,
  staffUserName = "",
  force = false,
} = {}) => {
  if (isRegressionTestContext()) {
    console.info("[ai-agent:dry-run-skip]", { action: "sendAiFollowupManual" });
    return { skipped: true, dry_run: true };
  }
  await ensureAiSalesAgentSchema();
  const task = await loadFollowupForAction({ tenantId, id });
  const settings = await getAiAgentSettings({ tenantId }).catch(() => DEFAULT_SETTINGS);
  const status = text(task.status || "pending");
  if (["cancelled", "completed", "done", "stopped", "rejected", "sent_internal"].includes(status) && !force) {
    throw Object.assign(new Error("Follow-up is not sendable"), { status: 409 });
  }
  if (task.last_sent_at && task.cooldown_until && new Date(task.cooldown_until).getTime() > Date.now() && !force) {
    throw Object.assign(new Error("Follow-up cooldown is still active"), { status: 409 });
  }
  if (settings.stop_followups_after_rejection !== false && ["rejected", "stopped"].includes(status) && !force) {
    throw Object.assign(new Error("Customer rejected follow-ups"), { status: 409 });
  }
  const scopeClause = task.profile_id ? "profile_id = $3" : "session_id = $3";
  const sentCount = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ai_followup_tasks
    WHERE tenant_id = $1
      AND id <> $2
      AND ${scopeClause}
      AND status IN ('sent', 'sent_internal', 'manual_ready', 'completed', 'done')
    `,
    [tenantId, task.id, task.profile_id || task.session_id]
  );
  if (int(sentCount.rows[0]?.count, 0) >= int(settings.max_followups_per_customer, DEFAULT_SETTINGS.max_followups_per_customer) && !force) {
    throw Object.assign(new Error("Maximum follow-ups reached for this customer"), { status: 409 });
  }
  const state = await getAiSupportConversationState({ tenantId, sessionId: task.session_id });
  if (state?.status === "closed" && !force) {
    throw Object.assign(new Error("Conversation is closed. Force send is required."), { status: 409 });
  }
  const safeMessage = text(message) || followupSuggestedMessage(task, settings);
  if (!safeMessage) throw Object.assign(new Error("Follow-up message is required"), { status: 400 });
  const staffMessage = state?.status === "closed"
    ? await appendForcedClosedFollowupNote({
        tenantId,
        sessionId: task.session_id,
        sessionRefId: state?.id || task.session_ref_id || null,
        message: safeMessage,
        staffUserId,
        staffUserName,
      })
    : await appendManualAiSupportReply({
        tenantId,
        sessionId: task.session_id,
        message: safeMessage,
        staffUserId,
        staffUserName,
        source: "ai_followup_center",
      });
  const result = await db.query(
    `
    UPDATE ai_followup_tasks
    SET status = 'sent_internal',
      manual_message = $3,
      last_sent_at = NOW(),
      sent_internal_at = NOW(),
      cooldown_until = NOW() + ($4::int * INTERVAL '1 hour'),
      action_by = $5,
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, task.id, safeMessage, int(settings.followup_cooldown_hours, 24), staffUserId || null]
  );
  console.log("[ai-agent:followup] sent_internal", { tenantId, followup_id: task.id, session_id: task.session_id, force: force === true });
  return { followup: normalizeFollowupTask(result.rows[0] || task, settings), message: staffMessage, delivery_status: "sent_internal" };
};

export const snoozeAiFollowup = async ({ tenantId, id, minutes = 60, snoozeUntil = "", staffUserId = null } = {}) => {
  await ensureAiSalesAgentSchema();
  await loadFollowupForAction({ tenantId, id });
  const parsedUntil = snoozeUntil ? new Date(snoozeUntil) : null;
  const safeMinutes = Math.max(15, Math.min(10080, int(minutes, 60)));
  const result = await db.query(
    `
    UPDATE ai_followup_tasks
    SET status = 'snoozed',
      scheduled_at = COALESCE($3::timestamp, NOW() + ($4::int * INTERVAL '1 minute')),
      snoozed_until = COALESCE($3::timestamp, NOW() + ($4::int * INTERVAL '1 minute')),
      action_by = $5,
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, id, parsedUntil && Number.isFinite(parsedUntil.getTime()) ? parsedUntil.toISOString() : null, safeMinutes, staffUserId || null]
  );
  console.log("[ai-agent:followup] snoozed", { tenantId, followup_id: id, minutes: safeMinutes });
  return normalizeFollowupTask(result.rows[0] || {});
};

export const cancelAiFollowup = async ({ tenantId, id, reason = "", staffUserId = null } = {}) => {
  await ensureAiSalesAgentSchema();
  await loadFollowupForAction({ tenantId, id });
  const result = await db.query(
    `
    UPDATE ai_followup_tasks
    SET status = 'cancelled',
      cancelled_at = NOW(),
      stopped_reason = $3,
      action_by = $4,
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, id, text(reason || "cancelled_by_staff"), staffUserId || null]
  );
  console.log("[ai-agent:followup] cancelled", { tenantId, followup_id: id });
  return normalizeFollowupTask(result.rows[0] || {});
};

export const completeAiFollowup = async ({ tenantId, id, staffUserId = null } = {}) => {
  await ensureAiSalesAgentSchema();
  await loadFollowupForAction({ tenantId, id });
  const result = await db.query(
    `
    UPDATE ai_followup_tasks
    SET status = 'completed',
      completed_at = NOW(),
      action_by = $3,
      updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [tenantId, id, staffUserId || null]
  );
  console.log("[ai-agent:followup] completed", { tenantId, followup_id: id });
  return normalizeFollowupTask(result.rows[0] || {});
};

const parseDateFilter = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const branchFilterValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const analyticsWhere = ({ tenantId, fromDate, toDate, branchId, alias = "", dateColumn = "created_at", includeBranch = false } = {}) => {
  const params = [tenantId];
  const prefix = alias ? `${alias}.` : "";
  const clauses = [`${prefix}tenant_id = $1`];
  if (fromDate) {
    params.push(fromDate);
    clauses.push(`${prefix}${dateColumn} >= $${params.length}::timestamp`);
  }
  if (toDate) {
    params.push(toDate);
    clauses.push(`${prefix}${dateColumn} <= $${params.length}::timestamp`);
  }
  if (includeBranch && branchId) {
    params.push(branchId);
    clauses.push(`${prefix}branch_id = $${params.length}::bigint`);
  }
  return { where: clauses.join(" AND "), params };
};

const rowsBy = (rows = [], key, valueKey = "count") =>
  Object.fromEntries(asArray(rows).map((row) => [row[key], numeric(row[valueKey], 0)]));

const loadTopAiObjections = async ({ tenantId } = {}) => {
  const objectionCase = (column) => `
      CASE
        WHEN ${column} ILIKE '%price%' OR ${column} ILIKE '%expensive%' THEN 'price'
        WHEN ${column} ILIKE '%discount%' OR ${column} ILIKE '%last_price%' THEN 'discount'
        WHEN ${column} ILIKE '%material%' OR ${column} ILIKE '%quality%' THEN 'material'
        WHEN ${column} ILIKE '%delivery%' OR ${column} ILIKE '%shipping%' THEN 'delivery'
        WHEN ${column} ILIKE '%exchange%' OR ${column} ILIKE '%return%' THEN 'exchange'
        WHEN ${column} ILIKE '%authentic%' THEN 'authenticity'
        WHEN ${column} ILIKE '%cheaper%' THEN 'cheaper alternative'
        ELSE ${column}
      END`;

  try {
    return await db.query(
      `
      SELECT ${objectionCase("COALESCE(NULLIF(detected_intent, ''), intent_type)")} AS objection,
        COUNT(*)::int AS count
      FROM ai_customer_interactions
      WHERE tenant_id = $1 AND COALESCE(NULLIF(detected_intent, ''), intent_type, '') <> ''
      GROUP BY objection
      ORDER BY count DESC
      LIMIT 10
      `,
      [tenantId]
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
    console.warn("[ai-agent:analytics] detected_intent missing; falling back to intent_type", { tenantId });
    return db.query(
      `
      SELECT ${objectionCase("intent_type")} AS objection,
        COUNT(*)::int AS count
      FROM ai_customer_interactions
      WHERE tenant_id = $1 AND COALESCE(intent_type, '') <> ''
      GROUP BY objection
      ORDER BY count DESC
      LIMIT 10
      `,
      [tenantId]
    );
  }
};

export const loadAiSalesAnalytics = async ({ tenantId, fromDate: rawFromDate = "", toDate: rawToDate = "", branchId: rawBranchId = null } = {}) => {
  await ensureAiSalesAgentSchema();
  const fromDate = parseDateFilter(rawFromDate);
  const toDate = parseDateFilter(rawToDate);
  const branchId = branchFilterValue(rawBranchId);
  const orderFilter = analyticsWhere({ tenantId, fromDate, toDate, branchId, alias: "o", includeBranch: true });
  const sessionFilter = analyticsWhere({ tenantId, fromDate, toDate, alias: "s", dateColumn: "updated_at" });
  const messageFilter = analyticsWhere({ tenantId, fromDate, toDate, alias: "m" });
  const followupFilter = analyticsWhere({ tenantId, fromDate, toDate, alias: "f", dateColumn: "created_at" });

  const result = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE o.ai_agent_status = 'confirmed')::int AS confirmed_orders,
      COUNT(*) FILTER (WHERE o.ai_agent_status = 'ai_draft')::int AS draft_orders,
      COUNT(*) FILTER (WHERE o.ai_agent_status IS NOT NULL)::int AS ai_orders_total,
      COUNT(DISTINCT o.ai_agent_conversation_id) FILTER (WHERE o.ai_agent_status IS NOT NULL AND COALESCE(o.ai_agent_conversation_id, '') <> '')::int AS order_conversations,
      COALESCE(SUM(CASE WHEN o.ai_agent_status = 'confirmed' THEN COALESCE(o.total_amount, o.total, o.total_price, 0) ELSE 0 END), 0)::numeric AS ai_revenue,
      COALESCE(AVG(CASE WHEN o.ai_agent_status = 'confirmed' THEN COALESCE(o.total_amount, o.total, o.total_price, 0) END), 0)::numeric AS average_order_value
    FROM orders o
    WHERE ${orderFilter.where} AND o.ai_agent_status IS NOT NULL
    `,
    orderFilter.params
  );
  const sales = result.rows[0] || {};

  const conversations = await db.query(
    `
    WITH order_sessions AS (
      SELECT ai_agent_conversation_id AS session_id,
        COUNT(*) FILTER (WHERE ai_agent_status = 'confirmed') AS confirmed_count,
        COUNT(*) FILTER (WHERE ai_agent_status IS NOT NULL) AS order_count
      FROM orders o
      WHERE ${orderFilter.where} AND COALESCE(ai_agent_conversation_id, '') <> ''
      GROUP BY ai_agent_conversation_id
    )
    SELECT
      COUNT(*)::int AS total_conversations,
      COUNT(*) FILTER (WHERE s.status = 'human_takeover')::int AS human_takeover_count,
      COUNT(*) FILTER (WHERE s.status = 'closed')::int AS closed_conversations,
      COUNT(*) FILTER (WHERE s.status <> 'closed' AND s.updated_at < NOW() - INTERVAL '15 minutes')::int AS waiting_customers,
      COUNT(*) FILTER (WHERE COALESCE(o.order_count, 0) = 0 AND s.status <> 'closed' AND s.updated_at < NOW() - INTERVAL '45 minutes')::int AS abandoned_conversations,
      COUNT(*) FILTER (WHERE COALESCE(o.confirmed_count, 0) > 0 AND EXISTS (
        SELECT 1 FROM ai_followup_tasks f WHERE f.tenant_id = s.tenant_id AND f.session_id = s.session_id
      ))::int AS recovered_conversations
    FROM ai_support_sessions s
    LEFT JOIN order_sessions o ON o.session_id = s.session_id
    WHERE ${sessionFilter.where}
    `,
    orderFilter.params
  );

  const messages = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(m.ai_answer, '') <> '')::int AS ai_replies_count,
      COUNT(*) FILTER (WHERE COALESCE(m.staff_message, '') <> '')::int AS manual_replies_count,
      COALESCE(AVG(EXTRACT(EPOCH FROM (m.created_at - s.created_at))) FILTER (WHERE COALESCE(m.ai_answer, '') <> ''), 0)::numeric AS average_response_seconds
    FROM ai_support_messages m
    LEFT JOIN ai_support_sessions s ON s.tenant_id = m.tenant_id AND s.session_id = m.session_id
    WHERE ${messageFilter.where}
    `,
    messageFilter.params
  );

  const leadQuality = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(p.memory_score, 0) >= 75)::int AS hot_leads,
      COUNT(*) FILTER (WHERE COALESCE(p.memory_score, 0) >= 45 AND COALESCE(p.memory_score, 0) < 75)::int AS warm_leads,
      COUNT(*) FILTER (WHERE COALESCE(p.memory_score, 0) < 45)::int AS cold_leads,
      COUNT(*) FILTER (WHERE COALESCE(o.confirmed_count, 0) > 0 AND COALESCE(p.memory_score, 0) >= 70)::int AS vip_customers,
      COUNT(*) FILTER (WHERE COALESCE(p.customer_sentiment, '') = 'negative' OR COALESCE(m.needs_human_support, FALSE) = TRUE)::int AS complaints
    FROM ai_customer_profiles p
    LEFT JOIN (
      SELECT profile_id, session_id
      FROM ai_customer_interactions
      WHERE tenant_id = $1
    ) i ON i.profile_id = p.id
    LEFT JOIN (
      SELECT ai_agent_conversation_id, COUNT(*) FILTER (WHERE ai_agent_status = 'confirmed') AS confirmed_count
      FROM orders
      WHERE tenant_id = $1 AND ai_agent_status IS NOT NULL
      GROUP BY ai_agent_conversation_id
    ) o ON o.ai_agent_conversation_id = i.session_id
    LEFT JOIN (
      SELECT DISTINCT ON (session_id) session_id, needs_human_support
      FROM ai_support_messages
      WHERE tenant_id = $1
      ORDER BY session_id, created_at DESC
    ) m ON m.session_id = i.session_id
    WHERE p.tenant_id = $1
    `,
    [tenantId]
  );

  const objections = await loadTopAiObjections({ tenantId });

  const productAsked = await db.query(
    `
    SELECT
      COALESCE(product->>'id', product->>'product_id') AS product_id,
      MAX(COALESCE(product->>'name', product->>'title', product->>'product_name')) AS name,
      COUNT(*)::int AS interest_count
    FROM ai_support_messages m
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(m.suggested_products) = 'array' THEN m.suggested_products ELSE '[]'::jsonb END
    ) AS product
    WHERE ${messageFilter.where}
      AND COALESCE(product->>'id', product->>'product_id') IS NOT NULL
    GROUP BY COALESCE(product->>'id', product->>'product_id')
    ORDER BY interest_count DESC, name ASC
    LIMIT 10
    `,
    messageFilter.params
  );

  const productConverted = await db.query(
    `
    SELECT
      oi.product_id,
      MAX(oi.product_name) AS name,
      COUNT(DISTINCT o.id)::int AS converted_count,
      COALESCE(SUM(COALESCE(oi.total_amount, oi.price * oi.quantity, oi.sale_price * oi.quantity, 0)), 0)::numeric AS revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE ${orderFilter.where}
      AND o.ai_agent_status = 'confirmed'
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id
    ORDER BY converted_count DESC, revenue DESC
    LIMIT 10
    `,
    orderFilter.params
  );

  const stockConflicts = await db.query(
    `
    SELECT
      oi.product_id,
      MAX(oi.product_name) AS name,
      COUNT(*)::int AS conflict_count
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    WHERE ${orderFilter.where}
      AND o.ai_agent_status IS NOT NULL
      AND oi.variant_id IS NOT NULL
      AND COALESCE(pv.stock, 0) < COALESCE(oi.quantity, 0)
    GROUP BY oi.product_id
    ORDER BY conflict_count DESC, name ASC
    LIMIT 10
    `,
    orderFilter.params
  );

  const followups = await db.query(
    `
    SELECT
      COUNT(*)::int AS scheduled_followups,
      COUNT(*) FILTER (WHERE f.status IN ('pending', 'snoozed') AND f.scheduled_at <= NOW())::int AS due_followups,
      COUNT(*) FILTER (WHERE f.status IN ('sent', 'sent_internal', 'completed', 'done'))::int AS sent_followups,
      COUNT(*) FILTER (WHERE f.status = 'sent_internal')::int AS manually_sent_followups,
      COUNT(*) FILTER (WHERE f.status = 'cancelled')::int AS cancelled_followups,
      COUNT(*) FILTER (WHERE f.status = 'snoozed')::int AS snoozed_followups,
      COUNT(*) FILTER (WHERE f.status IN ('stopped', 'rejected'))::int AS stopped_after_rejection,
      COUNT(DISTINCT f.session_id) FILTER (
        WHERE f.status IN ('sent', 'sent_internal', 'completed', 'done')
          AND EXISTS (
            SELECT 1
            FROM orders o
            WHERE o.tenant_id = f.tenant_id
              AND o.ai_agent_conversation_id = f.session_id
              AND o.ai_agent_status = 'confirmed'
              AND o.created_at >= COALESCE(f.last_sent_at, f.sent_internal_at, f.updated_at)
          )
      )::int AS recovered_conversations_after_followup
    FROM ai_followup_tasks f
    WHERE ${followupFilter.where}
    `,
    followupFilter.params
  );

  const convertedById = rowsBy(productConverted.rows, "product_id", "converted_count");
  const highInterestLowConversion = productAsked.rows
    .map((item) => ({
      ...item,
      converted_count: convertedById[item.product_id] || 0,
      conversion_rate: numeric(item.interest_count, 0) ? (convertedById[item.product_id] || 0) / numeric(item.interest_count, 1) : 0,
    }))
    .filter((item) => numeric(item.interest_count, 0) >= 2 && numeric(item.converted_count, 0) === 0)
    .slice(0, 10);

  const totalConversations = numeric(conversations.rows[0]?.total_conversations, 0);
  const confirmedOrders = numeric(sales.confirmed_orders, 0);
  return {
    ...sales,
    ai_revenue: numeric(sales.ai_revenue, 0),
    average_order_value: numeric(sales.average_order_value, 0),
    conversion_rate: totalConversations ? confirmedOrders / totalConversations : 0,
    abandoned_conversations: numeric(conversations.rows[0]?.abandoned_conversations, 0),
    recovered_conversations: numeric(conversations.rows[0]?.recovered_conversations, 0),
    total_conversations: totalConversations,
    ai_replies_count: numeric(messages.rows[0]?.ai_replies_count, 0),
    manual_replies_count: numeric(messages.rows[0]?.manual_replies_count, 0),
    human_takeover_count: numeric(conversations.rows[0]?.human_takeover_count, 0),
    average_response_seconds: numeric(messages.rows[0]?.average_response_seconds, 0),
    waiting_customers: numeric(conversations.rows[0]?.waiting_customers, 0),
    closed_conversations: numeric(conversations.rows[0]?.closed_conversations, 0),
    lead_quality: leadQuality.rows[0] || {},
    top_objections: objections.rows,
    product_intelligence: {
      top_products_asked_about: productAsked.rows,
      top_products_converted: productConverted.rows,
      high_interest_low_conversion: highInterestLowConversion,
      products_with_stock_conflicts: stockConflicts.rows,
    },
    followup_performance: followups.rows[0] || {},
    filters: { from_date: fromDate, to_date: toDate, branch_id: branchId },
  };
};

const latestCustomerMessage = (messages = []) =>
  [...asArray(messages)].reverse().find((message) => text(message.customer_message))?.customer_message || "";

const latestAiAnswer = (messages = []) =>
  [...asArray(messages)].reverse().find((message) => text(message.ai_answer))?.ai_answer || "";

const latestProducts = (messages = []) =>
  filterAiEligibleProducts(
    [...asArray(messages)].reverse().flatMap((message) => asArray(message.suggested_products)).filter((product) => product?.id || product?.product_id),
    { requireProductUrl: true }
  ).slice(0, 6);

const buildDashboardAiMemory = (conversation = {}) => {
  const channelMemory = conversation.channel_metadata?.ai_memory && typeof conversation.channel_metadata.ai_memory === "object"
    ? conversation.channel_metadata.ai_memory
    : {};
  const channelPreferences = channelMemory.preferences && typeof channelMemory.preferences === "object" ? channelMemory.preferences : {};
  const storedPreferences = conversation.conversation_memory_preferences && typeof conversation.conversation_memory_preferences === "object"
    ? conversation.conversation_memory_preferences
    : {};
  const preferences = {
    ...channelPreferences,
    ...storedPreferences,
  };
  const lastProducts = [
    ...asArray(conversation.conversation_memory_last_products),
    ...asArray(channelMemory.last_products),
    ...asArray(channelMemory.lastProducts),
  ];
  const lastProductCards = [
    ...asArray(preferences.last_product_cards),
    ...asArray(preferences.lastProductCards),
    ...asArray(channelMemory.last_product_cards),
    ...asArray(channelMemory.lastProductCards),
  ];
  const activeProductId = text(
    preferences.active_product_id ||
    preferences.activeProductId ||
    preferences.selected_product_id ||
    preferences.selectedProductId ||
    preferences.last_product_id ||
    channelMemory.active_product_id ||
    channelMemory.activeProductId ||
    channelMemory.selectedProductId ||
    channelMemory.last_product_id ||
    ""
  );
  return {
    ...channelMemory,
    preferences,
    last_products: lastProducts,
    lastProducts,
    last_product_cards: lastProductCards,
    lastProductCards: lastProductCards,
    active_product_id: activeProductId,
    activeProductId,
    selected_product_id: text(preferences.selected_product_id || preferences.selectedProductId || activeProductId),
    selectedProductId: text(preferences.selectedProductId || preferences.selected_product_id || activeProductId),
    last_product_id: text(preferences.last_product_id || activeProductId),
    lastIntent: text(preferences.lastIntent || preferences.last_intent || conversation.conversation_memory_shopping_intent || ""),
    last_intent: text(preferences.last_intent || preferences.lastIntent || conversation.conversation_memory_shopping_intent || ""),
    activeSize: text(preferences.active_size || preferences.activeSize || channelMemory.activeSize || ""),
    activeColor: text(preferences.active_color || preferences.activeColor || preferences.selected_color || preferences.selectedColor || channelMemory.activeColor || ""),
    buyingStage: text(preferences.buying_stage || preferences.buyingStage || channelMemory.buyingStage || conversation.conversation_memory_shopping_intent || ""),
  };
};

const productsFromDashboardMemory = (memory = {}) => {
  const preferences = memory.preferences || {};
  const products = [
    ...asArray(memory.last_product_cards),
    ...asArray(memory.lastProductCards),
    ...asArray(preferences.last_product_cards),
    ...asArray(preferences.lastProductCards),
    ...asArray(memory.last_products),
    ...asArray(memory.lastProducts),
    preferences.selected_product_context,
    preferences.selectedProductContext,
    preferences.last_product,
    preferences.lastProduct,
    memory.last_product,
    memory.lastProduct,
  ].filter((product) => product && typeof product === "object" && (product.id || product.product_id || product.name || product.title));
  const activeProductId = text(memory.active_product_id || memory.activeProductId || preferences.active_product_id || preferences.last_product_id || "");
  if (activeProductId && !products.length) {
    products.push({
      id: activeProductId,
      product_id: activeProductId,
      name: text(preferences.last_product_name || preferences.lastProductName || memory.last_product_name || memory.lastProductName || ""),
      title: text(preferences.last_product_name || preferences.lastProductName || memory.last_product_name || memory.lastProductName || ""),
      product_url: text(preferences.last_product_url || preferences.product_url || ""),
    });
  }
  return filterAiEligibleProducts(products, { requireProductUrl: false })
    .reduce((items, product) => {
      const key = String(product.product_id || product.id || "");
      if (key && !items.some((item) => String(item.product_id || item.id || "") === key)) items.push(product);
      return items;
    }, [])
    .slice(0, 8);
};

const realProductPrice = (product = {}) => {
  const resolved = resolveCustomerDisplayPrice(product);
  const raw = numeric(product.final_price || product.sale_price || product.price || product.product_price, 0);
  console.log("[ai-text-price-source]", {
    product_id: resolved.product_id || product.id || null,
    variant_id: resolved.variant_id || product.variant_id || null,
    raw_price_used_in_text: raw || "",
    text_template: "سعره ${price} جنيه.",
    function_name: "realProductPrice",
    file_name: "server/services/aiSalesAgentService.js",
  });
  if (raw > 0 && resolved.display_price > 0 && raw !== resolved.display_price) {
    console.error("[ai-price-mismatch]", {
      product_id: resolved.product_id || product.id || null,
      variant_id: resolved.variant_id || product.variant_id || null,
      text_price: raw,
      selected_display_price: resolved.display_price,
    });
  }
  return resolved.display_price || raw;
};

const stockCount = (product = {}) =>
  numeric(product.total_stock ?? product.stock ?? product.available_stock, 0);

const storefrontProductUrl = (product = {}) => {
  return resolveAiProductUrl(product);
};

const normalizeRecommendationProduct = (row = {}) => {
  const price = numeric(row.sale_price_enabled ? row.sale_price : 0, 0) || numeric(row.selling_price || row.price || row.regular_price || row.variant_price, 0);
  const totalStock = numeric(row.total_stock ?? row.stock, 0);
  return {
    id: row.id,
    product_id: row.id,
    name: row.name || "",
    title: row.name || "",
    sku: row.sku || "",
    gender: row.gender || "",
    category: row.category_name || row.product_type || "",
    brand: row.brand_name || "",
    slug: row.slug || row.canonical_slug || "",
    canonical_slug: row.canonical_slug || "",
    product_type: row.product_type || "",
    style: row.style || "",
    color: row.colors || "",
    size: row.sizes || "",
    price,
    final_price: price,
    image_url: row.variant_image_url || row.product_image_url || row.image_url || "",
    product_url: storefrontProductUrl(row),
    total_stock: totalStock,
    stock_state: totalStock > 5 ? "in_stock" : totalStock > 0 ? "low_stock" : "out_of_stock",
    availability: totalStock > 0 ? "available" : "out_of_stock",
  };
};

const extractSalesIntent = (message = "") => {
  const value = lower(message);
  const has = (terms = []) => terms.some((term) => value.includes(lower(term)));
  if (has(["hi", "hello", "hey", "السلام", "ازيك", "اهلا", "أهلا"])) return "greeting";
  if (has(["human", "agent", "admin", "كلم", "موظف", "حد يرد", "شكوى"])) return "human_support";
  if (has(["order", "invoice", "tracking", "فين الاوردر", "طلب", "اوردر", "فاتورة"])) return "order_follow_up";
  if (has(["price", "how much", "بكام", "سعر", "كام", "خصم"])) return "pricing_question";
  if (has(["available", "stock", "متاح", "موجود", "متوفر", "خلص"])) return "availability";
  if (has(["size", "color", "colour", "مقاس", "لون", "الوان", "ألوان"])) return "size_color_request";
  if (has(["show", "want", "need", "عايز", "عايزة", "موديل", "كوتشي", "شوز", "شنطة", "جزمة"])) return "product_search";
  return "general_sales";
};

const quantityWords = new Map([
  ["واحد", 1],
  ["واحدة", 1],
  ["قطعة", 1],
  ["اتنين", 2],
  ["اثنين", 2],
  ["قطعتين", 2],
  ["تلاتة", 3],
  ["ثلاثة", 3],
  ["اربعة", 4],
  ["أربعة", 4],
  ["خمسة", 5],
]);

const firstNumber = (value = "") => {
  const match = text(value).match(/\b\d+\b/);
  return match ? int(match[0], 0) : 0;
};

const parseSalesCloserQuantity = (message = "") => {
  const normalized = lower(message);
  const explicit = normalized.match(/(?:qty|quantity|عدد|كمية|عايز|عايزة|خد|هاخد|احجز)\s*(\d{1,3})/i);
  if (explicit) return Math.max(1, int(explicit[1], 1));
  for (const [word, count] of quantityWords.entries()) {
    if (normalized.includes(lower(word))) return count;
  }
  return 1;
};

const parseSalesCloserSize = (message = "") => {
  const value = text(message);
  const explicit = value.match(/(?:مقاس|size|رقم)\s*([0-9]{2}|xs|s|m|l|xl|xxl|xxxl)\b/i);
  if (explicit) return explicit[1].toUpperCase();
  const standalone = value.match(/\b(?:[2-5][0-9]|xs|s|m|l|xl|xxl|xxxl)\b/i);
  return standalone ? standalone[0].toUpperCase() : "";
};

const parseSalesCloserBudget = (message = "") => {
  const value = text(message);
  const explicit = value.match(/(?:budget|ميزانية|في حدود|لحد|تحت|اقل من|أقل من)\s*(\d{2,7})/i);
  if (explicit) return int(explicit[1], 0);
  return /(?:budget|ميزانية|في حدود|لحد|تحت|اقل من|أقل من)/i.test(value) ? firstNumber(value) : 0;
};

const parseSalesCloserColor = (message = "") => {
  const value = lower(message);
  const colors = [
    ["black", ["black", "اسود", "أسود"]],
    ["white", ["white", "ابيض", "أبيض"]],
    ["red", ["red", "احمر", "أحمر"]],
    ["blue", ["blue", "ازرق", "أزرق"]],
    ["green", ["green", "اخضر", "أخضر"]],
    ["beige", ["beige", "بيج"]],
    ["grey", ["gray", "grey", "رمادي", "رصاصي"]],
    ["brown", ["brown", "بني"]],
    ["pink", ["pink", "وردي", "بينك"]],
    ["navy", ["navy", "كحلي"]],
  ];
  return colors.find(([, aliases]) => aliases.some((alias) => value.includes(lower(alias))))?.[0] || "";
};

const parseSalesCloserModel = (message = "", products = []) => {
  const normalized = lower(message);
  const product = asArray(products).find((item) => text(item.name || item.title) && normalized.includes(lower(item.name || item.title)));
  if (product) return text(product.name || product.title);
  const terms = extractShoppingTerms(message).filter((term) => !/^\d+$/.test(term));
  return terms.slice(0, 4).join(" ");
};

export const parseAiSalesCloserIntent = ({ message = "", products = [], conversation = {} } = {}) => {
  const value = lower(message);
  const has = (terms = []) => terms.some((term) => value.includes(lower(term)));
  const intent = {
    product_model: parseSalesCloserModel(message, products),
    color: parseSalesCloserColor(message),
    size: parseSalesCloserSize(message) || text(conversation.customer_profile?.preferred_size),
    quantity: parseSalesCloserQuantity(message),
    budget: parseSalesCloserBudget(message),
    urgency: has(["دلوقتي", "حالا", "النهاردة", "مستعجل", "now", "urgent", "today"]) ? "urgent" : has(["بعدين", "later"]) ? "low" : "normal",
    purchase_intent: has(["هاخده", "هاخد", "اطلب", "أطلب", "اوردر", "أوردر", "احجز", "أحجز", "ابعت لينك", "checkout", "order", "reserve", "buy"]) ? "high" : has(["بكام", "سعر", "متاح", "مقاس", "لون", "price", "available"]) ? "medium" : "low",
    requested_payment: has(["دفع عند الاستلام", "كاش", "cod", "cash on delivery"]) ? "cod" : has(["لينك دفع", "payment link", "visa", "card"]) ? "online" : "",
  };
  intent.confidence = clamp(
    (intent.product_model ? 0.25 : 0) +
      (intent.size ? 0.16 : 0) +
      (intent.color ? 0.12 : 0) +
      (intent.budget ? 0.1 : 0) +
      (intent.purchase_intent === "high" ? 0.3 : intent.purchase_intent === "medium" ? 0.18 : 0.08) +
      (products.length ? 0.15 : 0),
    0,
    1
  );
  return intent;
};

export const scoreAiSalesLead = ({ conversation = {}, intent = {}, products = [] } = {}) => {
  const messages = asArray(conversation.messages);
  const customerCount = messages.filter((message) => text(message.customer_message) || message.sender_type === "customer").length;
  const hasDraft = asArray(conversation.draft_orders).length > 0;
  const score = Math.round(clamp(
    (intent.purchase_intent === "high" ? 0.38 : intent.purchase_intent === "medium" ? 0.22 : 0.08) +
      (intent.size || intent.color ? 0.14 : 0) +
      (intent.budget ? 0.1 : 0) +
      (products.some((product) => stockCount(product) > 0) ? 0.14 : 0) +
      (hasDraft ? 0.16 : 0) +
      Math.min(0.12, customerCount * 0.025) +
      clamp(numeric(conversation.lead_score, 0) / 100, 0, 0.08),
    0,
    1
  ) * 100);
  const label = score >= 72 ? "hot" : score >= 42 ? "warm" : "cold";
  return { score, label };
};

const extractShoppingTerms = (message = "") =>
  uniqueArray(
    text(message)
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length > 1)
      .filter((term) => !["عايز", "عايزة", "بكام", "كام", "سعر", "متاح", "موجود", "مقاس", "لون", "price", "size", "color", "available"].includes(lower(term)))
  ).slice(0, 8);

export const searchAiSalesProducts = async ({ tenantId, query = "", limit = 8 } = {}) => {
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return [];
  const terms = extractShoppingTerms(query);
  const likeQuery = `%${lower(query)}%`;
  const likeTerms = terms.map((term) => `%${lower(term)}%`);
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 8));
  console.log("ai_inbox_recommendations_query", {
    tenant_id: safeTenantId,
    query_length: text(query).length,
    terms_count: terms.length,
    limit: safeLimit,
  });
  try {
    const [productColumns, variantColumns, variantImageColumns, categoryColumns, brandColumns] = await Promise.all([
      getTableColumns("products"),
      getTableColumns("product_variants"),
      getTableColumns("product_variant_images"),
      getTableColumns("categories"),
      getTableColumns("brands"),
    ]);
    const p = (column, fallback = "NULL") => (productColumns.has(column) ? `p.${column}` : fallback);
    const v = (column, fallback = "NULL") => (variantColumns.has(column) ? `v.${column}` : fallback);
    const pText = (column) => `COALESCE(${p(column)}::text, '')`;
    const vText = (column) => `COALESCE(${v(column)}::text, '')`;
    const pNumber = (column) => `COALESCE(${p(column, "0")}::numeric, 0)`;
    const vNumber = (column) => `COALESCE(${v(column, "0")}::numeric, 0)`;
    const scoreParts = [
      productColumns.has("name") ? `CASE WHEN LOWER(${pText("name")}) LIKE $2 THEN 30 ELSE 0 END` : "0",
      productColumns.has("sku") ? `CASE WHEN LOWER(${pText("sku")}) LIKE $2 THEN 25 ELSE 0 END` : "0",
      productColumns.has("product_type") ? `CASE WHEN LOWER(${pText("product_type")}) LIKE $2 THEN 12 ELSE 0 END` : "0",
      productColumns.has("gender") ? `CASE WHEN LOWER(${pText("gender")}) LIKE $2 THEN 8 ELSE 0 END` : "0",
      categoryColumns.has("name") ? `CASE WHEN LOWER(COALESCE(c.name, '')) LIKE $2 THEN 8 ELSE 0 END` : "0",
      brandColumns.has("name") ? `CASE WHEN LOWER(COALESCE(b.name, '')) LIKE $2 THEN 8 ELSE 0 END` : "0",
    ];
    const searchParts = [
      "$2 = '%%'",
      ...["name", "sku", "description", "product_type", "gender", "style"].filter((column) => productColumns.has(column)).map((column) => `LOWER(${pText(column)}) LIKE $2`),
      categoryColumns.has("name") ? "LOWER(COALESCE(c.name, '')) LIKE $2" : "",
      brandColumns.has("name") ? "LOWER(COALESCE(b.name, '')) LIKE $2" : "",
      ...["color", "size", "sku", "article_code", "edition_name", "barcode"].filter((column) => variantColumns.has(column)).map((column) => `LOWER(${vText(column)}) LIKE ANY($3::text[])`),
    ].filter(Boolean);
    const whereParts = ["p.tenant_id = $1"];
    if (productColumns.has("is_active")) whereParts.push("COALESCE(p.is_active, TRUE) = TRUE");
    if (productColumns.has("status")) whereParts.push("COALESCE(p.status, 'active') <> 'archived'");
    if (productColumns.has("deleted_at")) whereParts.push("p.deleted_at IS NULL");
    whereParts.push(aiProductSqlExclusionClause("p", productColumns));
    whereParts.push(`(${searchParts.join("\n        OR ")})`);

    const variantJoin = variantColumns.has("product_id") ? "LEFT JOIN product_variants v ON v.product_id = p.id AND v.tenant_id = p.tenant_id" : "LEFT JOIN (SELECT NULL::bigint AS product_id, NULL::bigint AS tenant_id) v ON FALSE";
    const variantActive = [
      variantColumns.has("is_active") ? "COALESCE(v.is_active, TRUE) = TRUE" : "TRUE",
      variantColumns.has("deleted_at") ? "v.deleted_at IS NULL" : "TRUE",
    ].join(" AND ");
    const totalStockExpr = variantColumns.has("stock")
      ? `COALESCE(SUM(CASE WHEN ${variantActive} THEN ${vNumber("stock")} ELSE 0 END), ${pNumber("stock")}, 0)::int`
      : `COALESCE(${pNumber("stock")}, 0)::int`;
    const variantImageJoin = variantImageColumns.has("product_id") && variantImageColumns.has("image_url")
      ? `LEFT JOIN product_variant_images pvi ON pvi.product_id = p.id${variantImageColumns.has("variant_id") && variantColumns.has("id") ? " AND (pvi.variant_id = v.id OR pvi.variant_id IS NULL)" : ""}`
      : "";
    const categoryJoin = productColumns.has("category_id") && categoryColumns.has("id") ? "LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id" : "LEFT JOIN (SELECT NULL::text AS name) c ON FALSE";
    const brandJoin = productColumns.has("brand_id") && brandColumns.has("id") ? "LEFT JOIN brands b ON b.id = p.brand_id AND b.tenant_id = p.tenant_id" : "LEFT JOIN (SELECT NULL::text AS name) b ON FALSE";
    const variantImageExpr = [
      variantColumns.has("image_url") ? "MAX(NULLIF(v.image_url, ''))" : "",
      variantImageColumns.has("image_url") ? "MAX(NULLIF(pvi.image_url, ''))" : "",
      productColumns.has("image_url") ? "NULLIF(p.image_url, '')" : "",
    ].filter(Boolean).join(", ") || "''";
    const variantPriceExpr = ["sale_price", "selling_price", "price"]
      .filter((column) => variantColumns.has(column))
      .map((column) => `NULLIF(${vNumber(column)}, 0)`);
    const orderUpdated = productColumns.has("updated_at") ? "p.updated_at DESC," : "";
    const result = await db.query(
      `
      SELECT
        p.id,
        ${pText("name")} AS name,
        ${pText("sku")} AS sku,
        ${pText("slug")} AS slug,
        ${pText("canonical_slug")} AS canonical_slug,
        ${pText("gender")} AS gender,
        ${pText("product_type")} AS product_type,
        ${pText("style")} AS style,
        ${pText("image_url")} AS product_image_url,
        ${pNumber("selling_price")} AS selling_price,
        ${pNumber("regular_price")} AS regular_price,
        ${pNumber("price")} AS price,
        ${pNumber("sale_price")} AS sale_price,
        ${productColumns.has("sale_price_enabled") ? "COALESCE(p.sale_price_enabled, FALSE)" : "FALSE"} AS sale_price_enabled,
        ${categoryColumns.has("name") ? "COALESCE(c.name, '')" : "''"} AS category_name,
        ${brandColumns.has("name") ? "COALESCE(b.name, '')" : "''"} AS brand_name,
        ${totalStockExpr} AS total_stock,
        ${variantColumns.has("color") ? "STRING_AGG(DISTINCT NULLIF(v.color, ''), ', ')" : "''"} AS colors,
        ${variantColumns.has("size") ? "STRING_AGG(DISTINCT NULLIF(v.size, ''), ', ')" : "''"} AS sizes,
        COALESCE(${variantImageExpr}) AS variant_image_url,
        ${variantPriceExpr.length ? `MAX(COALESCE(${variantPriceExpr.join(", ")}, 0))` : "0"} AS variant_price,
        (${scoreParts.join(" + ")} + CASE WHEN ${totalStockExpr} > 0 THEN 10 ELSE 0 END) AS score
      FROM products p
      ${variantJoin}
      ${variantImageJoin}
      ${categoryJoin}
      ${brandJoin}
      WHERE ${whereParts.join("\n        AND ")}
      GROUP BY p.id, c.name, b.name
      ORDER BY score DESC, total_stock DESC, ${orderUpdated} p.id DESC
      LIMIT $4
      `,
      [safeTenantId, likeQuery, likeTerms.length ? likeTerms : [likeQuery], safeLimit]
    );
    const eligibleProducts = filterAiEligibleProducts(result.rows.map(normalizeRecommendationProduct), { requireProductUrl: true });
    const understanding = detectSalesProductUnderstanding({ message: query, source: "ai_sales_recommendations" });
    const products = understanding.requires_relevance_gate
      ? gateRelevantProducts({ products: eligibleProducts, understanding, limit: safeLimit, fallback: false })
      : eligibleProducts;
    console.log("[ai-orchestrator:candidates]", {
      exact_count: products.filter((product) => product.relevance_reasons?.includes("model_family_match")).length,
      family_count: products.filter((product) => product.relevance_reasons?.includes("same_jordan_family")).length,
      similar_count: products.length,
      fallback_count: 0,
    });
    console.log("ai_inbox_recommendations_success", { tenant_id: safeTenantId, count: products.length });
    return products;
  } catch (error) {
    console.error("ai_inbox_recommendations_failed", {
      tenant_id: safeTenantId,
      code: error?.code || "",
      message: error?.message || "Product recommendation query failed",
    });
    return [];
  }
};

export const loadAiInboxRecommendations = async ({ tenantId, conversationId, limit = 8 } = {}) => {
  const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 100 });
  const conversation = asArray(inbox.conversations).find((item) => item.session_id === conversationId);
  if (!conversation) {
    console.warn("ai_inbox_recommendations_failed", {
      tenant_id: tenantId,
      conversation_id: maskIdForLog(conversationId),
      message: "Conversation not found",
    });
    return {
      conversation_id: conversationId,
      conversation_found: false,
      intent: "general_sales",
      products: [],
    };
  }
  const lastMessage = latestCustomerMessage(conversation.messages) || conversation.latest_message_preview || conversation.last_message || "";
  const discussed = latestProducts(conversation.messages);
  const memory = buildDashboardAiMemory(conversation);
  const remembered = productsFromDashboardMemory(memory);
  const searchQuery = remembered.length
    ? text(remembered[0]?.name || remembered[0]?.title || remembered[0]?.product_name || lastMessage)
    : lastMessage;
  const searched = await searchAiSalesProducts({ tenantId, query: lastMessage, limit });
  const rememberedSearch = remembered.length && searchQuery !== lastMessage
    ? await searchAiSalesProducts({ tenantId, query: searchQuery, limit }).catch(() => [])
    : [];
  const products = filterAiEligibleProducts([...remembered, ...discussed, ...rememberedSearch, ...searched], { requireProductUrl: false })
    .filter((product) => product?.id || product?.product_id)
    .reduce((items, product) => {
      const key = String(product.id || product.product_id);
      if (!items.some((item) => String(item.id || item.product_id) === key)) items.push(product);
      return items;
    }, [])
    .slice(0, Math.min(20, Math.max(1, Number(limit) || 8)));
  const intelligence = await buildSalesConversationIntelligence({
    tenantId,
    conversation,
    messages: conversation.messages,
    draftOrders: asArray(conversation.draft_orders),
    conversationFollowups: asArray(conversation.followups),
    recommendations: products,
    selectedProduct: conversation.current_product || conversation.product || products[0] || null,
    existingJourneyEvents: asArray(conversation.sales_journey_events),
  }).catch(() => null);
  return {
    conversation_id: conversationId,
    intent: memory.last_intent || memory.lastIntent || extractSalesIntent(lastMessage),
    products,
    memory,
    active_product_id: memory.active_product_id || memory.activeProductId || "",
    projection_source: remembered.length ? "conversation_memory" : "latest_message_search",
    sales_intelligence: intelligence,
    sales_conversation_state: intelligence?.state || conversation.sales_conversation_state || null,
    conversion_probability: intelligence?.conversion || conversation.conversion_probability || {},
    follow_up_recommendation: intelligence?.followUp || conversation.follow_up_recommendation || {},
    cross_sell_suggestions: intelligence?.crossSellSuggestions || conversation.cross_sell_suggestions || [],
    proactive_closer: intelligence?.closer || conversation.proactive_closer || {},
  };
};

const ensureAiSalesCloserSchema = async () => {
  await ensureAiSalesAgentSchema();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_stock_reservations (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      order_id BIGINT NULL,
      product_id BIGINT NOT NULL,
      variant_id BIGINT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TIMESTAMP NOT NULL,
      released_at TIMESTAMP NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_stock_reservations_tenant_status ON ai_stock_reservations (tenant_id, status, expires_at)`);
  await db.query(`
    UPDATE ai_stock_reservations
    SET status = 'expired',
        released_at = COALESCE(released_at, NOW()),
        updated_at = NOW()
    WHERE status = 'active'
      AND expires_at <= NOW()
  `);
};

export const createAiStockReservation = async ({
  tenantId,
  conversationId = "",
  orderId = null,
  productId,
  variantId = null,
  quantity = 1,
  minutes = 20,
  metadata = {},
} = {}) => {
  if (isRegressionTestContext()) {
    console.info("[ai-agent:dry-run-skip]", { action: "createAiStockReservation" });
    return null;
  }
  const safeTenantId = Number(tenantId);
  const safeProductId = Number(productId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !Number.isFinite(safeProductId) || safeProductId <= 0) return null;
  await ensureAiSalesCloserSchema();
  const result = await db.query(
    `
    INSERT INTO ai_stock_reservations (
      tenant_id, conversation_id, order_id, product_id, variant_id, quantity, status, expires_at, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW() + ($7::int * INTERVAL '1 minute'), $8::jsonb)
    RETURNING *
    `,
    [
      safeTenantId,
      text(conversationId),
      Number.isFinite(Number(orderId)) ? Number(orderId) : null,
      safeProductId,
      Number.isFinite(Number(variantId)) ? Number(variantId) : null,
      Math.max(1, int(quantity, 1)),
      Math.max(5, Math.min(60, int(minutes, 20))),
      json(metadata || {}),
    ]
  );
  console.log("ai_sales_closer_stock_reserved", {
    tenant_id: safeTenantId,
    conversation_id: maskIdForLog(conversationId),
    order_id: orderId || null,
    product_id: safeProductId,
    variant_id: variantId || null,
    quantity: Math.max(1, int(quantity, 1)),
  });
  return result.rows[0] || null;
};

export const buildAiSalesCloserLookupKeys = (conversationId = "") => {
  const raw = text(conversationId);
  const decodedOnce = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const decodedTwice = (() => {
    try {
      return decodeURIComponent(decodedOnce);
    } catch {
      return decodedOnce;
    }
  })();
  const suffixes = [raw, decodedOnce, decodedTwice]
    .map((value) => text(value).split(":").pop())
    .filter(Boolean);
  return uniqueArray([raw, decodedOnce, decodedTwice, ...suffixes]).filter(Boolean);
};

const conversationMatchesKeys = (conversation = {}, keys = []) => {
  const values = [
    conversation.session_id,
    conversation.external_conversation_id,
    conversation.external_customer_id,
    conversation.channel_metadata?.external_conversation_id,
    conversation.channel_metadata?.external_customer_id,
  ].map((value) => text(value)).filter(Boolean);
  return values.some((value) => keys.includes(value));
};

const findAiInboxConversationByKeys = async ({ tenantId, keys = [] } = {}) => {
  const all = await loadAiInbox({ tenantId, filter: "all", limit: 1000 });
  let conversation = asArray(all.conversations).find((item) => conversationMatchesKeys(item, keys));
  if (conversation) return { conversation, loaded_count: all.conversations.length, searched: "all" };

  for (const key of keys) {
    const searched = await loadAiInbox({ tenantId, filter: "all", search: key, limit: 50 });
    conversation = asArray(searched.conversations).find((item) => conversationMatchesKeys(item, keys));
    if (conversation) return { conversation, loaded_count: searched.conversations.length, searched: key };
  }

  return { conversation: null, loaded_count: all.conversations.length, searched: "all" };
};

const buildPaymentActions = ({ conversation = {}, order = {}, product = {} } = {}) => {
  const orderNumber = text(order.public_order_number || order.invoice_number || order.id);
  const customer = text(conversation.customer_name || conversation.external_customer_id || "customer");
  const productName = text(product.name || product.title || product.product_name || "selected product");
  const amount = numeric(order.total_amount || order.total_price || order.total, 0);
  const invoicePath = orderNumber ? `/orders/${order.id || orderNumber}` : "";
  return [
    {
      key: "send_payment_link",
      label: "Send payment link",
      message: `تمام، ده لينك الدفع للطلب ${orderNumber}: ${invoicePath}`,
      enabled: Boolean(invoicePath),
    },
    {
      key: "cash_on_delivery",
      label: "Cash on delivery",
      message: `تمام يا ${customer}، ممكن الدفع عند الاستلام. هجهزلك ${productName}${amount ? ` بإجمالي ${amount} جنيه` : ""}.`,
      enabled: true,
    },
    {
      key: "whatsapp_checkout",
      label: "WhatsApp checkout",
      message: `أقدر أكمّل معاك على واتساب لتأكيد الطلب ${orderNumber}. ابعت رقم الموبايل والعنوان لو مناسب.`,
      enabled: true,
    },
    {
      key: "public_invoice",
      label: "Public invoice",
      message: `فاتورة الطلب ${orderNumber}: ${invoicePath}`,
      enabled: Boolean(invoicePath),
    },
  ];
};

export const buildAiSalesCloserPlan = async ({ tenantId, conversationId, products = [] } = {}) => {
  const lookupKeys = buildAiSalesCloserLookupKeys(conversationId);
  const { conversation, loaded_count: loadedCount, searched } = await findAiInboxConversationByKeys({ tenantId, keys: lookupKeys });
  if (!conversation) {
    throw Object.assign(new Error(`Conversation not found for sales closer: ${lookupKeys[0] || ""}`), {
      status: 404,
      code: "AI_SALES_CLOSER_CONVERSATION_NOT_FOUND",
      lookup_keys: lookupKeys,
      loaded_count: loadedCount,
      searched,
    });
  }
  const recommendations = products.length
    ? { products }
    : await loadAiInboxRecommendations({ tenantId, conversationId: conversation.session_id, limit: 8 });
  const lastMessage = latestCustomerMessage(conversation.messages) || conversation.latest_message_preview || conversation.last_message || "";
  const intent = parseAiSalesCloserIntent({ message: lastMessage, products: recommendations.products, conversation });
  const lead = scoreAiSalesLead({ conversation, intent, products: recommendations.products });
  const primaryProduct = recommendations.products.find((product) => stockCount(product) > 0) || recommendations.products[0] || null;
  const actions = [
    { key: "create_order", label: "Create order", priority: primaryProduct && lead.score >= 45 ? "high" : "normal", enabled: Boolean(primaryProduct) },
    { key: "reserve_stock", label: "Reserve stock", priority: primaryProduct && stockCount(primaryProduct) <= 3 && stockCount(primaryProduct) > 0 ? "high" : "normal", enabled: Boolean(primaryProduct && stockCount(primaryProduct) > 0) },
    { key: "send_payment_link", label: "Send payment link", priority: asArray(conversation.draft_orders).length ? "high" : "normal", enabled: asArray(conversation.draft_orders).length > 0 },
    { key: "offer_discount", label: "Offer discount", priority: intent.budget ? "normal" : "low", enabled: true },
    { key: "escalate_human", label: "Escalate to human", priority: conversation.needs_human_support ? "high" : "normal", enabled: true },
    { key: "recommend_alternatives", label: "Recommend alternatives", priority: primaryProduct ? "normal" : "high", enabled: true },
  ];
  const memory = {
    preferred_size: intent.size || conversation.customer_profile?.preferred_size || "",
    preferred_colors: uniqueArray([intent.color, ...asArray(conversation.customer_profile?.preferred_colors)]),
    favorite_models: uniqueArray([intent.product_model, ...asArray(conversation.customer_profile?.preferred_models)]),
    price_sensitivity: intent.budget ? "budget_declared" : "unknown",
    last_discussed_products: recommendations.products.slice(0, 4).map((product) => ({
      id: product.id || product.product_id,
      name: product.name || product.title,
      price: realProductPrice(product),
      stock: stockCount(product),
    })),
  };
  return {
    conversation_id: conversation.session_id,
    conversation,
    intent,
    lead,
    products: recommendations.products,
    primary_product: primaryProduct,
    suggested_actions: actions,
    memory,
    followup: {
      ten_minute_message: primaryProduct
        ? `لسه مهتم بـ ${primaryProduct.name || primaryProduct.title}؟ أقدر أحجزهولك مؤقتا وأجهز الطلب.`
        : "لسه محتاج مساعدة في اختيار المنتج؟ ابعتلي المقاس والميزانية وأرشحلك المتاح.",
      abandoned_cart_message: "لو حابب نكمل الطلب ابعتلي المقاس والعنوان، وأراجعلك المتاح قبل التأكيد.",
      low_stock_message: primaryProduct && stockCount(primaryProduct) > 0 && stockCount(primaryProduct) <= 3
        ? `باقي ${stockCount(primaryProduct)} بس من ${primaryProduct.name || primaryProduct.title}. أقدر أحجزهولك مؤقتا.`
        : "",
    },
  };
};

const buildArabicAiSalesAnswer = ({ intent, products = [], conversation = {} } = {}) => {
  const name = text(conversation.customer_name || conversation.customer_profile?.name || "");
  const greeting = name && !/unknown|anonymous/i.test(name) ? `${name}، ` : "";
  const available = products.filter((product) => stockCount(product) > 0);
  const primary = available[0] || products[0] || null;
  const productLines = available.slice(0, 3).map((product, index) => {
    const price = realProductPrice(product);
    const stock = stockCount(product);
    const urgency = stock > 0 && stock <= 3 ? " - الكمية قليلة" : "";
    return `${index + 1}. ${product.name || product.title}${price ? ` - ${price} جنيه` : ""}${product.size ? ` - المقاسات: ${product.size}` : ""}${product.color ? ` - الألوان: ${product.color}` : ""}${urgency}`;
  });
  if (intent === "greeting") return `أهلا ${greeting}نورتنا. تحب أساعدك في موديل معين، مقاس، لون، أو سعر؟`;
  if (intent === "human_support") return "تمام، هحوّل المحادثة لحد من الفريق يراجع معاك التفاصيل. ابعتلي بس رقم الطلب أو المشكلة باختصار.";
  if (intent === "order_follow_up") return "أكيد. ابعتلي رقم الطلب أو رقم الموبايل المسجل على الطلب، وأنا أراجعلك الحالة.";
  if (!products.length) return "ممكن تبعتلي اسم الموديل أو صورة المنتج أو المقاس واللون المطلوب؟ هطلعلك أقرب المتاح من المخزون.";
  if (["pricing_question", "availability", "size_color_request", "product_search"].includes(intent)) {
    return [
      `${greeting}المتاح عندنا حاليا:`,
      ...productLines,
      primary?.product_url ? `تقدر تشوف التفاصيل من هنا: ${primary.product_url}` : "",
      "تحب أثبتلك مقاس أو أطلعلك بدائل قريبة؟",
    ].filter(Boolean).join("\n");
  }
  return [
    `${greeting}راجعتلك أقرب اختيارات من المخزون:`,
    ...productLines,
    "قولّي المقاس واللون المفضلين وأنا أضيقلك الاختيارات.",
  ].filter(Boolean).join("\n");
};

const rememberProduct = (productContext = null) => {
  if (!productContext) return null;
  return {
    id: productContext.id,
    slug: productContext.slug,
    name: productContext.name,
    brand: productContext.brand || "",
    model: productContext.model || "",
    price: productContext.salePrice || productContext.price,
    salePrice: productContext.salePrice,
    imageUrl: productContext.imageUrl || "",
    productUrl: productContext.productUrl || "",
    inStock: productContext.inStock,
    sizes: productContext.sizes || [],
  };
};

const productVisualAttachment = (productContext = null) =>
  productContext?.imageUrl
    ? [{
        type: "product_recommendations",
        title: "AI matched product",
        items: [{
          id: productContext.id,
          product_id: productContext.id,
          title: productContext.name,
          name: productContext.name,
          price: productContext.salePrice || productContext.price,
          image_url: productContext.imageUrl,
          product_url: productContext.productUrl || "",
        }],
      }]
    : [];

const logProductShareContext = ({ conversationId = "", platform = "", productContext = null, includeImage = false } = {}) => {
  if (!productContext?.id) return;
  if (productContext.productUrl) {
    pushAIEvent({
      type: "PRODUCT_LINK_ATTACHED",
      status: "success",
      conversationId,
      platform,
      productId: productContext.id,
      productUrl: productContext.productUrl,
    });
  }
  if (includeImage && productContext.imageUrl) {
    pushAIEvent({
      type: "PRODUCT_IMAGE_ATTACHED",
      status: "success",
      conversationId,
      platform,
      productId: productContext.id,
    });
  }
};

const commerceReplyForIntent = (intent = "", productContext = null, detectedSize = null) => {
  if (productContext?.name) {
    const price = productContext.salePrice || productContext.price;
    const sizes = Array.isArray(productContext.sizes) ? productContext.sizes.map((size) => String(size)) : [];
    if (detectedSize && sizes.length) {
      return sizes.includes(String(detectedSize))
        ? `أيوه  مقاس ${detectedSize} متاح حاليا في ${productContext.name}.`
        : `للأسف مقاس ${detectedSize} مش ظاهر متاح حاليا في ${productContext.name}.`;
    }
    if (intent === "PRICE_INQUIRY" && price) {
      return `سعر ${productContext.name} حاليا ${price} جنيه `;
    }
    if (intent === "AVAILABILITY_INQUIRY") {
      return productContext.inStock
        ? `أيوه  ${productContext.name} متوفر حاليا.`
        : `للأسف ${productContext.name} غير متوفر حاليا.`;
    }
    if (intent === "SIZE_INQUIRY" && productContext.sizes?.length) {
      return `المقاسات المتاحة حاليا لـ ${productContext.name}: ${productContext.sizes.join(", ")} `;
    }
  }
  switch (intent) {
    case "SIZE_INQUIRY":
      return "أكيد  ابعتلي المقاس اللي بتلبسه عادة أو طول القدم وأنا أساعدك تختار المقاس المناسب.";
    case "PRICE_INQUIRY":
      return "أكيد  هقولك السعر الحالي والمتاح دلوقتي.";
    case "AVAILABILITY_INQUIRY":
      return "ثانية واحدة أتأكدلك من التوفر الحالي والمقاسات المتاحة ";
    default:
      return "";
  }
};

const currentProductForConversation = (conversation = {}, products = []) => {
  const memoryProducts = productsFromDashboardMemory(conversation.ai_memory || buildDashboardAiMemory(conversation));
  if (memoryProducts.length) return memoryProducts[0];
  const fromConversation = [
    conversation.current_product,
    conversation.product,
    conversation.channel_metadata?.product,
    conversation.channel_metadata?.current_product,
    conversation.channel_metadata?.last_viewed_product,
  ].find(Boolean);
  if (fromConversation) return fromConversation;
  return asArray(products).find((product) => product?.id || product?.product_id || product?.name || product?.title) || null;
};

export const generateAiInboxReply = async ({ tenantId, conversationId, persist = false } = {}) => {
  const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 100 });
  const conversation = asArray(inbox.conversations).find((item) => item.session_id === conversationId);
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  if (["human_takeover", "closed"].includes(conversation.conversation_status)) {
    throw Object.assign(new Error("AI is paused for this conversation"), { status: 409 });
  }
  const lastMessage = latestCustomerMessage(conversation.messages) || conversation.latest_message_preview || conversation.last_message || "";
  const intent = resolveIntent(lastMessage);
  const detectedSize = extractShoeSize(lastMessage);
  const salesIntent = extractSalesIntent(lastMessage);
  const escalation = detectEscalation(lastMessage);
  updateConversationMemory(conversationId, {
    lastIntent: intent,
    ...(detectedSize ? { lastSize: detectedSize } : {}),
  });
  pushAIEvent({
    type: "INTENT_DETECTED",
    status: "success",
    conversationId,
    platform: conversation.channel || conversation.source || "",
    intent,
  });
  pushAIEvent({
    type: "CONVERSATION_MEMORY_UPDATED",
    status: "success",
    conversationId,
    platform: conversation.channel || conversation.source || "",
    memory: {
      lastIntent: intent,
      lastSize: detectedSize || undefined,
    },
  });
  const recommendations = await loadAiInboxRecommendations({ tenantId, conversationId, limit: 8 });
  const productContext = buildProductContext(currentProductForConversation(conversation, recommendations.products));
  const conversationMemory = getConversationMemory(conversationId);
  const replyProductContext = productContext || buildProductContext(conversationMemory?.lastProduct);
  const latestMessageRow = [...asArray(conversation.messages)].reverse().find((message) => text(message.customer_message || message.message_text || message.last_message)) || {};
  const salesIntelligence = await buildSalesConversationIntelligence({
    tenantId,
    conversation: {
      ...conversation,
      channel: conversation.channel || conversation.source || "web_chat",
      source: conversation.source || conversation.channel || "web_chat",
    },
    messages: conversation.messages,
    draftOrders: asArray(conversation.draft_orders),
    conversationFollowups: asArray(conversation.followups),
    recommendations: recommendations.products,
    selectedProduct: replyProductContext || productContext || currentProductForConversation(conversation, recommendations.products),
    currentStateRow: conversation.sales_conversation_state || null,
    existingJourneyEvents: asArray(conversation.sales_journey_events),
    channel: conversation.channel || conversation.source || "web_chat",
    providerMessageId: text(latestMessageRow.external_message_id || latestMessageRow.provider_message_id || latestMessageRow.message_id || ""),
    traceReason: "ai_inbox_reply_generation",
  }).catch(() => null);
  if (productContext) {
    const lastProduct = rememberProduct(productContext);
    updateConversationMemory(conversationId, { lastProduct });
    pushAIEvent({
      type: "PRODUCT_CONTEXT_ATTACHED",
      status: "success",
      conversationId,
      platform: conversation.channel || conversation.source || "",
      productId: productContext.id,
      productName: productContext.name,
    });
    pushAIEvent({
      type: "CONVERSATION_MEMORY_UPDATED",
      status: "success",
      conversationId,
      platform: conversation.channel || conversation.source || "",
      memory: {
        lastIntent: intent,
        lastSize: detectedSize || conversationMemory?.lastSize || undefined,
        lastProduct: productContext.name,
      },
    });
  }
  const productPrompt = replyProductContext
    ? [
        "Current product context:",
        `- Product: ${replyProductContext.name}`,
        `- Price: ${replyProductContext.salePrice || replyProductContext.price || ""}`,
        `- In stock: ${replyProductContext.inStock ? "Yes" : "No"}`,
        `- Sizes: ${(replyProductContext.sizes || []).join(", ")}`,
      ].join("\n")
    : "";
  const aiSettings = await getAISettings();
  const toneInstruction = getAIToneInstruction(aiSettings.tone);
  const humanizedReply = buildHumanizedReply({
    intent,
    productContext: replyProductContext,
    detectedSize,
    conversationId,
    customerName: conversation.customer_name || conversation.customerName || "",
  });
  const guarded = guardAIReply({
    reply: escalation.shouldEscalate
      ? "واضح إن فيه مشكلة محتاجة متابعة من أحد أفراد الفريق. هحوّل المحادثة لموظف يساعدك فورًا "
      : humanizedReply || commerceReplyForIntent(intent, replyProductContext, detectedSize) || buildArabicAiSalesAnswer({ intent: salesIntent, products: recommendations.products, conversation }),
    intent,
    productContext,
    conversationMemory,
    detectedSize,
  });
  const answer = ensureProductLinkInReply(guarded.reply, replyProductContext);
  await buildSalesConversationIntelligence({
    tenantId,
    conversation,
    messages: conversation.messages,
    draftOrders: asArray(conversation.draft_orders),
    conversationFollowups: asArray(conversation.followups),
    recommendations: recommendations.products,
    selectedProduct: replyProductContext || productContext || currentProductForConversation(conversation, recommendations.products),
  }).catch(() => null);
  logProductShareContext({
    conversationId,
    platform: conversation.channel || conversation.source || "",
    productContext: replyProductContext,
    includeImage: Boolean(replyProductContext?.imageUrl),
  });
  pushAIEvent({
    type: "AI_SAFETY_GUARD",
    status: guarded.reason === "OK" ? "success" : "warning",
    conversationId,
    platform: conversation.channel || conversation.source || "",
    reason: guarded.reason,
  });
  if (!escalation.shouldEscalate && humanizedReply) {
    pushAIEvent({
      type: "HUMANIZED_REPLY_USED",
      status: "success",
      conversationId,
      platform: conversation.channel || conversation.source || "",
      intent,
    });
  }
  pushAIEvent({
    type: "AI_REPLY_GENERATED",
    status: "success",
    conversationId,
    platform: conversation.channel || conversation.source || "",
  });
  if (escalation.shouldEscalate) {
    pushAIEvent({
      type: "AI_ESCALATED_TO_HUMAN",
      status: "warning",
      conversationId,
      platform: conversation.channel || conversation.source || "",
      reason: escalation.reason,
      keyword: escalation.keyword,
    });
  }
  const recommendationVisualAttachments = recommendations.products.filter((product) => product.image_url).length
    ? [{ type: "product_recommendations", title: "AI matched products", items: recommendations.products.filter((product) => product.image_url).slice(0, 6) }]
    : [];
  const visualAttachments = [
    ...productVisualAttachment(replyProductContext),
    ...recommendationVisualAttachments,
  ];
  const baseReply = {
    answer,
    confidence: recommendations.products.length ? 0.82 : 0.58,
    detected_intent: intent,
    escalated: escalation.shouldEscalate,
    escalationReason: escalation.reason,
    escalationKeyword: escalation.keyword,
    product_context: replyProductContext,
    product_prompt: productPrompt,
    tone: aiSettings.tone,
    tone_instruction: toneInstruction,
    suggested_products: recommendations.products,
    visual_attachments: visualAttachments,
    suggested_actions: escalation.shouldEscalate || salesIntent === "human_support" ? ["takeover"] : ["ask_size", "send_product", "create_draft_order"],
  };
  const reply = await composeAiSalesReply({
    message: lastMessage,
    response: baseReply,
    intent: { type: intent },
    memory: conversationMemory,
    source: "ai_inbox",
  });
  const channelAdapterPayload = {
    channel: conversation.channel || conversation.source || "web_chat",
    text: reply.answer || "",
    product_cards: reply.suggested_products || [],
    image_cards: reply.visual_attachments || [],
    suggested_actions: reply.suggested_actions || [],
    draft_order: salesIntelligence?.state?.current_state === "DRAFT_ORDER" ? (conversation.draft_order || conversation.draft_orders?.[0] || null) : null,
    sales_state: salesIntelligence?.state || null,
    journey_events: salesIntelligence?.journeyEvents || [],
    conversion: salesIntelligence?.conversion || {},
    follow_up: salesIntelligence?.followUp || {},
    closer: salesIntelligence?.closer || {},
  };
  let message = null;
  if (persist) {
    message = await appendAiGeneratedSupportReply({
      tenantId,
      sessionId: conversationId,
      answer: reply.answer,
      confidence: reply.confidence,
      detectedIntent: intent,
      suggestedProducts: reply.suggested_products || [],
      visualAttachments: reply.visual_attachments || [],
      suggestedActions: reply.suggested_actions,
    });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: conversationId, message, at: new Date().toISOString() });
    emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
  }
  return {
    conversation_id: conversationId,
    reply,
    message,
    text: reply.answer || "",
    intent: intent,
    sales_state: salesIntelligence?.state || null,
    journey_events: salesIntelligence?.journeyEvents || [],
    conversion: salesIntelligence?.conversion || {},
    follow_up: salesIntelligence?.followUp || {},
    closer: salesIntelligence?.closer || {},
    product_cards: reply.suggested_products || [],
    suggested_actions: reply.suggested_actions || [],
    draft_order: channelAdapterPayload.draft_order,
    channel_adapter_payload: channelAdapterPayload,
    sales_intelligence: salesIntelligence,
    reasoning: reply.reasoning || null,
  };
};

const productLineAr = (product = {}) => {
  const name = text(product.name || product.title || product.product_name);
  const price = realProductPrice(product);
  const stock = stockCount(product);
  if (!name) return "";
  const pricePart = price > 0 ? `سعره ${price} جنيه` : "السعر محتاج يتأكد من المنتج";
  const stockPart = stock > 0 ? "ومتاح حاليا" : "ومش ظاهر متاح حاليا";
  return `${name} ${pricePart} ${stockPart}`;
};

const draftLineAr = (draft = {}) => {
  const item = asArray(draft.items)[0] || {};
  const productName = text(item.product_name || draft.ai_agent_metadata?.product_name);
  const price = numeric(item.price || item.sale_price || draft.total_amount || draft.total, 0);
  const stockStatus = text(item.stock_status || draft.ai_agent_metadata?.stock_status);
  return [
    productName ? `المسودة على ${productName}` : "فيه مسودة أوردر مفتوحة",
    price > 0 ? `بسعر ${price} جنيه` : "",
    stockStatus === "stock_conflict" ? "بس المخزون محتاج مراجعة قبل التأكيد" : "",
  ].filter(Boolean).join(" ");
};

const detectSuggestedReplyIntent = ({ message = "", conversation = {}, products = [], drafts = [] } = {}) => {
  const normalized = lower(message);
  if (conversation.customer_sentiment === "negative" || ["زعلان", "مشكلة", "شكوى", "اتأخر", "غلط"].some((term) => normalized.includes(term))) return "apologize";
  if (["غالي", "خصم", "اخر سعر", "آخر سعر", "expensive", "discount"].some((term) => normalized.includes(lower(term)))) return "handle_objection";
  if (drafts.length || ["اشتري", "اطلب", "اوردر", "أوردر", "هاخده", "احجز"].some((term) => normalized.includes(lower(term)))) return "close_sale";
  if (!products.length || ["مقاس", "لون", "رقم", "عنوان", "منطقة"].some((term) => normalized.includes(lower(term)))) return "ask_missing_info";
  if (conversation.conversation_status === "human_takeover") return "handoff_note";
  return "answer_question";
};

const buildMissingInfoReply = ({ products = [], profile = {} } = {}) => {
  const product = products.find((item) => stockCount(item) > 0) || products[0] || null;
  if (!product) return "ممكن تبعتلي اسم الموديل أو صورة المنتج اللي تقصده، ومعاه المقاس واللون المطلوب؟";
  const missingSize = !text(profile.preferred_size);
  if (missingSize) return `تمام، ${productLineAr(product)}. تحب أنهي مقاس عشان أراجع المتاح بالظبؿ`;
  return `تمام، ${productLineAr(product)}. تحب أنهي لون أو فاريانت عشان نأكد المتاح قبل التسجيل؟`;
};

const safeSuggestedReplies = ({ conversation = {}, settings = DEFAULT_SETTINGS } = {}) => {
  const messages = asArray(conversation.messages);
  const products = latestProducts(messages);
  const stockedProducts = products.filter((product) => stockCount(product) > 0);
  const drafts = asArray(conversation.draft_orders);
  const profile = conversation.customer_profile || {};
  const lastCustomer = latestCustomerMessage(messages);
  const lastAi = latestAiAnswer(messages);
  const intent = detectSuggestedReplyIntent({ message: lastCustomer, conversation, products, drafts });
  const primaryProduct = stockedProducts[0] || products[0] || null;
  const primaryLine = primaryProduct ? productLineAr(primaryProduct) : "";
  const draftLine = drafts[0] ? draftLineAr(drafts[0]) : "";
  const canDiscount = settings.allow_discount_promises === true || settings.discount_permission === true;

  if (intent === "apologize") {
    return {
      intent,
      confidence: 0.82,
      suggestions: [
        "حقك عليا، خليني أراجعلك الموضوع خطوة بخطوة ونحلها بأسرع شكل. ممكن تبعتلي رقم الأوردر أو رقم الموبايل؟",
        "متأسفين على اللي حصل. ابعتلي تفاصيل المشكلة ورقم الطلب وأنا هتابعها مع الفريق حالا.",
        "تمام، أنا معاك لحد ما نحلها. محتاج بس رقم الطلب أو اسم المنتج عشان أراجع الحالة بدقة.",
      ],
    };
  }

  if (intent === "handle_objection") {
    const priceReply = primaryLine
      ? `فاهمك، ${primaryLine}. السعر ده هو السعر الحقيقي الظاهر عندنا حاليا، ومقدرش أوعد بخصم غير لما يتأكد من الإدارة. تحب أرشحلك بدائل أرخص؟`
      : "فاهمك، ابعتلي الموديل اللي تقصده وأنا أراجعلك السعر الحقيقي وأقولك لو فيه بدائل أرخص متاحة.";
    return {
      intent,
      confidence: primaryProduct ? 0.8 : 0.6,
      suggestions: [
        canDiscount && primaryLine
          ? `فاهمك، ${primaryLine}. أقدر أراجعلك لو فيه عرض أو خصم متاح قبل ما نأكد الأوردر.`
          : priceReply,
        "لو السعر أعلى من الميزانية، قولّي الرينج المناسب وأنا أطلعلك أقرب بدائل متاحة بسعر أقل.",
        primaryLine ? `الموديل ده قيمته في خامته وشكله، بس لو عايز حاجة اقتصادية أكتر أقدر أوريك اختيارات قريبة.` : "حددلي الشكل أو صورة المنتج، وأنا أرشحلك بدائل مناسبة للميزانية.",
      ],
    };
  }

  if (intent === "close_sale") {
    return {
      intent,
      confidence: drafts.length ? 0.86 : 0.72,
      suggestions: [
        draftLine ? `${draftLine}. تحب أأكدلك البيانات قبل ما نكمل؟` : "تمام، عشان أسجل الطلب محتاج الاسم ورقم الموبايل والعنوان والمقاس/اللون المطلوب.",
        "ابعتلي الاسم ورقم الموبايل والمنطقة، وأنا أراجع المتاح والسعر النهائي قبل تأكيد الأوردر.",
        primaryLine ? `${primaryLine}. لو مناسبك، ابعتلي الاسم ورقم الموبايل والعنوان ونكمل الطلب.` : "تمام، ابعتلي المنتج المطلوب مع المقاس واللون ونكمل بيانات الطلب.",
      ],
    };
  }

  if (intent === "ask_missing_info") {
    return {
      intent,
      confidence: primaryProduct ? 0.7 : 0.55,
      suggestions: [
        buildMissingInfoReply({ products, profile }),
        "ممكن تحددلي المقاس واللون اللي محتاجه؟ هراجعلك المتاح والسعر الحقيقي قبل أي تأكيد.",
        lastAi ? "خلينا نأكد التفاصيل الأول: المقاس، اللون، والمنطقة عشان أقدر أرد عليك بدقة." : "ابعتلي تفاصيل أكتر عن المنتج المطلوب أو صورة له، وأنا أطلعلك الأقرب من المتاح.",
      ],
    };
  }

  if (intent === "handoff_note") {
    return {
      intent,
      confidence: 0.72,
      suggestions: [
        "أنا معاك دلوقتي بدل الرد الآلي. قولّي محتاج نراجع إيه بالظبط وأنا أتابعها معاك.",
        primaryLine ? `راجعت المحادثة، ${primaryLine}. تحب أكملك على نفس المنتج ولا تشوف بدائل؟` : "راجعت المحادثة، محتاج منك بس توضح المنتج أو الطلب اللي نكمل عليه.",
        "تمام، هكمل معاك يدوي. لو فيه مقاس أو لون معين ابعتهولي عشان أراجع المتاح.",
      ],
    };
  }

  return {
    intent,
    confidence: primaryProduct ? 0.76 : 0.58,
    suggestions: [
      primaryLine ? `${primaryLine}. تحب أراجعلك المقاسات والألوان المتاحة منه؟` : "ممكن توضحلي المنتج أو تبعت صورته عشان أرد عليك بدقة؟",
      "تمام، أقدر أساعدك. محتاج أعرف المقاس واللون أو الميزانية اللي بتدور عليها.",
      stockedProducts[1] ? `كمان فيه بديل متاح: ${productLineAr(stockedProducts[1])}. تحب أقارنهم لك؟` : "لو تحب، ابعتلي الميزانية والمقاس وأنا أرشحلك أفضل المتاح.",
    ],
  };
};

export const generateAiSuggestedReplies = async ({ tenantId, conversationId } = {}) => {
  await ensureAiSalesAgentSchema();
  const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 100 });
  const conversation = asArray(inbox.conversations).find((item) => item.session_id === conversationId);
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  if (conversation.conversation_status === "closed") {
    throw Object.assign(new Error("Conversation is closed"), { status: 409 });
  }

  const settings = await getAiAgentSettings({ tenantId }).catch(() => DEFAULT_SETTINGS);
  if (settings.suggested_replies_enabled === false) {
    throw Object.assign(new Error("Suggested replies are disabled"), { status: 409 });
  }
  const result = safeSuggestedReplies({ conversation, settings });
  const suggestions = uniqueArray(asArray(result.suggestions)).slice(0, Math.max(1, Math.min(3, int(settings.suggested_reply_count, 3))));
  const payload = {
    suggestions,
    suggested_intent: result.intent || "answer_question",
    confidence: clamp(result.confidence, 0, 1),
    conversation_status: conversation.conversation_status,
    ai_paused: conversation.ai_paused === true,
  };
  console.log("[ai-agent:suggested-replies]", {
    tenantId,
    conversationId,
    suggested_intent: payload.suggested_intent,
    confidence: payload.confidence,
    count: payload.suggestions.length,
  });
  return payload;
};
