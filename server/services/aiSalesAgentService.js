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
  upsertAiReplySuggestionDraft,
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
import { buildReplyCorrectionContextSource, searchRelevantCorrections, ensureCorrectionMemorySchema } from "./aiCorrectionMemoryService.js";
import { normalizeWhatsappSessionId } from "../utils/whatsappIdentity.js";
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
import { compressAiReplyPromptPayload } from "./aiPromptCompressionService.js";
import { isLikelyMessageLikeName, resolveMessengerConversationDisplayName } from "./aiChannelAdapterService.js";

let schemaReadyPromise = null;
let aiInboxSchemaReadyPromise = null;
let aiInboxSchemaEnsured = false;
let metaIntegrationServiceModulePromise = null;
const aiPipelineDebugCache = new Map();
const DEBUG_MESSENGER_INBOX_CONVERSATION_ID = "facebook_messenger:5036593356360590";

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
const clonePipelineDebug = (value) => (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : null);
const normalizeProductCardsValue = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        return asArray(parsed.cards || parsed.products || parsed.items);
      }
    } catch {
      return [];
    }
    return [];
  }
  if (typeof value === "object") {
    return asArray(value.cards || value.products || value.items);
  }
  return [];
};
const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";
const firstImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const nested = firstImageValue(
        value.secure_url,
        value.cloudinary_url,
        value.image_url,
        value.main_image,
        value.variant_image,
        value.variant_image_url,
        value.color_image,
        value.color_image_url,
        value.thumbnail_url,
        value.media_url,
        value.url,
        value.path,
        value.src,
        value.preview,
        value.image
      );
      if (nested) return nested;
      continue;
    }
    const safe = text(value);
    if (safe) return safe;
  }
  return "";
};
const normalizeInboxProductCard = (card = {}, inherited = {}) => {
  if (!card || typeof card !== "object") return [];
  const nestedCards = asArray(card.items || card.cards || card.products || card.product_cards || card.productCards);
  if (nestedCards.length) {
    const shared = { ...inherited, ...card };
    return nestedCards.flatMap((nestedCard) => normalizeInboxProductCard(nestedCard, shared));
  }

  const merged = { ...inherited, ...card };
  const productId = firstText(merged.product_id, merged.id, merged.productId, merged.matched_product_id);
  const productName = firstText(
    merged.name,
    merged.product_name,
    merged.title,
    merged.display_name,
    merged.label,
    inherited.product_name,
    inherited.name,
    inherited.title,
    "منتج"
  );
  const storefrontUrl = firstText(
    merged.storefront_url,
    merged.product_url,
    merged.url,
    merged.share_url,
    merged.shareUrl,
    inherited.storefront_url,
    inherited.product_url,
    inherited.url,
    inherited.share_url,
    productId ? `/shop/product/${encodeURIComponent(productId)}` : ""
  );
  const imageUrl = firstImageValue(
    merged.image_url,
    merged.image,
    merged.thumbnail_url,
    merged.media_url,
    merged.product_image_url,
    merged.product_image,
    merged.variant_image_url,
    merged.variant_image,
    merged.main_image,
    inherited.image_url,
    inherited.image,
    inherited.thumbnail_url,
    inherited.media_url,
    inherited.product_image_url,
    inherited.variant_image_url,
    inherited.main_image
  );

  return [{
    ...merged,
    id: productId || merged.id || merged.product_id || "",
    product_id: productId || merged.product_id || merged.id || "",
    product_name: productName,
    name: productName,
    title: productName,
    display_name: productName,
    label: merged.label || productName,
    storefront_url: storefrontUrl,
    product_url: storefrontUrl,
    url: storefrontUrl,
    share_url: text(merged.share_url || merged.shareUrl || ""),
    image_url: imageUrl,
    image: imageUrl,
    thumbnail_url: imageUrl || merged.thumbnail_url || "",
    media_url: text(merged.media_url || merged.mediaUrl || ""),
  }];
};
const asProductCards = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return [];
    }
  }
  return [];
};
const normalizeInboxProductCards = (row = {}) =>
  normalizeProductCardsValue(
    row.product_cards ||
      row.productCards ||
      row.suggested_products ||
      row.suggestedProducts ||
      []
  ).flatMap((card) => normalizeInboxProductCard(card));
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
  const inboxBaseStartedAt = Date.now();
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
  ai_assistant_global_enabled: true,
  reply_length: "balanced",
  sales_pressure: "medium",
  allowed_phrases: ["ط£ظٹظˆظ‡ ظٹط§ ظپظ†ط¯ظ…", "طھظ…ط§ظ…", "ط§ط®طھظٹط§ط± ط­ظ„ظˆ", "ط£ط±ط´ط­ظ„ظƒ"],
  preferred_phrases: ["ط£ظٹظˆظ‡ ظٹط§ ظپظ†ط¯ظ…", "طھظ…ط§ظ…", "ط§ط®طھظٹط§ط± ط­ظ„ظˆ", "ط£ط±ط´ط­ظ„ظƒ"],
  forbidden_phrases: ["ط£ظ†ط§ ظ…ط³ط§ط¹ط¯ ط°ظƒظٹ", "ظƒظ†ظ…ظˆط°ط¬ ظ„ط؛ظˆظٹ", "ظ„ط§ ط£ط³طھط·ظٹط¹"],
  allow_auto_draft_creation: true,
  require_human_approval_before_confirm: false,
  allow_discount_promises: false,
  max_discount_percent: 0,
  cod_availability_text: "ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ… ظ…طھط§ط­ ط­ط³ط¨ ط§ظ„ظ…ظ†ط·ظ‚ط© ظˆط³ظٹط§ط³ط© ط§ظ„ط´ط­ظ†.",
  exchange_return_policy_text: "ط§ظ„ط§ط³طھط¨ط¯ط§ظ„ ط£ظˆ ط§ظ„ط§ط³طھط±ط¬ط§ط¹ ط­ط³ط¨ ط³ظٹط§ط³ط© ط§ظ„ظ…طھط¬ط± ظˆط­ط§ظ„ط© ط§ظ„ظ…ظ†طھط¬.",
  delivery_policy_text: "ط§ظ„طھظˆطµظٹظ„ ط¨ظٹطھط­ط¯ط¯ ط­ط³ط¨ ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط© ظˆظٹطھط£ظƒط¯ ظ‚ط¨ظ„ ط§ظ„ط´ط­ظ†.",
  followups_enabled: true,
  followup_cooldown_hours: 24,
  abandoned_followup_minutes: 45,
  max_followups_per_customer: 3,
  stop_followups_after_rejection: true,
  followup_templates: [
    "ظ„ط³ظ‡ ظ…ظ‡طھظ… ط¨ط§ظ„ظ…ظˆط¯ظٹظ„طں ط£ظ‚ط¯ط± ط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط§ظ„ظ…طھط§ط­.",
    "ظ„ظˆ ظ…ط­طھط§ط¬ ط¨ط¯ط§ط¦ظ„ ظ‚ط±ظٹط¨ط© ظ…ظ† ظ†ظپط³ ط§ظ„ط´ظƒظ„ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ…ظٹط²ط§ظ†ظٹط©.",
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
  { type: "price_high", terms: ["ط§ظ„ط³ط¹ط± ط؛ط§ظ„ظٹ", "ط؛ط§ظ„ظٹ", "expensive"], action: "cheaper_alternatives" },
  { type: "discount", terms: ["ظپظٹظ‡ ط®طµظ…", "ط®طµظ…", "ط§ط®ط± ط³ط¹ط±", "ط¢ط®ط± ط³ط¹ط±", "discount"], action: "handoff" },
  { type: "quality", terms: ["ط®ط§ظ…طھظ‡", "ط§ظ„ط®ط§ظ…ط©", "quality", "material"], action: "quality_value" },
  { type: "authenticity", terms: ["ط£طµظ„ظٹ", "ط§طµظ„ظٹ", "original", "authentic"], action: "policy_context" },
  { type: "exchange", terms: ["ط§ط³طھط¨ط¯ط§ظ„", "ط§ط³طھط±ط¬ط§ط¹", "ظٹظ†ظپط¹ ط§ط³طھط¨ط¯ط§ظ„", "return", "exchange"], action: "policy_context" },
  { type: "delivery_cost", terms: ["ط§ظ„طھظˆطµظٹظ„ ط¨ظƒط§ظ…", "ط´ط­ظ† ط¨ظƒط§ظ…", "delivery cost"], action: "shipping_context" },
  { type: "delivery_eta", terms: ["ظ‡ظٹظˆطµظ„ ط§ظ…طھظ‰", "ظٹظˆطµظ„ ط§ظ…طھظ‰", "delivery time"], action: "shipping_context" },
  { type: "sizes", terms: ["ظ…ظ‚ط§ط³ط§طھ طھط§ظ†ظٹط©", "ظ…ظ‚ط§ط³ طھط§ظ†ظٹ", "sizes"], action: "variant_suggestions" },
  { type: "cheaper", terms: ["ظپظٹظ‡ ط£ط±ط®طµ", "ظپظٹظ‡ ط§ط±ط®طµ", "ط§ط±ط®طµ", "cheaper"], action: "cheaper_alternatives" },
  { type: "cod", terms: ["ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…", "cod", "cash on delivery"], action: "payment_context" },
  { type: "complaint", terms: ["ط´ظƒظˆظ‰", "ظ…ط´ظƒظ„ط©", "ط²ط¹ظ„ط§ظ†", "ظ…ط´ ط¹ط§ط¬ط¨ظ†ظٹ"], action: "handoff" },
];

const RESPONSE_VARIANTS = {
  opener: ["طھظ…ط§ظ…", "ط¨طµ", "ط­ط§ط¶ط±", "ط¬ظ…ظٹظ„"],
  softAvailability: ["ط§ظ„ظ…طھط§ط­ ظ…ظ†ظ‡ ظƒظˆظٹط³ ط¯ظ„ظˆظ‚طھظٹ", "ظپظٹظ‡ ظ…ظ†ظ‡ ظ…ظ‚ط§ط³ط§طھ ط´ط؛ط§ظ„ط©", "ط®ظ„ظٹظ†ظٹ ط£ط¸ط¨ط·ظ„ظƒ ط§ظ„ظ…طھط§ط­ ظ…ظ†ظ‡"],
  value: ["ط®ط§ظ…طھظ‡ ط¹ظ…ظ„ظٹط© ظˆط´ظƒظ„ظ‡ ط´ظٹظƒ ظپظٹ ط§ظ„ظ„ط¨ط³", "ظ…طھظˆظپط± ط¨ط³ط¹ط± ظˆط§ط¶ط­ ظˆظ…ظ†ط§ط³ط¨", "ط§ط®طھظٹط§ط± ظ…ط¶ظ…ظˆظ† ظ„ظˆ ط¹ط§ظٹط² ط­ط§ط¬ط© طھط¹ظٹط´ ظ…ط¹ط§ظƒ"],
  close: ["طھط­ط¨ ط£ط´ظˆظپظ„ظƒ ظ…ظ‚ط§ط³ظƒطں", "ظ…ظ‚ط§ط³ظƒ ظƒط§ظ…طں", "طھط­ط¨ ط£ط´ظˆظپظƒ ط§ظ„ط£ظ„ظˆط§ظ† ظˆط§ظ„ظ…ظ‚ط§ط³ط§طھطں"],
};

const pick = (items = [], seed = "") => {
  const list = asArray(items).filter(Boolean);
  if (!list.length) return "";
  const value = [...String(seed)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return list[value % list.length];
};

const isAiAssistantGlobalEnabled = (settings = {}) => settings?.ai_assistant_global_enabled !== false;

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
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
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
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS external_reply_id TEXT NOT NULL DEFAULT ''`);
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
          display_name TEXT NOT NULL DEFAULT '',
          facebook_name TEXT NOT NULL DEFAULT '',
          messenger_name TEXT NOT NULL DEFAULT '',
          customer_name TEXT NOT NULL DEFAULT '',
          customer_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
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
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS facebook_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS messenger_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS customer_profile JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_customer_profiles ADD COLUMN IF NOT EXISTS last_profile_sync_at TIMESTAMP NULL`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_customer_profiles_external_customer_id ON ai_customer_profiles (tenant_id, external_customer_id)`);
      await clientOrPool.query(`UPDATE ai_customer_interactions SET detected_intent = intent_type WHERE COALESCE(detected_intent, '') = '' AND COALESCE(intent_type, '') <> ''`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_customer_profiles_tenant_seen ON ai_customer_profiles (tenant_id, last_seen_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_interactions_tenant_created ON ai_customer_interactions (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_interactions_tenant_session_created ON ai_customer_interactions (tenant_id, session_id, created_at DESC)`);
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
        lead_status TEXT NOT NULL DEFAULT 'new',
        customer_profile_id BIGINT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_message_at TIMESTAMP NULL,
          read_at TIMESTAMP NULL,
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
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'new'`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP NULL`);
    await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
    await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_tenant_lead_status ON ai_channel_conversations (tenant_id, lead_status, updated_at DESC)`);
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
    await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_channel_event_logs_tenant_conversation_created ON ai_channel_event_logs (tenant_id, conversation_id, created_at DESC, id DESC)`);
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
    ai_assistant_global_enabled: stored.ai_assistant_global_enabled ?? DEFAULT_SETTINGS.ai_assistant_global_enabled,
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
    ai_assistant_global_enabled: settings.ai_assistant_global_enabled !== undefined
      ? Boolean(settings.ai_assistant_global_enabled)
      : DEFAULT_SETTINGS.ai_assistant_global_enabled,
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
  if (["ط´ظƒظˆظ‰", "ط²ط¹ظ„ط§ظ†", "ظˆط­ط´", "ظ…ط´ظƒظ„ط©", "ط؛ط§ظ„ظٹ ط¬ط¯ط§", "ظ…ط´ ط¹ط§ط¬ط¨"].some((term) => normalized.includes(term))) return "negative";
  if (["طھظ…ط§ظ…", "ط­ظ„ظˆ", "ظ‡ط§ط®ط¯ظ‡", "ظ…ظ…طھط§ط²", "ط¬ط§ظ…ط¯"].some((term) => normalized.includes(term))) return "positive";
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

const logAiInboxConversationFilterDebug = ({
  requestedFilter = "all",
  requestedChannelFilter = "",
  rowsBeforeFilter = 0,
  rowsAfterFilter = 0,
  conversations = [],
  phase = "summary",
} = {}) => {
  const items = asArray(conversations);
  console.info("AI_INBOX_CONVERSATION_FILTER_DEBUG", {
    phase,
    requested_filter: text(requestedFilter || "all"),
    requested_channel: text(requestedChannelFilter || ""),
    resolved_channels: [...new Set(items.map((item) => text(item.channel || item.session_channel || item.source || item.provider || item.platform || "")))].filter(Boolean),
    resolved_thread_kinds: [...new Set(items.map((item) => text(item.thread_kind || item.channel_metadata?.thread_kind || "")))].filter(Boolean),
    rows_before_filter: Number(rowsBeforeFilter || 0),
    rows_after_filter: Number(rowsAfterFilter || 0),
    sample_rows: items.slice(0, 5).map((item) => ({
      channel: text(item.channel || item.session_channel || item.source || item.provider || item.platform || ""),
      thread_kind: text(item.thread_kind || item.channel_metadata?.thread_kind || ""),
      conversation_id: text(item.conversation_id || item.session_id || item.conversation_key || item.external_conversation_id || ""),
    })),
  });
};

export const normalizeInboxMessage = (row = {}) => ({
  id: row.id,
  session_id: row.session_id,
  channel: row.channel || "",
  external_message_id: row.external_message_id || "",
  external_reply_id: row.external_reply_id || "",
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
  error_code: row.error_code || "",
  message_type: row.message_type || "",
  confidence: Number(row.confidence || 0),
  needs_human_support: row.needs_human_support === true,
  detected_intent: row.detected_intent || "",
  suggested_products: asArray(row.suggested_products),
  product_cards: normalizeInboxProductCards(row),
  productCards: normalizeInboxProductCards(row),
  visual_attachments: asArray(row.visual_attachments),
  suggested_actions: asArray(row.suggested_actions),
  created_at: row.created_at,
  system_events: [
    row.needs_human_support ? { type: "handoff", label: "Human handoff requested", created_at: row.created_at } : null,
    row.detected_intent === "order_draft_created" ? { type: "draft_created", label: "Draft created", created_at: row.created_at } : null,
  ].filter(Boolean),
});

const normalizeAiReplyDraft = (value = {}) => {
  const draft = value && typeof value === "object" ? value : {};
  return {
    id: text(draft.id || ""),
    original_suggestion_id: text(draft.original_suggestion_id || draft.originalSuggestionId || draft.id || ""),
    status: text(draft.status || "not_sent") || "not_sent",
    source: text(draft.source || "ai_suggestion") || "ai_suggestion",
    message_type: text(draft.message_type || "text") || "text",
    text: text(draft.text || draft.answer || draft.message || ""),
    product_cards: normalizeProductCardsValue(draft.product_cards || draft.productCards || []),
    confidence: Number(draft.confidence || 0),
    detected_intent: text(draft.detected_intent || ""),
    customer_question: text(draft.customer_question || ""),
    metadata: draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {},
    validation: draft.validation && typeof draft.validation === "object" ? draft.validation : (draft.metadata && typeof draft.metadata === "object" && draft.metadata.validation && typeof draft.metadata.validation === "object" ? draft.metadata.validation : null),
    confidence_engine: draft.confidence_engine && typeof draft.confidence_engine === "object" ? draft.confidence_engine : (draft.metadata && typeof draft.metadata === "object" && draft.metadata.confidence_engine && typeof draft.metadata.confidence_engine === "object" ? draft.metadata.confidence_engine : null),
    pipeline_debug: draft.pipeline_debug && typeof draft.pipeline_debug === "object" ? draft.pipeline_debug : (draft.metadata && typeof draft.metadata === "object" && draft.metadata.pipeline_debug && typeof draft.metadata.pipeline_debug === "object" ? draft.metadata.pipeline_debug : null),
    updated_at: draft.updated_at || null,
  };
};

export const getLastAiPipelineDebug = ({ tenantId = null, conversationId = "" } = {}) => {
  const cacheKey = `${Number(tenantId) || 0}:${text(conversationId)}`;
  const cached = aiPipelineDebugCache.get(cacheKey) || null;
  return cached ? clonePipelineDebug(cached) : null;
};

const setAiPipelineDebug = ({ tenantId = null, conversationId = "", value = null } = {}) => {
  const cacheKey = `${Number(tenantId) || 0}:${text(conversationId)}`;
  if (!value) {
    aiPipelineDebugCache.delete(cacheKey);
    return;
  }
  aiPipelineDebugCache.set(cacheKey, clonePipelineDebug(value));
};

const summarizeInboxMessage = (row = {}) => {
  const outbound = isOutboundMessageRow(row);
  const messageText = text(row.message_text || row.customer_message || row.ai_answer || row.staff_message || "");
  const customerMessage = outbound ? "" : text(row.customer_message || row.message_text || "");
  const aiAnswer = text(row.ai_answer || (outbound ? messageText : ""));
  const staffMessage = text(row.staff_message || "");
  return {
    id: row.id,
    session_id: row.session_id,
    channel: row.channel || "",
    external_message_id: row.external_message_id || "",
    external_reply_id: row.external_reply_id || "",
    dedupe_key: row.dedupe_key || "",
    customer_message: customerMessage,
    ai_answer: aiAnswer,
    staff_message: staffMessage,
    sender_type: row.sender_type || (staffMessage ? "staff" : outbound ? "ai" : "customer"),
    manual_message: row.manual_message === true,
    staff_user_id: row.staff_user_id || null,
    staff_user_name: row.staff_user_name || "",
    delivery_status: row.delivery_status || "",
    delivery_error: row.delivery_error || "",
    error_code: row.error_code || "",
    message_type: row.message_type || "",
    confidence: Number(row.confidence || 0),
    needs_human_support: row.needs_human_support === true,
    detected_intent: row.detected_intent || "",
    product_cards: normalizeInboxProductCards(row),
    productCards: normalizeInboxProductCards(row),
    created_at: row.created_at,
    system_events: Array.isArray(row.system_events) ? row.system_events.slice(0, 2) : [],
  };
};

const canonicalInboxChannel = (value = "") => {
  const channel = text(value).toLowerCase();
  if (!channel) return "";
  if (channel.includes("whatsapp")) return "whatsapp";
  if (channel.includes("facebook_comment")) return "facebook_comment";
  if (channel.includes("instagram_comment")) return "instagram_comment";
  if (channel.includes("facebook") && channel.includes("messenger")) return "facebook_messenger";
  if (channel === "facebook_messenger" || channel === "messenger" || channel === "facebook") return "facebook_messenger";
  if (channel.includes("instagram")) return "instagram";
  if (channel === "web_chat" || channel === "web") return "web_chat";
  return channel;
};

const extractMessengerPsid = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  const lowerRaw = raw.toLowerCase();
  const trimmed = lowerRaw.startsWith("facebook_messenger:")
    ? raw.slice(raw.indexOf(":") + 1)
    : lowerRaw.startsWith("messenger:")
      ? raw.slice(raw.indexOf(":") + 1)
      : lowerRaw.startsWith("facebook:")
        ? raw.slice(raw.indexOf(":") + 1)
        : raw;
  const digits = trimmed.replace(/\D/g, "");
  return /^\d{5,}$/.test(digits) ? digits : "";
};

const canonicalMessengerSessionId = (value = "") => {
  const raw = text(value);
  if (!raw) return "facebook_messenger";
  const psid = extractMessengerPsid(raw);
  if (psid) return `facebook_messenger:${psid}`;
  const lowerRaw = raw.toLowerCase();
  if (lowerRaw === "facebook_messenger" || lowerRaw === "messenger" || lowerRaw === "facebook") return "facebook_messenger";
  if (lowerRaw.startsWith("facebook_messenger:")) return raw;
  if (lowerRaw.startsWith("messenger:") || lowerRaw.startsWith("facebook:")) {
    const suffix = raw.slice(raw.indexOf(":") + 1).trim();
    return suffix ? `facebook_messenger:${suffix}` : "facebook_messenger";
  }
  if (/^\d{5,}$/.test(raw.replace(/\D/g, ""))) return `facebook_messenger:${raw.replace(/\D/g, "")}`;
  return `facebook_messenger:${raw}`;
};

