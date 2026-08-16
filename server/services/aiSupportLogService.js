import db from "../database/db.js";
import { logAIPersistentEvent } from "./aiPersistentEventLogService.js";

import { repairCorruptedArabicValue } from "../utils/arabicTextRepair.js";
import { normalizeWhatsappPhone, normalizeWhatsappSessionId as normalizeCanonicalWhatsappSessionId } from "../utils/whatsappIdentity.js";

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
const asArray = (value) => (Array.isArray(value) ? value : []);

const firstText = (...values) => values.map((value) => toText(value)).find(Boolean) || "";
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
    const safe = toText(value);
    if (safe) return safe;
  }
  return "";
};

const normalizeOutboundProductCard = (card = {}, inherited = {}) => {
  if (!card || typeof card !== "object") return [];
  const nestedCards = asArray(card.items || card.cards || card.products || card.product_cards || card.productCards);
  if (nestedCards.length) {
    const shared = { ...inherited, ...card };
    return nestedCards.flatMap((nestedCard) => normalizeOutboundProductCard(nestedCard, shared));
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
    share_url: toText(merged.share_url || merged.shareUrl || ""),
    image_url: imageUrl,
    image: imageUrl,
    thumbnail_url: imageUrl || merged.thumbnail_url || "",
    media_url: toText(merged.media_url || merged.mediaUrl || ""),
  }];
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

const buildOutboundTranscriptIdentityKey = ({
  tenantId,
  sessionId,
  direction = "outbound",
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
  clientRequestId,
  idempotencyKey,
  sourcePath,
  insertSource,
  productCards = [],
} = {}) => {
  const safeChannel = toText(channel).toLowerCase();
  const canonicalSessionId = safeChannel === "whatsapp"
    ? normalizeCanonicalWhatsappSessionId(sessionId, resolvedPhone || remoteJid || externalMessageId || providerMessageId || "")
    : toText(sessionId);
  const stableRequestKey = toText(clientRequestId || idempotencyKey || providerMessageId || externalMessageId || externalReplyId);
  if (!tenantId || !canonicalSessionId || !stableRequestKey) return "";
  return [
    "msg",
    tenantId,
    canonicalSessionId,
    toText(direction || "outbound"),
    stableRequestKey,
  ].join("|");
};

