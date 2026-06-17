import db from "../database/db.js";
import crypto from "node:crypto";

import { repairCorruptedArabicValue } from "../utils/arabicTextRepair.js";

let schemaReadyPromise = null;

const toText = (value, fallback = "") => String(value ?? fallback).trim();
const repairText = (value, fallback = "") => repairCorruptedArabicValue(toText(value, fallback));

const jsonValue = (value) => JSON.stringify(value === undefined ? null : value);
const logSqlError = (stage, error, extra = {}) => {
  console.error("[ai-support-transcript-sql-error]", {
    stage,
    code: error?.code || "",
    message: error?.message || "",
    detail: error?.detail || "",
    hint: error?.hint || "",
    position: error?.position || "",
    ...extra,
  });
};

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const CONVERSATION_PREFIX_ALIASES = new Map([
  ["facebook_messenger", "facebook_messenger"],
  ["facebook", "facebook_messenger"],
  ["messenger", "facebook_messenger"],
  ["instagram", "instagram"],
  ["whatsapp", "whatsapp"],
  ["web_chat", "web_chat"],
  ["web", "web_chat"],
]);

const CONVERSATION_PREFIXES = new Set(["facebook_messenger", "instagram", "whatsapp", "web_chat"]);

const normalizeConversationChannel = (value = "") => {
  const lower = toText(value).toLowerCase();
  if (lower.includes("instagram")) return "instagram";
  if (lower.includes("facebook") && lower.includes("messenger")) return "facebook_messenger";
  if (lower.includes("messenger")) return "facebook_messenger";
  if (lower.includes("whatsapp")) return "whatsapp";
  if (lower.includes("web")) return "web_chat";
  return lower;
};

const normalizeConversationPrefix = (value = "") => CONVERSATION_PREFIX_ALIASES.get(normalizeConversationChannel(value)) || "";

const stripConversationPrefixes = (value = "") => {
  let current = toText(value);
  let prefix = "";

  while (current) {
    const match = current.match(/^([a-z0-9_]+):(.*)$/i);
    if (!match) break;
    const nextPrefix = normalizeConversationPrefix(match[1]);
    if (!nextPrefix || !CONVERSATION_PREFIXES.has(nextPrefix)) break;
    prefix = prefix || nextPrefix;
    current = toText(match[2]);
  }

  return { prefix, value: current };
};

const normalizeConversationSessionId = (sessionId = "", channel = "") => {
  const rawSessionId = toText(sessionId);
  if (!rawSessionId) return "";
  const stripped = stripConversationPrefixes(rawSessionId);
  const prefix = stripped.prefix || normalizeConversationPrefix(channel);
  const baseSessionId = stripped.value || rawSessionId;
  if (!baseSessionId) return rawSessionId;
  return prefix ? `${prefix}:${baseSessionId}` : baseSessionId;
};

const parseConversationReference = ({ sessionId = "", channel = "" } = {}) => {
  const rawSessionId = toText(sessionId);
  const requestedChannel = normalizeConversationChannel(channel);
  const stripped = stripConversationPrefixes(rawSessionId);
  const canonicalChannel = stripped.prefix || normalizeConversationPrefix(requestedChannel);
  const baseSessionId = stripped.value || rawSessionId;
  const normalizedSessionId = canonicalChannel ? `${canonicalChannel}:${baseSessionId}` : baseSessionId;
  return {
    channel: canonicalChannel || requestedChannel,
    sessionId: normalizedSessionId,
    baseSessionId,
    conversationKey: normalizedSessionId,
    lookupSessionIds: [...new Set([normalizedSessionId, rawSessionId, baseSessionId].filter(Boolean))],
  };
};

const isMetaConversationChannel = (value = "") => ["instagram", "facebook_messenger"].includes(normalizeConversationChannel(value));

const compactList = (items = [], limit = 20) =>
  [...new Set((Array.isArray(items) ? items : []).map((item) => toText(item).toLowerCase()).filter(Boolean))].slice(0, limit);

const extractTermsFromMessage = (message = "") => {
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "this", "that", "have", "has", "you", "your", "price", "stock", "available",
    "size", "color", "product", "item", "want", "need", "show", "similar", "كام", "سعر", "مقاس", "لون", "متاح", "موجود",
    "عايز", "عايزة", "عندكم", "منتج", "موديل", "ده", "دي", "في", "من", "على", "هل", "ايه", "اية",
  ]);
  return compactList(
    toText(message)
      .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2)
      .filter((word) => !stopWords.has(word.toLowerCase())),
    10
  );
};

const extractRequestedSizes = (message = "") =>
  compactList(toText(message).match(/\b(?:[2-5][0-9]|xs|s|m|l|xl|xxl|xxxl)\b/gi) || [], 8);

const COLOR_TERMS = [
  "black", "white", "red", "blue", "green", "yellow", "pink", "purple", "grey", "gray", "brown", "beige", "orange",
  "navy", "silver", "gold", "اسود", "أسود", "ابيض", "أبيض", "احمر", "أحمر", "ازرق", "أزرق", "اخضر", "أخضر",
  "اصفر", "أصفر", "وردي", "بنفسجي", "رمادي", "رصاصي", "بني", "بيج", "برتقالي", "كحلي", "فضي", "ذهبي",
];

const extractRequestedColors = (message = "") => {
  const lower = toText(message).toLowerCase();
  return compactList(COLOR_TERMS.filter((color) => lower.includes(color.toLowerCase())), 8);
};

const incrementAliasUsage = async ({ tenantId, aliases = [], confidence = 0 } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeAliases = compactList(aliases, 10);
  if (!safeTenantId || !safeAliases.length) return;

  for (const alias of safeAliases) {
    await db.query(
      `
      INSERT INTO ai_support_product_aliases (tenant_id, alias, mapped_product_id, usage_count, confidence)
      VALUES ($1, $2, NULL, 1, $3)
      ON CONFLICT (tenant_id, alias) DO UPDATE SET
        usage_count = ai_support_product_aliases.usage_count + 1,
        confidence = GREATEST(ai_support_product_aliases.confidence, EXCLUDED.confidence),
        updated_at = CURRENT_TIMESTAMP
      `,
      [safeTenantId, alias, Math.max(0, Math.min(1, Number(confidence || 0)))]
    );
  }
};

const buildOutboundTranscriptDedupeKey = ({
  tenantId,
  sessionId,
  channel,
  senderType,
  messageType,
  message,
  deliveryStatus,
  deliveryError,
  externalMessageId,
  providerMessageId,
  whatsappInstance,
  remoteJid,
  resolvedReplyJid,
  resolvedPhone,
  externalReplyId,
  sourcePath,
  insertSource,
  productCards = [],
  timestamp = new Date().toISOString(),
} = {}) => {
  const providerKey = toText(providerMessageId || externalMessageId);
  if (providerKey) return providerKey;
  const minuteBucket = Math.floor(new Date(timestamp || Date.now()).getTime() / 60000);
  const cardKey = asArray(productCards)
    .map((card) =>
      [
        toText(card?.product_id || card?.id || ""),
        toText(card?.variant_id || card?.selected_variant_id || card?.matched_variant_id || ""),
        toText(card?.color || card?.color_name || card?.matched_variant_color || ""),
        toText(card?.image_url || card?.image || card?.main_image || ""),
      ].join(":")
    )
    .join("|");
  const payload = [
    tenantId,
    sessionId,
    channel,
    senderType,
    messageType,
    repairText(message),
    deliveryStatus,
    deliveryError,
    whatsappInstance,
    remoteJid,
    resolvedReplyJid,
    resolvedPhone,
    externalReplyId,
    sourcePath,
    insertSource,
    minuteBucket,
    cardKey,
  ]
    .map((item) => toText(item))
    .join("|");
  return `dedupe:${crypto.createHash("sha1").update(payload).digest("hex")}`;
};