const isMessengerInboxConversation = (conversation = {}) => canonicalInboxChannel(
  conversation.channel || conversation.session_channel || conversation.source || conversation.channel_source || conversation.provider || conversation.platform || ""
) === "facebook_messenger";

const messengerConversationPsid = (conversation = {}) =>
  extractMessengerPsid(
    conversation.external_customer_id ||
      conversation.channel_metadata?.customer_psid ||
      conversation.channel_metadata?.sender_psid ||
      conversation.channel_metadata?.resolved_customer_id ||
      conversation.external_conversation_id ||
      conversation.session_id ||
      conversation.conversation_key ||
      conversation.customer_profile?.external_customer_id ||
      conversation.customer_profile?.psid ||
      conversation.customer_profile?.external_psid ||
      ""
  );

const messengerConversationIdentityKey = (conversation = {}) => {
  if (!isMessengerInboxConversation(conversation)) return "";
  return canonicalMessengerSessionId(
    conversation.external_conversation_id ||
      conversation.session_id ||
      conversation.conversation_key ||
      conversation.external_customer_id ||
      conversation.customer_profile?.external_customer_id ||
      ""
  );
};

const conversationHasMeaningfulMessengerIdentity = (conversation = {}) => {
  if (!isMessengerInboxConversation(conversation)) return true;
  const name = text(conversation.customer_name || conversation.customer_profile?.name || conversation.customer_profile?.display_name || "");
  const avatar = text(conversation.customer_avatar_url || conversation.customer_profile?.avatar_url || "");
  return Boolean(name && name.toLowerCase() !== "customer") || Boolean(avatar);
};

const mergeConversationMessages = (left = [], right = []) => {
  const merged = new Map();
  for (const raw of [...asArray(left), ...asArray(right)]) {
    const message = normalizeInboxMessage(raw);
    const identity = text(message.message_identity_key || message.provider_message_id || message.external_message_id || message.id || `${message.created_at || ""}:${message.message_text || message.customer_message || message.ai_answer || ""}`);
    if (!merged.has(identity)) {
      merged.set(identity, message);
      continue;
    }
    const current = merged.get(identity) || {};
    merged.set(identity, {
      ...current,
      ...message,
      product_cards: message.product_cards?.length ? message.product_cards : current.product_cards || [],
      productCards: message.productCards?.length ? message.productCards : current.productCards || [],
      customer_message: message.customer_message || current.customer_message || "",
      ai_answer: message.ai_answer || current.ai_answer || "",
      staff_message: message.staff_message || current.staff_message || "",
    });
  }
  return [...merged.values()].sort((leftMessage, rightMessage) => {
    const leftAt = new Date(leftMessage.created_at || 0).getTime() || 0;
    const rightAt = new Date(rightMessage.created_at || 0).getTime() || 0;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return Number(leftMessage.id || 0) - Number(rightMessage.id || 0);
  });
};

const mergeMessengerConversationRecords = (left = {}, right = {}) => {
  const leftHasIdentity = conversationHasMeaningfulMessengerIdentity(left);
  const rightHasIdentity = conversationHasMeaningfulMessengerIdentity(right);
  const preferred = rightHasIdentity && !leftHasIdentity ? right : left;
  const fallback = preferred === left ? right : left;
  const mergedMessages = mergeConversationMessages(left.messages || [], right.messages || []);
  const resolvedPsid = messengerConversationPsid(preferred) || messengerConversationPsid(fallback);
  const canonicalSessionId = canonicalMessengerSessionId(
    preferred.session_id ||
      preferred.conversation_key ||
      preferred.external_conversation_id ||
      fallback.session_id ||
      fallback.conversation_key ||
      fallback.external_conversation_id ||
      resolvedPsid ||
      ""
  );
  return {
    ...left,
    ...right,
    ...preferred,
    channel: "facebook_messenger",
    session_channel: "facebook_messenger",
    session_id: canonicalSessionId || text(preferred.session_id || fallback.session_id || ""),
    conversation_id: canonicalSessionId || text(preferred.conversation_id || fallback.conversation_id || preferred.session_id || fallback.session_id || ""),
    conversation_key: canonicalSessionId || text(preferred.conversation_key || fallback.conversation_key || preferred.session_id || fallback.session_id || ""),
    external_customer_id: resolvedPsid || text(preferred.external_customer_id || fallback.external_customer_id || ""),
    external_conversation_id: canonicalSessionId || text(preferred.external_conversation_id || fallback.external_conversation_id || preferred.session_id || fallback.session_id || ""),
    customer_name: text(preferred.customer_name || fallback.customer_name || preferred.customer_profile?.name || fallback.customer_profile?.name || ""),
    customer_avatar_url: text(preferred.customer_avatar_url || fallback.customer_avatar_url || preferred.customer_profile?.avatar_url || fallback.customer_profile?.avatar_url || ""),
    customer_profile: {
      ...(fallback.customer_profile || {}),
      ...(preferred.customer_profile || {}),
      external_customer_id: resolvedPsid || text((preferred.customer_profile || {}).external_customer_id || (fallback.customer_profile || {}).external_customer_id || ""),
      name: text(preferred.customer_profile?.name || fallback.customer_profile?.name || preferred.customer_name || fallback.customer_name || ""),
      avatar_url: text(preferred.customer_profile?.avatar_url || fallback.customer_profile?.avatar_url || preferred.customer_avatar_url || fallback.customer_avatar_url || ""),
    },
    channel_metadata: {
      ...(fallback.channel_metadata || {}),
      ...(preferred.channel_metadata || {}),
    },
    messages: mergedMessages,
    message_count: mergedMessages.length,
    preview_message: text(preferred.preview_message || fallback.preview_message || preferred.latest_message_preview || fallback.latest_message_preview || ""),
    latest_message_preview: text(preferred.latest_message_preview || fallback.latest_message_preview || preferred.preview_message || fallback.preview_message || ""),
    last_message: text(preferred.last_message || fallback.last_message || ""),
    last_activity_at: preferred.last_activity_at || fallback.last_activity_at || preferred.updated_at || fallback.updated_at || null,
    updated_at: preferred.updated_at || fallback.updated_at || null,
    unread_count: Math.max(Number(preferred.unread_count || 0), Number(fallback.unread_count || 0)),
    unread: Boolean(preferred.unread || fallback.unread),
    older_messages_available: Boolean(
      preferred.older_messages_available ||
      fallback.older_messages_available ||
      mergedMessages.length > Math.max(asArray(left.messages || []).length, asArray(right.messages || []).length)
    ),
  };
};

const normalizeAndMergeInboxConversations = (conversations = []) => {
  const merged = [];
  const indexByKey = new Map();

  for (const conversation of asArray(conversations)) {
    const normalized = { ...conversation };
    const canonicalChannel = canonicalInboxChannel(normalized.channel || normalized.session_channel || normalized.source || normalized.provider || normalized.platform || "");
    const messengerKey = canonicalChannel === "facebook_messenger" ? messengerConversationIdentityKey({ ...normalized, channel: canonicalChannel }) : "";
    const sessionKey = text(normalized.conversation_key || normalized.session_id || normalized.conversation_id || normalized.external_conversation_id || "");
    const canonicalKey = messengerKey || sessionKey;
    if (!canonicalKey) {
      merged.push(normalized);
      continue;
    }

    const existingIndex = indexByKey.has(canonicalKey) ? indexByKey.get(canonicalKey) : -1;
    if (existingIndex < 0) {
      const nextConversation = messengerKey
        ? {
            ...normalized,
            channel: "facebook_messenger",
            session_channel: "facebook_messenger",
            session_id: canonicalMessengerSessionId(
              normalized.session_id ||
                normalized.conversation_key ||
                normalized.external_conversation_id ||
                normalized.external_customer_id ||
                ""
            ),
            conversation_id: canonicalMessengerSessionId(
              normalized.conversation_id ||
                normalized.session_id ||
                normalized.conversation_key ||
                normalized.external_conversation_id ||
                normalized.external_customer_id ||
                ""
            ),
            conversation_key: canonicalMessengerSessionId(
              normalized.conversation_key ||
                normalized.session_id ||
                normalized.external_conversation_id ||
                normalized.external_customer_id ||
                ""
            ),
            external_conversation_id: canonicalMessengerSessionId(
              normalized.external_conversation_id ||
                normalized.session_id ||
                normalized.conversation_key ||
                normalized.external_customer_id ||
                ""
            ),
            external_customer_id: messengerConversationPsid(normalized) || normalized.external_customer_id || "",
          }
        : {
            ...normalized,
            channel: canonicalChannel || normalized.channel || "",
          };
      indexByKey.set(canonicalKey, merged.length);
      merged.push(nextConversation);
      continue;
    }

    const existing = merged[existingIndex];
    const nextConversation = messengerKey
      ? mergeMessengerConversationRecords(existing, normalized)
      : {
          ...existing,
          ...normalized,
          channel: canonicalChannel || existing.channel || normalized.channel || "",
          messages: mergeConversationMessages(existing.messages || [], normalized.messages || []),
        };
    merged[existingIndex] = nextConversation;
    indexByKey.set(canonicalKey, existingIndex);
  }

  return merged;
};