const buildOutboundTranscriptDedupeKey = (args = {}) => buildOutboundTranscriptIdentityKey(args);

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
  clientRequestId = "",
  idempotencyKey = "",
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
  direction = "outbound",
  preserveExistingOnProviderMatch = false,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeChannel = toText(channel || "web_chat");
  const safeSessionId = safeChannel === "whatsapp"
    ? normalizeCanonicalWhatsappSessionId(sessionId, resolvedPhone || remoteJid || externalMessageId || providerMessageId)
    : toText(sessionId);
  const safeSenderType = toText(senderType || (manualMessage ? "staff" : "ai") || "ai");
  const safeDirection = toText(direction || "outbound").toLowerCase() === "inbound" ? "inbound" : "outbound";
  const isInbound = safeDirection === "inbound";
  const safeMessageType = toText(messageType || "text") || "text";
  const safeMessage = preserveExactMessage ? String(message ?? answer ?? staffMessage ?? "") : repairText(message || answer || staffMessage);
  const safeAnswer = preserveExactMessage ? String(answer || message || staffMessage || "") : repairText(answer || message || staffMessage);
  const safeStaffMessage = preserveExactMessage ? String(staffMessage || message || answer || "") : repairText(staffMessage || message || answer);
  const safeProductCards = (Array.isArray(productCards) ? productCards : []).flatMap((card) => normalizeOutboundProductCard(card));
  const safeSuggestedProducts = Array.isArray(suggestedProducts) ? suggestedProducts : [];
  const safeVisualAttachments = Array.isArray(visualAttachments) ? visualAttachments : [];
  const safeSuggestedActions = Array.isArray(suggestedActions) ? suggestedActions : [];
  const safeExternalMessageId = toText(externalMessageId || providerMessageId);
  const safeProviderMessageId = toText(providerMessageId || externalMessageId);
  const safeClientRequestId = toText(clientRequestId || idempotencyKey || externalReplyId);
  const safeIdempotencyKey = toText(idempotencyKey || clientRequestId);
  const safeExternalReplyId = toText(externalReplyId);
  const safeSourcePath = toText(sourcePath, "manual_message_insert");
  const safeInsertSource = toText(insertSource, "manual_message_insert");
  const safeSessionSource = toText(sessionSource || source || safeChannel || "web_chat");
  const safeSessionChannel = toText(sessionChannel || safeChannel || "web_chat");
  const safeSessionCustomerName = toText(sessionCustomerName);
  const safeDetectedIntent = toText(detectedIntent);
  const safeRemoteJid = safeChannel === "whatsapp"
    ? normalizeCanonicalWhatsappSessionId(remoteJid || resolvedReplyJid || sessionId, resolvedPhone || remoteJid || sessionId)
    : toText(remoteJid);
  const safeResolvedReplyJid = safeChannel === "whatsapp"
    ? normalizeCanonicalWhatsappSessionId(resolvedReplyJid || remoteJid || sessionId, resolvedPhone || resolvedReplyJid || sessionId) || safeRemoteJid
    : toText(resolvedReplyJid);
  const safeResolvedPhone = safeChannel === "whatsapp"
    ? normalizeWhatsappPhone(resolvedPhone || remoteJid || sessionId)
    : toText(resolvedPhone);
  const safeMessageIdentityKey = buildOutboundTranscriptIdentityKey({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    direction: safeDirection,
    channel: safeChannel,
    senderType: safeSenderType,
    messageType: safeMessageType,
    message: safeMessage || safeStaffMessage || safeAnswer,
    deliveryStatus,
    deliveryError,
    externalMessageId: safeExternalMessageId,
    providerMessageId: safeProviderMessageId,
    whatsappInstance,
    remoteJid: safeRemoteJid,
    resolvedReplyJid: safeResolvedReplyJid,
    resolvedPhone: safeResolvedPhone,
    externalReplyId: safeExternalReplyId,
    clientRequestId: safeClientRequestId,
    idempotencyKey: safeIdempotencyKey,
    sourcePath: safeSourcePath,
    insertSource: safeInsertSource,
    productCards: safeProductCards,
  });
  const safeDedupeKey = toText(dedupeKey) || buildOutboundTranscriptDedupeKey({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    direction: safeDirection,
    channel: safeChannel,
    senderType: safeSenderType,
    messageType: safeMessageType,
    message: safeMessage || safeStaffMessage || safeAnswer,
    deliveryStatus,
    deliveryError,
    externalMessageId: safeExternalMessageId,
    providerMessageId: safeProviderMessageId,
    whatsappInstance,
    remoteJid: safeRemoteJid,
    resolvedReplyJid: safeResolvedReplyJid,
    resolvedPhone: safeResolvedPhone,
    externalReplyId: safeExternalReplyId,
    clientRequestId: safeClientRequestId,
    idempotencyKey: safeIdempotencyKey,
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
    isInbound ? (safeMessage || safeAnswer || safeStaffMessage || "") : "",
    isInbound ? "" : (safeAnswer || safeMessage || safeStaffMessage || ""),
    Number(confidence) || 1,
    false,
    jsonValue([]),
    jsonValue(safeSuggestedProducts),
    jsonValue(safeVisualAttachments),
    jsonValue(safeSuggestedActions),
    safeDetectedIntent,
    "",
    isInbound ? "" : (safeStaffMessage || (!["ai", "assistant", "system", "bot"].includes(safeSenderType) ? safeMessage : "")),
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
    safeClientRequestId,
    safeMessageIdentityKey,
    safeIdempotencyKey,
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
    client_request_id,
    message_identity_key,
    idempotency_key,
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
      client_request_id = $29,
      message_identity_key = $30,
      idempotency_key = $31,
      whatsapp_instance = $32,
      remote_jid = $33,
      resolved_reply_jid = $34,
      resolved_phone = $35,
      external_reply_id = $36,
      message_type = $37,
      product_cards = $38::jsonb,
      dedupe_key = $39,
      insert_source = $40,
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
      if (preserveExistingOnProviderMatch) {
        const existing = await db.query("SELECT * FROM ai_support_messages WHERE id = $1::bigint LIMIT 1", [existingProvider.rows[0].id]);
        return existing.rows[0] || null;
      }
      const updated = await db.query(updateSql, [existingProvider.rows[0].id, ...values]);
      return updated.rows[0] || null;
    }
  }

  if (safeMessageIdentityKey) {
    const existingIdentity = await db.query(
      `
      SELECT id
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND session_id = $2
        AND message_identity_key = $3
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, safeSessionId, safeMessageIdentityKey]
    );
    if (existingIdentity.rows[0]?.id) {
      const updated = await db.query(updateSql, [existingIdentity.rows[0].id, ...values]);
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
      VALUES ($1::bigint, $2::bigint, $3::bigint, $4::text, $5::text, $6::text, $7::text, $8::numeric, $9::boolean, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::text, $15::text, $16::text, $17::text, $18::boolean, $19::bigint, $20::text, $21::text, $22::text, $23::text, $24::text, $25::text, $26::text, $27::text, $28::text, $29::text, $30::text, $31::text, $32::text, $33::text, $34::text, $35::text, $36::text, $37::jsonb, $38::text, $39::text)
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
        is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_avatar_url TEXT NOT NULL DEFAULT '',
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
          provider_message_id TEXT NOT NULL DEFAULT '',
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
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS customer_avatar_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS external_customer_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS takeover_started_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS returned_to_ai_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS last_ai_reply_draft JSONB NOT NULL DEFAULT '{}'::jsonb`);
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
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS last_ai_reply_draft_updated_at TIMESTAMP NULL`);
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
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS post_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS post_permalink_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS post_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS post_caption TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS post_full_picture TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS post_created_time TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS comment_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS parent_comment_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS root_comment_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS commenter_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS commenter_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS commenter_profile_picture_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS comment_created_time TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS comment_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS thread_kind TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS staff_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(40) NOT NULL DEFAULT 'customer'`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS manual_message BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS staff_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS staff_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS external_message_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS client_request_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS message_identity_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT ''`);
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
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`
        UPDATE ai_support_messages
        SET delivery_error = 'لم يتم الإرسال لأن آخر تفاعل من العميل مر عليه أكثر من 24 ساعة. اطلب من العميل إرسال رسالة جديدة أولًا.',
            updated_at = CURRENT_TIMESTAMP
        WHERE delivery_error <> ''
          AND (
            delivery_error ILIKE '%(#10)%'
            OR delivery_error ILIKE '%خارج الإطار الزمني%'
            OR delivery_error ILIKE '%policy-overview%'
          )
          AND delivery_error <> 'لم يتم الإرسال لأن آخر تفاعل من العميل مر عليه أكثر من 24 ساعة. اطلب من العميل إرسال رسالة جديدة أولًا.'
      `);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS clicked_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS added_to_cart_after_chat BOOLEAN NULL`);
      // Canonicalise legacy WhatsApp keys to whatsapp:<digits>.
      //
      // Two rules this migration has to respect, both learned the hard way:
      //
      // 1. whatsapp:lid:<id> is already canonical. A customer who hides their
      //    number behind a WhatsApp username has no phone at all, so their LID
      //    is the key. Flattening it to digits mints a fake phone number and
      //    silently undoes that on every boot.
      // 2. It must never collide. This runs inside startup, so a duplicate key
      //    here does not skip a row — it takes the whole server down.
      await clientOrPool.query(`
        UPDATE ai_support_sessions AS s
        SET session_id = 'whatsapp:' || regexp_replace(regexp_replace(lower(s.session_id), '^whatsapp:', ''), '[^0-9]', '', 'g')
        WHERE lower(s.channel) = 'whatsapp'
          AND COALESCE(s.session_id, '') <> ''
          AND s.session_id !~ '^whatsapp:[0-9]+$'
          AND s.session_id !~ '^whatsapp:lid:[0-9]+$'
          AND NULLIF(regexp_replace(regexp_replace(lower(s.session_id), '^whatsapp:', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ai_support_sessions AS existing
            WHERE existing.tenant_id = s.tenant_id
              AND existing.session_id = 'whatsapp:' || regexp_replace(regexp_replace(lower(s.session_id), '^whatsapp:', ''), '[^0-9]', '', 'g')
          )
      `);
      await clientOrPool.query(`
        UPDATE ai_channel_conversations AS c
        SET external_conversation_id = 'whatsapp:' || regexp_replace(regexp_replace(lower(c.external_conversation_id), '^whatsapp:', ''), '[^0-9]', '', 'g')
        WHERE lower(c.channel) = 'whatsapp'
          AND COALESCE(c.external_conversation_id, '') <> ''
          AND c.external_conversation_id !~ '^whatsapp:[0-9]+$'
          AND c.external_conversation_id !~ '^whatsapp:lid:[0-9]+$'
          AND NULLIF(regexp_replace(regexp_replace(lower(c.external_conversation_id), '^whatsapp:', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ai_channel_conversations AS existing
            WHERE existing.tenant_id = c.tenant_id
              AND existing.channel = c.channel
              AND existing.external_conversation_id = 'whatsapp:' || regexp_replace(regexp_replace(lower(c.external_conversation_id), '^whatsapp:', ''), '[^0-9]', '', 'g')
          )
      `);
      await clientOrPool.query(`UPDATE ai_support_messages SET client_request_id = COALESCE(NULLIF(client_request_id, ''), NULLIF(external_reply_id, '')) WHERE COALESCE(NULLIF(client_request_id, ''), '') = '' AND COALESCE(NULLIF(external_reply_id, ''), '') <> ''`);
      await clientOrPool.query(`
        UPDATE ai_support_messages
        SET message_identity_key = CASE
          WHEN COALESCE(NULLIF(message_identity_key, ''), '') <> '' THEN message_identity_key
          WHEN COALESCE(NULLIF(client_request_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || client_request_id
          WHEN COALESCE(NULLIF(provider_message_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || provider_message_id
          WHEN COALESCE(NULLIF(external_message_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || external_message_id
          ELSE ''
        END,
        idempotency_key = CASE
          WHEN COALESCE(NULLIF(idempotency_key, ''), '') <> '' THEN idempotency_key
          WHEN COALESCE(NULLIF(client_request_id, ''), '') <> '' THEN client_request_id
          WHEN COALESCE(NULLIF(provider_message_id, ''), '') <> '' THEN provider_message_id
          WHEN COALESCE(NULLIF(external_message_id, ''), '') <> '' THEN external_message_id
          ELSE ''
        END
      `);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_inbound_ai_reply_locks (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          channel TEXT NOT NULL DEFAULT '',
          conversation_id TEXT NOT NULL DEFAULT '',
          provider_message_id TEXT NOT NULL DEFAULT '',
          trigger_source TEXT NOT NULL DEFAULT '',
          ai_reply_id BIGINT NULL,
          outbound_meta_message_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'claimed',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
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
      await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_provider_message_id_session ON ai_support_messages (tenant_id, session_id, provider_message_id) WHERE provider_message_id <> ''`);
      await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_external_message_id_session ON ai_support_messages (tenant_id, session_id, external_message_id) WHERE external_message_id <> ''`);
      await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_identity_key ON ai_support_messages (tenant_id, session_id, message_identity_key) WHERE message_identity_key <> ''`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_inbound_ai_reply_locks_tenant_conversation ON ai_inbound_ai_reply_locks (tenant_id, conversation_id, created_at DESC)`);
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_inbound_ai_reply_locks_provider_message_id
        ON ai_inbound_ai_reply_locks (tenant_id, channel, provider_message_id)
        WHERE provider_message_id <> ''
      `);
      await clientOrPool.query(`UPDATE ai_support_messages SET insert_source = COALESCE(insert_source, CASE WHEN channel = 'whatsapp' AND NULLIF(provider_message_id, '') IS NOT NULL THEN 'whatsapp_unknown_legacy' WHEN channel = 'facebook_messenger' THEN 'meta_messenger_legacy' WHEN channel = 'instagram' THEN 'instagram_dm_legacy' ELSE 'legacy_unknown' END) WHERE insert_source IS NULL`);
      await clientOrPool.query(`
        UPDATE ai_support_messages
        SET provider_message_id = COALESCE(NULLIF(provider_message_id, ''), NULLIF(external_message_id, ''))
        WHERE channel IN ('facebook_messenger', 'instagram')
          AND COALESCE(NULLIF(provider_message_id, ''), NULLIF(external_message_id, '')) IS NOT NULL
      `);
      await clientOrPool.query(`UPDATE ai_support_messages SET client_request_id = COALESCE(NULLIF(client_request_id, ''), NULLIF(external_reply_id, '')) WHERE COALESCE(NULLIF(client_request_id, ''), '') = '' AND COALESCE(NULLIF(external_reply_id, ''), '') <> ''`);
      await clientOrPool.query(`
        UPDATE ai_support_messages
        SET message_identity_key = CASE
          WHEN COALESCE(NULLIF(message_identity_key, ''), '') <> '' THEN message_identity_key
          WHEN COALESCE(NULLIF(client_request_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || client_request_id
          WHEN COALESCE(NULLIF(provider_message_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || provider_message_id
          WHEN COALESCE(NULLIF(external_message_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || external_message_id
          ELSE ''
        END,
        idempotency_key = CASE
          WHEN COALESCE(NULLIF(idempotency_key, ''), '') <> '' THEN idempotency_key
          WHEN COALESCE(NULLIF(client_request_id, ''), '') <> '' THEN client_request_id
          WHEN COALESCE(NULLIF(provider_message_id, ''), '') <> '' THEN provider_message_id
          WHEN COALESCE(NULLIF(external_message_id, ''), '') <> '' THEN external_message_id
          ELSE ''
        END
      `);
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
          AND newer.channel = older.channel
          AND newer.channel IN ('facebook_messenger', 'instagram')
          AND newer.provider_message_id <> ''
          AND newer.provider_message_id = older.provider_message_id
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
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_meta_provider_message_id
        ON ai_support_messages (tenant_id, channel, provider_message_id)
        WHERE provider_message_id <> '' AND channel IN ('facebook_messenger', 'instagram')
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

export const updateAiSupportConversationFavorite = async ({
  tenantId,
  sessionId,
  channel = "",
  isFavorite = false,
  actorUserId = null,
  source = "admin_console",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeChannel = normalizeConversationChannel(channel);
  if (!safeTenantId || !safeSessionId) {
    throw Object.assign(new Error("tenant_id and conversation id are required"), { status: 400 });
  }
  await ensureAiSupportLogSchema();

  const conversationReference = parseConversationReference({ sessionId: safeSessionId, channel: safeChannel });
  const safeSessionCandidates = [...new Set([
    conversationReference.sessionId,
    conversationReference.baseSessionId,
    safeSessionId,
    ...conversationReference.lookupSessionIds,
  ].filter(Boolean))];
  const safeFavorite = isFavorite === true;
  const resolvedChannel = conversationReference.channel || safeChannel || "web_chat";

  const result = await db.query(
    `
    INSERT INTO ai_support_sessions (
      tenant_id,
      user_id,
      session_id,
      source,
      channel,
      is_favorite
    )
    VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::boolean)
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      channel = COALESCE(EXCLUDED.channel, ai_support_sessions.channel),
      is_favorite = EXCLUDED.is_favorite,
      updated_at = NOW()
    RETURNING *
    `,
    [safeTenantId, numberOrNull(actorUserId), safeSessionId, toText(source, "admin_console"), resolvedChannel, safeFavorite]
  );

  if (result.rows[0]) {
    return { ...(result.rows[0] || {}), is_favorite: safeFavorite, channel: resolvedChannel, session_id: safeSessionId, external_conversation_id: safeSessionId };
  }

  const fallback = await db.query(
    `
    UPDATE ai_support_sessions
    SET is_favorite = $3::boolean,
        updated_at = NOW()
    WHERE tenant_id = $1::bigint
      AND session_id = ANY($2::text[])
    RETURNING *
    `,
    [safeTenantId, safeSessionCandidates, safeFavorite]
  );

  return (fallback.rows[0] || null) || {
    tenant_id: safeTenantId,
    session_id: safeSessionId,
    external_conversation_id: safeSessionId,
    channel: resolvedChannel,
    is_favorite: safeFavorite,
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
  const sessionCandidates = [...new Set([conversationReference.sessionId, ...(Array.isArray(conversationReference.lookupSessionIds) ? conversationReference.lookupSessionIds : []), safeSessionId].filter(Boolean))];
  const resolvedSessionId = conversationReference.sessionId || safeSessionId;
  const resolvedChannel = conversationReference.channel || safeChannel;
  const readAt = new Date().toISOString();
  const sessionResult = await db.query(
    `
    UPDATE ai_support_sessions
    SET read_at = $3::timestamp
    WHERE tenant_id = $1::bigint
      AND session_id = ANY($2::text[])
    RETURNING *
    `,
    [safeTenantId, sessionCandidates, readAt]
  ).catch((error) => {
    logSqlError("markAiSupportConversationRead.session", error, {
      tenantId: safeTenantId,
      sessionId: resolvedSessionId,
      candidates: sessionCandidates,
      channel: resolvedChannel,
    });
    return { rows: [] };
  });

  const channelResult = resolvedChannel
    ? await db.query(
        `
        UPDATE ai_channel_conversations
        SET read_at = $4::timestamp
        WHERE tenant_id = $1::bigint
          AND external_conversation_id = ANY($2::text[])
          AND channel = $3::text
        RETURNING *
        `,
        [safeTenantId, sessionCandidates, resolvedChannel, readAt]
      ).catch((error) => {
        logSqlError("markAiSupportConversationRead.channel", error, {
          tenantId: safeTenantId,
          sessionId: resolvedSessionId,
          candidates: sessionCandidates,
          channel: resolvedChannel,
        });
        return { rows: [] };
      })
    : await db.query(
        `
        UPDATE ai_channel_conversations
        SET read_at = $3::timestamp
        WHERE tenant_id = $1::bigint
          AND external_conversation_id = ANY($2::text[])
        RETURNING *
        `,
        [safeTenantId, sessionCandidates, readAt]
      ).catch((error) => {
        logSqlError("markAiSupportConversationRead.channel-all", error, {
          tenantId: safeTenantId,
          sessionId: resolvedSessionId,
          candidates: sessionCandidates,
          channel: resolvedChannel,
        });
        return { rows: [] };
      });

  return {
    read_at: readAt,
    session_id: resolvedSessionId,
    channel: resolvedChannel || "",
    conversation_key: conversationReference.conversationKey,
    ...(sessionResult.rows[0] || {}),
    ...(channelResult.rows[0] || {}),
    read_updated: Boolean(sessionResult.rows[0] || channelResult.rows[0]),
  };
};

export const updateAiSupportConversationState = async ({
  tenantId,
  sessionId,
  status,
  channel = "",
  assignedUserId = undefined,
  assignedUserName = undefined,
  actorUserId = null,
  source = "admin_console",
  allowClosedReopen = false,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeStatus = toText(status || "ai_active");
  const safeChannel = normalizeConversationChannel(channel);
  if (!safeTenantId || !safeSessionId) {
    throw Object.assign(new Error("tenant_id and conversation id are required"), { status: 400 });
  }
  if (!["ai_active", "human_takeover", "closed"].includes(safeStatus)) {
    throw Object.assign(new Error("Invalid conversation status"), { status: 400 });
  }
  await ensureAiSupportLogSchema();
  const current = await db.query(
    `SELECT status, channel FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1`,
    [safeTenantId, safeSessionId]
  );
  if (current.rows[0]?.status === "closed" && safeStatus !== "closed" && allowClosedReopen !== true) {
    throw Object.assign(new Error("Conversation is closed"), { status: 409 });
  }
  const safeEnabled = safeStatus === "ai_active";
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
      ai_enabled,
      updated_at
    )
    VALUES (
      $1::bigint, $2::bigint, $3::text, $4::text, $5::varchar(40), $6::bigint, $7::text,
      CASE WHEN $8::text = 'human_takeover' THEN NOW() ELSE NULL END,
      CASE WHEN $9::text = 'ai_active' THEN NOW() ELSE NULL END,
      CASE WHEN $10::text = 'closed' THEN NOW() ELSE NULL END,
      CASE WHEN $11::text = 'ai_active' THEN TRUE ELSE FALSE END,
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
      ai_enabled = EXCLUDED.ai_enabled,
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
      safeStatus,
    ]
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
    normalizeConversationChannel(current.rows[0]?.channel || ""),
    ...existingChannelRows.rows.map((row) => normalizeConversationChannel(row.channel || "")),
  ].map((value) => normalizeConversationChannel(value)).filter(Boolean))];
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
  clientRequestId = "",
  idempotencyKey = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
  externalReplyId = "",
  preserveExactMessage = false,
  upsertSession = true,
  redactSessionInLogs = false,
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
    clientRequestId,
    idempotencyKey,
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
    session_id: redactSessionInLogs ? "[redacted]" : safeSessionId,
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
  if (safeTenantId && safeSessionId) {
    const safeChannel = repairText(channel || "web_chat");
    await updateAiSupportConversationState({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      status: "human_takeover",
      channel: safeChannel,
      actorUserId: staffUserId,
      source: source || "admin_console",
    }).catch(() => {});
  }

  // Agreement measurement. Recorded HERE because this is the one place every send
  // branch — WhatsApp, Telegram, Messenger, Instagram, stored-only, internal note —
  // persists the employee's message. Doing it at the route would mean repeating it at
  // every branch and every return, and the branch that got missed would silently
  // remove its cases from the sample that autonomy is later judged on.
  //
  // A staff-authored message only: an AI auto-send has no human decision to compare
  // against and would score as perfect agreement with itself.
  if (safeTenantId && safeSessionId && staffUserId) {
    await recordSentReplyAgreement({
      tenantId: safeTenantId,
      sessionId: safeSessionId,
      channel: repairText(channel || "web_chat"),
      sentText: safeMessage,
      messageId: toText(result?.id || externalMessageId || providerMessageId || ""),
    }).catch(() => {});
  }

  return result || null;
};

/**
 * Loads the draft this reply replaced and scores it against what was actually sent.
 *
 * Separated from the send itself so the send path reads as a send. Never throws: the
 * caller is delivering a message to a customer and a measurement must not be able to
 * interfere with that.
 */
const recordSentReplyAgreement = async ({ tenantId, sessionId, channel, sentText, messageId }) => {
  try {
    const session = await db.query(
      `SELECT last_ai_reply_draft FROM ai_support_sessions
        WHERE tenant_id = $1 AND session_id = $2 LIMIT 1`,
      [tenantId, sessionId]
    );
    const draft = session.rows[0]?.last_ai_reply_draft;
    if (!draft || typeof draft !== "object") return;

    const draftText = toText(draft.text || draft.answer || draft.message || "");
    if (!draftText) return;

    const { recordAgreement } = await import("./aiAgreementScoreService.js");
    await recordAgreement({
      tenantId,
      conversationId: sessionId,
      messageId,
      channel,
      draftText,
      sentText,
      confidenceScore: Number(draft?.confidence_engine?.confidence_score ?? draft?.confidence ?? null),
      autoSendEligible:
        typeof draft?.metadata?.auto_reply_shadow?.eligible === "boolean"
          ? draft.metadata.auto_reply_shadow.eligible
          : null,
      generationSource: toText(draft?.generation_source || ""),
    });
  } catch (error) {
    console.warn("[ai-agreement] scoring skipped", { tenantId, message: error?.message });
  }
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
  clientRequestId = "",
  idempotencyKey = "",
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
    clientRequestId,
    idempotencyKey,
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
  clientRequestId = "",
  idempotencyKey = "",
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
  clientRequestId,
  idempotencyKey,
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

// Shared channel transcript entry points. Webhook handlers use these before any
// AI gate so the inbox remains a complete provider timeline even while AI is
// paused, and provider echoes use the same dedupe path as application sends.
export const appendInboundAiSupportMessage = async ({
  tenantId,
  sessionId,
  message,
  messageType = "text",
  channel = "web_chat",
  customerName = "",
  deliveryStatus = "received",
  externalMessageId = "",
  providerMessageId = "",
  visualAttachments = [],
  source = "channel_webhook",
  sourcePath = "channel_webhook",
  insertSource = "channel_webhook",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
} = {}) => persistOutboundTranscriptRow({
  tenantId,
  sessionId,
  message,
  messageType,
  senderType: "customer",
  manualMessage: false,
  source,
  channel,
  deliveryStatus,
  externalMessageId,
  providerMessageId,
  visualAttachments,
  preserveExactMessage: true,
  upsertSession: true,
  sessionStatus: "ai_active",
  sessionSource: channel,
  sessionChannel: channel,
  sessionCustomerName: customerName,
  sourcePath,
  insertSource,
  whatsappInstance,
  remoteJid,
  resolvedReplyJid,
  resolvedPhone,
  direction: "inbound",
});

export const appendChannelOutboundSupportReply = async (options = {}) =>
  persistOutboundTranscriptRow({
    ...options,
    direction: "outbound",
    senderType: options.senderType || "system",
    preserveExactMessage: options.preserveExactMessage !== false,
    upsertSession: options.upsertSession !== false,
    sessionSource: options.sessionSource || options.channel || options.source || "channel_outbound",
    sessionChannel: options.sessionChannel || options.channel || "web_chat",
    sourcePath: options.sourcePath || "channel_outbound",
    insertSource: options.insertSource || "channel_outbound",
    preserveExistingOnProviderMatch: options.preserveExistingOnProviderMatch === true,
  });

export const upsertAiSupportMessageReaction = async ({
  tenantId,
  sessionId,
  channel = "whatsapp",
  emoji = "",
  targetMessageId = "",
  fromMe = false,
  providerMessageId = "",
  whatsappInstance = "",
  remoteJid = "",
  resolvedReplyJid = "",
  resolvedPhone = "",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeChannel = toText(channel || "whatsapp");
  const safeSessionId = safeChannel === "whatsapp"
    ? normalizeCanonicalWhatsappSessionId(sessionId, resolvedPhone || remoteJid || sessionId)
    : toText(sessionId);
  const safeTargetMessageId = toText(targetMessageId);
  const safeEmoji = String(emoji ?? "").trim();
  const senderType = fromMe ? "staff" : "customer";
  if (!safeTenantId || !safeSessionId || !safeTargetMessageId) return null;

  await ensureAiSupportLogSchema();
  await db.query(
    `
    DELETE FROM ai_support_messages
    WHERE tenant_id = $1::bigint
      AND session_id = $2::text
      AND channel = $3::text
      AND message_type = 'reaction'
      AND external_reply_id = $4::text
      AND sender_type = $5::text
    `,
    [safeTenantId, safeSessionId, safeChannel, safeTargetMessageId, senderType]
  );
  if (!safeEmoji) return { removed: true, reaction: null };

  const reaction = await persistOutboundTranscriptRow({
    tenantId: safeTenantId,
    sessionId: safeSessionId,
    message: safeEmoji,
    messageType: "reaction",
    senderType,
    staffMessage: fromMe ? safeEmoji : "",
    channel: safeChannel,
    deliveryStatus: fromMe ? "sent" : "received",
    externalMessageId: providerMessageId,
    providerMessageId,
    whatsappInstance,
    remoteJid,
    resolvedReplyJid,
    resolvedPhone,
    externalReplyId: safeTargetMessageId,
    preserveExactMessage: true,
    upsertSession: false,
    source: "whatsapp_reaction",
    sourcePath: "whatsapp_reaction",
    insertSource: "whatsapp_reaction",
    direction: fromMe ? "outbound" : "inbound",
  });
  return { removed: false, reaction };
};

export const upsertAiReplySuggestionDraft = async ({
  tenantId,
  sessionId,
  suggestionText = "",
  messageType = "text",
  productCards = [],
  confidence = 0,
  detectedIntent = "",
  customerQuestion = "",
  originalSuggestionId = "",
  status = "not_sent",
  metadata = {},
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  if (!safeTenantId || !safeSessionId) {
    return null;
  }
  await ensureAiSupportLogSchema();
  const safeProductCards = Array.isArray(productCards) ? productCards : [];
  const safeOriginalSuggestionId = toText(originalSuggestionId || "");
  const draftId = toText(originalSuggestionId || `ai_suggestion_${Date.now()}`);
  const draft = {
    id: draftId,
    original_suggestion_id: safeOriginalSuggestionId || draftId,
    status: toText(status || "not_sent") || "not_sent",
    source: "ai_suggestion",
    message_type: toText(messageType || (safeProductCards.length ? "product_card" : "text")) || "text",
    text: repairText(suggestionText || ""),
    product_cards: safeProductCards,
    confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : 0,
    detected_intent: toText(detectedIntent),
    customer_question: repairText(customerQuestion || ""),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    updated_at: new Date().toISOString(),
  };
  const result = await db.query(
    `
    UPDATE ai_support_sessions
    SET last_ai_reply_draft = $3::jsonb,
        last_ai_reply_draft_updated_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1::bigint AND session_id = $2::text
    RETURNING *
    `,
    [safeTenantId, safeSessionId, jsonValue(draft)]
  );
  if (!result.rows[0]) {
    await db.query(
      `
      INSERT INTO ai_support_sessions (
        tenant_id,
        session_id,
        source,
        status,
        channel,
        ai_enabled,
        customer_name,
        last_message,
        last_ai_reply_draft,
        last_ai_reply_draft_updated_at,
        updated_at
      )
      VALUES ($1::bigint, $2::text, 'ai_reply_draft', 'ai_active', 'web_chat', TRUE, '', '', $3::jsonb, NOW(), NOW())
      ON CONFLICT (tenant_id, session_id) DO UPDATE SET
        last_ai_reply_draft = EXCLUDED.last_ai_reply_draft,
        last_ai_reply_draft_updated_at = NOW(),
        updated_at = NOW()
      `,
      [safeTenantId, safeSessionId, jsonValue(draft)]
    );
  }
  return draft;
};

export const clearAiReplySuggestionDraft = async ({ tenantId, sessionId, sourceMessageId = "" } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  if (!safeTenantId || !safeSessionId) return null;
  await ensureAiSupportLogSchema();
  // Phase 13.2 — clear to a versioned TOMBSTONE (status:"sent" + the completed source_message_id + cleared_at),
  // NOT '{}'. A bare {} loses identity, so a stale list/socket/cache payload carrying the OLD draft can't be
  // recognised as older and resurrects the completed suggestion. The tombstone + the bumped
  // last_ai_reply_draft_updated_at give the cleared state a monotonic version the client can reconcile against.
  await db.query(
    `
    UPDATE ai_support_sessions
    SET last_ai_reply_draft = jsonb_build_object(
          'status', 'sent',
          'text', '',
          'source_message_id', $3::text,
          'cleared_at', to_jsonb(NOW())
        ),
        last_ai_reply_draft_updated_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1::bigint AND session_id = $2::text
    `,
    [safeTenantId, safeSessionId, toText(sourceMessageId)]
  );
  return true;
};

export const claimAiInboxReplyLock = async ({
  tenantId,
  channel = "",
  conversationId = "",
  providerMessageId = "",
  triggerSource = "",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeChannel = toText(channel);
  const safeConversationId = toText(conversationId);
  const safeProviderMessageId = toText(providerMessageId);
  const safeTriggerSource = toText(triggerSource);
  if (!safeTenantId || !safeConversationId || !safeProviderMessageId) {
    return { claimed: false, reason: "missing_lock_key" };
  }
  await ensureAiSupportLogSchema();
  const claimed = await db.query(
    `
    INSERT INTO ai_inbound_ai_reply_locks (
      tenant_id, channel, conversation_id, provider_message_id, trigger_source, status, created_at, updated_at
    )
    VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, 'claimed', NOW(), NOW())
    ON CONFLICT (tenant_id, channel, provider_message_id) WHERE provider_message_id <> '' DO NOTHING
    RETURNING *
    `,
    [safeTenantId, safeChannel, safeConversationId, safeProviderMessageId, safeTriggerSource]
  );
  if (claimed.rows[0]) {
    console.log("[ai-inbox-ai-reply-lock] claimed", {
      tenant_id: safeTenantId,
      channel: safeChannel,
      conversation_id: safeConversationId,
      provider_message_id: safeProviderMessageId,
      trigger_source: safeTriggerSource,
      ai_reply_id: claimed.rows[0].ai_reply_id || null,
      outbound_meta_message_id: claimed.rows[0].outbound_meta_message_id || "",
    });
    return { claimed: true, lock: claimed.rows[0] };
  }
  const existing = await db.query(
    `
    SELECT *
    FROM ai_inbound_ai_reply_locks
    WHERE tenant_id = $1::bigint
      AND channel = $2::text
      AND provider_message_id = $3::text
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    `,
    [safeTenantId, safeChannel, safeProviderMessageId]
  );
  const lock = existing.rows[0] || null;
  console.log("[ai-inbox-ai-reply-lock] duplicate", {
    tenant_id: safeTenantId,
    channel: safeChannel,
    conversation_id: safeConversationId,
    provider_message_id: safeProviderMessageId,
    trigger_source: safeTriggerSource,
    ai_reply_id: lock?.ai_reply_id || null,
    outbound_meta_message_id: lock?.outbound_meta_message_id || "",
    status: lock?.status || "duplicate",
  });
  await logAIPersistentEvent({
    tenantId: safeTenantId,
    category: "duplicate_prevention",
    eventType: "duplicate_ai_reply_lock",
    conversationId: safeConversationId,
    channel: safeChannel,
    source: safeTriggerSource || "ai_support_log_service",
    reason: "provider_message_id_duplicate",
    message: "AI reply lock duplicate prevented",
    metadata: {
      provider_message_id: safeProviderMessageId,
      ai_reply_id: lock?.ai_reply_id || null,
      outbound_meta_message_id: lock?.outbound_meta_message_id || "",
      status: lock?.status || "duplicate",
    },
  });
  return { claimed: false, duplicate: true, lock };
};

export const hasRecentAiReplyDuplicate = async ({
  tenantId,
  sessionId = "",
  messageText = "",
  withinMinutes = 10,
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessageText = repairText(messageText || "").trim();
  const safeMinutes = Math.max(1, Math.min(60, Number(withinMinutes || 10)));
  if (!safeTenantId || !safeSessionId || !safeMessageText) {
    return null;
  }
  await ensureAiSupportLogSchema();
  const result = await db.query(
    `
    SELECT id, created_at, message_text, answer, staff_message, source, channel
    FROM ai_support_messages
    WHERE tenant_id = $1::bigint
      AND session_id = $2::text
      AND sender_type = 'ai'
      AND created_at >= NOW() - ($4::int || ' minutes')::interval
      AND regexp_replace(lower(trim(COALESCE(NULLIF(message_text, ''), NULLIF(answer, ''), NULLIF(staff_message, ''), ''))), '\\s+', ' ', 'g') =
          regexp_replace(lower(trim($3::text)), '\\s+', ' ', 'g')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [safeTenantId, safeSessionId, safeMessageText, safeMinutes]
  );
  return result.rows[0] || null;
};

export const completeAiInboxReplyLock = async ({
  tenantId,
  channel = "",
  conversationId = "",
  providerMessageId = "",
  triggerSource = "",
  aiReplyId = null,
  outboundMetaMessageId = "",
  status = "completed",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeChannel = toText(channel);
  const safeConversationId = toText(conversationId);
  const safeProviderMessageId = toText(providerMessageId);
  const safeTriggerSource = toText(triggerSource);
  const safeOutboundMetaMessageId = toText(outboundMetaMessageId);
  if (!safeTenantId || !safeConversationId || !safeProviderMessageId) {
    return null;
  }
  await ensureAiSupportLogSchema();
  const result = await db.query(
    `
    UPDATE ai_inbound_ai_reply_locks
    SET ai_reply_id = COALESCE($5::bigint, ai_reply_id),
        outbound_meta_message_id = COALESCE(NULLIF($6::text, ''), outbound_meta_message_id),
        status = COALESCE(NULLIF($7::text, ''), status),
        updated_at = NOW()
    WHERE tenant_id = $1::bigint
      AND channel = $2::text
      AND conversation_id = $3::text
      AND provider_message_id = $4::text
    RETURNING *
    `,
    [safeTenantId, safeChannel, safeConversationId, safeProviderMessageId, aiReplyId, safeOutboundMetaMessageId, status]
  );
  const lock = result.rows[0] || null;
  console.log("[ai-inbox-ai-reply-lock] completed", {
    tenant_id: safeTenantId,
    channel: safeChannel,
    conversation_id: safeConversationId,
    provider_message_id: safeProviderMessageId,
    trigger_source: safeTriggerSource,
    ai_reply_id: lock?.ai_reply_id || aiReplyId || null,
    outbound_meta_message_id: lock?.outbound_meta_message_id || safeOutboundMetaMessageId || "",
    status: lock?.status || status,
  });
  return lock;
};

// Phase 11 stale protection: is there a customer message newer than a given draft's source message?
// Prefer the precise message-id boundary; fall back to a timestamp when no source id was captured.
export const hasNewerCustomerMessage = async ({ tenantId, sessionId, afterMessageId = 0, afterTime = null } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  if (!safeTenantId || !safeSessionId) return false;
  await ensureAiSupportLogSchema();
  const params = [safeTenantId, safeSessionId];
  let boundary = "";
  if (Number(afterMessageId) > 0) { params.push(Number(afterMessageId)); boundary = `AND id > $${params.length}`; }
  else if (afterTime) { params.push(afterTime); boundary = `AND created_at > $${params.length}::timestamptz`; }
  else return false; // cannot determine freshness → do not block
  const result = await db.query(
    `SELECT 1 FROM ai_support_messages
      WHERE tenant_id = $1 AND session_id = $2 AND COALESCE(sender_type, '') = 'customer' ${boundary}
      LIMIT 1`,
    params
  ).catch(() => ({ rows: [] }));
  return Boolean(result.rows[0]);
};

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
  const safeSessionId = normalizeCanonicalWhatsappSessionId(sessionId, resolvedPhone || remoteJid || externalMessageId || providerMessageId) || toText(sessionId);
  const safeProviderMessageId = toText(providerMessageId || externalMessageId);
  if (!safeTenantId || !safeProviderMessageId) {
    return null;
  }
  await ensureAiSupportLogSchema();
  const result = await db.query(
    `
    UPDATE ai_support_messages
    SET
      delivery_status = (
        CASE
          WHEN NULLIF($4, '') IS NULL THEN delivery_status
          WHEN lower($4) = 'failed' THEN
            CASE WHEN (CASE lower(COALESCE(delivery_status, '')) WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE 0 END) >= 3
                 THEN delivery_status ELSE 'failed' END
          WHEN (CASE lower($4) WHEN 'pending' THEN 0 WHEN 'sending' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'failed' THEN 2 ELSE 0 END)
             > (CASE lower(COALESCE(delivery_status, '')) WHEN 'pending' THEN 0 WHEN 'sending' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'failed' THEN 2 ELSE 0 END)
            THEN $4
          ELSE delivery_status
        END
      ),
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
          OR ($2 <> '' AND session_id = $2 AND COALESCE(sender_type, '') <> 'customer')
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
  channel = "",
  customerName = "",
  externalCustomerId = "",
  externalMessageId = "",
  providerMessageId = "",
  sourcePath = "manual_admin",
  insertSource = "manual_message_insert",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessage = repairText(customerMessage);
  const safeChannel = toText(channel || source || "web_chat");
  const safeCustomerName = repairText(customerName);
  const safeExternalCustomerId = toText(externalCustomerId);
  const safeExternalMessageId = toText(externalMessageId || providerMessageId);
  const safeProviderMessageId = toText(providerMessageId || externalMessageId);
  if (!safeTenantId || !safeSessionId || !safeMessage) return null;

  await ensureAiSupportLogSchema();
  const requestedProductTerms = compactList(response.requested_product_terms || response.unknown_product_terms || extractTermsFromMessage(safeMessage), 10);
  const requestedSizes = compactList(response.requested_sizes || extractRequestedSizes(safeMessage), 8);
  const requestedColors = compactList(response.requested_colors || extractRequestedColors(safeMessage), 8);

  const sessionResult = await db.query(
    `
    INSERT INTO ai_support_sessions (
      tenant_id,
      user_id,
      session_id,
      source,
      channel,
      customer_name,
      external_customer_id,
      last_message,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, ai_support_sessions.user_id),
      source = COALESCE(NULLIF(EXCLUDED.source, ''), ai_support_sessions.source),
      channel = COALESCE(NULLIF(EXCLUDED.channel, ''), ai_support_sessions.channel),
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_support_sessions.external_customer_id),
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_support_sessions.last_message),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
    `,
    [
      safeTenantId,
      numberOrNull(userId),
      safeSessionId,
      repairText(source || safeChannel, "admin_console"),
      safeChannel,
      safeCustomerName,
      safeExternalCustomerId,
      safeMessage,
    ]
  );

  const sessionRefId = sessionResult.rows[0]?.id || null;
  console.info("[ai-support-insert]", {
    source: "manual_message_insert",
    session_id: safeSessionId,
    channel: safeChannel,
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
      channel,
      customer_name,
      last_message,
      external_message_id,
      provider_message_id,
      source_path,
      insert_source
    )
    VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19, $20, $21, $22, $23, $24)
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
      safeChannel,
      safeCustomerName,
      safeMessage,
      safeExternalMessageId,
      safeProviderMessageId,
      repairText(sourcePath, "manual_admin"),
      repairText(insertSource),
    ]
  );
  console.info("[ai-support-insert]", {
    source: "manual_message_insert",
    session_id: safeSessionId,
    channel: safeChannel,
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