const persistOutboundTranscriptRow = async ({
  tenantId,
  sessionId,
  message,
  answer = "",
  messageType = "text",
  senderType = "ai",
  manualMessage = false,
  staffUserId = null,
  staffUserName = "",
  source = "admin_console",
  channel = "",
  deliveryStatus = "",
  deliveryError = "",
  errorCode = "",
  externalMessageId = "",
  providerMessageId = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
  externalReplyId = "",
  productCards = [],
  preserveExactMessage = false,
  upsertSession = false,
  sessionStatus = "ai_active",
  sessionSource = "",
  sessionChannel = "",
  sessionCustomerName = "",
  sourcePath = "manual_message_insert",
  insertSource = "manual_message_insert",
  dedupeKey = "",
  confidence = 1,
  detectedIntent = "",
  suggestedProducts = [],
  visualAttachments = [],
  suggestedActions = [],
  staffMessage = "",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeChannel = toText(channel || "web_chat");
  const safeSenderType = toText(senderType || (manualMessage ? "staff" : "ai") || "ai");
  const safeMessageType = toText(messageType || "text") || "text";
  const safeMessage = preserveExactMessage ? String(message ?? answer ?? staffMessage ?? "") : repairText(message || answer || staffMessage);
  const safeAnswer = preserveExactMessage ? String(answer || message || staffMessage || "") : repairText(answer || message || staffMessage);
  const safeStaffMessage = preserveExactMessage ? String(staffMessage || message || answer || "") : repairText(staffMessage || message || answer);
  const safeProductCards = Array.isArray(productCards) ? productCards : [];
  const safeSuggestedProducts = Array.isArray(suggestedProducts) ? suggestedProducts : [];
  const safeVisualAttachments = Array.isArray(visualAttachments) ? visualAttachments : [];
  const safeSuggestedActions = Array.isArray(suggestedActions) ? suggestedActions : [];
  const safeExternalMessageId = toText(externalMessageId || providerMessageId);
  const safeProviderMessageId = toText(providerMessageId || externalMessageId);
  const safeExternalReplyId = toText(externalReplyId);
  const safeSourcePath = toText(sourcePath, "manual_message_insert");
  const safeInsertSource = toText(insertSource, "manual_message_insert");
  const safeSessionSource = toText(sessionSource || source || safeChannel || "web_chat");
  const safeSessionChannel = toText(sessionChannel || safeChannel || "web_chat");
  const safeSessionCustomerName = toText(sessionCustomerName);
  const safeDetectedIntent = toText(detectedIntent);
  const safeDedupeKey = toText(dedupeKey) || buildOutboundTranscriptDedupeKey({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    channel: safeChannel,
    senderType: safeSenderType,
    messageType: safeMessageType,
    message: safeMessage || safeStaffMessage || safeAnswer,
    deliveryStatus,
    deliveryError,
    externalMessageId: safeExternalMessageId,
    providerMessageId: safeProviderMessageId,
    whatsappInstance,
    remoteJid,
    resolvedReplyJid,
    resolvedPhone,
    externalReplyId: safeExternalReplyId,
    sourcePath: safeSourcePath,
    insertSource: safeInsertSource,
    productCards: safeProductCards,
  });
  if (!safeTenantId || !safeSessionId || !(safeMessage || safeProductCards.length)) {
    throw Object.assign(new Error("Reply message is required"), { status: 400 });
  }
  await ensureAiSupportLogSchema();

  let sessionRefId = null;
  if (upsertSession) {
    try {
      const sessionResult = await db.query(
        `
        INSERT INTO ai_support_sessions (
          tenant_id, user_id, session_id, source, status, channel, customer_name, last_message, assigned_user_id, assigned_user_name, takeover_started_at, ai_enabled, updated_at
        )
        VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $2::bigint, $9::text, CASE WHEN $5::text = 'human_takeover' THEN NOW() ELSE NULL END, TRUE, NOW())
        ON CONFLICT (tenant_id, session_id) DO UPDATE SET
          user_id = COALESCE(EXCLUDED.user_id, ai_support_sessions.user_id),
          source = CASE
            WHEN EXCLUDED.source IN ('admin_console', 'ai_followup_center') AND ai_support_sessions.source IN ('facebook_messenger', 'instagram', 'whatsapp', 'web_chat')
              THEN ai_support_sessions.source
            ELSE COALESCE(NULLIF(EXCLUDED.source, ''), ai_support_sessions.source)
          END,
          status = CASE
            WHEN ai_support_sessions.status = 'closed' THEN ai_support_sessions.status
            WHEN EXCLUDED.status = 'human_takeover' THEN 'human_takeover'
            ELSE COALESCE(NULLIF(EXCLUDED.status, ''), ai_support_sessions.status, 'ai_active')
          END,
          channel = COALESCE(NULLIF(EXCLUDED.channel, ''), ai_support_sessions.channel),
          customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
          last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_sessions.last_message),
          assigned_user_id = COALESCE(ai_support_sessions.assigned_user_id, EXCLUDED.assigned_user_id),
          assigned_user_name = COALESCE(NULLIF(ai_support_sessions.assigned_user_name, ''), EXCLUDED.assigned_user_name, ''),
          takeover_started_at = COALESCE(ai_support_sessions.takeover_started_at, EXCLUDED.takeover_started_at),
          ai_enabled = COALESCE(ai_support_sessions.ai_enabled, EXCLUDED.ai_enabled),
          updated_at = NOW()
        RETURNING id
        `,
        [
          safeTenantId,
          numberOrNull(staffUserId),
          safeSessionId,
          safeSessionSource,
          toText(sessionStatus, manualMessage ? "human_takeover" : "ai_active") || "ai_active",
          safeSessionChannel,
          safeSessionCustomerName,
          safeMessage || safeStaffMessage || safeAnswer,
          toText(staffUserName),
        ]
      );
      sessionRefId = sessionResult.rows[0]?.id || null;
    } catch (error) {
      logSqlError("session_upsert", error, { tenantId: safeTenantId, sessionId: safeSessionId, source: safeSessionSource, channel: safeSessionChannel });
      throw error;
    }
  }

  const values = [
    sessionRefId || null,
    safeTenantId,
    numberOrNull(staffUserId),
    safeSessionId,
    safeMessage || safeStaffMessage || safeAnswer,
    "",
    safeAnswer || safeMessage || safeStaffMessage || "",
    Number(confidence) || 1,
    false,
    jsonValue([]),
    jsonValue(safeSuggestedProducts),
    jsonValue(safeVisualAttachments),
    jsonValue(safeSuggestedActions),
    safeDetectedIntent,
    "",
    safeStaffMessage || (safeSenderType !== "ai" ? safeMessage : ""),
    safeSenderType,
    manualMessage,
    numberOrNull(staffUserId),
    toText(staffUserName),
    safeChannel,
    safeSourcePath,
    toText(deliveryStatus),
    toText(deliveryError),
    toText(errorCode),
    safeExternalMessageId,
    safeProviderMessageId,
    toText(whatsappInstance),
    toText(remoteJid),
    toText(resolvedReplyJid),
    toText(resolvedPhone),
    safeExternalReplyId,
    safeMessageType,
    jsonValue(safeProductCards),
    safeDedupeKey,
    safeInsertSource,
  ];

  const baseColumns = `
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
    channel,
    source_path,
    delivery_status,
    delivery_error,
    error_code,
    external_message_id,
    provider_message_id,
    whatsapp_instance,
    remote_jid,
    resolved_reply_jid,
    resolved_phone,
    external_reply_id,
    message_type,
    product_cards,
    dedupe_key,
    insert_source
  `;

  const updateSql = `
    UPDATE ai_support_messages
    SET
      session_ref_id = $2,
      tenant_id = $3,
      user_id = $4,
      session_id = $5,
      message_text = $6,
      customer_message = $7,
      ai_answer = $8,
      confidence = $9,
      needs_human_support = $10,
      sources_used = $11::jsonb,
      suggested_products = $12::jsonb,
      visual_attachments = $13::jsonb,
      suggested_actions = $14::jsonb,
      detected_intent = $15,
      fallback_reason = $16,
      staff_message = $17,
      sender_type = $18,
      manual_message = $19,
      staff_user_id = $20,
      staff_user_name = $21,
      channel = $22,
      source_path = $23,
      delivery_status = $24,
      delivery_error = $25,
      error_code = $26,
      external_message_id = $27,
      provider_message_id = $28,
      whatsapp_instance = $29,
      remote_jid = $30,
      resolved_reply_jid = $31,
      resolved_phone = $32,
      external_reply_id = $33,
      message_type = $34,
      product_cards = $35::jsonb,
      dedupe_key = $36,
      insert_source = $37,
      updated_at = NOW()
    WHERE id = $1::bigint
    RETURNING *
  `;

  const providerKey = safeProviderMessageId;
  if (providerKey) {
    const existingProvider = await db.query(
      `
      SELECT id
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND channel = $2
        AND provider_message_id = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeChannel, providerKey]
    );
    if (existingProvider.rows[0]?.id) {
      const updated = await db.query(updateSql, [existingProvider.rows[0].id, ...values]);
      return updated.rows[0] || null;
    }
  }

  if (safeDedupeKey) {
    const existingDedupe = await db.query(
      `
      SELECT id
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        AND dedupe_key = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeSessionId, safeDedupeKey]
    );
    if (existingDedupe.rows[0]?.id) {
      const updated = await db.query(updateSql, [existingDedupe.rows[0].id, ...values]);
      return updated.rows[0] || null;
    }
  }

  let inserted;
  try {
    inserted = await db.query(
      `
      INSERT INTO ai_support_messages (${baseColumns})
      VALUES ($1::bigint, $2::bigint, $3::bigint, $4::text, $5::text, $6::text, $7::text, $8::numeric, $9::boolean, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::text, $15::text, $16::text, $17::text, $18::boolean, $19::bigint, $20::text, $21::text, $22::text, $23::text, $24::text, $25::text, $26::text, $27::text, $28::text, $29::text, $30::text, $31::text, $32::text, $33::text, $34::jsonb, $35::text, $36::text)
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      values
    );
  } catch (error) {
    logSqlError("insert_message", error, {
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      messageType: safeMessageType,
      channel: safeChannel,
      providerMessageId: safeProviderMessageId,
      dedupeKey: safeDedupeKey,
    });
    throw error;
  }
  if (inserted.rows[0]) return inserted.rows[0];

  if (providerKey) {
    const fallbackProvider = await db.query(
      `
      SELECT *
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND channel = $2
        AND provider_message_id = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeChannel, providerKey]
    );
    if (fallbackProvider.rows[0]) return fallbackProvider.rows[0];
  }

  if (safeDedupeKey) {
    const fallbackDedupe = await db.query(
      `
      SELECT *
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        AND dedupe_key = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeSessionId, safeDedupeKey]
    );
    if (fallbackDedupe.rows[0]) return fallbackDedupe.rows[0];
  }
  return null;
};

export const ensureAiSupportLogSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_support_sessions (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          user_id BIGINT NULL,
          session_id TEXT NOT NULL,
          source VARCHAR(80) NOT NULL DEFAULT 'admin_console',
          status VARCHAR(40) NOT NULL DEFAULT 'ai_active',
          channel TEXT NOT NULL DEFAULT 'web_chat',
          thread_kind TEXT NOT NULL DEFAULT 'dm',
          ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          customer_name TEXT NOT NULL DEFAULT '',
          last_message TEXT NOT NULL DEFAULT '',
          assigned_user_id BIGINT NULL,
          assigned_user_name TEXT NOT NULL DEFAULT '',
          takeover_started_at TIMESTAMP NULL,
          returned_to_ai_at TIMESTAMP NULL,
          closed_at TIMESTAMP NULL,
          read_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, session_id)
        )
      `);

      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_support_messages (
          id BIGSERIAL PRIMARY KEY,
          session_ref_id BIGINT NULL REFERENCES ai_support_sessions(id) ON DELETE CASCADE,
          tenant_id BIGINT NOT NULL,
          user_id BIGINT NULL,
          session_id TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'web_chat',
          customer_name TEXT NOT NULL DEFAULT '',
          last_message TEXT NOT NULL DEFAULT '',
          message_text TEXT NOT NULL DEFAULT '',
          customer_message TEXT NOT NULL,
          ai_answer TEXT NOT NULL DEFAULT '',
          confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
          needs_human_support BOOLEAN NOT NULL DEFAULT TRUE,
          sources_used JSONB NOT NULL DEFAULT '[]'::jsonb,
          suggested_products JSONB NOT NULL DEFAULT '[]'::jsonb,
          visual_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
          suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
          detected_intent TEXT NOT NULL DEFAULT '',
          intent_confidence NUMERIC(5,2),
          sentiment TEXT,
          detected_language TEXT,
          handoff_to_human BOOLEAN DEFAULT FALSE,
          resolution_status TEXT DEFAULT 'open',
          ai_response_time_ms INTEGER,
          fallback_reason TEXT NOT NULL DEFAULT '',
          message_type TEXT NOT NULL DEFAULT 'text',
          product_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
          external_reply_id TEXT NOT NULL DEFAULT '',
          staff_message TEXT NOT NULL DEFAULT '',
          sender_type VARCHAR(40) NOT NULL DEFAULT 'customer',
          manual_message BOOLEAN NOT NULL DEFAULT FALSE,
          staff_user_id BIGINT NULL,
          staff_user_name TEXT NOT NULL DEFAULT '',
          external_message_id TEXT NOT NULL DEFAULT '',
          dedupe_key TEXT NOT NULL DEFAULT '',
          source_path TEXT NOT NULL DEFAULT '',
          delivery_status TEXT NOT NULL DEFAULT '',
          delivery_error TEXT NOT NULL DEFAULT '',
          error_code TEXT NOT NULL DEFAULT '',
          requested_product_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
          requested_sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
          requested_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
          clicked_product_id BIGINT NULL,
          added_to_cart_after_chat BOOLEAN NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'ai_active'`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS thread_kind TEXT NOT NULL DEFAULT 'dm'`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS takeover_started_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS returned_to_ai_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS detected_intent TEXT`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS sentiment TEXT`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS escalation_reason TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS last_escalation_keyword TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS message_text TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS sentiment TEXT`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS product_cards JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS external_reply_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS requested_product_terms JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS requested_sizes JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS requested_colors JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS visual_attachments JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS staff_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(40) NOT NULL DEFAULT 'customer'`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS manual_message BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS staff_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS staff_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS external_message_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS source_path TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS whatsapp_instance TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS remote_jid TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS resolved_reply_jid TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS resolved_phone TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS insert_source TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS delivery_error TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS error_code TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS clicked_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS added_to_cart_after_chat BOOLEAN NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS detected_intent TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC(5,2)`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS sentiment TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS detected_language TEXT`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS handoff_to_human BOOLEAN DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS ai_response_time_ms INTEGER`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_channel_conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_channel_conversations ADD COLUMN IF NOT EXISTS thread_kind TEXT NOT NULL DEFAULT 'dm'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_channel_conversations ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
      await clientOrPool.query(`UPDATE ai_support_messages SET message_text = customer_message WHERE COALESCE(message_text, '') = ''`);

      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_support_product_aliases (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          alias TEXT NOT NULL,
          mapped_product_id BIGINT NULL,
          usage_count INTEGER NOT NULL DEFAULT 0,
          confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, alias)
        )
      `);

      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_sessions_tenant_updated ON ai_support_sessions (tenant_id, updated_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_sessions_tenant_status ON ai_support_sessions (tenant_id, status, updated_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_created ON ai_support_messages (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_session_created ON ai_support_messages (tenant_id, session_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_session_created ON ai_support_messages (session_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_human ON ai_support_messages (tenant_id, needs_human_support, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_confidence ON ai_support_messages (tenant_id, confidence, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_clicked ON ai_support_messages (tenant_id, clicked_product_id, created_at DESC)`);
      await clientOrPool.query(`UPDATE ai_support_messages SET insert_source = COALESCE(insert_source, CASE WHEN channel = 'whatsapp' AND NULLIF(provider_message_id, '') IS NOT NULL THEN 'whatsapp_unknown_legacy' WHEN channel = 'facebook_messenger' THEN 'meta_messenger_legacy' WHEN channel = 'instagram' THEN 'instagram_dm_legacy' ELSE 'legacy_unknown' END) WHERE insert_source IS NULL`);
      await clientOrPool.query(`
        DELETE FROM ai_support_messages newer
        USING ai_support_messages older
        WHERE newer.id > older.id
          AND newer.tenant_id = older.tenant_id
          AND newer.session_id = older.session_id
          AND COALESCE(NULLIF(newer.dedupe_key, ''), NULLIF(newer.external_message_id, '')) <> ''
          AND COALESCE(NULLIF(newer.dedupe_key, ''), NULLIF(newer.external_message_id, '')) =
              COALESCE(NULLIF(older.dedupe_key, ''), NULLIF(older.external_message_id, ''))
      `);
      await clientOrPool.query(`
        DELETE FROM ai_support_messages newer
        USING ai_support_messages older
        WHERE newer.id > older.id
          AND newer.tenant_id = older.tenant_id
          AND newer.session_id = older.session_id
          AND newer.sender_type = older.sender_type
          AND COALESCE(NULLIF(newer.external_message_id, ''), NULLIF(newer.dedupe_key, '')) IS NULL
          AND COALESCE(NULLIF(older.external_message_id, ''), NULLIF(older.dedupe_key, '')) IS NULL
          AND newer.sender_type = 'customer'
          AND COALESCE(newer.fallback_reason, '') = 'ai_status:pending'
          AND COALESCE(older.fallback_reason, '') = 'ai_status:pending'
          AND COALESCE(newer.customer_message, newer.message_text, '') = COALESCE(older.customer_message, older.message_text, '')
          AND newer.created_at <= older.created_at + INTERVAL '5 minutes'
      `);
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_dedupe
        ON ai_support_messages (tenant_id, session_id, dedupe_key)
        WHERE dedupe_key <> ''
      `);
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_provider_message_id
        ON ai_support_messages (tenant_id, channel, whatsapp_instance, remote_jid, provider_message_id)
        WHERE provider_message_id <> ''
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_aliases_tenant_usage ON ai_support_product_aliases (tenant_id, mapped_product_id, usage_count DESC)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
};

export const getAiSupportConversationState = async ({ tenantId, sessionId, channel = "" } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const conversationReference = parseConversationReference({ sessionId, channel });
  const sessionCandidates = conversationReference.lookupSessionIds || [conversationReference.sessionId];
  const safeSessionId = sessionCandidates[0];
  const safeChannel = conversationReference.channel;
  if (!safeTenantId || !safeSessionId) return null;
  await ensureAiSupportLogSchema();

  let sessionState = { rows: [] };
  for (const candidateSessionId of sessionCandidates) {
    sessionState = await db.query(
      `
      SELECT *
      FROM ai_support_sessions
      WHERE tenant_id = $1 AND session_id = $2
      LIMIT 1
      `,
      [safeTenantId, candidateSessionId]
    );
    if (sessionState.rows[0]) break;
  }

  if (safeChannel) {
    let channelState = { rows: [] };
    for (const candidateSessionId of sessionCandidates) {
      channelState = await db.query(
        `
        SELECT *
        FROM ai_channel_conversations
        WHERE tenant_id = $1 AND channel = $2 AND external_conversation_id = $3
        LIMIT 1
        `,
        [safeTenantId, safeChannel, candidateSessionId]
      );
      if (channelState.rows[0]) break;
    }
    if (channelState.rows[0]) {
      return {
        ...(sessionState.rows[0] || {}),
        ...channelState.rows[0],
        ai_enabled: channelState.rows[0].ai_enabled !== undefined
          ? channelState.rows[0].ai_enabled !== false
          : sessionState.rows[0]?.ai_enabled !== false,
        channel: channelState.rows[0].channel || sessionState.rows[0]?.channel || safeChannel,
        session_id: sessionState.rows[0]?.session_id || conversationReference.sessionId,
        external_conversation_id: channelState.rows[0].external_conversation_id || sessionState.rows[0]?.session_id || conversationReference.sessionId,
      };
    }
  }

  return sessionState.rows[0] || null;
};

export const updateAiSupportConversationAiEnabled = async ({
  tenantId,
  sessionId,
  channel = "",
  aiEnabled = true,
  actorUserId = null,
  source = "admin_console",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeChannel = normalizeConversationChannel(channel);
  const safeEnabled = aiEnabled !== false;
  if (!safeTenantId || !safeSessionId) {
    throw Object.assign(new Error("tenant_id and conversation id are required"), { status: 400 });
  }
  await ensureAiSupportLogSchema();

  const sessionState = await db.query(
    `
    SELECT channel
    FROM ai_support_sessions
    WHERE tenant_id = $1 AND session_id = $2
    LIMIT 1
    `,
    [safeTenantId, safeSessionId]
  );
  const existingChannelRows = await db.query(
    `
    SELECT DISTINCT channel
    FROM ai_channel_conversations
    WHERE tenant_id = $1 AND external_conversation_id = $2
    `,
    [safeTenantId, safeSessionId]
  );
  const resolvedChannels = [...new Set([
    safeChannel,
    normalizeConversationChannel(sessionState.rows[0]?.channel || ""),
    ...existingChannelRows.rows.map((row) => normalizeConversationChannel(row.channel || "")),
  ].map((value) => normalizeConversationChannel(value)).filter(Boolean))];
  const sessionResult = await db.query(
    `
    INSERT INTO ai_support_sessions (
      tenant_id,
      user_id,
      session_id,
      source,
      ai_enabled,
      updated_at
    )
    VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::boolean, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, ai_support_sessions.user_id),
      source = COALESCE(NULLIF(EXCLUDED.source, ''), ai_support_sessions.source),
      ai_enabled = EXCLUDED.ai_enabled,
      updated_at = NOW()
    RETURNING *
    `,
    [safeTenantId, numberOrNull(actorUserId), safeSessionId, toText(source, "admin_console"), safeEnabled]
  );
  for (const resolvedChannel of resolvedChannels) {
    await db.query(
      `
      INSERT INTO ai_channel_conversations (
        tenant_id,
        channel,
        external_conversation_id,
        ai_enabled,
        updated_at
      )
      VALUES ($1::bigint, $2::text, $3::text, $4::boolean, NOW())
      ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
        ai_enabled = EXCLUDED.ai_enabled,
        updated_at = NOW()
      `,
      [safeTenantId, resolvedChannel, safeSessionId, safeEnabled]
    );
  }

  const channelResult = resolvedChannels.length
    ? await db.query(
        `
        SELECT *
        FROM ai_channel_conversations
        WHERE tenant_id = $1
          AND external_conversation_id = $2
          AND channel = ANY($3::text[])
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        `,
        [safeTenantId, safeSessionId, resolvedChannels]
      )
    : { rows: [] };

  console.log("[ai-toggle] conversation ai state updated", {
    tenant_id: safeTenantId,
    conversation_id: safeSessionId,
    channel: safeChannel || resolvedChannels[0] || "",
    targets: ["ai_support_sessions", ...resolvedChannels.map(() => "ai_channel_conversations")],
    ai_enabled: safeEnabled,
  });
  return {
    ...(sessionResult.rows[0] || {}),
    ...(channelResult.rows[0] || {}),
    ai_enabled: safeEnabled,
    channel: safeChannel || channelResult.rows[0]?.channel || sessionResult.rows[0]?.channel || resolvedChannels[0] || "",
    session_id: safeSessionId,
    external_conversation_id: safeSessionId,
  };
};

export const markAiSupportConversationRead = async ({
  tenantId,
  sessionId,
  channel = "",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeChannel = normalizeConversationChannel(channel);
  if (!safeTenantId || !safeSessionId) {
    throw Object.assign(new Error("tenant_id and conversation id are required"), { status: 400 });
  }
  await ensureAiSupportLogSchema();

  const conversationReference = parseConversationReference({ sessionId: safeSessionId, channel: safeChannel });
  const state = await getAiSupportConversationState({ tenantId: safeTenantId, sessionId: conversationReference.sessionId, channel: conversationReference.channel });
  if (!state) {
    throw Object.assign(new Error("Conversation not found"), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" });
  }

  const resolvedSessionId = toText(state.session_id || state.external_conversation_id || conversationReference.sessionId);
  const resolvedChannel = normalizeConversationChannel(state.channel || state.session_channel || state.source || conversationReference.channel || safeChannel);
  const readAt = new Date().toISOString();
  const sessionResult = await db.query(
    `
    UPDATE ai_support_sessions
    SET read_at = $3::timestamp
    WHERE tenant_id = $1::bigint AND session_id = $2::text
    RETURNING *
    `,
    [safeTenantId, resolvedSessionId, readAt]
  );

  const channelResult = resolvedChannel
    ? await db.query(
        `
        UPDATE ai_channel_conversations
        SET read_at = $4::timestamp
        WHERE tenant_id = $1::bigint
          AND external_conversation_id = $2::text
          AND channel = $3::text
        RETURNING *
        `,
        [safeTenantId, resolvedSessionId, resolvedChannel, readAt]
      )
    : { rows: [] };

  return {
    read_at: readAt,
    session_id: resolvedSessionId,
    channel: resolvedChannel || state.channel || state.session_channel || state.source || "",
    conversation_key: conversationReference.conversationKey,
    ...(sessionResult.rows[0] || {}),
    ...(channelResult.rows[0] || {}),
  };
};

export const updateAiSupportConversationState = async ({
  tenantId,
  sessionId,
  status,
  assignedUserId = undefined,
  assignedUserName = undefined,
  actorUserId = null,
  source = "admin_console",
  allowClosedReopen = false,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeStatus = toText(status || "ai_active");
  if (!safeTenantId || !safeSessionId) {
    throw Object.assign(new Error("tenant_id and conversation id are required"), { status: 400 });
  }
  if (!["ai_active", "human_takeover", "closed"].includes(safeStatus)) {
    throw Object.assign(new Error("Invalid conversation status"), { status: 400 });
  }
  await ensureAiSupportLogSchema();
  const current = await db.query(
    `SELECT status FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1`,
    [safeTenantId, safeSessionId]
  );
  if (current.rows[0]?.status === "closed" && safeStatus !== "closed" && allowClosedReopen !== true) {
    throw Object.assign(new Error("Conversation is closed"), { status: 409 });
  }
  console.log("ai_return_to_ai_session_lookup", {
    tenant_id: safeTenantId,
    session_id: safeSessionId,
    target_status: safeStatus,
    found: Boolean(current.rows[0]),
    current_status: current.rows[0]?.status || "",
  });

  const resolvedAssignedUserId = assignedUserId === undefined
    ? (safeStatus === "human_takeover" ? numberOrNull(actorUserId) : null)
    : numberOrNull(assignedUserId);
  const resolvedAssignedUserName = assignedUserName === undefined
    ? ""
    : toText(assignedUserName);

  const result = await db.query(
    `
    INSERT INTO ai_support_sessions (
      tenant_id,
      user_id,
      session_id,
      source,
      status,
      assigned_user_id,
      assigned_user_name,
      takeover_started_at,
      returned_to_ai_at,
      closed_at,
      updated_at
    )
    VALUES (
      $1::bigint, $2::bigint, $3::text, $4::text, $5::varchar(40), $6::bigint, $7::text,
      CASE WHEN $8::text = 'human_takeover' THEN NOW() ELSE NULL END,
      CASE WHEN $9::text = 'ai_active' THEN NOW() ELSE NULL END,
      CASE WHEN $10::text = 'closed' THEN NOW() ELSE NULL END,
      NOW()
    )
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, ai_support_sessions.user_id),
      source = COALESCE(NULLIF(EXCLUDED.source, ''), ai_support_sessions.source),
      status = EXCLUDED.status,
      assigned_user_id = CASE
        WHEN EXCLUDED.status = 'human_takeover' THEN COALESCE(EXCLUDED.assigned_user_id, ai_support_sessions.assigned_user_id)
        ELSE NULL
      END,
      assigned_user_name = CASE
        WHEN EXCLUDED.status = 'human_takeover' THEN COALESCE(NULLIF(EXCLUDED.assigned_user_name, ''), ai_support_sessions.assigned_user_name, '')
        ELSE ''
      END,
      takeover_started_at = CASE
        WHEN EXCLUDED.status = 'human_takeover' THEN COALESCE(ai_support_sessions.takeover_started_at, NOW())
        WHEN EXCLUDED.status = 'ai_active' THEN NULL
        ELSE ai_support_sessions.takeover_started_at
      END,
      returned_to_ai_at = CASE WHEN EXCLUDED.status = 'ai_active' THEN NOW() ELSE ai_support_sessions.returned_to_ai_at END,
      closed_at = CASE WHEN EXCLUDED.status = 'closed' THEN NOW() ELSE NULL END,
      handoff_to_human = CASE WHEN EXCLUDED.status = 'ai_active' THEN FALSE ELSE ai_support_sessions.handoff_to_human END,
      escalation_reason = CASE WHEN EXCLUDED.status = 'ai_active' THEN '' ELSE ai_support_sessions.escalation_reason END,
      last_escalation_keyword = CASE WHEN EXCLUDED.status = 'ai_active' THEN '' ELSE ai_support_sessions.last_escalation_keyword END,
      escalated_at = CASE WHEN EXCLUDED.status = 'ai_active' THEN NULL ELSE ai_support_sessions.escalated_at END,
      updated_at = NOW()
    RETURNING *
    `,
    [
      safeTenantId,
      numberOrNull(actorUserId),
      safeSessionId,
      toText(source, "admin_console"),
      safeStatus,
      resolvedAssignedUserId,
      resolvedAssignedUserName,
      safeStatus,
      safeStatus,
      safeStatus,
    ]
  );
  return result.rows[0] || null;
};

export const assignAiSupportConversation = async ({
  tenantId,
  sessionId,
  assignedUserId = null,
  assignedUserName = "",
  actorUserId = null,
} = {}) => {
  const state = await updateAiSupportConversationState({
    tenantId,
    sessionId,
    status: "human_takeover",
    assignedUserId,
    assignedUserName,
    actorUserId,
  });
  return state;
};

export const markAiSupportConversationEscalated = async ({
  tenantId,
  sessionId,
  reason = "",
  keyword = "",
  actorUserId = null,
  source = "ai_escalation",
} = {}) => {
  const state = await updateAiSupportConversationState({
    tenantId,
    sessionId,
    status: "human_takeover",
    assignedUserId: null,
    assignedUserName: "",
    actorUserId,
    source,
  });
  await ensureAiSupportLogSchema();
  const result = await db.query(
    `
    UPDATE ai_support_sessions
    SET
      escalation_reason = $3::text,
      last_escalation_keyword = $4::text,
      escalated_at = COALESCE(escalated_at, NOW()),
      handoff_to_human = TRUE,
      updated_at = NOW()
    WHERE tenant_id = $1::bigint AND session_id = $2::text
    RETURNING *
    `,
    [numberOrNull(tenantId), toText(sessionId), toText(reason), toText(keyword)]
  );
  return result.rows[0] || state;
};

export const appendManualAiSupportReply = async ({
  tenantId,
  sessionId,
  message,
  messageType = "text",
  productCards = [],
  previewMessage = "",
  staffUserId = null,
  staffUserName = "",
  source = "admin_console",
  channel = "",
  deliveryStatus = "",
  deliveryError = "",
  errorCode = "",
  externalMessageId = "",
  providerMessageId = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
  externalReplyId = "",
  preserveExactMessage = false,
  upsertSession = true,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessage = preserveExactMessage ? String(message ?? "") : repairText(message || previewMessage);
  if (upsertSession && safeTenantId && safeSessionId) {
    const sessionResult = await db.query(
      `
      SELECT status
      FROM ai_support_sessions
      WHERE tenant_id = $1 AND session_id = $2
      LIMIT 1
      `,
      [safeTenantId, safeSessionId]
    );
    if (sessionResult.rows[0]?.status === "closed") {
      throw Object.assign(new Error("Conversation is closed"), { status: 409 });
    }
  }

  const result = await persistOutboundTranscriptRow({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    message: safeMessage,
    messageType,
    senderType: "staff",
    manualMessage: true,
    staffUserId,
    staffUserName,
    source,
    channel,
    deliveryStatus,
    deliveryError,
    errorCode,
    externalMessageId,
    providerMessageId,
    whatsappInstance,
    remoteJid,
    resolvedReplyJid,
    resolvedPhone,
    externalReplyId,
    productCards,
    preserveExactMessage,
    upsertSession,
    sessionStatus: "human_takeover",
    sessionSource: source,
    sessionChannel: channel || "web_chat",
    sessionCustomerName: "",
    sourcePath: "manual_message_insert",
    insertSource: "manual_message_insert",
    staffMessage: safeMessage,
  });
  console.info("[ai-support-insert]", {
    source: "ai_support_route",
    session_id: safeSessionId,
    channel: toText(channel, "web_chat"),
    message_id: result?.id || null,
  });
  if (upsertSession && safeTenantId && safeSessionId) {
    await db.query(
      `
      UPDATE ai_support_sessions
      SET last_message = $3,
          channel = COALESCE(NULLIF($4, ''), channel),
          updated_at = NOW()
      WHERE tenant_id = $1 AND session_id = $2
      `,
      [safeTenantId, safeSessionId, safeMessage || repairText(message || previewMessage), repairText(channel)]
    ).catch(() => {});
  }

  return result || null;
};

export const appendAiGeneratedSupportReply = async ({
  tenantId,
  sessionId,
  answer = "",
  messageType = "",
  confidence = 0.72,
  detectedIntent = "",
  suggestedProducts = [],
  visualAttachments = [],
  suggestedActions = [],
  productCards = [],
  channel = "",
  deliveryStatus = "",
  deliveryError = "",
  externalMessageId = "",
  providerMessageId = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
  sourcePath = "retry_worker",
  insertSource = "ai_support_route",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeProductCards = Array.isArray(productCards) ? productCards : [];
  const safeAnswer = repairText(answer || (safeProductCards.length ? `Product cards sent (${safeProductCards.length})` : ""));
  const safeMessageType = toText(messageType || (safeProductCards.length ? "product_card" : "text")) || "text";
  const sessionResult = await db.query(
    `
    SELECT id, status
    FROM ai_support_sessions
    WHERE tenant_id = $1 AND session_id = $2
    LIMIT 1
    `,
    [safeTenantId, safeSessionId]
  );
  if (["human_takeover", "closed"].includes(sessionResult.rows[0]?.status)) {
    throw Object.assign(new Error("AI is paused for this conversation"), { status: 409 });
  }
  const result = await persistOutboundTranscriptRow({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    message: safeAnswer,
    answer: safeAnswer,
    messageType: safeMessageType,
    senderType: "ai",
    manualMessage: false,
    source: insertSource,
    channel,
    confidence,
    deliveryStatus,
    deliveryError,
    externalMessageId,
    providerMessageId,
    whatsappInstance,
    remoteJid,
    resolvedReplyJid,
    resolvedPhone,
    productCards,
    preserveExactMessage: false,
    upsertSession: true,
    sessionStatus: "ai_active",
    sessionSource: "whatsapp",
    sessionChannel: channel || "web_chat",
    sessionCustomerName: "",
    sourcePath,
    insertSource,
    dedupeKey: "",
    detectedIntent,
    suggestedProducts,
    visualAttachments,
    suggestedActions,
  });
  await db.query(
    `
    UPDATE ai_support_sessions
    SET last_message = $3,
      updated_at = NOW()
    WHERE tenant_id = $1 AND session_id = $2
    `,
    [safeTenantId, safeSessionId, repairText(safeAnswer)]
  ).catch(() => {});
  return result || null;
};

export const appendWhatsappOutboundSupportReply = async ({
  tenantId,
  sessionId,
  message,
  messageType = "text",
  productCards = [],
  senderType = "system",
  source = "whatsapp_system_send",
  channel = "whatsapp",
  deliveryStatus = "",
  deliveryError = "",
  errorCode = "",
  externalMessageId = "",
  providerMessageId = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
  externalReplyId = "",
  preserveExactMessage = false,
  upsertSession = true,
  sessionStatus = "ai_active",
  sessionSource = "whatsapp",
  sessionChannel = "whatsapp",
  sessionCustomerName = "",
  sourcePath = "whatsapp_outbound_send",
  insertSource = "whatsapp_outbound_send",
  confidence = 1,
  detectedIntent = "whatsapp_outbound_send",
  suggestedProducts = [],
  visualAttachments = [],
  suggestedActions = [],
  staffMessage = "",
} = {}) => persistOutboundTranscriptRow({
  tenantId,
  sessionId,
  message,
  messageType,
  senderType,
  manualMessage: false,
  source,
  channel,
  deliveryStatus,
  deliveryError,
  errorCode,
  externalMessageId,
  providerMessageId,
  whatsappInstance,
  remoteJid,
  resolvedReplyJid,
  resolvedPhone,
  externalReplyId,
  productCards,
  preserveExactMessage,
  upsertSession,
  sessionStatus,
  sessionSource,
  sessionChannel,
  sessionCustomerName,
  sourcePath,
  insertSource,
  confidence,
  detectedIntent,
  suggestedProducts,
  visualAttachments,
  suggestedActions,
  staffMessage,
});

export const updateAiSupportMessageDeliveryStatus = async ({
  tenantId,
  sessionId = "",
  providerMessageId = "",
  externalMessageId = "",
  deliveryStatus = "",
  deliveryError = "",
  errorCode = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
  sourcePath = "whatsapp_webhook",
  insertSource = "whatsapp_webhook",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeProviderMessageId = toText(providerMessageId || externalMessageId);
  if (!safeTenantId || !safeProviderMessageId) {
    return null;
  }
  await ensureAiSupportLogSchema();
  const result = await db.query(
    `
    UPDATE ai_support_messages
    SET
      delivery_status = COALESCE(NULLIF($4, ''), delivery_status),
      delivery_error = COALESCE(NULLIF($5, ''), delivery_error),
      error_code = COALESCE(NULLIF($6, ''), error_code),
      external_message_id = COALESCE(NULLIF($3, ''), external_message_id),
      provider_message_id = COALESCE(NULLIF($3, ''), provider_message_id),
      whatsapp_instance = COALESCE(NULLIF($7, ''), whatsapp_instance),
      remote_jid = COALESCE(NULLIF($8, ''), remote_jid),
      resolved_reply_jid = COALESCE(NULLIF($9, ''), resolved_reply_jid),
      resolved_phone = COALESCE(NULLIF($10, ''), resolved_phone),
      source_path = COALESCE(NULLIF($11, ''), source_path),
      insert_source = COALESCE(NULLIF($12, ''), insert_source),
      updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND (
          provider_message_id = $3
          OR external_message_id = $3
          OR ($2 <> '' AND session_id = $2)
        )
      ORDER BY CASE
        WHEN provider_message_id = $3 THEN 0
        WHEN external_message_id = $3 THEN 1
        ELSE 2
      END, created_at DESC, id DESC
      LIMIT 1
    )
    RETURNING *
    `,
    [
      safeTenantId,
      safeSessionId,
      safeProviderMessageId,
      toText(deliveryStatus),
      toText(deliveryError),
      toText(errorCode),
      toText(whatsappInstance),
      toText(remoteJid),
      toText(resolvedReplyJid),
      toText(resolvedPhone),
      toText(sourcePath),
      toText(insertSource),
    ]
  );
  return result.rows[0] || null;
};

export const appendAutomationSupportTranscript = async ({
  tenantId,
  sessionId,
  message = "",
  messageType = "automation_error",
  channel = "",
  deliveryStatus = "",
  deliveryError = "",
  errorCode = "",
  externalMessageId = "",
  externalReplyId = "",
  staffUserName = "Social Comment Automation",
  senderType = "staff",
  sourcePath = "social_comment_automation",
  insertSource = "social_comment_automation",
  staffUserId = null,
  productCards = [],
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessage = repairText(message);
  const safeMessageType = toText(messageType || "automation_error") || "automation_error";
  if (!safeTenantId || !safeSessionId || !safeMessage) {
    return null;
  }
  await ensureAiSupportLogSchema();

  const sessionResult = await db.query(
    `
    SELECT id
    FROM ai_support_sessions
    WHERE tenant_id = $1 AND session_id = $2
    LIMIT 1
    `,
    [safeTenantId, safeSessionId]
  );

  let sessionRefId = sessionResult.rows[0]?.id || null;
  if (!sessionRefId) {
    const createdSession = await db.query(
      `
      INSERT INTO ai_support_sessions (
        tenant_id,
        user_id,
        session_id,
        source,
        status,
        channel,
        thread_kind,
        customer_name,
        last_message,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'ai_active', COALESCE(NULLIF($5, ''), 'web_chat'), 'comment', '', $6, NOW())
      ON CONFLICT (tenant_id, session_id) DO UPDATE SET
        channel = COALESCE(NULLIF(EXCLUDED.channel, ''), ai_support_sessions.channel),
        last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_sessions.last_message),
        updated_at = NOW()
      RETURNING id
      `,
      [
        safeTenantId,
        numberOrNull(staffUserId),
        safeSessionId,
        repairText(sourcePath, "social_comment_automation"),
        repairText(channel),
        safeMessage,
      ]
    );
    sessionRefId = createdSession.rows[0]?.id || null;
  }

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
      channel,
      source_path,
      delivery_status,
      delivery_error,
      error_code,
      external_message_id,
      external_reply_id,
      message_type,
      product_cards,
      insert_source
    )
    VALUES ($1, $2, $3, $4, $5, '', '', 1, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, FALSE, $3, $7, COALESCE(NULLIF($8, ''), 'web_chat'), $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
    RETURNING *
    `,
    [
      sessionRefId,
      safeTenantId,
      numberOrNull(staffUserId),
      safeSessionId,
      safeMessage,
      repairText(staffUserName),
      repairText(senderType || "staff"),
      repairText(channel),
      repairText(sourcePath, "social_comment_automation"),
      repairText(deliveryStatus),
      repairText(deliveryError),
      repairText(errorCode),
      repairText(externalMessageId),
      repairText(externalReplyId),
      safeMessageType,
      jsonValue(Array.isArray(productCards) ? productCards : []),
      repairText(insertSource),
    ]
  );

  await db.query(
    `
    UPDATE ai_support_sessions
    SET last_message = $3,
        channel = COALESCE(NULLIF($4, ''), channel),
        updated_at = NOW()
    WHERE tenant_id = $1 AND session_id = $2
    `,
    [safeTenantId, safeSessionId, safeMessage, repairText(channel)]
  ).catch(() => {});

  return result.rows[0] || null;
};

export const logAiSupportMessage = async ({
  tenantId,
  userId = null,
  sessionId,
  customerMessage,
  response = {},
  detectedIntent = "",
  fallbackReason = "",
  source = "admin_console",
  sourcePath = "manual_admin",
  insertSource = "manual_message_insert",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessage = repairText(customerMessage);
  if (!safeTenantId || !safeSessionId || !safeMessage) return null;

  await ensureAiSupportLogSchema();
  const requestedProductTerms = compactList(response.requested_product_terms || response.unknown_product_terms || extractTermsFromMessage(safeMessage), 10);
  const requestedSizes = compactList(response.requested_sizes || extractRequestedSizes(safeMessage), 8);
  const requestedColors = compactList(response.requested_colors || extractRequestedColors(safeMessage), 8);

  const sessionResult = await db.query(
    `
    INSERT INTO ai_support_sessions (tenant_id, user_id, session_id, source, updated_at)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, ai_support_sessions.user_id),
      source = EXCLUDED.source,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
    `,
    [safeTenantId, numberOrNull(userId), safeSessionId, repairText(source, "admin_console")]
  );

  const sessionRefId = sessionResult.rows[0]?.id || null;
  console.info("[ai-support-insert]", {
    source: "manual_message_insert",
    session_id: safeSessionId,
    channel: toText(source, "admin_console"),
  });
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
      requested_product_terms,
      requested_sizes,
      requested_colors,
      source_path,
      insert_source
    )
    VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19)
    RETURNING *
    `,
    [
      sessionRefId,
      safeTenantId,
      numberOrNull(userId),
      safeSessionId,
      repairText(safeMessage),
      repairText(response.answer),
      Math.max(0, Math.min(1, Number(response.confidence || 0))),
      response.needs_human_support !== false,
      jsonValue(Array.isArray(response.sources_used) ? response.sources_used : []),
      jsonValue(Array.isArray(response.suggested_products) ? response.suggested_products : []),
      jsonValue(Array.isArray(response.visual_attachments) ? response.visual_attachments : []),
      jsonValue(Array.isArray(response.suggested_actions) ? response.suggested_actions : []),
      repairText(detectedIntent),
      repairText(fallbackReason),
      jsonValue(requestedProductTerms),
      jsonValue(requestedSizes),
      jsonValue(requestedColors),
      repairText(source, "manual_admin"),
      repairText(sourcePath, "manual_admin"),
      repairText(insertSource),
    ]
  );
  console.info("[ai-support-insert]", {
    source: "manual_message_insert",
    session_id: safeSessionId,
    channel: toText(source, "admin_console"),
    message_id: result.rows[0]?.id || null,
  });

  if (["no_matching_products", "product_discovery_needs_clarification"].includes(toText(fallbackReason))) {
    await incrementAliasUsage({ tenantId: safeTenantId, aliases: response.unknown_product_terms || requestedProductTerms, confidence: 0 });
  }

  return result.rows[0] || null;
};

export const trackAiSupportProductClick = async ({ tenantId, sessionId, productId } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeProductId = numberOrNull(productId);
  if (!safeTenantId || !safeSessionId || !safeProductId) return null;
  await ensureAiSupportLogSchema();

  const result = await db.query(
    `
    UPDATE ai_support_messages
    SET clicked_product_id = $3
    WHERE id = (
      SELECT id
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        AND (
          clicked_product_id IS NULL
          OR suggested_products @> $4::jsonb
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    RETURNING id, tenant_id, session_id, clicked_product_id
    `,
    [safeTenantId, safeSessionId, safeProductId, jsonValue([{ id: safeProductId }])]
  );
  return result.rows[0] || null;
};

export const trackAiSupportCartOutcome = async ({ tenantId, sessionId, productId, addedToCart = true } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeProductId = numberOrNull(productId);
  if (!safeTenantId || !safeSessionId) return null;
  await ensureAiSupportLogSchema();

  const params = [safeTenantId, safeSessionId, addedToCart === true];
  const productClause = safeProductId
    ? `AND (clicked_product_id = $4 OR suggested_products @> $5::jsonb)`
    : "";
  if (safeProductId) {
    params.push(safeProductId, jsonValue([{ id: safeProductId }]));
  }

  const result = await db.query(
    `
    UPDATE ai_support_messages
    SET added_to_cart_after_chat = $3
    WHERE id = (
      SELECT id
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        ${productClause}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    RETURNING id, tenant_id, session_id, added_to_cart_after_chat
    `,
    params
  );
  return result.rows[0] || null;
};

export const listAiSupportHistory = async ({
  tenantId,
  needsHumanSupport = "",
  lowConfidence = false,
  limit = 50,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) return [];
  await ensureAiSupportLogSchema();

  const params = [safeTenantId];
  const clauses = ["tenant_id = $1"];

  if (needsHumanSupport === "true" || needsHumanSupport === true) {
    clauses.push("needs_human_support = TRUE");
  } else if (needsHumanSupport === "false" || needsHumanSupport === false) {
    clauses.push("needs_human_support = FALSE");
  }

  if (lowConfidence) {
    params.push(0.5);
    clauses.push(`confidence < $${params.length}`);
  }

  params.push(Math.max(1, Math.min(100, Number(limit) || 50)));

  const result = await db.query(
    `
    SELECT
      id,
      tenant_id,
      user_id,
      session_id,
      customer_message,
      ai_answer,
      confidence::float AS confidence,
      needs_human_support,
      sources_used,
      suggested_products,
      suggested_actions,
      detected_intent,
      fallback_reason,
      created_at
    FROM ai_support_messages
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
};

const limitValue = (value, fallback = 10) => Math.max(1, Math.min(50, Number(value) || fallback));

const emptyAiSupportInsights = () => ({
  handoff_count: 0,
  top_questions: [],
  top_product_terms: [],
  top_requested_sizes: [],
  top_requested_colors: [],
  most_suggested_products: [],
  most_clicked_products: [],
  pending_aliases: [],
  fallback_questions: [],
});

const verifyAiSupportAnalyticsTables = async () => {
  const result = await db.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = ANY($1::text[])
    `,
    [["ai_support_messages", "ai_support_sessions", "ai_support_product_aliases"]]
  );
  const existing = new Set((result.rows || []).map((row) => row.table_name));
  return {
    ai_support_messages: existing.has("ai_support_messages"),
    ai_support_sessions: existing.has("ai_support_sessions"),
    ai_support_product_aliases: existing.has("ai_support_product_aliases"),
  };
};

const runInsightsAggregation = async ({ label, text, values, fallbackRows = [] }) => {
  try {
    const result = await db.query(text, values);
    return result.rows || fallbackRows;
  } catch (error) {
    console.error("[ai-support] insights SQL error", {
      label,
      code: error?.code,
      message: error?.message,
    });
    return fallbackRows;
  }
};

export const getAiSupportInsights = async ({ tenantId, limit = 10 } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) {
    return emptyAiSupportInsights();
  }
  try {
    await ensureAiSupportLogSchema();
    const tableStatus = await verifyAiSupportAnalyticsTables();
    console.log("[ai-support] insights table check", {
      tenantId: safeTenantId,
      ...tableStatus,
    });
    if (!tableStatus.ai_support_messages || !tableStatus.ai_support_sessions || !tableStatus.ai_support_product_aliases) {
      return emptyAiSupportInsights();
    }
  } catch (error) {
    console.error("[ai-support] insights schema/table verification error", {
      tenantId: safeTenantId,
      code: error?.code,
      message: error?.message,
    });
    return emptyAiSupportInsights();
  }

  const safeLimit = limitValue(limit);
  const params = [safeTenantId, safeLimit];

  const [
    topQuestions,
    topProductTerms,
    topRequestedSizes,
    topRequestedColors,
    mostSuggestedProducts,
    mostClickedProducts,
    fallbackQuestions,
    humanHandoff,
    pendingAliases,
  ] = await Promise.all([
    runInsightsAggregation({
      label: "top_questions",
      text: `
      SELECT customer_message AS question, COUNT(*)::int AS count, MAX(created_at) AS last_asked_at
      FROM ai_support_messages
      WHERE tenant_id = $1
      GROUP BY LOWER(customer_message), customer_message
      ORDER BY count DESC, last_asked_at DESC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "top_product_terms",
      text: `
      SELECT value AS term, COUNT(*)::int AS count
      FROM ai_support_messages
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(requested_product_terms) = 'array' THEN requested_product_terms ELSE '[]'::jsonb END
      ) AS value
      WHERE tenant_id = $1
      GROUP BY value
      ORDER BY count DESC, value ASC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "top_requested_sizes",
      text: `
      SELECT value AS size, COUNT(*)::int AS count
      FROM ai_support_messages
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(requested_sizes) = 'array' THEN requested_sizes ELSE '[]'::jsonb END
      ) AS value
      WHERE tenant_id = $1
      GROUP BY value
      ORDER BY count DESC, value ASC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "top_requested_colors",
      text: `
      SELECT value AS color, COUNT(*)::int AS count
      FROM ai_support_messages
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(requested_colors) = 'array' THEN requested_colors ELSE '[]'::jsonb END
      ) AS value
      WHERE tenant_id = $1
      GROUP BY value
      ORDER BY count DESC, value ASC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "most_suggested_products",
      text: `
      SELECT
        COALESCE(product->>'id', product->>'product_id') AS product_id,
        MAX(product->>'name') AS name,
        COUNT(*)::int AS count
      FROM ai_support_messages
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(suggested_products) = 'array' THEN suggested_products ELSE '[]'::jsonb END
      ) AS product
      WHERE tenant_id = $1
        AND COALESCE(product->>'id', product->>'product_id') IS NOT NULL
      GROUP BY COALESCE(product->>'id', product->>'product_id')
      ORDER BY count DESC, name ASC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "most_clicked_products",
      text: `
      SELECT
        clicked_product_id AS product_id,
        MAX(product->>'name') FILTER (
          WHERE COALESCE(product->>'id', product->>'product_id') = clicked_product_id::text
        ) AS name,
        COUNT(*)::int AS count
      FROM ai_support_messages
      LEFT JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(suggested_products) = 'array' THEN suggested_products ELSE '[]'::jsonb END
      ) AS product ON TRUE
      WHERE tenant_id = $1
        AND clicked_product_id IS NOT NULL
      GROUP BY clicked_product_id
      ORDER BY count DESC, product_id ASC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "fallback_questions",
      text: `
      SELECT
        id,
        customer_message AS question,
        fallback_reason,
        needs_human_support,
        confidence::float AS confidence,
        created_at
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND (
          COALESCE(fallback_reason, '') <> ''
          OR needs_human_support = TRUE
          OR confidence < 0.5
        )
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      values: params,
    }),
    runInsightsAggregation({
      label: "human_handoff_count",
      text: `
      SELECT COUNT(*)::int AS count
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND needs_human_support = TRUE
      `,
      values: [safeTenantId],
      fallbackRows: [{ count: 0 }],
    }),
    runInsightsAggregation({
      label: "pending_aliases",
      text: `
      SELECT alias, mapped_product_id, usage_count, confidence::float AS confidence, updated_at
      FROM ai_support_product_aliases
      WHERE tenant_id = $1
        AND mapped_product_id IS NULL
      ORDER BY usage_count DESC, updated_at DESC
      LIMIT $2
      `,
      values: params,
    }),
  ]);

  return {
    handoff_count: humanHandoff[0]?.count || 0,
    top_questions: topQuestions,
    top_product_terms: topProductTerms,
    top_requested_sizes: topRequestedSizes,
    top_requested_colors: topRequestedColors,
    most_suggested_products: mostSuggestedProducts,
    most_clicked_products: mostClickedProducts,
    pending_aliases: pendingAliases,
    fallback_questions: fallbackQuestions,
  };
};

export const clearAiSupportTestHistory = async ({ tenantId } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) return { deleted_messages: 0, deleted_sessions: 0 };
  await ensureAiSupportLogSchema();

  const messages = await db.query(
    `DELETE FROM ai_support_messages WHERE tenant_id = $1 RETURNING id`,
    [safeTenantId]
  );
  const sessions = await db.query(
    `DELETE FROM ai_support_sessions WHERE tenant_id = $1 RETURNING id`,
    [safeTenantId]
  );

  return {
    deleted_messages: messages.rowCount || 0,
    deleted_sessions: sessions.rowCount || 0,
  };
};