const canonicalInboxConversationSessionId = (conversation = {}) => {
  const channel = canonicalInboxChannel(conversation.channel || conversation.session_channel || conversation.source || conversation.provider || conversation.platform || "");
  const rawSessionId = text(conversation.session_id || conversation.conversation_key || conversation.conversation_id || "");
  const externalConversationId = text(conversation.external_conversation_id || "");
  const externalCustomerId = text(conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "");

  if (channel === "whatsapp") {
    return normalizeWhatsappSessionId(rawSessionId, externalCustomerId || externalConversationId || conversation.phone || "") || rawSessionId || externalConversationId || "";
  }

  if (channel === "facebook_messenger") {
    return canonicalMessengerSessionId(
      rawSessionId ||
        externalConversationId ||
        externalCustomerId ||
        conversation.customer_profile?.psid ||
        ""
    );
  }

  return rawSessionId || externalConversationId || text(conversation.conversation_key || conversation.conversation_id || "");
};
const isOutboundMessageRow = (row = {}) => {
  const direction = text(row.direction || row.message_direction || row.latest_direction || row.latest_message_direction || "").toLowerCase();
  const senderType = text(row.sender_type || row.senderType || row.latest_sender_type || row.latestSenderType || "").toLowerCase();
  const sourcePath = text(row.source_path || row.sourcePath || row.latest_source_path || row.latestSourcePath || "").toLowerCase();
  const insertSource = text(row.insert_source || row.insertSource || row.latest_insert_source || row.latestInsertSource || "").toLowerCase();
  const fromMe = row.from_me === true || row.fromMe === true || row.is_from_me === true || row.latest_from_me === true || row.latestFromMe === true;

  if (fromMe) return true;
  if (direction === "outbound") return true;
  if (["ai", "assistant", "staff", "team", "agent", "bot", "system"].includes(senderType)) return true;
  if (sourcePath.includes("ai_auto_reply") || sourcePath.includes("ai_send_success") || sourcePath.includes("whatsapp_outbound")) return true;
  if (insertSource.includes("ai_send_success") || insertSource.includes("whatsapp_outbound")) return true;
  return false;
};
const isMessengerConversationChannel = (value = "") => ["facebook_messenger", "facebook", "messenger"].includes(lower(value));
const isLikelyMessengerExternalId = (value = "") => {
  const candidate = text(value).replace(/\s+/g, "");
  return Boolean(candidate) && /^\d{5,}$/.test(candidate);
};
const extractMessengerPsidFromIdentity = (value = "") => {
  const candidate = text(value);
  if (!candidate) return "";
  const lowerCandidate = candidate.toLowerCase();
  let trimmed = candidate;
  if (lowerCandidate.startsWith("facebook_messenger:") || lowerCandidate.startsWith("messenger:") || lowerCandidate.startsWith("facebook:")) {
    trimmed = candidate.slice(candidate.indexOf(":") + 1);
  }
  const digits = trimmed.replace(/\D/g, "");
  return /^\d{5,}$/.test(digits) ? digits : "";
};
const isHumanReadableDisplayName = (value = "", { sessionId = "", externalConversationId = "" } = {}) => {
  const candidate = text(value);
  if (!candidate) return false;
  const normalized = candidate.toLowerCase();
  const compact = candidate.replace(/\s+/g, "");
  if (!compact) return false;
  if (/^\d+$/.test(compact)) return false;
  if (normalized.startsWith("facebook_messenger:") || normalized.startsWith("whatsapp:")) return false;
  if (["customer", "unknown", "عميل", "زبون", "client", "user"].includes(normalized)) return false;
  if (isLikelyMessageLikeName(candidate)) return false;
  const idCandidates = [sessionId, externalConversationId]
    .map((item) => extractMessengerPsidFromIdentity(item))
    .filter(Boolean);
  if (idCandidates.includes(compact)) return false;
  return true;
};
const resolveConversationDisplayName = ({ conversation = {}, customerProfile = {}, customerName = "" } = {}) => {
  const sourceChannel = lower(conversation.channel || conversation.session_channel || conversation.source || "");
  const isMessenger = isMessengerConversationChannel(sourceChannel);
  const profile = customerProfile && typeof customerProfile === "object"
    ? customerProfile
    : conversation.customer_profile && typeof conversation.customer_profile === "object"
      ? conversation.customer_profile
      : {};
  const messengerProfile = conversation.channel_metadata?.messenger_profile || conversation.channel_metadata?.customer_profile || profile?.messenger_profile || {};
  const sessionId = text(conversation.session_id || conversation.conversation_key || "");
  const externalConversationId = text(conversation.external_conversation_id || "");
  const candidates = [
    profile.name,
    profile.display_name,
    profile.facebook_name,
    profile.messenger_name,
    profile.full_name,
    profile.sender_name,
    profile.profile_name,
    profile.contact_name,
    [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    messengerProfile.name,
    messengerProfile.display_name,
    messengerProfile.facebook_name,
    messengerProfile.messenger_name,
    messengerProfile.full_name,
    messengerProfile.sender_name,
    messengerProfile.profile_name,
    messengerProfile.contact_name,
    [messengerProfile.first_name, messengerProfile.last_name].filter(Boolean).join(" "),
    conversation.session_customer_name,
    customerName,
    conversation.customer_name,
    conversation.customer?.name,
    conversation.display_name,
    conversation.participant_name,
    conversation.facebook_name,
    conversation.messenger_name,
    conversation.sender_name,
    conversation.profile_name,
    conversation.contact_name,
    [conversation.first_name, conversation.last_name].filter(Boolean).join(" "),
  ];
  if (!isMessenger) {
    candidates.push(conversation.external_customer_id, conversation.phone);
  }
  for (const candidate of candidates) {
    const name = text(candidate);
    if (!name) continue;
    if (isMessenger && !isHumanReadableDisplayName(name, { sessionId, externalConversationId })) continue;
    return name;
  }
  return isMessenger ? "" : text(conversation.external_customer_id || conversation.phone || "");
};
const buildCustomerProfilePayload = ({ conversation = {}, memories = [] } = {}) => {
  const profile = conversation.customer_profile || {};
  const memoryValues = memories.map((item) => item.memory_value || {});
  const firstName = text(profile.first_name || conversation.first_name || "");
  const lastName = text(profile.last_name || conversation.last_name || "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const displayName = resolveConversationDisplayName({
    conversation,
    customerProfile: profile,
    customerName: conversation.customer_name || "",
  });
  const messengerFallbackName = isMessengerConversationChannel(conversation.channel || conversation.source || "")
    ? (isHumanReadableDisplayName(conversation.customer_name, {
        sessionId: conversation.session_id || conversation.conversation_key || "",
        externalConversationId: conversation.external_conversation_id || "",
      }) ? conversation.customer_name : "")
    : (conversation.customer_name || "");
  const resolvedName = displayName || fullName || firstName || messengerFallbackName || "";
  return {
    id: profile.id || conversation.profile_id || null,
    name: resolvedName,
    display_name: resolvedName,
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

const getMetaIntegrationServiceModule = async () => {
  if (!metaIntegrationServiceModulePromise) {
    metaIntegrationServiceModulePromise = import("./metaIntegrationService.js");
  }
  return metaIntegrationServiceModulePromise;
};

const shouldRefreshMessengerInboxProfile = (conversation = {}) => {
  const sourceChannel = lower(conversation.channel || conversation.session_channel || conversation.source || "");
  if (!isMessengerConversationChannel(sourceChannel)) return false;
  const sessionId = text(conversation.session_id || conversation.conversation_key || conversation.external_conversation_id || "");
  const externalConversationId = text(conversation.external_conversation_id || "");
  const customerName = text(conversation.customer_name || conversation.display_name || conversation.participant_name || "");
  const avatarUrl = text(
    conversation.customer_avatar_url ||
    conversation.profile_pic_url ||
    conversation.customer_profile?.avatar_url ||
    conversation.channel_metadata?.messenger_profile?.profile_pic ||
    conversation.channel_metadata?.messenger_profile?.profile_pic_url ||
    ""
  );
  return !isHumanReadableDisplayName(customerName, { sessionId, externalConversationId }) || !avatarUrl;
};

const hydrateMessengerInboxConversation = async ({ tenantId, conversation = {} } = {}) => {
  if (!shouldRefreshMessengerInboxProfile(conversation)) return conversation;
  const sessionId = text(conversation.session_id || conversation.conversation_key || conversation.external_conversation_id || "");
  const externalConversationId = text(conversation.external_conversation_id || sessionId || "");
  const externalCustomerId = text(conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "");
  if (!sessionId || !externalConversationId || !externalCustomerId) return conversation;
  const pageId = text(
    conversation.channel_metadata?.page_id ||
    conversation.channel_metadata?.facebook_page_id ||
    conversation.channel_metadata?.resolved_page_id ||
    conversation.channel_metadata?.recipient_page_id ||
    ""
  );
  try {
    const { refreshMessengerProfileForConversation } = await getMetaIntegrationServiceModule();
    const refreshed = await refreshMessengerProfileForConversation({
      tenantId,
      conversationId: externalConversationId,
      externalCustomerId,
      pageId,
      dryRun: false,
    });
    if (externalConversationId === DEBUG_MESSENGER_INBOX_CONVERSATION_ID) {
      console.log("messenger_inbox_profile_refresh_result", {
        tenant_id: tenantId,
        conversation_id: externalConversationId,
        session_id: sessionId,
        external_customer_id: externalCustomerId,
        page_id: pageId,
        refreshed_name: text(refreshed?.customer_name || refreshed?.display_name || ""),
        refreshed_avatar: text(refreshed?.customer_avatar_url || ""),
        refreshed_profile_name: text(refreshed?.customer_profile?.name || ""),
        refreshed_profile_avatar: text(refreshed?.customer_profile?.avatar_url || refreshed?.customer_profile?.profile_pic_url || ""),
        updated_rows: Number(refreshed?.updated_rows || 0),
      });
    }
    const refreshedName = text(refreshed?.customer_name || refreshed?.display_name || "");
    const refreshedAvatar = text(refreshed?.customer_avatar_url || "");
    const refreshedProfile = refreshed?.customer_profile && typeof refreshed.customer_profile === "object" ? refreshed.customer_profile : {};
    if (!refreshedName && !refreshedAvatar) return conversation;
    const messengerProfile = {
      ...((conversation.channel_metadata || {}).messenger_profile || {}),
      ...refreshedProfile,
      first_name: text(refreshedProfile.first_name || conversation.first_name || ""),
      last_name: text(refreshedProfile.last_name || conversation.last_name || ""),
      name: refreshedName || text(refreshedProfile.name || conversation.customer_name || ""),
      display_name: refreshedName || text(refreshedProfile.display_name || conversation.display_name || conversation.customer_name || ""),
      profile_pic: refreshedAvatar || text(refreshedProfile.profile_pic || conversation.customer_avatar_url || ""),
      profile_pic_url: refreshedAvatar || text(refreshedProfile.profile_pic_url || conversation.customer_avatar_url || ""),
      profile_fetched_at: text(refreshedProfile.profile_fetched_at || new Date().toISOString()),
    };
    const customerProfile = {
      ...(conversation.customer_profile || {}),
      ...refreshedProfile,
      name: refreshedName || text((conversation.customer_profile || {}).name || conversation.customer_name || ""),
      display_name: refreshedName || text((conversation.customer_profile || {}).display_name || conversation.customer_name || ""),
      avatar_url: refreshedAvatar || text((conversation.customer_profile || {}).avatar_url || conversation.customer_avatar_url || ""),
      profile_pic_url: refreshedAvatar || text((conversation.customer_profile || {}).profile_pic_url || conversation.customer_avatar_url || ""),
      external_customer_id: externalCustomerId || text((conversation.customer_profile || {}).external_customer_id || ""),
      source_channel: conversation.channel || conversation.source || (conversation.customer_profile || {}).source_channel || "",
    };
    const customerAvatarUrl = refreshedAvatar || text(conversation.customer_avatar_url || conversation.profile_pic_url || "");
    const hydratedConversation = {
      ...conversation,
      customer_name: refreshedName || text(conversation.customer_name || ""),
      display_name: refreshedName || text(conversation.display_name || ""),
      participant_name: refreshedName || text(conversation.participant_name || ""),
      sender_name: refreshedName || text(conversation.sender_name || ""),
      profile_name: refreshedName || text(conversation.profile_name || ""),
      contact_name: refreshedName || text(conversation.contact_name || ""),
      customer_avatar_url: customerAvatarUrl,
      profile_pic_url: customerAvatarUrl,
      profile_id: refreshed?.customer_profile_id || conversation.profile_id || conversation.customer_profile_id || null,
      customer_profile_id: refreshed?.customer_profile_id || conversation.customer_profile_id || conversation.profile_id || null,
      first_name: text(refreshedProfile.first_name || conversation.first_name || ""),
      last_name: text(refreshedProfile.last_name || conversation.last_name || ""),
      channel_metadata: {
        ...(conversation.channel_metadata || {}),
        page_id: pageId || text((conversation.channel_metadata || {}).page_id || ""),
        facebook_page_id: pageId || text((conversation.channel_metadata || {}).facebook_page_id || ""),
        resolved_page_id: pageId || text((conversation.channel_metadata || {}).resolved_page_id || ""),
        messenger_profile: messengerProfile,
      },
      customer_profile: customerProfile,
    };
    if (externalConversationId === DEBUG_MESSENGER_INBOX_CONVERSATION_ID) {
      console.log("messenger_inbox_profile_hydration_applied", {
        tenant_id: tenantId,
        conversation_id: externalConversationId,
        session_id: sessionId,
        customer_name: text(hydratedConversation.customer_name || ""),
        customer_avatar_url: text(hydratedConversation.customer_avatar_url || ""),
        customer_profile_name: text(hydratedConversation.customer_profile?.name || ""),
        customer_profile_avatar: text(hydratedConversation.customer_profile?.avatar_url || hydratedConversation.customer_profile?.profile_pic_url || ""),
      });
    }
    return hydratedConversation;
  } catch (error) {
    console.warn("messenger_inbox_profile_hydration_failed", {
      tenant_id: tenantId,
      conversation_id: externalConversationId,
      session_id: sessionId,
      message: error?.message || "Messenger inbox profile hydration failed",
    });
    return conversation;
  }
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
  const phone = text(metadata.customer_phone || metadata.phone || "").replace(/\D/g, "");
  const externalCustomerId = text(
    metadata.external_customer_id ||
      metadata.externalCustomerId ||
      metadata.customer_external_id ||
      metadata.customerExternalId ||
      metadata.messenger_profile?.id ||
      metadata.sender_psid ||
      metadata.customer_psid ||
      metadata.resolved_customer_id ||
      metadata.resolvedCustomerId ||
      ""
  );
  if (!tenantId || (!phone && !externalCustomerId)) return null;
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
  const customerSummary = text(response.answer || message).slice(0, 500);
  let profile = null;
  if (externalCustomerId) {
    const result = await db.query(
      `
      SELECT *
      FROM ai_customer_profiles
      WHERE tenant_id = $1
        AND COALESCE(external_customer_id, '') = $2
      LIMIT 1
      `,
      [tenantId, externalCustomerId]
    );
    profile = result.rows[0] || null;
  }
  if (!profile && phone) {
    const result = await db.query(
      `
      SELECT *
      FROM ai_customer_profiles
      WHERE tenant_id = $1
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2
      LIMIT 1
      `,
      [tenantId, phone]
    );
    profile = result.rows[0] || null;
  }

  const profileValues = {
    first_name: firstName,
    last_name: text(metadata.last_name || metadata.family_name || ""),
    phone,
    external_customer_id: externalCustomerId,
    source_channel: text(metadata.channel || ""),
    viewed_products: products,
    city_area: text(metadata.city_area || metadata.area),
    conversation_summary: customerSummary,
    customer_sentiment: sentiment,
    memory_score: memoryScore,
  };

  if (profile) {
    const updated = await db.query(
      `
      UPDATE ai_customer_profiles
      SET
        first_name = COALESCE(NULLIF($1::text, ''), first_name),
        last_name = COALESCE(NULLIF($2::text, ''), last_name),
        phone = COALESCE(NULLIF($3::text, ''), phone),
        external_customer_id = COALESCE(NULLIF($4::text, ''), external_customer_id),
        source_channel = COALESCE(NULLIF($5::text, ''), source_channel),
        viewed_products = (
          SELECT COALESCE(jsonb_agg(DISTINCT item), '[]'::jsonb)
          FROM jsonb_array_elements(ai_customer_profiles.viewed_products || $6::jsonb) AS item
        ),
        city_area = COALESCE(NULLIF($7::text, ''), city_area),
        conversation_summary = COALESCE(NULLIF($8::text, ''), conversation_summary),
        customer_sentiment = $9::text,
        memory_score = GREATEST(ai_customer_profiles.memory_score, $10::int),
        last_seen_at = NOW(),
        updated_at = NOW()
      WHERE id = $11::bigint
      RETURNING *
      `,
      [
        profileValues.first_name,
        profileValues.last_name,
        profileValues.phone,
        profileValues.external_customer_id,
        profileValues.source_channel,
        json(profileValues.viewed_products),
        profileValues.city_area,
        profileValues.conversation_summary,
        profileValues.customer_sentiment,
        profileValues.memory_score,
        profile.id,
      ]
    );
    profile = updated.rows[0] || profile;
  } else {
    const inserted = await db.query(
      `
      INSERT INTO ai_customer_profiles (
        tenant_id, first_name, last_name, phone, source_channel, external_customer_id, viewed_products, city_area,
        conversation_summary, customer_sentiment, memory_score, last_seen_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,NOW(),NOW())
      RETURNING *
      `,
      [
        tenantId,
        profileValues.first_name,
        profileValues.last_name,
        profileValues.phone,
        profileValues.source_channel,
        profileValues.external_customer_id,
        json(profileValues.viewed_products),
        profileValues.city_area,
        profileValues.conversation_summary,
        profileValues.customer_sentiment,
        profileValues.memory_score,
      ]
    );
    profile = inserted.rows[0] || null;
  }
  if (!profile) return null;
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
  const name = product?.name || "ط§ظ„ظ…ظˆط¯ظٹظ„ ط¯ظ‡";
  if (objection.action === "handoff") {
    if (objection.type === "discount" && (settings.allow_discount_promises === true || settings.discount_permission === true)) {
      const maxDiscount = numeric(settings.max_discount_percent, 0);
      return {
        answer: maxDiscount > 0
          ? `${opener}طŒ ط£ظ‚ط¯ط± ط£ط±ط§ط¬ط¹ظ„ظƒ ط®طµظ… ظ„ط­ط¯ ${maxDiscount}% ط­ط³ط¨ ط³ظٹط§ط³ط© ط§ظ„ظ…طھط¬ط± ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±.`
          : `${opener}طŒ ط£ظ‚ط¯ط± ط£ط±ط§ط¬ط¹ظ„ظƒ ظ„ظˆ ظپظٹظ‡ ط¹ط±ط¶ ظ…طھط§ط­ ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±.`,
        needs_human_support: false,
        suggested_actions: ["show_similar_products"],
        objection_type: objection.type,
      };
    }
    return {
      answer: `${opener}طŒ ط§ظ„ظ†ظ‚ط·ط© ط¯ظٹ ظ…ط­طھط§ط¬ط© طھط£ظƒظٹط¯ ظ…ظ† ط§ظ„ظپط±ظٹظ‚ ط¹ط´ط§ظ† ظ†ط¯ظٹظƒ ط£ظپط¶ظ„ ط­ظ„ ظ…ط¶ط¨ظˆط·. ظ‡ط­ظˆظ‘ظ„ظƒ ظ„ط­ط¯ ظٹط±ط§ط¬ط¹ظ‡ط§ ظ…ط¹ط§ظƒ.`,
      needs_human_support: true,
      suggested_actions: ["contact_support"],
      objection_type: objection.type,
    };
  }
  if (objection.action === "cheaper_alternatives") {
    return {
      answer: `${opener}طŒ ظپط§ظ‡ظ…ظƒ. ${name} ظ‚ظٹظ…طھظ‡ ط­ظ„ظˆط©طŒ ط¨ط³ ط£ظ‚ط¯ط± ط£ط±ط´ط­ظ„ظƒ ط¨ط¯ط§ط¦ظ„ ط£ط±ط®طµ ط¨ظ†ظپط³ ط§ظ„ظ„ظˆظƒ طھظ‚ط±ظٹط¨ظ‹ط§. ظ…ظ‚ط§ط³ظƒ ظƒط§ظ…طں`,
      needs_human_support: false,
      suggested_actions: ["show_similar_products"],
      objection_type: objection.type,
    };
  }
  if (objection.action === "variant_suggestions") {
    return {
      answer: `${opener}طŒ ط£ط´ظٹظƒظ„ظƒ ط¹ظ„ظ‰ ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط§ظ„ظ…طھط§ط­ط©. ظ‚ظˆظ„ظ‘ظٹ ظ…ظ‚ط§ط³ظƒ ط§ظ„ط£ط³ط§ط³ظٹ ظˆظ„ظˆ ظٹظ†ظپط¹ ظ…ط¹ط§ظƒ ظ…ظ‚ط§ط³ ظ‚ط±ظٹط¨ ظ…ظ†ظ‡.`,
      needs_human_support: false,
      suggested_actions: ["choose_size"],
      objection_type: objection.type,
    };
  }
  const line =
    objection.action === "quality_value"
      ? `${name} ط®ط§ظ…طھظ‡ ط¹ظ…ظ„ظٹط© ظˆظ…ظ†ط§ط³ط¨ ظ„ظ„ط¨ط³ ط§ظ„ظٹظˆظ…ظٹطŒ ظˆط§ظ„ط£ظ‡ظ… ط¥ظ† ط§ظ„ظ…ظ‚ط§ط³ ظ„ظˆ ظ…ط¶ط¨ظˆط· ظ‡ظٹط¯ظٹظƒ ط´ظƒظ„ ط­ظ„ظˆ ظپظٹ ط§ظ„ط±ط¬ظ„.`
      : objection.action === "shipping_context"
        ? "ط§ظ„طھظˆطµظٹظ„ ط¨ظٹطھط­ط³ط¨ ط­ط³ط¨ ط§ظ„ظ…ط­ط§ظپط¸ط© ظˆط§ظ„ظ…ظ†ط·ظ‚ط©طŒ ظˆط§ط¨ط¹طھظ„ظٹ ظ…ظ†ط·ظ‚طھظƒ ط£ظ‚ظˆظ„ظƒ ط§ظ„ط£ظ†ط³ط¨."
        : objection.action === "payment_context"
          ? "ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ… ظ…طھط§ط­ ط­ط³ط¨ ط§ظ„ظ…ظ†ط·ظ‚ط© ظˆط­ط§ظ„ط© ط§ظ„ط¹ظ…ظٹظ„طŒ ط§ط¨ط¹طھظ„ظٹ ط±ظ‚ظ…ظƒ ظˆظ…ظ†ط·ظ‚طھظƒ ظˆظ†ط£ظƒط¯ظ‡ط§."
          : "ط§ظ„ط³ظٹط§ط³ط© ط¨طھطھط£ظƒط¯ ط­ط³ط¨ ط­ط§ظ„ط© ط§ظ„ظ…ظ†طھط¬ ظˆط§ظ„ط·ظ„ط¨طŒ ط£ظ‚ط¯ط± ط£ظˆطµظ„ظƒ ط¨ظپط±ظٹظ‚ ط§ظ„ط¯ط¹ظ… ظ„ظˆ ظ…ط­طھط§ط¬ طھظپط§طµظٹظ„ ط¯ظ‚ظٹظ‚ط©.";
  return {
    answer: `${opener}طŒ ${line}`,
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
    if (!/ط£ظ†ط§ ظ…ط³ط§ط¹ط¯ ط°ظƒظٹ|ظƒظ†ظ…ظˆط°ط¬ ظ„ط؛ظˆظٹ/i.test(answer)) {
      answer = `${opener}طŒ ${name ? `${name} ` : ""}${price ? `ط³ط¹ط±ظ‡ ${price} ط¬ظ†ظٹظ‡. ` : ""}${valueLine}. ${pick(RESPONSE_VARIANTS.close, message)}`;
    }
  }
  const lengthMode = text(settings.reply_length || "balanced");
  if (lengthMode === "short") {
    answer = answer.split(/\n+/).slice(0, 2).join("\n").split(/(?<=[.!طں])\s+/).slice(0, 2).join(" ").trim();
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
  const customerRejected = ["ظ…ط´ ظ…ظ‡طھظ…", "ظ„ط§ ط´ظƒط±ط§", "ظ„ط§ ط´ظƒط±ظ‹ط§", "stop", "unsubscribe", "ظ…ط´ ط¹ط§ظٹط²"].some((term) => lower(response.answer || metadata.last_customer_message || "").includes(lower(term)));
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

export const loadAiInboxMessages = async ({ tenantId, conversationId, limit = 30, before = "", beforeId = "" } = {}) => {
  await ensureAiSalesAgentSchema();
  await ensureAiInboxSchema();
  const rawConversationId = text(conversationId);
  const safeConversationId = lower(rawConversationId).startsWith("whatsapp:")
    ? normalizeWhatsappSessionId(rawConversationId) || rawConversationId
    : rawConversationId;
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
        if (beforeId) {
          params.push(beforeId);
          return `AND (created_at < $${params.length - 1}::timestamp OR (created_at = $${params.length - 1}::timestamp AND id < $${params.length}::bigint))`;
        }
        return `AND created_at < $${params.length}`;
      })()
    : "";
  const inboxBaseStartedAt = Date.now();
  const result = await db.query(
    `
    WITH ranked_messages AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(message_identity_key, ''), NULLIF(provider_message_id, ''), NULLIF(external_message_id, ''), id::text)
          ORDER BY created_at DESC, id DESC
        ) AS identity_rank
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        ${beforeClause}
    ), paged_messages AS (
      SELECT *
      FROM ranked_messages
      WHERE identity_rank = 1
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    )
    SELECT *
    FROM paged_messages
    ORDER BY created_at ASC, id ASC
    `,
    params
  );
  logAiInboxTiming({
    phase: "inbox_full_base_query",
    startedAt: inboxBaseStartedAt,
    rows: result.rowCount,
    conversations: result.rows.length,
    extra: {
      conversation_id: safeConversationId,
      before: Boolean(before),
      before_id: Boolean(beforeId),
      limit: messageLimit,
    },
  });
  const countResult = await db.query(
    `
    SELECT COUNT(DISTINCT COALESCE(NULLIF(message_identity_key, ''), NULLIF(provider_message_id, ''), NULLIF(external_message_id, ''), id::text))::int AS total
    FROM ai_support_messages
    WHERE tenant_id = $1
      AND session_id = $2
    `,
    [tenantId, safeConversationId]
  );
  const messages = result.rows.map((row) => {
    const canonicalSessionId = lower(row.channel || row.session_id || "").startsWith("whatsapp")
      ? normalizeWhatsappSessionId(row.session_id, row.resolved_phone || row.remote_jid || "")
      : "";
    return normalizeInboxMessage({
      ...row,
      session_id: canonicalSessionId || row.session_id,
      conversation_id: canonicalSessionId || row.session_id,
      conversation_key: canonicalSessionId || row.session_id,
      remote_jid: canonicalSessionId || row.remote_jid || "",
      resolved_reply_jid: canonicalSessionId || row.resolved_reply_jid || "",
    });
  });
  const oldest = messages[0] || null;
  const total = Number(countResult.rows[0]?.total || 0);
  return {
    messages,
    total,
    has_more: before ? messages.length === messageLimit : total > messages.length,
    next_before: oldest?.created_at || "",
  };
};

export const loadAiInbox = async ({ tenantId, filter = "all", channelFilter = "", limit = 50, search = "", messageLimit = 30, summaryOnly = false } = {}) => {
  const loadAiInboxStartedAt = Date.now();
  await ensureAiSalesAgentSchema();
  await ensureAiConversationMemorySchema();
  await ensureAiSupportLogSchema();
  const clauses = ["s.tenant_id = $1"];
  const params = [tenantId, Math.min(1000, Math.max(1, int(limit, 50)))];
  const inboxMessageLimit = summaryOnly ? 1 : Math.min(100, Math.max(1, int(messageLimit, 30)));
  const normalizedFilter = lower(filter || "all");
  const normalizedChannelFilter = lower(channelFilter || "");
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
  if (normalizedChannelFilter === "facebook_comment") {
    clauses.push("(COALESCE(c.channel, s.channel, s.source) = 'facebook_comment' OR COALESCE(c.thread_kind, s.thread_kind, '') = 'comment')");
  }
  if (normalizedChannelFilter === "instagram_comment") {
    clauses.push("(COALESCE(c.channel, s.channel, s.source) = 'instagram_comment' OR COALESCE(c.thread_kind, s.thread_kind, '') = 'comment')");
  }
  if (normalizedChannelFilter === "facebook_messenger") {
    clauses.push("COALESCE(c.channel, s.channel, s.source) = 'facebook_messenger'");
  }
  if (normalizedChannelFilter === "instagram") {
    clauses.push("COALESCE(c.channel, s.channel, s.source) = 'instagram'");
  }
  if (normalizedChannelFilter === "whatsapp") {
    clauses.push("COALESCE(c.channel, s.channel, s.source) = 'whatsapp'");
  }
  if (normalizedChannelFilter === "web_chat") {
    clauses.push("(COALESCE(c.channel, s.channel, s.source) IN ('web_chat', 'web'))");
  }
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
  if (summaryOnly) {
    const summaryStartedAt = Date.now();
    const summaryQuery = `
    SELECT
      s.session_id,
      s.source,
      s.channel AS session_channel,
      s.thread_kind AS thread_kind,
      s.customer_name AS session_customer_name,
      s.customer_avatar_url AS session_customer_avatar_url,
      s.last_message AS session_last_message,
      s.last_ai_reply_draft,
      s.last_ai_reply_draft_updated_at,
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
      c.thread_kind AS channel_thread_kind,
      COALESCE(c.lead_status, 'new') AS lead_status,
      c.customer_avatar_url,
      c.metadata AS channel_metadata,
      COALESCE(c.last_message_at, s.updated_at) AS last_message_at,
      COALESCE(c.read_at, s.read_at) AS read_at,
      m.latest_message_id,
      m.customer_message,
      m.message_text,
      m.ai_answer,
      m.needs_human_support,
      m.sender_type AS latest_sender_type,
      m.message_type,
      m.product_cards,
      m.latest_message_created_at,
      m.external_message_id,
      m.external_reply_id,
      m.delivery_status,
      m.delivery_error,
      m.error_code,
      m.provider_message_id,
      m.confidence
    FROM ai_support_sessions s
    LEFT JOIN ai_channel_conversations c ON c.tenant_id = s.tenant_id AND c.channel = s.channel AND c.external_conversation_id = s.session_id
    LEFT JOIN LATERAL (
      SELECT
        msg.id AS latest_message_id,
        msg.customer_message,
        msg.message_text,
        msg.ai_answer,
        msg.needs_human_support,
        msg.sender_type,
        msg.message_type,
        msg.product_cards,
        msg.created_at AS latest_message_created_at,
        msg.external_message_id,
        msg.external_reply_id,
        msg.delivery_status,
        msg.delivery_error,
        msg.error_code,
        msg.provider_message_id,
        msg.confidence
      FROM ai_support_messages msg
      WHERE msg.tenant_id = s.tenant_id
        AND msg.session_id = s.session_id
      ORDER BY msg.created_at DESC, msg.id DESC
      LIMIT 1
    ) m ON TRUE
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE WHEN COALESCE(c.channel, s.channel, s.source) IN ('facebook_messenger', 'instagram', 'whatsapp') THEN 0 ELSE 1 END,
      COALESCE(c.last_message_at, s.updated_at) DESC,
      s.updated_at DESC
    LIMIT $2
    `;
    const summaryResult = await db.query(summaryQuery, params);
    logAiInboxTiming({
      phase: "inbox_summary_query",
      startedAt: summaryStartedAt,
      rows: summaryResult.rowCount,
      conversations: summaryResult.rows.length,
      extra: {
        filter: normalizedFilter,
        search: Boolean(searchTerm),
        limit: params[1],
        message_limit: inboxMessageLimit,
        total_duration_ms: Date.now() - loadAiInboxStartedAt,
      },
    });

    const normalizedSummaryLeadStatus = (value = "") => {
      const key = lower(value);
      if (key === "negotiation" || key === "follow_up" || key === "followup") return "interested";
      if (key === "lost" || key === "closed") return "new";
      return ["new", "contacted", "interested", "won"].includes(key) ? key : "new";
    };

    const conversations = normalizeAndMergeInboxConversations(summaryResult.rows.map((conversation) => {
    const summaryMessage = conversation.latest_message_id
      ? summarizeInboxMessage(normalizeInboxMessage({
          ...conversation,
          created_at: conversation.latest_message_created_at || conversation.updated_at,
          customer_message: isOutboundMessageRow(conversation) ? "" : conversation.customer_message || conversation.message_text || "",
          message_text: conversation.message_text || conversation.customer_message || "",
          ai_answer: conversation.ai_answer || (isOutboundMessageRow(conversation) ? conversation.message_text || "" : ""),
          sender_type: conversation.latest_sender_type || conversation.sender_type || "",
          message_type: conversation.message_type || "",
          product_cards: conversation.product_cards || [],
          external_message_id: conversation.external_message_id || "",
          external_reply_id: conversation.external_reply_id || "",
          delivery_status: conversation.delivery_status || "",
            delivery_error: conversation.delivery_error || "",
            error_code: conversation.error_code || "",
            provider_message_id: conversation.provider_message_id || "",
            confidence: conversation.confidence || 0,
            needs_human_support: conversation.needs_human_support === true,
          }))
        : null;
      const summaryMessages = summaryMessage ? [summaryMessage] : [];
      const unreadCount = (() => {
        const lastActivityAt = new Date(conversation.last_message_at || conversation.updated_at || 0).getTime() || 0;
        const readAt = new Date(conversation.read_at || 0).getTime() || 0;
        const requiresAttention = conversation.latest_sender_type === "customer" || conversation.needs_human_support === true || conversation.conversation_status === "human_takeover";
        return requiresAttention && (!readAt || lastActivityAt > readAt) ? 1 : 0;
      })();
      const leadStatus = normalizedSummaryLeadStatus(conversation.lead_status || conversation.channel_metadata?.lead_status || "new");
      const leadType = leadTypeFrom({
        memoryScore: 0,
        sentiment: "neutral",
        needsHumanSupport: conversation.needs_human_support === true || conversation.conversation_status === "human_takeover",
        draftCount: 0,
        confirmedCount: 0,
        followupDue: false,
      });
    const channel = canonicalInboxChannel(conversation.channel || conversation.session_channel || conversation.source || "web_chat") || "web_chat";
    const canonicalSessionId = canonicalInboxConversationSessionId(conversation);
    const customerName = resolveConversationDisplayName({ conversation, customerName: conversation.customer_name || "" });
    const customerAvatarUrl = conversation.customer_avatar_url || conversation.session_customer_avatar_url || "";
    const summaryDirection = isOutboundMessageRow(conversation) ? "outbound" : text(conversation.direction || conversation.message_direction || "");
    const summaryCustomerMessage = summaryDirection === "outbound" ? "" : text(conversation.customer_message || conversation.message_text || "");
    const summaryAiAnswer = summaryDirection === "outbound" ? text(conversation.ai_answer || conversation.message_text || conversation.staff_message || "") : text(conversation.ai_answer || "");
    const summaryStaffMessage = text(conversation.staff_message || "");
    const summaryMessageText = text(conversation.message_text || conversation.customer_message || conversation.ai_answer || conversation.staff_message || conversation.session_last_message || "");
    const summaryPreviewMessage = summaryCustomerMessage || summaryAiAnswer || summaryStaffMessage || summaryMessageText || conversation.session_last_message || "";
    return {
      session_id: canonicalSessionId || conversation.session_id,
      conversation_id: canonicalSessionId || conversation.session_id,
      conversation_key: canonicalSessionId || conversation.conversation_key || conversation.session_id,
      source: conversation.source || channel || "web_chat",
      channel,
      direction: summaryDirection || conversation.direction || conversation.message_direction || "",
      status: conversation.conversation_status || "ai_active",
      conversation_status: conversation.conversation_status || "ai_active",
        thread_kind: conversation.thread_kind || "",
        assigned_to: conversation.assigned_user_id || conversation.assigned_user_name
          ? { id: conversation.assigned_user_id || null, name: conversation.assigned_user_name || "" }
          : null,
        assigned_user: conversation.assigned_user_id || conversation.assigned_user_name
          ? { id: conversation.assigned_user_id || null, name: conversation.assigned_user_name || "" }
          : null,
        ai_enabled: conversation.ai_enabled !== false,
        ai_paused: ["human_takeover", "closed"].includes(conversation.conversation_status),
        human_takeover: conversation.conversation_status === "human_takeover",
        needs_human_support: conversation.needs_human_support === true,
        hot_lead: false,
        escalation_reason: conversation.escalation_reason || "",
        ai_escalation_reason: conversation.escalation_reason || "",
        last_escalation_keyword: conversation.last_escalation_keyword || "",
        escalated_at: conversation.escalated_at || null,
        takeover_started_at: conversation.takeover_started_at,
        returned_to_ai_at: conversation.returned_to_ai_at,
        closed_at: conversation.closed_at,
        customer_name: customerName,
        customer_avatar_url: customerAvatarUrl,
        phone: "",
        sender_name: "",
        profile_name: "",
        contact_name: "",
        external_customer_id: conversation.external_customer_id || "",
        external_conversation_id: canonicalSessionId || conversation.external_conversation_id || conversation.session_id,
        last_message: summaryPreviewMessage,
        latest_message_preview: summaryPreviewMessage,
        last_message_at: conversation.last_message_at || conversation.updated_at,
        updated_at: conversation.updated_at,
        last_activity_at: conversation.last_message_at || conversation.updated_at,
        unread_count: unreadCount,
        unread: unreadCount > 0,
        waiting: false,
        lead_status: leadStatus,
        lead_type: leadType,
        lead_badge: leadBadgeKey(leadType),
        tags: [],
        status_flags: {
          ai_enabled: conversation.ai_enabled !== false,
          ai_paused: ["human_takeover", "closed"].includes(conversation.conversation_status),
          human_takeover: conversation.conversation_status === "human_takeover",
          needs_human_support: conversation.needs_human_support === true,
          hot_lead: false,
          waiting: false,
        },
        channel_metadata: conversation.channel_metadata || {},
        customer_profile: {
          name: customerName,
          avatar_url: customerAvatarUrl,
          phone: "",
          external_customer_id: conversation.external_customer_id || "",
        },
        message_count: summaryMessages.length,
        preview_message: summaryPreviewMessage,
        messages: summaryMessages,
        older_messages_available: summaryMessages.length > 0,
        next_messages_before: summaryMessages[0]?.created_at || "",
        anyFullMessages: false,
      };
    }));
    logAiInboxConversationFilterDebug({
      phase: "summary",
      requestedFilter: normalizedFilter,
      requestedChannelFilter: normalizedChannelFilter,
      rowsBeforeFilter: summaryResult.rowCount,
      rowsAfterFilter: conversations.length,
      conversations: summaryResult.rows,
    });
    logAiInboxTiming({
      phase: "inbox_summary_build",
      startedAt: summaryStartedAt,
      rows: summaryResult.rowCount,
      conversations: conversations.length,
      extra: {
        unread_count: conversations.reduce((total, item) => total + Number(item.unread_count || 0), 0),
        total_duration_ms: Date.now() - loadAiInboxStartedAt,
      },
    });
    return { conversations, followups: [], anyFullMessages: false };
  }
  const result = await db.query(
    `
    WITH latest_interaction AS (
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
      s.thread_kind AS thread_kind,
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
      c.thread_kind AS channel_thread_kind,
      COALESCE(c.lead_status, 'new') AS lead_status,
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
      COALESCE(c.read_at, s.read_at) AS read_at,
      e.last_webhook_event_at,
      e.last_webhook_status,
      m.customer_message,
      m.id AS latest_message_id,
      m.message_text,
      m.channel AS message_channel,
      m.sender_type AS latest_sender_type,
      m.ai_answer,
      m.confidence,
      m.needs_human_support,
      m.detected_intent,
      m.suggested_products,
      m.visual_attachments,
      m.external_message_id,
      m.external_reply_id,
      m.dedupe_key,
      m.delivery_status,
      m.delivery_error,
      m.error_code,
      m.provider_message_id,
      m.whatsapp_instance,
      m.remote_jid,
      m.resolved_reply_jid,
      m.resolved_phone,
      m.source_path,
      m.insert_source,
      m.message_type,
      m.product_cards,
      m.created_at AS latest_message_created_at,
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
    LEFT JOIN LATERAL (
      SELECT msg.*
      FROM ai_support_messages msg
      WHERE msg.tenant_id = s.tenant_id
        AND msg.session_id = s.session_id
      ORDER BY msg.created_at DESC, msg.id DESC
      LIMIT 1
    ) m ON TRUE
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
  const conversations = normalizeAndMergeInboxConversations(result.rows);
  logAiInboxConversationFilterDebug({
    phase: "full",
    requestedFilter: normalizedFilter,
    requestedChannelFilter: normalizedChannelFilter,
    rowsBeforeFilter: result.rowCount,
    rowsAfterFilter: conversations.length,
    conversations: result.rows,
  });
  const sessionIds = conversations.map((item) => item.session_id).filter(Boolean);
  const profileIds = conversations.map((item) => item.profile_id).filter(Boolean);
  const messageTotalsBySession = new Map();
  let messagesResult = { rows: [] };
  let memoriesResult = { rows: [] };
  let draftsResult = { rows: [] };
  let conversationFollowupsResult = { rows: [] };
  let salesStatesResult = { rows: [] };
  let salesJourneyEventsResult = { rows: [] };

  if (sessionIds.length) {
    if (summaryOnly) {
      const inboxSummaryDetailsStartedAt = Date.now();
      const [latestMessagesResult, totalsResult] = await Promise.all([
        (async () => {
          const startedAt = Date.now();
          const result = await db.query(
          `
          SELECT DISTINCT ON (msg.session_id) msg.*
          FROM ai_support_messages msg
          WHERE msg.tenant_id = $1
            AND msg.session_id = ANY($2::text[])
          ORDER BY msg.session_id, msg.created_at DESC, msg.id DESC
          `,
          [tenantId, sessionIds]
        );
          logAiInboxTiming({
            phase: "inbox_summary_messages",
            startedAt,
            rows: result.rowCount,
            conversations: sessionIds.length,
            extra: {
              latest_only: true,
            },
          });
          return result;
        })(),
        (async () => {
          const startedAt = Date.now();
          const result = await db.query(
          `
          SELECT session_id, COUNT(*)::int AS total_messages
          FROM ai_support_messages
          WHERE tenant_id = $1
            AND session_id = ANY($2::text[])
          GROUP BY session_id
          `,
          [tenantId, sessionIds]
        );
          logAiInboxTiming({
            phase: "inbox_summary_counts",
            startedAt,
            rows: result.rowCount,
            conversations: sessionIds.length,
          });
          return result;
        })(),
      ]);
      messagesResult = latestMessagesResult;
      totalsResult.rows.forEach((row) => {
        messageTotalsBySession.set(row.session_id, Number(row.total_messages || 0));
      });
      logAiInboxTiming({
        phase: "inbox_summary_details",
        startedAt: inboxSummaryDetailsStartedAt,
        rows: latestMessagesResult.rowCount + totalsResult.rowCount,
        conversations: sessionIds.length,
        extra: {
          latest_messages_rows: latestMessagesResult.rowCount,
          totals_rows: totalsResult.rowCount,
        },
      });
  } else {
    const inboxHydrationStartedAt = Date.now();
      [messagesResult, memoriesResult, draftsResult, conversationFollowupsResult] = await Promise.all([
        (async () => {
          const startedAt = Date.now();
          const result = await db.query(
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
        );
          logAiInboxTiming({
            phase: "inbox_full_messages",
            startedAt,
            rows: result.rowCount,
            conversations: sessionIds.length,
            extra: {
              message_limit: inboxMessageLimit,
            },
          });
          return result;
        })(),
        profileIds.length
          ? (async () => {
              const startedAt = Date.now();
              const result = await db.query(
            `
            SELECT *
            FROM ai_customer_memories
            WHERE tenant_id = $1 AND profile_id = ANY($2::bigint[])
            ORDER BY last_seen_at DESC, created_at DESC
            LIMIT 300
            `,
            [tenantId, profileIds]
          );
              logAiInboxTiming({
                phase: "inbox_full_profiles",
                startedAt,
                rows: result.rowCount,
                conversations: profileIds.length,
              });
              return result;
            })()
          : Promise.resolve({ rows: [] }),
        (async () => {
          const startedAt = Date.now();
          const result = await db.query(
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
        );
          logAiInboxTiming({
            phase: "inbox_full_drafts",
            startedAt,
            rows: result.rowCount,
            conversations: sessionIds.length,
          });
          return result;
        })(),
        (async () => {
          const startedAt = Date.now();
          const result = await db.query(
          `
          SELECT *
          FROM ai_followup_tasks
          WHERE tenant_id = $1 AND session_id = ANY($2::text[])
          ORDER BY scheduled_at DESC
          `,
          [tenantId, sessionIds]
        );
          logAiInboxTiming({
            phase: "inbox_full_followups",
            startedAt,
            rows: result.rowCount,
            conversations: sessionIds.length,
          });
          return result;
        })(),
      ]);
      logAiInboxTiming({
        phase: "inbox_full_hydration",
        startedAt: inboxHydrationStartedAt,
        rows: messagesResult.rowCount + memoriesResult.rowCount + draftsResult.rowCount + conversationFollowupsResult.rowCount,
        conversations: sessionIds.length,
        extra: {
          messages_rows: messagesResult.rowCount,
          memories_rows: memoriesResult.rowCount,
          drafts_rows: draftsResult.rowCount,
          followup_rows: conversationFollowupsResult.rowCount,
        },
      });
    }
  }

  if (!summaryOnly && sessionIds.length) {
    const salesJoinsStartedAt = Date.now();
    [salesStatesResult, salesJourneyEventsResult] = await Promise.all([
      (async () => {
        const startedAt = Date.now();
        const result = await db.query(
        `
        SELECT *
        FROM ai_sales_conversation_states
        WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])
        `,
        [tenantId, sessionIds]
      ).catch(() => ({ rows: [] }));
        logAiInboxTiming({
          phase: "inbox_sales_states",
          startedAt,
          rows: result.rowCount,
          conversations: sessionIds.length,
        });
        return result;
      })(),
      (async () => {
        const startedAt = Date.now();
        const result = await db.query(
        `
        SELECT *
        FROM ai_sales_journey_events
        WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])
        ORDER BY created_at DESC, id DESC
        LIMIT 500
        `,
        [tenantId, sessionIds]
      ).catch(() => ({ rows: [] }));
        logAiInboxTiming({
          phase: "inbox_sales_journey",
          startedAt,
          rows: result.rowCount,
          conversations: sessionIds.length,
        });
        return result;
      })(),
    ]);
    logAiInboxTiming({
      phase: "inbox_sales_joins",
      startedAt: salesJoinsStartedAt,
      rows: salesStatesResult.rowCount + salesJourneyEventsResult.rowCount,
      conversations: sessionIds.length,
      extra: {
        sales_states_rows: salesStatesResult.rowCount,
        sales_journey_rows: salesJourneyEventsResult.rowCount,
      },
    });
  }

  const messagesBySession = new Map();
  messagesResult.rows.forEach((row) => {
    const list = messagesBySession.get(row.session_id) || [];
    list.push(normalizeInboxMessage(row));
    messagesBySession.set(row.session_id, list);
    messageTotalsBySession.set(row.session_id, Number(row.total_messages || messageTotalsBySession.get(row.session_id) || list.length));
  });
  if (summaryOnly) {
    for (const [sessionId, totalMessages] of messageTotalsBySession.entries()) {
      if (!messagesBySession.has(sessionId)) {
        messagesBySession.set(sessionId, []);
      }
      if (!Number.isFinite(totalMessages)) {
        messageTotalsBySession.set(sessionId, 0);
      }
    }
  }
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
  const followups = summaryOnly
    ? { rows: [] }
    : await db.query(
      `
      SELECT *
      FROM ai_followup_tasks
      WHERE tenant_id = $1
      ORDER BY scheduled_at DESC
      LIMIT 30
      `,
      [tenantId]
    );

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

  const enrichedStartedAt = Date.now();
  const enriched = await Promise.all(conversations.map(async (conversation) => {
    const memories = summaryOnly ? [] : (memoriesByProfile.get(conversation.profile_id) || []);
    const messages = messagesBySession.get(conversation.session_id) || [];
    const totalMessages = messageTotalsBySession.get(conversation.session_id) || messages.length;
    const draftOrders = draftsBySession.get(conversation.session_id) || [];
    const conversationFollowups = followupsBySession.get(conversation.session_id) || [];
    const currentStateRow = salesStateByConversation.get(conversation.session_id) || null;
    const existingJourneyEvents = salesJourneyEventsByConversation.get(conversation.session_id) || [];
    const hydratedConversation = await hydrateMessengerInboxConversation({ tenantId, conversation });
    if (hydratedConversation && hydratedConversation !== conversation) {
      Object.assign(conversation, hydratedConversation);
    }
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
    if (text(conversation.external_conversation_id || conversation.session_id || "") === DEBUG_MESSENGER_INBOX_CONVERSATION_ID) {
      console.log("messenger_inbox_final_response_row", {
        tenant_id: tenantId,
        conversation_id: conversation.external_conversation_id || conversation.session_id || "",
        session_id: conversation.session_id || "",
        customer_name: text(customerProfile.name || ""),
        customer_avatar_url: text(customerProfile.avatar_url || ""),
        customer_profile_name: text(customerProfile.name || ""),
        customer_profile_avatar: text(customerProfile.avatar_url || ""),
        top_level_customer_name: text(conversation.customer_name || ""),
        top_level_customer_avatar_url: text(conversation.customer_avatar_url || ""),
      });
    }
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
    const summaryMessages = summaryOnly ? messages.slice(0, 1).map(summarizeInboxMessage) : messages;
    console.info("[ai-inbox:load-conversation-summary]", {
      tenantId,
      conversation_id: conversation.session_id || "",
      summary_only: summaryOnly,
      total_messages: totalMessages,
      summary_messages: summaryMessages.length,
    });
    const salesIntelligence = summaryOnly
      ? {
          state: {
            current_state: currentStateRow?.current_state || "DISCOVERY",
            previous_state: currentStateRow?.previous_state || "",
            state_reason: currentStateRow?.state_reason || "",
            confidence: Number(currentStateRow?.confidence ?? 0.5) || 0.5,
            updated_at: currentStateRow?.updated_at || new Date().toISOString(),
            channel: conversation.channel || conversation.source || "web_chat",
            customer_id: conversation.external_customer_id || "",
            conversation_id: conversation.session_id || "",
            badge: buildSalesStateBadge({
              current_state: currentStateRow?.current_state || "DISCOVERY",
              state_reason: currentStateRow?.state_reason || "",
              confidence: Number(currentStateRow?.confidence ?? 0.5) || 0.5,
            }),
            discovery_questions: [],
          },
          journeyEvents: [],
          conversion: { score: 0, level: "low", reasons: [], risk_flags: [], recommended_action: "CONTINUE_CONVERSATION" },
          followUp: { follow_up_needed: false, follow_up_reason: "", suggested_follow_up_message: "", suggested_follow_up_at: "" },
          crossSellSuggestions: [],
          closer: { last_closer_action: "", last_closer_at: "", recommended_action: "CONTINUE", suggested_message: "", reasons: [], should_offer_closer: false },
        }
      : await buildSalesConversationIntelligence({
          tenantId,
          conversation: {
            ...conversation,
            customer_profile: customerProfile,
            current_product: selectedProduct,
            product: selectedProduct,
            ai_memory: conversationAiMemory,
          },
          messages: summaryMessages,
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
          journeyEvents: [],
          conversion: { score: 0, level: "low", reasons: [], risk_flags: [], recommended_action: "CONTINUE_CONVERSATION" },
          followUp: { follow_up_needed: false, follow_up_reason: "", suggested_follow_up_message: "", suggested_follow_up_at: "" },
          crossSellSuggestions: [],
          closer: { last_closer_action: "", last_closer_at: "", recommended_action: "CONTINUE", suggested_message: "", reasons: [], should_offer_closer: false },
        }));
    const resolvedChannel = text(conversation.channel || conversation.session_channel || conversation.source);
    const isMessengerConversation = ["facebook_messenger", "facebook", "messenger"].includes(lower(resolvedChannel));
    const messengerDisplayName = isMessengerConversation ? resolveConversationDisplayName({ conversation, customerName: conversation.customer_name || "" }) : "";
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
    if (summaryOnly) {
      const normalizeSummaryLeadStatus = (value = "") => {
        const key = text(value).toLowerCase();
        if (key === "negotiation" || key === "follow_up" || key === "followup") return "interested";
        if (key === "lost" || key === "closed") return "new";
        return ["new", "contacted", "interested", "won"].includes(key) ? key : "new";
      };
      const metadata = conversation.channel_metadata || {};
      const leadMetadata = metadata && typeof metadata === "object" ? (metadata.lead || {}) : {};
      const assignedTo = conversation.assigned_user_id || conversation.assigned_user_name
        ? {
            id: conversation.assigned_user_id || null,
            name: conversation.assigned_user_name || "",
          }
          : null;
      const leadStatus = normalizeSummaryLeadStatus(
        conversation.lead_status ||
        metadata.lead_status ||
        leadMetadata.status ||
        leadMetadata.lead_status ||
        "new"
      );
      const lastMessagePreview = conversation.customer_message || conversation.message_text || conversation.ai_answer || conversation.session_last_message || "";
      const unreadCount = (() => {
        const lastActivityAt = new Date(conversation.last_message_at || conversation.updated_at || 0).getTime() || 0;
        const readAt = new Date(conversation.read_at || 0).getTime() || 0;
        const requiresAttention = conversation.latest_sender_type === "customer" || conversation.needs_human_support === true || conversation.conversation_status === "human_takeover";
        return requiresAttention && (!readAt || lastActivityAt > readAt) ? 1 : 0;
      })();
      const conversationSessionId = canonicalInboxConversationSessionId(conversation);
      return {
        session_id: conversationSessionId || conversation.session_id,
        conversation_id: conversationSessionId || conversation.session_id,
        conversation_key: conversationSessionId || conversation.conversation_key || conversation.session_id,
        source: conversation.source || conversation.channel || "web_chat",
        channel: channel,
        status: conversation.conversation_status || "ai_active",
        conversation_status: conversation.conversation_status || "ai_active",
        thread_kind: conversation.thread_kind || "",
        assigned_to: assignedTo,
        assigned_user: assignedTo,
        ai_enabled: conversation.ai_enabled !== false,
        ai_paused: ["human_takeover", "closed"].includes(conversation.conversation_status),
        human_takeover: conversation.conversation_status === "human_takeover",
        needs_human_support: conversation.needs_human_support === true,
        hot_lead: conversation.hot_lead === true,
        escalation_reason: conversation.escalation_reason || "",
        ai_escalation_reason: conversation.escalation_reason || "",
        last_escalation_keyword: conversation.last_escalation_keyword || "",
        escalated_at: conversation.escalated_at || null,
        takeover_started_at: conversation.takeover_started_at,
        returned_to_ai_at: conversation.returned_to_ai_at,
        closed_at: conversation.closed_at,
        customer_name: messengerDisplayName || customerProfile.name || "",
        display_name: messengerDisplayName || customerProfile.display_name || customerProfile.name || "",
        participant_name: messengerDisplayName || customerProfile.display_name || customerProfile.name || "",
        customer_avatar_url: customerProfile.avatar_url || conversation.customer_avatar_url || "",
        phone: customerProfile.phone || conversation.phone || "",
        sender_name: isMessengerConversation ? messengerDisplayName : conversation.sender_name || "",
        profile_name: isMessengerConversation ? messengerDisplayName : conversation.profile_name || "",
        contact_name: isMessengerConversation ? messengerDisplayName : conversation.contact_name || "",
        external_customer_id: conversation.external_customer_id || "",
        external_conversation_id: conversationSessionId || conversation.external_conversation_id || conversation.session_id,
        last_message: lastMessagePreview,
        latest_message_preview: lastMessagePreview,
        last_message_at: conversation.last_message_at || conversation.updated_at,
        updated_at: conversation.updated_at,
        last_activity_at: conversation.last_message_at || conversation.updated_at,
        unread_count: unreadCount,
        unread: unreadCount > 0,
        waiting: conversation.due_followup_count > 0 || (conversation.updated_at && Date.now() - new Date(conversation.updated_at).getTime() > 15 * 60 * 1000),
        lead_status: leadStatus,
        lead_type: leadType,
        lead_badge: leadBadgeKey(leadType),
        tags: Array.isArray(conversation.tags) ? conversation.tags.slice(0, 10) : [],
        status_flags: {
          ai_enabled: conversation.ai_enabled !== false,
          ai_paused: ["human_takeover", "closed"].includes(conversation.conversation_status),
          human_takeover: conversation.conversation_status === "human_takeover",
          needs_human_support: conversation.needs_human_support === true,
          hot_lead: conversation.hot_lead === true,
          waiting: conversation.due_followup_count > 0 || (conversation.updated_at && Date.now() - new Date(conversation.updated_at).getTime() > 15 * 60 * 1000),
        },
        channel_metadata: {
          assigned_employee_id: text(metadata.assigned_employee_id || ""),
          page_id: text(metadata.page_id || ""),
          instagram_business_account_id: text(metadata.instagram_business_account_id || ""),
          comment_id: text(metadata.comment_id || leadMetadata.comment_id || conversation.external_comment_id || conversation.comment_id || ""),
          thread_kind: text(metadata.thread_kind || conversation.thread_kind || ""),
        },
        customer_profile: {
          name: customerProfile.name || "",
          avatar_url: customerProfile.avatar_url || conversation.customer_avatar_url || "",
          phone: customerProfile.phone || conversation.phone || "",
          external_customer_id: customerProfile.external_customer_id || conversation.external_customer_id || "",
        },
        message_count: totalMessages,
        preview_message: lastMessagePreview,
        messages: summaryMessages,
        message_count: totalMessages,
        older_messages_available: totalMessages > summaryMessages.length,
        next_messages_before: summaryMessages[0]?.created_at || "",
        anyFullMessages: false,
      };
    }
    return {
      ...conversation,
      source: conversation.source || conversation.channel || "web_chat",
      channel: canonicalInboxChannel(conversation.channel || conversation.session_channel || conversation.source || "web_chat") || "web_chat",
      customer_name: messengerDisplayName || customerProfile.name || "",
      display_name: messengerDisplayName || customerProfile.display_name || customerProfile.name || "",
      participant_name: messengerDisplayName || customerProfile.display_name || customerProfile.name || "",
      sender_name: isMessengerConversation ? messengerDisplayName : conversation.sender_name || "",
      profile_name: isMessengerConversation ? messengerDisplayName : conversation.profile_name || "",
      contact_name: isMessengerConversation ? messengerDisplayName : conversation.contact_name || "",
      external_sender_name: conversation.external_sender_name || "",
      external_contact_name: conversation.external_contact_name || "",
      customer_avatar_url: customerProfile.avatar_url || conversation.customer_avatar_url || "",
      last_message: conversation.customer_message || conversation.message_text || conversation.session_last_message || "",
      latest_message_preview: conversation.customer_message || conversation.message_text || conversation.ai_answer || conversation.session_last_message || "",
      external_customer_id: conversation.external_customer_id || "",
      external_conversation_id: canonicalInboxConversationSessionId(conversation) || conversation.external_conversation_id || conversation.session_id,
      is_live_meta: ["facebook_messenger", "instagram"].includes(canonicalInboxChannel(conversation.channel || conversation.session_channel || conversation.source || "")),
      live_badge: ["facebook_messenger", "instagram"].includes(canonicalInboxChannel(conversation.channel || conversation.session_channel || conversation.source || "")) ? "Live Meta" : "",
      last_message_at: conversation.last_message_at || conversation.updated_at,
      last_webhook_event_at: conversation.last_webhook_event_at || null,
      last_webhook_status: conversation.last_webhook_status || "",
      channel_metadata: conversation.channel_metadata || {},
      ai_reply_draft: normalizeAiReplyDraft(conversation.last_ai_reply_draft || {}),
      last_ai_reply_draft_updated_at: conversation.last_ai_reply_draft_updated_at || null,
      ai_memory: conversationAiMemory,
      current_product: selectedProduct,
      product: selectedProduct,
      detected_intent: projectedCurrentIntent || conversation.detected_intent || "",
      current_intent: projectedCurrentIntent || conversation.detected_intent || "",
      customer_profile: customerProfile,
      messages: summaryMessages,
      message_count: totalMessages,
      older_messages_available: totalMessages > summaryMessages.length,
      next_messages_before: summaryMessages[0]?.created_at || "",
      memories,
      followups: conversationFollowups,
      draft_orders: draftOrders,
      draft_order: draftOrders[0] || null,
      sales_conversation_state: salesIntelligence.state,
      sales_journey_events: summaryOnly ? [] : salesIntelligence.journeyEvents,
      conversion_probability: salesIntelligence.conversion,
      follow_up_recommendation: salesIntelligence.followUp,
      cross_sell_suggestions: salesIntelligence.crossSellSuggestions,
      proactive_closer: salesIntelligence.closer,
      sales_intelligence: salesIntelligence,
      system_events: summaryOnly ? systemEvents.slice(0, 3) : systemEvents,
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
      unread: (() => {
        const lastActivityAt = new Date(conversation.last_message_at || conversation.updated_at || 0).getTime() || 0;
        const readAt = new Date(conversation.read_at || 0).getTime() || 0;
        const requiresAttention = conversation.latest_sender_type === "customer" || conversation.needs_human_support === true || conversation.conversation_status === "human_takeover";
        return requiresAttention && (!readAt || lastActivityAt > readAt);
      })(),
      waiting: conversation.due_followup_count > 0 || (conversation.updated_at && Date.now() - new Date(conversation.updated_at).getTime() > 15 * 60 * 1000),
      last_activity_at: conversation.last_message_at || conversation.updated_at,
    };
  }));
  logAiInboxTiming({
    phase: "inbox_enriched_build",
    startedAt: enrichedStartedAt,
    rows: enriched.length,
    conversations: enriched.length,
  });
  return { conversations: enriched, followups: followups.rows, anyFullMessages: false };
};

const followupSuggestedMessage = (task = {}, settings = DEFAULT_SETTINGS) => {
  const payload = task.payload || {};
  const products = asArray(payload.products);
  const productName = text(products[0]?.name || products[0]?.title || products[0]?.product_name);
  const template = asArray(settings.followup_templates).find(Boolean) || DEFAULT_SETTINGS.followup_templates[0];
  if (text(task.manual_message)) return text(task.manual_message);
  if (text(payload.suggested_message || payload.followup_message)) return text(payload.suggested_message || payload.followup_message);
  if (productName) return `ظ„ط³ظ‡ ظ…ظ‡طھظ… ط¨ظ€ ${productName}طں ط£ظ‚ط¯ط± ط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط§ظ„ظ…طھط§ط­ ظˆط£ظ‚ظˆظ„ظƒ ط§ظ„ط³ط¹ط± ط§ظ„ط­ظ‚ظٹظ‚ظٹ ظ‚ط¨ظ„ ظ…ط§ ظ†ظƒظ…ظ„.`;
  if (text(template)) return text(template);
  return "ظ„ط³ظ‡ ظ…ظ‡طھظ… ط¨ط§ظ„ظ…ظ†طھط¬طں ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ط£ظˆ ط§ظ„ظ„ظˆظ† ط§ظ„ظ…ط·ظ„ظˆط¨ ظˆط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…طھط§ط­ ظ‚ط¨ظ„ ظ…ط§ ظ†ظƒظ…ظ„.";
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

const shadowConfidenceBucket = (score = 0) => {
  const value = Math.max(0, Math.min(100, numeric(score, 0)));
  if (value <= 25) return "0-25";
  if (value <= 50) return "26-50";
  if (value <= 75) return "51-75";
  return "76-100";
};

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

export const loadAiShadowAnalytics = async ({ tenantId, fromDate: rawFromDate = "", toDate: rawToDate = "" } = {}) => {
  await ensureAiSupportLogSchema();
  await ensureCorrectionMemorySchema();
  const fromDate = parseDateFilter(rawFromDate);
  const toDate = parseDateFilter(rawToDate);
  const params = [tenantId];
  const clauses = ["s.tenant_id = $1"];
  if (fromDate) {
    params.push(fromDate);
    clauses.push(`COALESCE(s.last_ai_reply_draft_updated_at, s.updated_at) >= $${params.length}::timestamp`);
  }
  if (toDate) {
    params.push(toDate);
    clauses.push(`COALESCE(s.last_ai_reply_draft_updated_at, s.updated_at) <= $${params.length}::timestamp`);
  }

  const result = await db.query(
    `
    SELECT
      s.session_id AS conversation_id,
      COALESCE(c.channel, s.channel, s.source, 'web_chat') AS channel,
      s.last_ai_reply_draft,
      s.last_ai_reply_draft_updated_at,
      s.updated_at
    FROM ai_support_sessions s
    LEFT JOIN ai_channel_conversations c
      ON c.tenant_id = s.tenant_id
     AND c.channel = s.channel
     AND c.external_conversation_id = s.session_id
    WHERE ${clauses.join(" AND ")}
      AND COALESCE(s.last_ai_reply_draft, '{}'::jsonb) <> '{}'::jsonb
      AND jsonb_typeof(COALESCE(s.last_ai_reply_draft, '{}'::jsonb) -> 'metadata' -> 'auto_reply_shadow') = 'object'
    ORDER BY COALESCE(s.last_ai_reply_draft_updated_at, s.updated_at) DESC, s.session_id DESC
    `,
    params
  );

  const drafts = result.rows
    .map((row) => {
      const draft = normalizeAiReplyDraft(row.last_ai_reply_draft || {});
      const shadow = draft?.metadata?.auto_reply_shadow && typeof draft.metadata.auto_reply_shadow === "object"
        ? draft.metadata.auto_reply_shadow
        : {};
      const blockers = asArray(shadow.blockers).map((item) => text(item)).filter(Boolean);
      const intent = text(shadow.intent || draft.detected_intent || draft.intent || "");
      const safetyIntent = text(shadow.safety_intent || "");
      const confidenceScore = numeric(
        shadow.confidence_score ?? draft.confidence_engine?.score ?? draft.confidence ?? 0,
        0
      );
      const confidenceLevel = text(
        shadow.confidence_level || draft.confidence_engine?.level || draft.confidence_level || ""
      ) || "unknown";
      const decision = text(shadow.decision || draft.confidence_engine?.decision || "") || "unknown";
      const eligible = shadow.eligible === true || shadow.eligibility_result === true;
      const validationViolationsCount = int(draft.validation?.violations_count ?? 0, 0);
      return {
        conversation_id: row.conversation_id,
        channel: text(row.channel || "web_chat"),
        intent,
        safety_intent: safetyIntent,
        confidence_score: confidenceScore,
        confidence_level: confidenceLevel,
        decision,
        eligible,
        blockers,
        created_at: row.last_ai_reply_draft_updated_at || draft.updated_at || row.updated_at || null,
        validator_violations_count: validationViolationsCount,
      };
    })
    .filter((item) => Boolean(item.conversation_id));

  const totalDrafts = drafts.length;
  const eligibleCount = drafts.filter((draft) => draft.eligible === true).length;
  const reviewCount = drafts.filter((draft) => draft.decision === "review").length;
  const humanRequiredCount = drafts.filter((draft) => draft.decision === "human_required").length;
  const safetyBlockedCount = drafts.filter((draft) => Boolean(draft.safety_intent)).length;
  const validatorViolationsCount = drafts.reduce((total, draft) => total + Number(draft.validator_violations_count || 0), 0);
  const validatorViolationDraftRate = totalDrafts ? drafts.filter((draft) => Number(draft.validator_violations_count || 0) > 0).length / totalDrafts : 0;

  const intentCounts = new Map();
  const safetyIntentCounts = new Map();
  const blockerCounts = new Map();
  const channelCounts = new Map();
  const confidenceBuckets = new Map([
    ["0-25", 0],
    ["26-50", 0],
    ["51-75", 0],
    ["76-100", 0],
  ]);

  for (const draft of drafts) {
    if (draft.intent) intentCounts.set(draft.intent, (intentCounts.get(draft.intent) || 0) + 1);
    if (draft.safety_intent) safetyIntentCounts.set(draft.safety_intent, (safetyIntentCounts.get(draft.safety_intent) || 0) + 1);
    if (draft.channel) channelCounts.set(draft.channel, (channelCounts.get(draft.channel) || 0) + 1);
    const bucket = shadowConfidenceBucket(draft.confidence_score);
    confidenceBuckets.set(bucket, (confidenceBuckets.get(bucket) || 0) + 1);
    for (const blocker of draft.blockers) {
      blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
    }
  }

  const toRankedRows = (entries, keyName) =>
    [...entries]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, 10)
      .map(([name, count]) => ({ [keyName]: name, count }));

  const correctionsCountResult = drafts.length
    ? await db.query(
        `
        SELECT COUNT(*)::int AS count
        FROM ai_reply_corrections c
        WHERE c.tenant_id = $1
          AND c.conversation_id = ANY($2::text[])
          ${fromDate ? `AND c.created_at >= $3::timestamp` : ""}
          ${toDate ? `AND c.created_at <= $${fromDate ? 4 : 3}::timestamp` : ""}
        `,
        fromDate || toDate
          ? [
              tenantId,
              drafts.map((draft) => draft.conversation_id),
              ...(fromDate ? [fromDate] : []),
              ...(toDate ? [toDate] : []),
            ]
          : [tenantId, drafts.map((draft) => draft.conversation_id)]
      )
    : { rows: [{ count: 0 }] };

  const correctionsCount = numeric(correctionsCountResult.rows[0]?.count, 0);
  const eligibilityRate = totalDrafts ? eligibleCount / totalDrafts : 0;
  const correctionRate = totalDrafts ? correctionsCount / totalDrafts : 0;
  const safetyBlockRate = totalDrafts ? safetyBlockedCount / totalDrafts : 0;
  const validatorViolationRate = totalDrafts ? validatorViolationDraftRate : 0;
  const pilotReadinessScore = Math.max(0, Math.min(100, Math.round(
    (eligibilityRate * 100)
    - (correctionRate * 80)
    - (safetyBlockRate * 60)
    - (validatorViolationRate * 40)
  )));
  const pilotReadinessState = (() => {
    if (!totalDrafts || eligibleCount === 0) return "not_ready";
    if (
      eligibilityRate >= 0.7 &&
      correctionRate <= 0.05 &&
      safetyBlockRate <= 0.15 &&
      validatorViolationRate <= 0.15 &&
      pilotReadinessScore >= 80
    ) return "pilot_ready";
    if (
      eligibilityRate >= 0.45 &&
      correctionRate <= 0.12 &&
      safetyBlockRate <= 0.25 &&
      validatorViolationRate <= 0.25 &&
      pilotReadinessScore >= 55
    ) return "monitor";
    return "not_ready";
  })();

  return {
    total_drafts: totalDrafts,
    eligible_count: eligibleCount,
    review_count: reviewCount,
    human_required_count: humanRequiredCount,
    eligibility_rate: eligibilityRate,
    top_intents: toRankedRows(intentCounts, "intent"),
    top_safety_intents: toRankedRows(safetyIntentCounts, "safety_intent"),
    top_blockers: toRankedRows(blockerCounts, "blocker"),
    confidence_distribution: [...confidenceBuckets.entries()].map(([bucket, count]) => ({ bucket, count })),
    corrections_count: correctionsCount,
    channels_breakdown: toRankedRows(channelCounts, "channel"),
    safety_blocks_count: safetyBlockedCount,
    validator_violations_count: validatorViolationsCount,
    validator_violation_rate: validatorViolationRate,
    correction_rate: correctionRate,
    pilot_readiness_score: pilotReadinessScore,
    pilot_readiness_state: pilotReadinessState,
    pilot_readiness_formula: "score = clamp(round(eligible_rate*100 - correction_rate*80 - safety_block_rate*60 - validator_violation_rate*40), 0, 100)",
    drafts,
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

const logAiInboxTiming = ({ phase, startedAt, rows = null, conversations = null, extra = {} } = {}) => {
  console.log("[ai-inbox][timing]", {
    phase,
    duration_ms: Date.now() - startedAt,
    rows,
    conversations,
    ...extra,
  });
};

const realProductPrice = (product = {}) => {
  const resolved = resolveCustomerDisplayPrice(product);
  const raw = numeric(product.final_price || product.sale_price || product.price || product.product_price, 0);
  console.log("[ai-text-price-source]", {
    product_id: resolved.product_id || product.id || null,
    variant_id: resolved.variant_id || product.variant_id || null,
    raw_price_used_in_text: raw || "",
    text_template: "ط³ط¹ط±ظ‡ ${price} ط¬ظ†ظٹظ‡.",
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
  if (has(["hi", "hello", "hey", "ط§ظ„ط³ظ„ط§ظ…", "ط§ط²ظٹظƒ", "ط§ظ‡ظ„ط§", "ط£ظ‡ظ„ط§"])) return "greeting";
  if (has(["human", "agent", "admin", "ظƒظ„ظ…", "ظ…ظˆط¸ظپ", "ط­ط¯ ظٹط±ط¯", "ط´ظƒظˆظ‰"])) return "human_support";
  if (has(["order", "invoice", "tracking", "ظپظٹظ† ط§ظ„ط§ظˆط±ط¯ط±", "ط·ظ„ط¨", "ط§ظˆط±ط¯ط±", "ظپط§طھظˆط±ط©"])) return "order_follow_up";
  if (has(["price", "how much", "ط¨ظƒط§ظ…", "ط³ط¹ط±", "ظƒط§ظ…", "ط®طµظ…"])) return "pricing_question";
  if (has(["available", "stock", "ظ…طھط§ط­", "ظ…ظˆط¬ظˆط¯", "ظ…طھظˆظپط±", "ط®ظ„طµ"])) return "availability";
  if (has(["size", "color", "colour", "ظ…ظ‚ط§ط³", "ظ„ظˆظ†", "ط§ظ„ظˆط§ظ†", "ط£ظ„ظˆط§ظ†"])) return "size_color_request";
  if (has(["show", "want", "need", "ط¹ط§ظٹط²", "ط¹ط§ظٹط²ط©", "ظ…ظˆط¯ظٹظ„", "ظƒظˆطھط´ظٹ", "ط´ظˆط²", "ط´ظ†ط·ط©", "ط¬ط²ظ…ط©"])) return "product_search";
  return "general_sales";
};

const quantityWords = new Map([
  ["ظˆط§ط­ط¯", 1],
  ["ظˆط§ط­ط¯ط©", 1],
  ["ظ‚ط·ط¹ط©", 1],
  ["ط§طھظ†ظٹظ†", 2],
  ["ط§ط«ظ†ظٹظ†", 2],
  ["ظ‚ط·ط¹طھظٹظ†", 2],
  ["طھظ„ط§طھط©", 3],
  ["ط«ظ„ط§ط«ط©", 3],
  ["ط§ط±ط¨ط¹ط©", 4],
  ["ط£ط±ط¨ط¹ط©", 4],
  ["ط®ظ…ط³ط©", 5],
]);

const firstNumber = (value = "") => {
  const match = text(value).match(/\b\d+\b/);
  return match ? int(match[0], 0) : 0;
};

const parseSalesCloserQuantity = (message = "") => {
  const normalized = lower(message);
  const explicit = normalized.match(/(?:qty|quantity|ط¹ط¯ط¯|ظƒظ…ظٹط©|ط¹ط§ظٹط²|ط¹ط§ظٹط²ط©|ط®ط¯|ظ‡ط§ط®ط¯|ط§ط­ط¬ط²)\s*(\d{1,3})/i);
  if (explicit) return Math.max(1, int(explicit[1], 1));
  for (const [word, count] of quantityWords.entries()) {
    if (normalized.includes(lower(word))) return count;
  }
  return 1;
};

const parseSalesCloserSize = (message = "") => {
  const value = text(message);
  const explicit = value.match(/(?:ظ…ظ‚ط§ط³|size|ط±ظ‚ظ…)\s*([0-9]{2}|xs|s|m|l|xl|xxl|xxxl)\b/i);
  if (explicit) return explicit[1].toUpperCase();
  const standalone = value.match(/\b(?:[2-5][0-9]|xs|s|m|l|xl|xxl|xxxl)\b/i);
  return standalone ? standalone[0].toUpperCase() : "";
};

const parseSalesCloserBudget = (message = "") => {
  const value = text(message);
  const explicit = value.match(/(?:budget|ظ…ظٹط²ط§ظ†ظٹط©|ظپظٹ ط­ط¯ظˆط¯|ظ„ط­ط¯|طھط­طھ|ط§ظ‚ظ„ ظ…ظ†|ط£ظ‚ظ„ ظ…ظ†)\s*(\d{2,7})/i);
  if (explicit) return int(explicit[1], 0);
  return /(?:budget|ظ…ظٹط²ط§ظ†ظٹط©|ظپظٹ ط­ط¯ظˆط¯|ظ„ط­ط¯|طھط­طھ|ط§ظ‚ظ„ ظ…ظ†|ط£ظ‚ظ„ ظ…ظ†)/i.test(value) ? firstNumber(value) : 0;
};

const parseSalesCloserColor = (message = "") => {
  const value = lower(message);
  const colors = [
    ["black", ["black", "ط§ط³ظˆط¯", "ط£ط³ظˆط¯"]],
    ["white", ["white", "ط§ط¨ظٹط¶", "ط£ط¨ظٹط¶"]],
    ["red", ["red", "ط§ط­ظ…ط±", "ط£ط­ظ…ط±"]],
    ["blue", ["blue", "ط§ط²ط±ظ‚", "ط£ط²ط±ظ‚"]],
    ["green", ["green", "ط§ط®ط¶ط±", "ط£ط®ط¶ط±"]],
    ["beige", ["beige", "ط¨ظٹط¬"]],
    ["grey", ["gray", "grey", "ط±ظ…ط§ط¯ظٹ", "ط±طµط§طµظٹ"]],
    ["brown", ["brown", "ط¨ظ†ظٹ"]],
    ["pink", ["pink", "ظˆط±ط¯ظٹ", "ط¨ظٹظ†ظƒ"]],
    ["navy", ["navy", "ظƒط­ظ„ظٹ"]],
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
    urgency: has(["ط¯ظ„ظˆظ‚طھظٹ", "ط­ط§ظ„ط§", "ط§ظ„ظ†ظ‡ط§ط±ط¯ط©", "ظ…ط³طھط¹ط¬ظ„", "now", "urgent", "today"]) ? "urgent" : has(["ط¨ط¹ط¯ظٹظ†", "later"]) ? "low" : "normal",
    purchase_intent: has(["ظ‡ط§ط®ط¯ظ‡", "ظ‡ط§ط®ط¯", "ط§ط·ظ„ط¨", "ط£ط·ظ„ط¨", "ط§ظˆط±ط¯ط±", "ط£ظˆط±ط¯ط±", "ط§ط­ط¬ط²", "ط£ط­ط¬ط²", "ط§ط¨ط¹طھ ظ„ظٹظ†ظƒ", "checkout", "order", "reserve", "buy"]) ? "high" : has(["ط¨ظƒط§ظ…", "ط³ط¹ط±", "ظ…طھط§ط­", "ظ…ظ‚ط§ط³", "ظ„ظˆظ†", "price", "available"]) ? "medium" : "low",
    requested_payment: has(["ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…", "ظƒط§ط´", "cod", "cash on delivery"]) ? "cod" : has(["ظ„ظٹظ†ظƒ ط¯ظپط¹", "payment link", "visa", "card"]) ? "online" : "",
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
      .filter((term) => !["ط¹ط§ظٹط²", "ط¹ط§ظٹط²ط©", "ط¨ظƒط§ظ…", "ظƒط§ظ…", "ط³ط¹ط±", "ظ…طھط§ط­", "ظ…ظˆط¬ظˆط¯", "ظ…ظ‚ط§ط³", "ظ„ظˆظ†", "price", "size", "color", "available"].includes(lower(term)))
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
    const stockPriorityExpr = `CASE WHEN ${totalStockExpr} > 0 THEN 0 ELSE 1 END`;
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
        ${stockPriorityExpr} AS stock_priority,
        (${scoreParts.join(" + ")} + CASE WHEN ${totalStockExpr} > 0 THEN 10 ELSE 0 END) AS score
      FROM products p
      ${variantJoin}
      ${variantImageJoin}
      ${categoryJoin}
      ${brandJoin}
      WHERE ${whereParts.join("\n        AND ")}
      GROUP BY p.id, c.name, b.name
      ORDER BY stock_priority ASC, score DESC, total_stock DESC, ${orderUpdated} p.id DESC
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

export const loadAiInboxRecommendations = async ({ tenantId, conversationId, limit = 8, inbox = null, conversation = null } = {}) => {
  const resolvedInbox = inbox || await loadAiInbox({ tenantId, filter: "all", limit: 100 });
  const resolvedConversation = conversation || asArray(resolvedInbox.conversations).find((item) => item.session_id === conversationId);
  if (!resolvedConversation) {
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
  const lastMessage = latestCustomerMessage(resolvedConversation.messages) || resolvedConversation.latest_message_preview || resolvedConversation.last_message || "";
  const discussed = latestProducts(resolvedConversation.messages);
  const memory = buildDashboardAiMemory(resolvedConversation);
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
    conversation: resolvedConversation,
    messages: resolvedConversation.messages,
    draftOrders: asArray(resolvedConversation.draft_orders),
    conversationFollowups: asArray(resolvedConversation.followups),
    recommendations: products,
    selectedProduct: resolvedConversation.current_product || resolvedConversation.product || products[0] || null,
    existingJourneyEvents: asArray(resolvedConversation.sales_journey_events),
  }).catch(() => null);
  return {
    conversation_id: conversationId,
    intent: memory.last_intent || memory.lastIntent || extractSalesIntent(lastMessage),
    products,
    memory,
    active_product_id: memory.active_product_id || memory.activeProductId || "",
    projection_source: remembered.length ? "conversation_memory" : "latest_message_search",
    sales_intelligence: intelligence,
    sales_conversation_state: intelligence?.state || resolvedConversation.sales_conversation_state || null,
    conversion_probability: intelligence?.conversion || resolvedConversation.conversion_probability || {},
    follow_up_recommendation: intelligence?.followUp || resolvedConversation.follow_up_recommendation || {},
    cross_sell_suggestions: intelligence?.crossSellSuggestions || resolvedConversation.cross_sell_suggestions || [],
    proactive_closer: intelligence?.closer || resolvedConversation.proactive_closer || {},
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
      message: `طھظ…ط§ظ…طŒ ط¯ظ‡ ظ„ظٹظ†ظƒ ط§ظ„ط¯ظپط¹ ظ„ظ„ط·ظ„ط¨ ${orderNumber}: ${invoicePath}`,
      enabled: Boolean(invoicePath),
    },
    {
      key: "cash_on_delivery",
      label: "Cash on delivery",
      message: `طھظ…ط§ظ… ظٹط§ ${customer}طŒ ظ…ظ…ظƒظ† ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…. ظ‡ط¬ظ‡ط²ظ„ظƒ ${productName}${amount ? ` ط¨ط¥ط¬ظ…ط§ظ„ظٹ ${amount} ط¬ظ†ظٹظ‡` : ""}.`,
      enabled: true,
    },
    {
      key: "whatsapp_checkout",
      label: "WhatsApp checkout",
      message: `ط£ظ‚ط¯ط± ط£ظƒظ…ظ‘ظ„ ظ…ط¹ط§ظƒ ط¹ظ„ظ‰ ظˆط§طھط³ط§ط¨ ظ„طھط£ظƒظٹط¯ ط§ظ„ط·ظ„ط¨ ${orderNumber}. ط§ط¨ط¹طھ ط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ظ„ظˆ ظ…ظ†ط§ط³ط¨.`,
      enabled: true,
    },
    {
      key: "public_invoice",
      label: "Public invoice",
      message: `ظپط§طھظˆط±ط© ط§ظ„ط·ظ„ط¨ ${orderNumber}: ${invoicePath}`,
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
        ? `ظ„ط³ظ‡ ظ…ظ‡طھظ… ط¨ظ€ ${primaryProduct.name || primaryProduct.title}طں ط£ظ‚ط¯ط± ط£ط­ط¬ط²ظ‡ظˆظ„ظƒ ظ…ط¤ظ‚طھط§ ظˆط£ط¬ظ‡ط² ط§ظ„ط·ظ„ط¨.`
        : "ظ„ط³ظ‡ ظ…ط­طھط§ط¬ ظ…ط³ط§ط¹ط¯ط© ظپظٹ ط§ط®طھظٹط§ط± ط§ظ„ظ…ظ†طھط¬طں ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ…ظٹط²ط§ظ†ظٹط© ظˆط£ط±ط´ط­ظ„ظƒ ط§ظ„ظ…طھط§ط­.",
      abandoned_cart_message: "ظ„ظˆ ط­ط§ط¨ط¨ ظ†ظƒظ…ظ„ ط§ظ„ط·ظ„ط¨ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ط¹ظ†ظˆط§ظ†طŒ ظˆط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…طھط§ط­ ظ‚ط¨ظ„ ط§ظ„طھط£ظƒظٹط¯.",
      low_stock_message: primaryProduct && stockCount(primaryProduct) > 0 && stockCount(primaryProduct) <= 3
        ? `ط¨ط§ظ‚ظٹ ${stockCount(primaryProduct)} ط¨ط³ ظ…ظ† ${primaryProduct.name || primaryProduct.title}. ط£ظ‚ط¯ط± ط£ط­ط¬ط²ظ‡ظˆظ„ظƒ ظ…ط¤ظ‚طھط§.`
        : "",
    },
  };
};

const buildArabicAiSalesAnswer = ({ intent, products = [], conversation = {} } = {}) => {
  const name = text(conversation.customer_name || conversation.customer_profile?.name || "");
  const greeting = name && !/unknown|anonymous/i.test(name) ? `${name}طŒ ` : "";
  const available = products.filter((product) => stockCount(product) > 0);
  const primary = available[0] || products[0] || null;
  const productLines = available.slice(0, 3).map((product, index) => {
    const price = realProductPrice(product);
    const stock = stockCount(product);
    const urgency = stock > 0 && stock <= 3 ? " - ط§ظ„ظƒظ…ظٹط© ظ‚ظ„ظٹظ„ط©" : "";
    return `${index + 1}. ${product.name || product.title}${price ? ` - ${price} ط¬ظ†ظٹظ‡` : ""}${product.size ? ` - ط§ظ„ظ…ظ‚ط§ط³ط§طھ: ${product.size}` : ""}${product.color ? ` - ط§ظ„ط£ظ„ظˆط§ظ†: ${product.color}` : ""}${urgency}`;
  });
  if (intent === "greeting") return `ط£ظ‡ظ„ط§ ${greeting}ظ†ظˆط±طھظ†ط§. طھط­ط¨ ط£ط³ط§ط¹ط¯ظƒ ظپظٹ ظ…ظˆط¯ظٹظ„ ظ…ط¹ظٹظ†طŒ ظ…ظ‚ط§ط³طŒ ظ„ظˆظ†طŒ ط£ظˆ ط³ط¹ط±طں`;
  if (intent === "human_support") return "طھظ…ط§ظ…طŒ ظ‡ط­ظˆظ‘ظ„ ط§ظ„ظ…ط­ط§ط¯ط«ط© ظ„ط­ط¯ ظ…ظ† ط§ظ„ظپط±ظٹظ‚ ظٹط±ط§ط¬ط¹ ظ…ط¹ط§ظƒ ط§ظ„طھظپط§طµظٹظ„. ط§ط¨ط¹طھظ„ظٹ ط¨ط³ ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨ ط£ظˆ ط§ظ„ظ…ط´ظƒظ„ط© ط¨ط§ط®طھطµط§ط±.";
  if (intent === "order_follow_up") return "ط£ظƒظٹط¯. ط§ط¨ط¹طھظ„ظٹ ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨ ط£ظˆ ط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ط§ظ„ظ…ط³ط¬ظ„ ط¹ظ„ظ‰ ط§ظ„ط·ظ„ط¨طŒ ظˆط£ظ†ط§ ط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ط­ط§ظ„ط©.";
  if (!products.length) return "ظ…ظ…ظƒظ† طھط¨ط¹طھظ„ظٹ ط§ط³ظ… ط§ظ„ظ…ظˆط¯ظٹظ„ ط£ظˆ طµظˆط±ط© ط§ظ„ظ…ظ†طھط¬ ط£ظˆ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط§ظ„ظ…ط·ظ„ظˆط¨طں ظ‡ط·ظ„ط¹ظ„ظƒ ط£ظ‚ط±ط¨ ط§ظ„ظ…طھط§ط­ ظ…ظ† ط§ظ„ظ…ط®ط²ظˆظ†.";
  if (["pricing_question", "availability", "size_color_request", "product_search"].includes(intent)) {
    return [
      `${greeting}ط§ظ„ظ…طھط§ط­ ط¹ظ†ط¯ظ†ط§ ط­ط§ظ„ظٹط§:`,
      ...productLines,
      primary?.product_url ? `طھظ‚ط¯ط± طھط´ظˆظپ ط§ظ„طھظپط§طµظٹظ„ ظ…ظ† ظ‡ظ†ط§: ${primary.product_url}` : "",
      "طھط­ط¨ ط£ط«ط¨طھظ„ظƒ ظ…ظ‚ط§ط³ ط£ظˆ ط£ط·ظ„ط¹ظ„ظƒ ط¨ط¯ط§ط¦ظ„ ظ‚ط±ظٹط¨ط©طں",
    ].filter(Boolean).join("\n");
  }
  return [
    `${greeting}ط±ط§ط¬ط¹طھظ„ظƒ ط£ظ‚ط±ط¨ ط§ط®طھظٹط§ط±ط§طھ ظ…ظ† ط§ظ„ظ…ط®ط²ظˆظ†:`,
    ...productLines,
    "ظ‚ظˆظ„ظ‘ظٹ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط§ظ„ظ…ظپط¶ظ„ظٹظ† ظˆط£ظ†ط§ ط£ط¶ظٹظ‚ظ„ظƒ ط§ظ„ط§ط®طھظٹط§ط±ط§طھ.",
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
        ? `ط£ظٹظˆظ‡  ظ…ظ‚ط§ط³ ${detectedSize} ظ…طھط§ط­ ط­ط§ظ„ظٹط§ ظپظٹ ${productContext.name}.`
        : `ظ„ظ„ط£ط³ظپ ظ…ظ‚ط§ط³ ${detectedSize} ظ…ط´ ط¸ط§ظ‡ط± ظ…طھط§ط­ ط­ط§ظ„ظٹط§ ظپظٹ ${productContext.name}.`;
    }
    if (intent === "PRICE_INQUIRY" && price) {
      return `ط³ط¹ط± ${productContext.name} ط­ط§ظ„ظٹط§ ${price} ط¬ظ†ظٹظ‡ `;
    }
    if (intent === "AVAILABILITY_INQUIRY") {
      return productContext.inStock
        ? `ط£ظٹظˆظ‡  ${productContext.name} ظ…طھظˆظپط± ط­ط§ظ„ظٹط§.`
        : `ظ„ظ„ط£ط³ظپ ${productContext.name} ط؛ظٹط± ظ…طھظˆظپط± ط­ط§ظ„ظٹط§.`;
    }
    if (intent === "SIZE_INQUIRY" && productContext.sizes?.length) {
      return `ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط§ظ„ظ…طھط§ط­ط© ط­ط§ظ„ظٹط§ ظ„ظ€ ${productContext.name}: ${productContext.sizes.join(", ")} `;
    }
  }
  switch (intent) {
    case "SIZE_INQUIRY":
      return "ط£ظƒظٹط¯  ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ„ظٹ ط¨طھظ„ط¨ط³ظ‡ ط¹ط§ط¯ط© ط£ظˆ ط·ظˆظ„ ط§ظ„ظ‚ط¯ظ… ظˆط£ظ†ط§ ط£ط³ط§ط¹ط¯ظƒ طھط®طھط§ط± ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ…ظ†ط§ط³ط¨.";
    case "PRICE_INQUIRY":
      return "ط£ظƒظٹط¯  ظ‡ظ‚ظˆظ„ظƒ ط§ظ„ط³ط¹ط± ط§ظ„ط­ط§ظ„ظٹ ظˆط§ظ„ظ…طھط§ط­ ط¯ظ„ظˆظ‚طھظٹ.";
    case "AVAILABILITY_INQUIRY":
      return "ط«ط§ظ†ظٹط© ظˆط§ط­ط¯ط© ط£طھط£ظƒط¯ظ„ظƒ ظ…ظ† ط§ظ„طھظˆظپط± ط§ظ„ط­ط§ظ„ظٹ ظˆط§ظ„ظ…ظ‚ط§ط³ط§طھ ط§ظ„ظ…طھط§ط­ط© ";
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

const correctionTypeHintForIntent = ({ intent = "", salesIntent = "", message = "" } = {}) => {
  const normalizedIntent = lower(intent);
  const normalizedSalesIntent = lower(salesIntent);
  const normalizedMessage = lower(message);
  if (normalizedIntent.includes("size_color_request")) return "colors_basic";
  if (normalizedIntent.includes("price") || normalizedSalesIntent.includes("price") || /ط³ط¹ط±|price|cost/.test(normalizedMessage)) return "wrong_price";
  if (normalizedIntent.includes("availability") || normalizedSalesIntent.includes("availability") || /ظ…ظˆط¬ظˆط¯|ظ…طھط§ط­|stock|availability/.test(normalizedMessage)) return "wrong_stock";
  if (/(policy|return|exchange|shipping|delivery|cod|payment)/.test(normalizedIntent) || /(policy|return|exchange|shipping|delivery|cod|payment|ط´ط­ظ†|ط§ط³طھط¨ط¯ط§ظ„|ط§ط³طھط±ط¬ط§ط¹|ط¯ظپط¹)/.test(normalizedMessage)) return "wrong_policy";
  return "other";
};

const SAFE_AUTO_REPLY_INTENTS = new Set(["greeting", "price_question", "size_followup", "availability", "shipping_basic", "return_policy_basic", "colors_basic", "cod_basic", "payment_basic"]);

const normalizeSafetyText = (value = "") =>
  lower(value)
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670\u0640\u200c\u200d\u200e\u200f]/g, "")
    .replace(/\p{M}+/gu, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

const SAFETY_INTENT_PATTERNS = [
  ["refund_request", [/refund/, /refund request/, /return money/, /money back/, /استرداد/, /استرجاع فلوس/, /ارجاع فلوسي/, /ارجع فلوسي/, /ارجع الفلوس/, /رد فلوسي/, /فلوسي/, /استرد فلوس/]],
  ["cancellation_request", [/cancel/, /cancel order/, /cancellation/, /cancel my order/, /الغاء/, /الغي/, /الغى/, /الغاء الطلب/, /إلغاء/, /إلغاء الطلب/, /اوقف الطلب/, /امسح الطلب/]],
  ["complaint", [/complaint/, /complain/, /شكوى/, /اشتكي/, /بشتكي/, /مشتكي/, /تعامل سيئ/, /سيء/, /مش راضي/, /متضايق/]],
  ["manager_request", [/manager/, /supervisor/, /admin/, /team lead/, /اكلم المدير/, /عاوز المدير/, /عايز مدير/, /مدير/, /المسؤول/]],
  ["address_change", [/change address/, /update address/, /address change/, /wrong address/, /غير العنوان/, /تغيير العنوان/, /عدل العنوان/, /العنوان/, /بدل العنوان/]],
  ["shipping_dispute", [/shipping dispute/, /delivery dispute/, /shipping issue/, /delivery issue/, /الشحن/, /التوصيل/, /تأخر الشحن/, /تأخر التوصيل/, /الشحنة متأخرة/, /الشحن متاخر/, /فين الشحنة/]],
  ["defect_report", [/defect/, /defective/, /broken/, /damaged/, /عيب/, /مكسور/, /تالف/, /بايظ/, /مقطوع/, /اتكسر/, /مخروم/]],
  ["compensation_request", [/compensation/, /compensate/, /refund me/, /partial refund/, /credit me/, /تعويض/, /عوضني/, /تعويض مالي/, /كوبون/, /خصم تعويض/]],
  ["wrong_item", [/wrong item/, /wrong product/, /different item/, /received wrong/, /استلمت غلط/, /منتج غلط/, /صنف غلط/, /جالي غلط/, /وصلني غلط/, /غير اللي طلبته/]],
  ["wrong_size", [/wrong size/, /size mismatch/, /size issue/, /bad size/, /مقاس غلط/, /المقاس غلط/, /مقاسي غلط/, /جالي مقاس/, /مقاس مختلف/, /مش نفس المقاس/]],
];

const detectSafetyIntent = (intent = "", salesIntent = "", message = "") => {
  const haystack = normalizeSafetyText(`${intent} ${salesIntent} ${message}`);
  for (const [safetyIntent, patterns] of SAFETY_INTENT_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(haystack))) return safetyIntent;
  }
  return "";
};

const INTENT_SHADOW_PROFILES = {
  greeting: { minConfidence: 70, suppressMissingFacts: new Set(["missing_product_facts", "missing_inventory_facts", "missing_order_facts"]) },
  shipping_basic: { minConfidence: 70, suppressMissingFacts: new Set(["missing_product_facts", "missing_inventory_facts", "missing_order_facts"]) },
  return_policy_basic: { minConfidence: 70, suppressMissingFacts: new Set(["missing_product_facts", "missing_inventory_facts", "missing_order_facts"]) },
  cod_basic: { minConfidence: 70, suppressMissingFacts: new Set(["missing_product_facts", "missing_inventory_facts", "missing_order_facts"]) },
  payment_basic: { minConfidence: 70, suppressMissingFacts: new Set(["missing_product_facts", "missing_inventory_facts", "missing_order_facts"]) },
  colors_basic: { minConfidence: 70, suppressMissingFacts: new Set(["missing_product_facts", "missing_inventory_facts", "missing_order_facts"]) },
  price_question: { minConfidence: 90, suppressMissingFacts: new Set() },
  size_followup: { minConfidence: 90, suppressMissingFacts: new Set() },
  availability: { minConfidence: 90, suppressMissingFacts: new Set() },
};

const shadowIntentProfile = (intent = "", salesIntent = "", message = "") => {
  const normalizedIntent = lower(`${intent} ${salesIntent}`);
  const normalizedMessage = lower(message);
  if (normalizedIntent.includes("size_color_request")) {
    return INTENT_SHADOW_PROFILES.colors_basic;
  }
  if (/(order|tracking|order_status|order_follow_up|ط·آ§ط¸ث†ط·آ±ط·آ¯ط·آ±|ط·ع¾ط·ع¾ط·آ¨ط·آ¹)/.test(normalizedIntent) || /(order|tracking|ط·آ§ط¸ث†ط·آ±ط·آ¯ط·آ±|ط·ع¾ط·ع¾ط·آ¨ط·آ¹)/.test(normalizedMessage)) {
    return { minConfidence: 80, suppressMissingFacts: new Set() };
  }
  if (/(price|cost|ط·آ³ط·آ¹ط·آ±|ط¸ئ’ط¸â€¦|ط·آ¨ط¸ئ’ط·آ§ط¸â€¦|ط·ط›ط·آ§ط¸â€‍ط¸ظ¹|ط·آ§ط·آ±ط·آ®ط·آµ)/.test(normalizedIntent) || /(price|cost|ط·آ³ط·آ¹ط·آ±|ط¸ئ’ط¸â€¦|ط·آ¨ط¸ئ’ط·آ§ط¸â€¦|ط·ط›ط·آ§ط¸â€‍ط¸ظ¹|ط·آ§ط·آ±ط·آ®ط·آµ)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.price_question;
  }
  if (/(size|ط¸â€¦ط¸â€ڑط·آ§ط·آ³|measure|fit)/.test(normalizedIntent) || /(size|ط¸â€¦ط¸â€ڑط·آ§ط·آ³)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.size_followup;
  }
  if (/(availability|available|stock|ط¸â€¦ط·ع¾ط·آ§ط·آ­|ط¸â€¦ط¸ث†ط·آ¬ط¸ث†ط·آ¯|inventory)/.test(normalizedIntent) || /(availability|available|stock|ط¸â€¦ط·ع¾ط·آ§ط·آ­|ط¸â€¦ط¸ث†ط·آ¬ط¸ث†ط·آ¯)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.availability;
  }
  if (/(shipping|delivery|ط·آ´ط·آ­ط¸â€ |ط·ع¾ط¸ث†ط·آµط¸ظ¹ط¸â€‍)/.test(normalizedIntent) || /(shipping|delivery|ط·آ´ط·آ­ط¸â€ |ط·ع¾ط¸ث†ط·آµط¸ظ¹ط¸â€‍)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.shipping_basic;
  }
  if (/(return|exchange|policy|ط·آ§ط·آ³ط·ع¾ط·آ¨ط·آ¯ط·آ§ط¸â€‍|ط·آ§ط·آ³ط·ع¾ط·آ±ط·آ¬ط·آ§ط·آ¹)/.test(normalizedIntent) || /(return|exchange|policy|ط·آ§ط·آ³ط·ع¾ط·آ¨ط·آ¯ط·آ§ط¸â€‍|ط·آ§ط·آ³ط·ع¾ط·آ±ط·آ¬ط·آ§ط·آ¹)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.return_policy_basic;
  }
  if (/(color|colors|colour|colours|ط¸â€‍ط¸ث†ط¸â€ |ط·آ§ط¸â€‍ط¸ث†ط·آ§ط¸â€ |ط·آ£ط¸â€‍ط¸ث†ط·آ§ط¸â€ )/.test(normalizedIntent) || /(color|colors|colour|colours|ط¸â€‍ط¸ث†ط¸â€ |ط·آ§ط¸â€‍ط¸ث†ط·آ§ط¸â€ |ط·آ£ط¸â€‍ط¸ث†ط·آ§ط¸â€ )/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.colors_basic;
  }
  if (/(cod|cash on delivery|cash)/.test(normalizedIntent) || /(cod|cash on delivery|cash)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.cod_basic;
  }
  if (/(payment|ط¯ظپط¹|ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…|ط·ط±ظ‚ ط§ظ„ط¯ظپط¹)/.test(normalizedIntent) || /(payment|ط¯ظپط¹|ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…|ط·ط±ظ‚ ط§ظ„ط¯ظپط¹)/.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.payment_basic;
  }
  if (/(greeting|hello|hi|ط·آ³ط¸â€‍ط·آ§ط¸â€¦|ط·آ§ط¸â€،ط¸â€‍ط·آ§|ط·آ£ط¸â€،ط¸â€‍ط·آ§)/.test(normalizedIntent) || /^(hi|hello|ط·آ³ط¸â€‍ط·آ§ط¸â€¦|ط·آ§ط¸â€،ط¸â€‍ط·آ§|ط·آ£ط¸â€،ط¸â€‍ط·آ§)$/i.test(normalizedMessage)) {
    return INTENT_SHADOW_PROFILES.greeting;
  }
  return { minConfidence: 80, suppressMissingFacts: new Set() };
};

const normalizeShadowIntent = ({ intent = "", salesIntent = "", message = "" } = {}) => {
  const normalizedIntent = lower(`${intent} ${salesIntent}`);
  const normalizedMessage = lower(message);
  if (normalizedIntent.includes("size_color_request")) return "colors_basic";
  if (/greeting|hello|hi|ط³ظ„ط§ظ…|ط§ظ‡ظ„ط§|ط£ظ‡ظ„ط§/.test(normalizedIntent) || /^(hi|hello|ط³ظ„ط§ظ…|ط§ظ‡ظ„ط§|ط£ظ‡ظ„ط§)$/i.test(normalizedMessage)) return "greeting";
  if (/price|cost|ظƒظ…|ط¨ظƒط§ظ…|ط³ط¹ط±|ط؛ط§ظ„ظٹ|ط§ط±ط®طµ|objection/.test(normalizedIntent) || /price|cost|ظƒظ…|ط¨ظƒط§ظ…|ط³ط¹ط±|ط؛ط§ظ„ظٹ|ط§ط±ط®طµ/.test(normalizedMessage)) return "price_question";
  if (/size|ظ…ظ‚ط§ط³|measure|fit|size_check|size_followup/.test(normalizedIntent) || /size|ظ…ظ‚ط§ط³/.test(normalizedMessage)) return "size_followup";
  if (/availability|available|stock|ظ…طھط§ط­|ظ…ظˆط¬ظˆط¯|inventory/.test(normalizedIntent) || /availability|available|stock|ظ…طھط§ط­|ظ…ظˆط¬ظˆط¯/.test(normalizedMessage)) return "availability";
  if (/shipping|delivery|ط´ط­ظ†|طھظˆطµظٹظ„/.test(normalizedIntent) || /shipping|delivery|ط´ط­ظ†|طھظˆطµظٹظ„/.test(normalizedMessage)) return "shipping_basic";
  if (/return|exchange|policy|ط§ط³طھط¨ط¯ط§ظ„|ط§ط³طھط±ط¬ط§ط¹/.test(normalizedIntent) || /return|exchange|policy|ط§ط³طھط¨ط¯ط§ظ„|ط§ط³طھط±ط¬ط§ط¹/.test(normalizedMessage)) return "return_policy_basic";
  if (/color|colors|colour|colours|ظ„ظˆظ†|ط§ظ„ظˆط§ظ†|ط£ظ„ظˆط§ظ†/.test(normalizedIntent) || /color|colors|colour|colours|ظ„ظˆظ†|ط§ظ„ظˆط§ظ†|ط£ظ„ظˆط§ظ†/.test(normalizedMessage)) return "colors_basic";
  if (/cod|cash on delivery|cash/.test(normalizedIntent) || /cod|cash on delivery|cash/.test(normalizedMessage)) return "cod_basic";
  if (/payment|ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…|ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…|ط·ط±ظ‚ ط§ظ„ط¯ظپط¹/.test(normalizedIntent) || /payment|ط§ظ„ط¯ظپط¹ ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…|ط¹ظ†ط¯ ط§ظ„ط§ط³طھظ„ط§ظ…|ط·ط±ظ‚ ط§ظ„ط¯ظپط¹/.test(normalizedMessage)) return "payment_basic";
  return lower(intent || salesIntent || "");
};

const buildAutoReplyShadowDecision = ({
  conversation = {},
  draft = {},
  validation = {},
  confidenceEngine = {},
  intent = "",
  salesIntent = "",
  message = "",
} = {}) => {
  const resolvedIntent = normalizeShadowIntent({ intent, salesIntent, message: message || draft?.customer_question || draft?.text || "" });
  const safetyIntent = detectSafetyIntent(intent, salesIntent, message || draft?.customer_question || draft?.text || "");
  const validationViolationsCount = Number(validation?.violations_count ?? validation?.violationsCount ?? (Array.isArray(validation?.violations) ? validation.violations.length : 0)) || 0;
  const confidenceScore = Number(confidenceEngine?.confidence_score ?? confidenceEngine?.score ?? 0) || 0;
  const confidenceDecision = text(confidenceEngine?.decision || confidenceEngine?.status || "");
  const riskFlags = confidenceEngine?.risk_flags && typeof confidenceEngine.risk_flags === "object" ? confidenceEngine.risk_flags : {};
  const intentProfile = shadowIntentProfile(resolvedIntent, salesIntent, message || draft?.customer_question || draft?.text || "");
  if (safetyIntent) {
    const blockers = [`safety_intent_${safetyIntent}`];
    return {
      evaluated: true,
      eligible: false,
      eligibility_result: false,
      decision: "human_required",
      reason: blockers[0],
      blockers,
      confidence_score: confidenceScore,
      confidence_decision: confidenceDecision || "unknown",
      intent: resolvedIntent,
      intent_detected: resolvedIntent,
      safety_intent: safetyIntent,
      safety_intent_detected: true,
      safety_intent_blocked: true,
      validator_blocked: false,
      evaluated_at: new Date().toISOString(),
    };
  }
  const riskyFlagNames = Object.entries(riskFlags)
    .filter(([key, value]) => {
      if (!value) return false;
      if (intentProfile.suppressMissingFacts?.has(key)) return false;
      return /^(missing_|hallucination_|ambiguous_customer_request|engine_error|unknown_|unsafe_|high_risk)/i.test(key);
    })
    .map(([key]) => key);
  const blockers = [];

  if (confidenceDecision !== "safe") blockers.push(`confidence_decision_${confidenceDecision || "missing"}`);
  if (confidenceScore < intentProfile.minConfidence) blockers.push(`confidence_score_${confidenceScore || 0}_lt_${intentProfile.minConfidence}`);
  if (validationViolationsCount > 0) blockers.push(`validation_violations_${validationViolationsCount}`);
  if (text(draft?.status || "") !== "not_sent") blockers.push(`draft_status_${text(draft?.status || "missing")}`);
  if (conversation?.conversation_status === "human_takeover") blockers.push("conversation_human_takeover");
  if (conversation?.conversation_status === "closed") blockers.push("conversation_closed");
  if (conversation?.ai_enabled === false) blockers.push("channel_ai_disabled");
  if (!SAFE_AUTO_REPLY_INTENTS.has(resolvedIntent)) blockers.push(`intent_${resolvedIntent || "unknown"}`);
  if (riskyFlagNames.length) blockers.push(...riskyFlagNames.slice(0, 6));

  const eligible = blockers.length === 0;
  return {
    evaluated: true,
    eligible,
    eligibility_result: eligible,
    reason: eligible ? "eligible" : blockers[0],
    blockers,
    confidence_score: confidenceScore,
    decision: confidenceDecision || "unknown",
    intent: resolvedIntent,
    intent_detected: resolvedIntent,
    safety_intent: "",
    safety_intent_detected: false,
    evaluated_at: new Date().toISOString(),
  };
};

export const generateAiInboxReply = async ({ tenantId, conversationId, persist = false } = {}) => {
  const pipelineStartedAt = Date.now();
  const pipelineWarnings = [];
  const stageTimings = {
    harness_ms: 0,
    tools_ms: 0,
    generation_ms: 0,
    validation_ms: 0,
    confidence_ms: 0,
    draft_storage_ms: 0,
    total_reply_ms: 0,
  };
  const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 100 });
  const pipelineQueryCounts = {
    db_reads_count: 1,
    correction_queries_count: 0,
    product_queries_count: 0,
  };
  const conversation = asArray(inbox.conversations).find((item) => item.session_id === conversationId);
  if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  const aiSettings = await getAiAgentSettings({ tenantId }).catch(() => DEFAULT_SETTINGS);
  if (!isAiAssistantGlobalEnabled(aiSettings)) {
    throw Object.assign(new Error("AI assistant is globally paused"), { status: 409, code: "AI_ASSISTANT_GLOBAL_PAUSED" });
  }
  if (["human_takeover", "closed"].includes(conversation.conversation_status)) {
    throw Object.assign(new Error("AI is paused for this conversation"), { status: 409 });
  }
  const lastMessage = latestCustomerMessage(conversation.messages) || conversation.latest_message_preview || conversation.last_message || "";
  let replyHarness = null;
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
  const recommendationsResult = await loadAiInboxRecommendations({
    tenantId,
    conversationId,
    limit: 8,
    inbox,
    conversation,
  });
  pipelineQueryCounts.db_reads_count += 1;
  pipelineQueryCounts.product_queries_count += 1;
  const recommendations = recommendationsResult || { products: [] };
  const preloadedProductContext = buildProductContext(currentProductForConversation(conversation, recommendations.products));
  const productContext = replyHarness?.product_context?.active_product || preloadedProductContext;
  const replyProductContext = productContext || buildProductContext(getConversationMemory(conversationId)?.lastProduct);
  const employeeCorrections = await searchRelevantCorrections({
    tenantId,
    query: lastMessage,
    productId: replyProductContext?.id || productContext?.id || null,
    correctionType: correctionTypeHintForIntent({ intent, salesIntent, message: lastMessage }),
    limit: 3,
  }).catch((error) => {
    console.warn("[ai-agent:corrections] search skipped", {
      tenantId,
      conversationId,
      message: error?.message,
    });
    return [];
  });
  pipelineQueryCounts.db_reads_count += 1;
  pipelineQueryCounts.correction_queries_count += 1;
  const preloadedCorrectionSources = buildReplyCorrectionContextSource(employeeCorrections, lastMessage);
  pipelineQueryCounts.db_reads_count += 1;
  let conversationMemory = getConversationMemory(conversationId);
  const latestMessageRow = [...asArray(conversation.messages)].reverse().find((message) => text(message.customer_message || message.message_text || message.last_message)) || {};
  const salesIntelligence = replyHarness?.business_context?.sales_intelligence || await buildSalesConversationIntelligence({
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
  const employeeCorrectionSources = asArray(replyHarness?.correction_context?.sources).length
    ? asArray(replyHarness.correction_context.sources)
    : preloadedCorrectionSources;
  try {
    const harnessStartedAt = Date.now();
    const { buildReplyHarness } = await import("./aiReplyHarnessService.js");
    replyHarness = await buildReplyHarness({
      tenantId,
      conversationId,
      conversation,
      latestCustomerMessage: lastMessage,
      sendMode: persist ? "persist" : "compose",
      channel: conversation.channel || conversation.source || "web_chat",
      preloadedInbox: inbox,
      preloadedMessages: conversation.messages,
      preloadedMemory: getConversationMemory(conversationId),
      preloadedRecommendations: recommendations.products,
      preloadedCorrections: employeeCorrections,
      preloadedProductContext: preloadedProductContext,
      preloadedAiSettings: aiSettings,
      preloadedShippingZones: null,
      preloadedSalesIntelligence: salesIntelligence,
    });
    stageTimings.harness_ms = Date.now() - harnessStartedAt;
    stageTimings.tools_ms = Number(replyHarness?.trace?.tools_ms || 0);
    conversationMemory = replyHarness?.memory_context?.raw || conversationMemory;
  } catch (error) {
    pipelineWarnings.push(`buildReplyHarness failed: ${error?.message || String(error)}`);
    console.warn("[ai-agent:harness] build skipped", {
      tenantId,
      conversationId,
      message: error?.message || String(error),
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
      ? "ظˆط§ط¶ط­ ط¥ظ† ظپظٹظ‡ ظ…ط´ظƒظ„ط© ظ…ط­طھط§ط¬ط© ظ…طھط§ط¨ط¹ط© ظ…ظ† ط£ط­ط¯ ط£ظپط±ط§ط¯ ط§ظ„ظپط±ظٹظ‚. ظ‡ط­ظˆظ‘ظ„ ط§ظ„ظ…ط­ط§ط¯ط«ط© ظ„ظ…ظˆط¸ظپ ظٹط³ط§ط¹ط¯ظƒ ظپظˆط±ظ‹ط§ "
      : humanizedReply || commerceReplyForIntent(intent, replyProductContext, detectedSize) || buildArabicAiSalesAnswer({ intent: salesIntent, products: recommendations.products, conversation }),
    intent,
    productContext,
    conversationMemory,
    detectedSize,
  });
  const answer = ensureProductLinkInReply(guarded.reply, replyProductContext);
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
    employee_corrections: employeeCorrections,
    employee_correction_sources: employeeCorrectionSources,
    suggested_actions: escalation.shouldEscalate || salesIntent === "human_support" ? ["takeover"] : ["ask_size", "send_product", "create_draft_order"],
  };
  const promptOptimization = compressAiReplyPromptPayload({
    message: lastMessage,
    response: {
      ...baseReply,
      reply_harness: replyHarness ? {
        tenant_id: replyHarness.tenant_id,
        conversation_id: replyHarness.conversation_id,
        send_mode: replyHarness.send_mode,
        trace: replyHarness.trace,
        tool_context: replyHarness.tool_context || null,
      } : null,
    },
    intent: { type: intent },
    memory: conversationMemory,
    context: {
      reply_harness: replyHarness,
      harness_trace: replyHarness?.trace || null,
      tool_context: replyHarness?.tool_context || null,
    },
    harness: replyHarness,
    recent_messages: asArray(conversation.messages),
    product_context: replyProductContext,
    correction_context: {
      query: lastMessage,
      corrections: employeeCorrections,
    },
  });
  const generationStartedAt = Date.now();
  const reply = await composeAiSalesReply({
    message: lastMessage,
    response: {
      ...baseReply,
      reply_harness: replyHarness ? {
        tenant_id: replyHarness.tenant_id,
        conversation_id: replyHarness.conversation_id,
        send_mode: replyHarness.send_mode,
        trace: replyHarness.trace,
        tool_context: replyHarness.tool_context || null,
      } : null,
    },
    intent: { type: intent },
    memory: conversationMemory,
    context: {
      reply_harness: replyHarness,
      harness_trace: replyHarness?.trace || null,
      tool_context: replyHarness?.tool_context || null,
    },
    source: "ai_inbox",
  });
  stageTimings.generation_ms = Date.now() - generationStartedAt;
  const validationStartedAt = Date.now();
  let validation = {
    is_valid: true,
    confidence: 1,
    violations: [],
    warnings: [],
    suggested_action: "keep_draft",
  };
  let confidenceEngine = {
    confidence_score: 50,
    confidence_level: "medium",
    decision: "review",
    reasons: [],
    risk_flags: {},
  };
  try {
    const { validateAiReply } = await import("./aiReplyValidatorService.js");
    validation = await validateAiReply({
      replyText: reply.answer || "",
      harness: replyHarness,
    });
  } catch (error) {
    validation = {
      is_valid: true,
      confidence: 0.5,
      violations: [],
      warnings: [`validateAiReply failed: ${error?.message || String(error)}`],
      suggested_action: "keep_draft",
    };
  }
  stageTimings.validation_ms = Date.now() - validationStartedAt;
  const confidenceStartedAt = Date.now();
  try {
    const { buildAiConfidenceEngine } = await import("./aiConfidenceEngineService.js");
    confidenceEngine = await buildAiConfidenceEngine({
      harness: replyHarness,
      tool_context: replyHarness?.tool_context || null,
      validation,
      draft: {
        text: reply.answer || "",
        detected_intent: intent,
        customer_question: lastMessage,
        validation,
      },
      correction_context: replyHarness?.correction_context || null,
    });
  } catch (error) {
    confidenceEngine = {
      confidence_score: 50,
      confidence_level: "medium",
      decision: "review",
      reasons: [`buildAiConfidenceEngine failed: ${error?.message || String(error)}`],
      risk_flags: {
        engine_error: true,
      },
    };
  }
  stageTimings.confidence_ms = Date.now() - confidenceStartedAt;
  reply.validation = validation;
  reply.confidence_engine = confidenceEngine;
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
  const draftStorageStartedAt = Date.now();
  const draft = await upsertAiReplySuggestionDraft({
    tenantId,
    sessionId: conversationId,
    suggestionText: reply.answer,
    messageType: reply.suggested_products?.length ? "product_card" : "text",
    productCards: reply.suggested_products || [],
    confidence: reply.confidence,
    detectedIntent: intent,
    customerQuestion: lastMessage,
    status: "not_sent",
    metadata: {
      source: "ai_suggestion",
      persist_requested: persist === true,
      validation,
      confidence_engine: confidenceEngine,
    },
  });
  stageTimings.draft_storage_ms = Date.now() - draftStorageStartedAt;
  const aiReplyDraft = normalizeAiReplyDraft(draft || {});
  aiReplyDraft.validation = {
    confidence: Number(validation?.confidence ?? 0),
    violations_count: Array.isArray(validation?.violations) ? validation.violations.length : 0,
    warnings_count: Array.isArray(validation?.warnings) ? validation.warnings.length : 0,
  };
  aiReplyDraft.confidence_engine = {
    score: Number(confidenceEngine?.confidence_score ?? 0),
    level: confidenceEngine?.confidence_level || "medium",
    decision: confidenceEngine?.decision || "review",
    reasons_count: Array.isArray(confidenceEngine?.reasons) ? confidenceEngine.reasons.length : 0,
    risk_flags_count: confidenceEngine?.risk_flags ? Object.values(confidenceEngine.risk_flags).filter(Boolean).length : 0,
  };
  const autoReplyShadow = buildAutoReplyShadowDecision({
    conversation,
    draft: aiReplyDraft,
    validation,
    confidenceEngine,
    intent,
    salesIntent,
    message: lastMessage,
  });
  aiReplyDraft.metadata = {
    ...(aiReplyDraft.metadata && typeof aiReplyDraft.metadata === "object" ? aiReplyDraft.metadata : {}),
    auto_reply_shadow: autoReplyShadow,
  };
  const harnessQueryCounts = replyHarness?.trace?.query_counts || {};
  const totalCorrectionQueries = Number(pipelineQueryCounts.correction_queries_count || 0) + Number(harnessQueryCounts.correction_queries_count || 0);
  const totalProductQueries = Number(pipelineQueryCounts.product_queries_count || 0) + Number(harnessQueryCounts.product_queries_count || 0);
  const totalProductFactQueries = Number(harnessQueryCounts.product_fact_queries_count || 0);
  const totalDbReads = Number(pipelineQueryCounts.db_reads_count || 0) + Number(harnessQueryCounts.db_reads_count || 0);
  const duplicateCorrectionLookup = totalCorrectionQueries > 1;
  const duplicateProductLookup = totalProductQueries > 1;
  const harnessBytes = (() => {
    try {
      return JSON.stringify(replyHarness || {}).length;
    } catch {
      return 0;
    }
  })();
  const promptBytes = text(productPrompt).length + text(answer).length + text(toneInstruction).length + text(lastMessage).length;
  const optimizationReport = {
    ...(promptOptimization?.optimization_report || {}),
    prompt_bytes_before: Number(promptOptimization?.prompt_bytes_before || 0),
    prompt_bytes_after: Number(promptOptimization?.prompt_bytes_after || 0),
    reduction_percent: Number(promptOptimization?.reduction_percent || 0),
    db_reads_count: totalDbReads,
    correction_queries_count: totalCorrectionQueries,
    product_queries_count: totalProductQueries,
    product_fact_queries_count: totalProductFactQueries,
  };
  const pipelineDebug = {
    tenant_id: tenantId,
    conversation_id: conversationId,
    channel: conversation.channel || conversation.source || "web_chat",
    harness_summary: {
      latest_customer_message: replyHarness?.latest_customer_message || lastMessage || "",
      send_mode: replyHarness?.send_mode || "",
      trace: replyHarness?.trace || null,
    },
    timings: {
      ...stageTimings,
      total_reply_ms: Date.now() - pipelineStartedAt,
    },
    deterministic: {
      harness_deterministic: Boolean(replyHarness),
      tools_deterministic: Boolean(replyHarness?.tool_context),
      validation_deterministic: Boolean(validation),
      confidence_deterministic: Boolean(confidenceEngine),
      draft_storage_deterministic: Boolean(draft),
    },
    duplicate_work: {
      repeated_correction_lookup: duplicateCorrectionLookup,
      repeated_product_lookup: duplicateProductLookup,
      repeated_db_reads: duplicateCorrectionLookup || duplicateProductLookup,
    },
    memory: {
      harness_bytes: harnessBytes,
      prompt_bytes: promptBytes,
      oversized_harness: harnessBytes > 35000,
      oversized_prompt: promptBytes > 9000,
      duplicate_context_blocks: duplicateProductLookup,
    },
    optimization_report: optimizationReport,
    auto_reply_shadow: autoReplyShadow,
    counts: {
      corrections: asArray(employeeCorrections).length,
      recommendations: asArray(recommendations.products).length,
      product_facts_loaded: Boolean(replyHarness?.tool_context?.product_facts),
      inventory_facts_loaded: Boolean(replyHarness?.tool_context?.inventory_facts),
      shipping_facts_loaded: Boolean(replyHarness?.tool_context?.shipping_facts),
      policy_facts_loaded: Boolean(replyHarness?.tool_context?.policy_facts),
      order_facts_loaded: Boolean(replyHarness?.tool_context?.order_facts),
      db_reads_count: optimizationReport.db_reads_count,
      correction_queries_count: optimizationReport.correction_queries_count,
      product_queries_count: optimizationReport.product_queries_count,
      product_fact_queries_count: optimizationReport.product_fact_queries_count,
    },
    warnings: pipelineWarnings,
  };
  setAiPipelineDebug({ tenantId, conversationId, value: pipelineDebug });
  reply.pipeline_debug = pipelineDebug;
  aiReplyDraft.pipeline_debug = {
    timings: pipelineDebug.timings,
    duplicate_work: pipelineDebug.duplicate_work,
    memory: pipelineDebug.memory,
    optimization_report: pipelineDebug.optimization_report,
    auto_reply_shadow: autoReplyShadow,
  };
  await db.query(
    `
    UPDATE ai_support_sessions
    SET last_ai_reply_draft = $3::jsonb,
        last_ai_reply_draft_updated_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1::bigint
      AND session_id = $2::text
    `,
    [Number(tenantId) || null, conversationId, JSON.stringify(aiReplyDraft)]
  ).catch((error) => {
    console.warn("[ai-agent] failed to persist ai reply pipeline debug", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      message: error?.message || String(error),
    });
  });
  emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, session_id: conversationId, at: new Date().toISOString() });
  return {
    conversation_id: conversationId,
    reply,
    draft: aiReplyDraft,
    ai_reply_draft: aiReplyDraft,
    suggestion: aiReplyDraft,
    message: null,
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
    validation,
    confidence_engine: confidenceEngine,
    auto_reply_shadow: autoReplyShadow,
    pipeline_debug: pipelineDebug,
  };
};

const productLineAr = (product = {}) => {
  const name = text(product.name || product.title || product.product_name);
  const price = realProductPrice(product);
  const stock = stockCount(product);
  if (!name) return "";
  const pricePart = price > 0 ? `ط³ط¹ط±ظ‡ ${price} ط¬ظ†ظٹظ‡` : "ط§ظ„ط³ط¹ط± ظ…ط­طھط§ط¬ ظٹطھط£ظƒط¯ ظ…ظ† ط§ظ„ظ…ظ†طھط¬";
  const stockPart = stock > 0 ? "ظˆظ…طھط§ط­ ط­ط§ظ„ظٹط§" : "ظˆظ…ط´ ط¸ط§ظ‡ط± ظ…طھط§ط­ ط­ط§ظ„ظٹط§";
  return `${name} ${pricePart} ${stockPart}`;
};

const draftLineAr = (draft = {}) => {
  const item = asArray(draft.items)[0] || {};
  const productName = text(item.product_name || draft.ai_agent_metadata?.product_name);
  const price = numeric(item.price || item.sale_price || draft.total_amount || draft.total, 0);
  const stockStatus = text(item.stock_status || draft.ai_agent_metadata?.stock_status);
  return [
    productName ? `ط§ظ„ظ…ط³ظˆط¯ط© ط¹ظ„ظ‰ ${productName}` : "ظپظٹظ‡ ظ…ط³ظˆط¯ط© ط£ظˆط±ط¯ط± ظ…ظپطھظˆط­ط©",
    price > 0 ? `ط¨ط³ط¹ط± ${price} ط¬ظ†ظٹظ‡` : "",
    stockStatus === "stock_conflict" ? "ط¨ط³ ط§ظ„ظ…ط®ط²ظˆظ† ظ…ط­طھط§ط¬ ظ…ط±ط§ط¬ط¹ط© ظ‚ط¨ظ„ ط§ظ„طھط£ظƒظٹط¯" : "",
  ].filter(Boolean).join(" ");
};

const detectSuggestedReplyIntent = ({ message = "", conversation = {}, products = [], drafts = [] } = {}) => {
  const normalized = lower(message);
  if (conversation.customer_sentiment === "negative" || ["ط²ط¹ظ„ط§ظ†", "ظ…ط´ظƒظ„ط©", "ط´ظƒظˆظ‰", "ط§طھط£ط®ط±", "ط؛ظ„ط·"].some((term) => normalized.includes(term))) return "apologize";
  if (["ط؛ط§ظ„ظٹ", "ط®طµظ…", "ط§ط®ط± ط³ط¹ط±", "ط¢ط®ط± ط³ط¹ط±", "expensive", "discount"].some((term) => normalized.includes(lower(term)))) return "handle_objection";
  if (drafts.length || ["ط§ط´طھط±ظٹ", "ط§ط·ظ„ط¨", "ط§ظˆط±ط¯ط±", "ط£ظˆط±ط¯ط±", "ظ‡ط§ط®ط¯ظ‡", "ط§ط­ط¬ط²"].some((term) => normalized.includes(lower(term)))) return "close_sale";
  if (!products.length || ["ظ…ظ‚ط§ط³", "ظ„ظˆظ†", "ط±ظ‚ظ…", "ط¹ظ†ظˆط§ظ†", "ظ…ظ†ط·ظ‚ط©"].some((term) => normalized.includes(lower(term)))) return "ask_missing_info";
  if (conversation.conversation_status === "human_takeover") return "handoff_note";
  return "answer_question";
};

const buildMissingInfoReply = ({ products = [], profile = {} } = {}) => {
  const product = products.find((item) => stockCount(item) > 0) || products[0] || null;
  if (!product) return "ظ…ظ…ظƒظ† طھط¨ط¹طھظ„ظٹ ط§ط³ظ… ط§ظ„ظ…ظˆط¯ظٹظ„ ط£ظˆ طµظˆط±ط© ط§ظ„ظ…ظ†طھط¬ ط§ظ„ظ„ظٹ طھظ‚طµط¯ظ‡طŒ ظˆظ…ط¹ط§ظ‡ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط§ظ„ظ…ط·ظ„ظˆط¨طں";
  const missingSize = !text(profile.preferred_size);
  if (missingSize) return `طھظ…ط§ظ…طŒ ${productLineAr(product)}. طھط­ط¨ ط£ظ†ظ‡ظٹ ظ…ظ‚ط§ط³ ط¹ط´ط§ظ† ط£ط±ط§ط¬ط¹ ط§ظ„ظ…طھط§ط­ ط¨ط§ظ„ط¸ط¨ط؟`;
  return `طھظ…ط§ظ…طŒ ${productLineAr(product)}. طھط­ط¨ ط£ظ†ظ‡ظٹ ظ„ظˆظ† ط£ظˆ ظپط§ط±ظٹط§ظ†طھ ط¹ط´ط§ظ† ظ†ط£ظƒط¯ ط§ظ„ظ…طھط§ط­ ظ‚ط¨ظ„ ط§ظ„طھط³ط¬ظٹظ„طں`;
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
        "ط­ظ‚ظƒ ط¹ظ„ظٹط§طŒ ط®ظ„ظٹظ†ظٹ ط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…ظˆط¶ظˆط¹ ط®ط·ظˆط© ط¨ط®ط·ظˆط© ظˆظ†ط­ظ„ظ‡ط§ ط¨ط£ط³ط±ط¹ ط´ظƒظ„. ظ…ظ…ظƒظ† طھط¨ط¹طھظ„ظٹ ط±ظ‚ظ… ط§ظ„ط£ظˆط±ط¯ط± ط£ظˆ ط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„طں",
        "ظ…طھط£ط³ظپظٹظ† ط¹ظ„ظ‰ ط§ظ„ظ„ظٹ ط­طµظ„. ط§ط¨ط¹طھظ„ظٹ طھظپط§طµظٹظ„ ط§ظ„ظ…ط´ظƒظ„ط© ظˆط±ظ‚ظ… ط§ظ„ط·ظ„ط¨ ظˆط£ظ†ط§ ظ‡طھط§ط¨ط¹ظ‡ط§ ظ…ط¹ ط§ظ„ظپط±ظٹظ‚ ط­ط§ظ„ط§.",
        "طھظ…ط§ظ…طŒ ط£ظ†ط§ ظ…ط¹ط§ظƒ ظ„ط­ط¯ ظ…ط§ ظ†ط­ظ„ظ‡ط§. ظ…ط­طھط§ط¬ ط¨ط³ ط±ظ‚ظ… ط§ظ„ط·ظ„ط¨ ط£ظˆ ط§ط³ظ… ط§ظ„ظ…ظ†طھط¬ ط¹ط´ط§ظ† ط£ط±ط§ط¬ط¹ ط§ظ„ط­ط§ظ„ط© ط¨ط¯ظ‚ط©.",
      ],
    };
  }

  if (intent === "handle_objection") {
    const priceReply = primaryLine
      ? `ظپط§ظ‡ظ…ظƒطŒ ${primaryLine}. ط§ظ„ط³ط¹ط± ط¯ظ‡ ظ‡ظˆ ط§ظ„ط³ط¹ط± ط§ظ„ط­ظ‚ظٹظ‚ظٹ ط§ظ„ط¸ط§ظ‡ط± ط¹ظ†ط¯ظ†ط§ ط­ط§ظ„ظٹط§طŒ ظˆظ…ظ‚ط¯ط±ط´ ط£ظˆط¹ط¯ ط¨ط®طµظ… ط؛ظٹط± ظ„ظ…ط§ ظٹطھط£ظƒط¯ ظ…ظ† ط§ظ„ط¥ط¯ط§ط±ط©. طھط­ط¨ ط£ط±ط´ط­ظ„ظƒ ط¨ط¯ط§ط¦ظ„ ط£ط±ط®طµطں`
      : "ظپط§ظ‡ظ…ظƒطŒ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظˆط¯ظٹظ„ ط§ظ„ظ„ظٹ طھظ‚طµط¯ظ‡ ظˆط£ظ†ط§ ط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ط³ط¹ط± ط§ظ„ط­ظ‚ظٹظ‚ظٹ ظˆط£ظ‚ظˆظ„ظƒ ظ„ظˆ ظپظٹظ‡ ط¨ط¯ط§ط¦ظ„ ط£ط±ط®طµ ظ…طھط§ط­ط©.";
    return {
      intent,
      confidence: primaryProduct ? 0.8 : 0.6,
      suggestions: [
        canDiscount && primaryLine
          ? `ظپط§ظ‡ظ…ظƒطŒ ${primaryLine}. ط£ظ‚ط¯ط± ط£ط±ط§ط¬ط¹ظ„ظƒ ظ„ظˆ ظپظٹظ‡ ط¹ط±ط¶ ط£ظˆ ط®طµظ… ظ…طھط§ط­ ظ‚ط¨ظ„ ظ…ط§ ظ†ط£ظƒط¯ ط§ظ„ط£ظˆط±ط¯ط±.`
          : priceReply,
        "ظ„ظˆ ط§ظ„ط³ط¹ط± ط£ط¹ظ„ظ‰ ظ…ظ† ط§ظ„ظ…ظٹط²ط§ظ†ظٹط©طŒ ظ‚ظˆظ„ظ‘ظٹ ط§ظ„ط±ظٹظ†ط¬ ط§ظ„ظ…ظ†ط§ط³ط¨ ظˆط£ظ†ط§ ط£ط·ظ„ط¹ظ„ظƒ ط£ظ‚ط±ط¨ ط¨ط¯ط§ط¦ظ„ ظ…طھط§ط­ط© ط¨ط³ط¹ط± ط£ظ‚ظ„.",
        primaryLine ? `ط§ظ„ظ…ظˆط¯ظٹظ„ ط¯ظ‡ ظ‚ظٹظ…طھظ‡ ظپظٹ ط®ط§ظ…طھظ‡ ظˆط´ظƒظ„ظ‡طŒ ط¨ط³ ظ„ظˆ ط¹ط§ظٹط² ط­ط§ط¬ط© ط§ظ‚طھطµط§ط¯ظٹط© ط£ظƒطھط± ط£ظ‚ط¯ط± ط£ظˆط±ظٹظƒ ط§ط®طھظٹط§ط±ط§طھ ظ‚ط±ظٹط¨ط©.` : "ط­ط¯ط¯ظ„ظٹ ط§ظ„ط´ظƒظ„ ط£ظˆ طµظˆط±ط© ط§ظ„ظ…ظ†طھط¬طŒ ظˆط£ظ†ط§ ط£ط±ط´ط­ظ„ظƒ ط¨ط¯ط§ط¦ظ„ ظ…ظ†ط§ط³ط¨ط© ظ„ظ„ظ…ظٹط²ط§ظ†ظٹط©.",
      ],
    };
  }

  if (intent === "close_sale") {
    return {
      intent,
      confidence: drafts.length ? 0.86 : 0.72,
      suggestions: [
        draftLine ? `${draftLine}. طھط­ط¨ ط£ط£ظƒط¯ظ„ظƒ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ‚ط¨ظ„ ظ…ط§ ظ†ظƒظ…ظ„طں` : "طھظ…ط§ظ…طŒ ط¹ط´ط§ظ† ط£ط³ط¬ظ„ ط§ظ„ط·ظ„ط¨ ظ…ط­طھط§ط¬ ط§ظ„ط§ط³ظ… ظˆط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ظˆط§ظ„ظ…ظ‚ط§ط³/ط§ظ„ظ„ظˆظ† ط§ظ„ظ…ط·ظ„ظˆط¨.",
        "ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط§ط³ظ… ظˆط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ظ…ظ†ط·ظ‚ط©طŒ ظˆط£ظ†ط§ ط£ط±ط§ط¬ط¹ ط§ظ„ظ…طھط§ط­ ظˆط§ظ„ط³ط¹ط± ط§ظ„ظ†ظ‡ط§ط¦ظٹ ظ‚ط¨ظ„ طھط£ظƒظٹط¯ ط§ظ„ط£ظˆط±ط¯ط±.",
        primaryLine ? `${primaryLine}. ظ„ظˆ ظ…ظ†ط§ط³ط¨ظƒطŒ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ط§ط³ظ… ظˆط±ظ‚ظ… ط§ظ„ظ…ظˆط¨ط§ظٹظ„ ظˆط§ظ„ط¹ظ†ظˆط§ظ† ظˆظ†ظƒظ…ظ„ ط§ظ„ط·ظ„ط¨.` : "طھظ…ط§ظ…طŒ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظ†طھط¬ ط§ظ„ظ…ط·ظ„ظˆط¨ ظ…ط¹ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ظˆظ†ظƒظ…ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط·ظ„ط¨.",
      ],
    };
  }

  if (intent === "ask_missing_info") {
    return {
      intent,
      confidence: primaryProduct ? 0.7 : 0.55,
      suggestions: [
        buildMissingInfoReply({ products, profile }),
        "ظ…ظ…ظƒظ† طھط­ط¯ط¯ظ„ظٹ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط§ظ„ظ„ظٹ ظ…ط­طھط§ط¬ظ‡طں ظ‡ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…طھط§ط­ ظˆط§ظ„ط³ط¹ط± ط§ظ„ط­ظ‚ظٹظ‚ظٹ ظ‚ط¨ظ„ ط£ظٹ طھط£ظƒظٹط¯.",
        lastAi ? "ط®ظ„ظٹظ†ط§ ظ†ط£ظƒط¯ ط§ظ„طھظپط§طµظٹظ„ ط§ظ„ط£ظˆظ„: ط§ظ„ظ…ظ‚ط§ط³طŒ ط§ظ„ظ„ظˆظ†طŒ ظˆط§ظ„ظ…ظ†ط·ظ‚ط© ط¹ط´ط§ظ† ط£ظ‚ط¯ط± ط£ط±ط¯ ط¹ظ„ظٹظƒ ط¨ط¯ظ‚ط©." : "ط§ط¨ط¹طھظ„ظٹ طھظپط§طµظٹظ„ ط£ظƒطھط± ط¹ظ† ط§ظ„ظ…ظ†طھط¬ ط§ظ„ظ…ط·ظ„ظˆط¨ ط£ظˆ طµظˆط±ط© ظ„ظ‡طŒ ظˆط£ظ†ط§ ط£ط·ظ„ط¹ظ„ظƒ ط§ظ„ط£ظ‚ط±ط¨ ظ…ظ† ط§ظ„ظ…طھط§ط­.",
      ],
    };
  }

  if (intent === "handoff_note") {
    return {
      intent,
      confidence: 0.72,
      suggestions: [
        "ط£ظ†ط§ ظ…ط¹ط§ظƒ ط¯ظ„ظˆظ‚طھظٹ ط¨ط¯ظ„ ط§ظ„ط±ط¯ ط§ظ„ط¢ظ„ظٹ. ظ‚ظˆظ„ظ‘ظٹ ظ…ط­طھط§ط¬ ظ†ط±ط§ط¬ط¹ ط¥ظٹظ‡ ط¨ط§ظ„ط¸ط¨ط· ظˆط£ظ†ط§ ط£طھط§ط¨ط¹ظ‡ط§ ظ…ط¹ط§ظƒ.",
        primaryLine ? `ط±ط§ط¬ط¹طھ ط§ظ„ظ…ط­ط§ط¯ط«ط©طŒ ${primaryLine}. طھط­ط¨ ط£ظƒظ…ظ„ظƒ ط¹ظ„ظ‰ ظ†ظپط³ ط§ظ„ظ…ظ†طھط¬ ظˆظ„ط§ طھط´ظˆظپ ط¨ط¯ط§ط¦ظ„طں` : "ط±ط§ط¬ط¹طھ ط§ظ„ظ…ط­ط§ط¯ط«ط©طŒ ظ…ط­طھط§ط¬ ظ…ظ†ظƒ ط¨ط³ طھظˆط¶ط­ ط§ظ„ظ…ظ†طھط¬ ط£ظˆ ط§ظ„ط·ظ„ط¨ ط§ظ„ظ„ظٹ ظ†ظƒظ…ظ„ ط¹ظ„ظٹظ‡.",
        "طھظ…ط§ظ…طŒ ظ‡ظƒظ…ظ„ ظ…ط¹ط§ظƒ ظٹط¯ظˆظٹ. ظ„ظˆ ظپظٹظ‡ ظ…ظ‚ط§ط³ ط£ظˆ ظ„ظˆظ† ظ…ط¹ظٹظ† ط§ط¨ط¹طھظ‡ظˆظ„ظٹ ط¹ط´ط§ظ† ط£ط±ط§ط¬ط¹ ط§ظ„ظ…طھط§ط­.",
      ],
    };
  }

  return {
    intent,
    confidence: primaryProduct ? 0.76 : 0.58,
    suggestions: [
      primaryLine ? `${primaryLine}. طھط­ط¨ ط£ط±ط§ط¬ط¹ظ„ظƒ ط§ظ„ظ…ظ‚ط§ط³ط§طھ ظˆط§ظ„ط£ظ„ظˆط§ظ† ط§ظ„ظ…طھط§ط­ط© ظ…ظ†ظ‡طں` : "ظ…ظ…ظƒظ† طھظˆط¶ط­ظ„ظٹ ط§ظ„ظ…ظ†طھط¬ ط£ظˆ طھط¨ط¹طھ طµظˆط±طھظ‡ ط¹ط´ط§ظ† ط£ط±ط¯ ط¹ظ„ظٹظƒ ط¨ط¯ظ‚ط©طں",
      "طھظ…ط§ظ…طŒ ط£ظ‚ط¯ط± ط£ط³ط§ط¹ط¯ظƒ. ظ…ط­طھط§ط¬ ط£ط¹ط±ظپ ط§ظ„ظ…ظ‚ط§ط³ ظˆط§ظ„ظ„ظˆظ† ط£ظˆ ط§ظ„ظ…ظٹط²ط§ظ†ظٹط© ط§ظ„ظ„ظٹ ط¨طھط¯ظˆط± ط¹ظ„ظٹظ‡ط§.",
      stockedProducts[1] ? `ظƒظ…ط§ظ† ظپظٹظ‡ ط¨ط¯ظٹظ„ ظ…طھط§ط­: ${productLineAr(stockedProducts[1])}. طھط­ط¨ ط£ظ‚ط§ط±ظ†ظ‡ظ… ظ„ظƒطں` : "ظ„ظˆ طھط­ط¨طŒ ط§ط¨ط¹طھظ„ظٹ ط§ظ„ظ…ظٹط²ط§ظ†ظٹط© ظˆط§ظ„ظ…ظ‚ط§ط³ ظˆط£ظ†ط§ ط£ط±ط´ط­ظ„ظƒ ط£ظپط¶ظ„ ط§ظ„ظ…طھط§ط­.",
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
  if (!isAiAssistantGlobalEnabled(settings)) {
    throw Object.assign(new Error("AI assistant is globally paused"), { status: 409, code: "AI_ASSISTANT_GLOBAL_PAUSED" });
  }
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
