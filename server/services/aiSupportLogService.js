import db from "../database/db.js";

let schemaReadyPromise = null;

const toText = (value, fallback = "") => String(value ?? fallback).trim();

const jsonValue = (value) => JSON.stringify(value === undefined ? null : value);

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

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
          customer_name TEXT NOT NULL DEFAULT '',
          last_message TEXT NOT NULL DEFAULT '',
          assigned_user_id BIGINT NULL,
          assigned_user_name TEXT NOT NULL DEFAULT '',
          takeover_started_at TIMESTAMP NULL,
          returned_to_ai_at TIMESTAMP NULL,
          closed_at TIMESTAMP NULL,
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
          staff_message TEXT NOT NULL DEFAULT '',
          sender_type VARCHAR(40) NOT NULL DEFAULT 'customer',
          manual_message BOOLEAN NOT NULL DEFAULT FALSE,
          staff_user_id BIGINT NULL,
          staff_user_name TEXT NOT NULL DEFAULT '',
          external_message_id TEXT NOT NULL DEFAULT '',
          dedupe_key TEXT NOT NULL DEFAULT '',
          delivery_status TEXT NOT NULL DEFAULT '',
          delivery_error TEXT NOT NULL DEFAULT '',
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
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS assigned_user_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS takeover_started_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS returned_to_ai_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL`);
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
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS whatsapp_instance TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS remote_jid TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS delivery_error TEXT NOT NULL DEFAULT ''`);
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
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_conversations ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
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
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_human ON ai_support_messages (tenant_id, needs_human_support, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_confidence ON ai_support_messages (tenant_id, confidence, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_clicked ON ai_support_messages (tenant_id, clicked_product_id, created_at DESC)`);
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

export const getAiSupportConversationState = async ({ tenantId, sessionId } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  if (!safeTenantId || !safeSessionId) return null;
  await ensureAiSupportLogSchema();

  const result = await db.query(
    `
    SELECT *
    FROM ai_support_sessions
    WHERE tenant_id = $1 AND session_id = $2
    LIMIT 1
    `,
    [safeTenantId, safeSessionId]
  );
  return result.rows[0] || null;
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
  staffUserId = null,
  staffUserName = "",
  source = "admin_console",
  channel = "",
  deliveryStatus = "",
  deliveryError = "",
  externalMessageId = "",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessage = toText(message);
  if (!safeTenantId || !safeSessionId || !safeMessage) {
    throw Object.assign(new Error("Reply message is required"), { status: 400 });
  }
  await ensureAiSupportLogSchema();

  const sessionResult = await db.query(
    `
    INSERT INTO ai_support_sessions (
      tenant_id, user_id, session_id, source, status, assigned_user_id, assigned_user_name, takeover_started_at, updated_at
    )
    VALUES ($1, $2, $3, $4, 'human_takeover', $2, $5, NOW(), NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, ai_support_sessions.user_id),
      source = CASE
        WHEN EXCLUDED.source IN ('admin_console', 'ai_followup_center')
          AND ai_support_sessions.source IN ('facebook_messenger', 'instagram', 'whatsapp', 'web_chat')
          THEN ai_support_sessions.source
        ELSE EXCLUDED.source
      END,
      status = CASE WHEN ai_support_sessions.status = 'closed' THEN ai_support_sessions.status ELSE 'human_takeover' END,
      assigned_user_id = COALESCE(ai_support_sessions.assigned_user_id, EXCLUDED.assigned_user_id),
      assigned_user_name = COALESCE(NULLIF(ai_support_sessions.assigned_user_name, ''), EXCLUDED.assigned_user_name, ''),
      takeover_started_at = COALESCE(ai_support_sessions.takeover_started_at, NOW()),
      updated_at = NOW()
    RETURNING id, status
    `,
    [safeTenantId, numberOrNull(staffUserId), safeSessionId, toText(source, "admin_console"), toText(staffUserName)]
  );
  if (sessionResult.rows[0]?.status === "closed") {
    throw Object.assign(new Error("Conversation is closed"), { status: 409 });
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
      delivery_status,
      delivery_error,
      external_message_id
    )
    VALUES ($1, $2, $3, $4, $5, '', '', 1, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'manual_staff_reply', '', $5, 'staff', TRUE, $3, $6, COALESCE(NULLIF($7, ''), 'web_chat'), $8, $9, $10)
    RETURNING *
    `,
    [
      sessionResult.rows[0]?.id || null,
      safeTenantId,
      numberOrNull(staffUserId),
      safeSessionId,
      safeMessage,
      toText(staffUserName),
      toText(channel),
      toText(deliveryStatus),
      toText(deliveryError),
      toText(externalMessageId),
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
    [safeTenantId, safeSessionId, safeMessage, toText(channel)]
  ).catch(() => {});

  return result.rows[0] || null;
};

export const appendAiGeneratedSupportReply = async ({
  tenantId,
  sessionId,
  answer = "",
  confidence = 0.72,
  detectedIntent = "",
  suggestedProducts = [],
  visualAttachments = [],
  suggestedActions = [],
  channel = "",
  deliveryStatus = "",
  deliveryError = "",
  externalMessageId = "",
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeAnswer = toText(answer);
  if (!safeTenantId || !safeSessionId || !safeAnswer) {
    throw Object.assign(new Error("AI reply text is required"), { status: 400 });
  }
  await ensureAiSupportLogSchema();

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

  const result = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id,
      tenant_id,
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
      sender_type,
      manual_message,
      channel,
      delivery_status,
      delivery_error,
      external_message_id
    )
    VALUES ($1, $2, $3, $4, '', $4, $5, FALSE, '[]'::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, '', 'ai', FALSE, COALESCE(NULLIF($10, ''), 'web_chat'), $11, $12, $13)
    RETURNING *
    `,
    [
      sessionResult.rows[0]?.id || null,
      safeTenantId,
      safeSessionId,
      safeAnswer,
      Number(confidence) || 0,
      jsonValue(Array.isArray(suggestedProducts) ? suggestedProducts : []),
      jsonValue(Array.isArray(visualAttachments) ? visualAttachments : []),
      jsonValue(Array.isArray(suggestedActions) ? suggestedActions : []),
      toText(detectedIntent),
      toText(channel),
      toText(deliveryStatus),
      toText(deliveryError),
      toText(externalMessageId),
    ]
  );
  await db.query(
    `
    UPDATE ai_support_sessions
    SET last_message = $3,
      updated_at = NOW()
    WHERE tenant_id = $1 AND session_id = $2
    `,
    [safeTenantId, safeSessionId, safeAnswer]
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
} = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const safeSessionId = toText(sessionId);
  const safeMessage = toText(customerMessage);
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
    [safeTenantId, numberOrNull(userId), safeSessionId, toText(source, "admin_console")]
  );

  const sessionRefId = sessionResult.rows[0]?.id || null;
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
      requested_colors
    )
    VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb)
    RETURNING *
    `,
    [
      sessionRefId,
      safeTenantId,
      numberOrNull(userId),
      safeSessionId,
      safeMessage,
      toText(response.answer),
      Math.max(0, Math.min(1, Number(response.confidence || 0))),
      response.needs_human_support !== false,
      jsonValue(Array.isArray(response.sources_used) ? response.sources_used : []),
      jsonValue(Array.isArray(response.suggested_products) ? response.suggested_products : []),
      jsonValue(Array.isArray(response.visual_attachments) ? response.visual_attachments : []),
      jsonValue(Array.isArray(response.suggested_actions) ? response.suggested_actions : []),
      toText(detectedIntent),
      toText(fallbackReason),
      jsonValue(requestedProductTerms),
      jsonValue(requestedSizes),
      jsonValue(requestedColors),
    ]
  );

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
