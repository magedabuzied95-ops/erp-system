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

const extractSuggestedProductIds = (products = []) =>
  compactList(
    (Array.isArray(products) ? products : [])
      .map((product) => product?.id ?? product?.product_id ?? product?.productId)
      .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
      .map((value) => String(Math.trunc(Number(value)))),
    50
  );

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
          message_text TEXT NOT NULL DEFAULT '',
          customer_message TEXT NOT NULL,
          ai_answer TEXT NOT NULL DEFAULT '',
          confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
          needs_human_support BOOLEAN NOT NULL DEFAULT TRUE,
          sources_used JSONB NOT NULL DEFAULT '[]'::jsonb,
          suggested_products JSONB NOT NULL DEFAULT '[]'::jsonb,
          suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
          detected_intent TEXT NOT NULL DEFAULT '',
          fallback_reason TEXT NOT NULL DEFAULT '',
          requested_product_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
          requested_sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
          requested_colors JSONB NOT NULL DEFAULT '[]'::jsonb,
          clicked_product_id BIGINT NULL,
          added_to_cart_after_chat BOOLEAN NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS message_text TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS requested_product_terms JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS requested_sizes JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS requested_colors JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS clicked_product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE ai_support_messages ADD COLUMN IF NOT EXISTS added_to_cart_after_chat BOOLEAN NULL`);
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
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_created ON ai_support_messages (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_human ON ai_support_messages (tenant_id, needs_human_support, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_confidence ON ai_support_messages (tenant_id, confidence, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_messages_tenant_clicked ON ai_support_messages (tenant_id, clicked_product_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_aliases_tenant_usage ON ai_support_product_aliases (tenant_id, mapped_product_id, usage_count DESC)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
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
      suggested_actions,
      detected_intent,
      fallback_reason,
      requested_product_terms,
      requested_sizes,
      requested_colors
    )
    VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb)
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

export const getAiSupportInsights = async ({ tenantId, limit = 10 } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) {
    return {
      top_questions: [],
      top_product_terms: [],
      top_requested_sizes: [],
      top_requested_colors: [],
      most_suggested_products: [],
      most_clicked_suggested_products: [],
      fallback_questions: [],
      human_handoff_count: 0,
      pending_aliases: [],
    };
  }
  await ensureAiSupportLogSchema();
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
    db.query(
      `
      SELECT customer_message AS question, COUNT(*)::int AS count, MAX(created_at) AS last_asked_at
      FROM ai_support_messages
      WHERE tenant_id = $1
      GROUP BY LOWER(customer_message), customer_message
      ORDER BY count DESC, last_asked_at DESC
      LIMIT $2
      `,
      params
    ),
    db.query(
      `
      SELECT value AS term, COUNT(*)::int AS count
      FROM ai_support_messages, jsonb_array_elements_text(requested_product_terms) AS value
      WHERE tenant_id = $1
      GROUP BY value
      ORDER BY count DESC, value ASC
      LIMIT $2
      `,
      params
    ),
    db.query(
      `
      SELECT value AS size, COUNT(*)::int AS count
      FROM ai_support_messages, jsonb_array_elements_text(requested_sizes) AS value
      WHERE tenant_id = $1
      GROUP BY value
      ORDER BY count DESC, value ASC
      LIMIT $2
      `,
      params
    ),
    db.query(
      `
      SELECT value AS color, COUNT(*)::int AS count
      FROM ai_support_messages, jsonb_array_elements_text(requested_colors) AS value
      WHERE tenant_id = $1
      GROUP BY value
      ORDER BY count DESC, value ASC
      LIMIT $2
      `,
      params
    ),
    db.query(
      `
      SELECT
        COALESCE(product->>'id', product->>'product_id') AS product_id,
        MAX(product->>'name') AS name,
        COUNT(*)::int AS count
      FROM ai_support_messages
      CROSS JOIN LATERAL jsonb_array_elements(suggested_products) AS product
      WHERE tenant_id = $1
        AND COALESCE(product->>'id', product->>'product_id') IS NOT NULL
      GROUP BY COALESCE(product->>'id', product->>'product_id')
      ORDER BY count DESC, name ASC
      LIMIT $2
      `,
      params
    ),
    db.query(
      `
      SELECT
        clicked_product_id AS product_id,
        MAX(product->>'name') FILTER (
          WHERE COALESCE(product->>'id', product->>'product_id') = clicked_product_id::text
        ) AS name,
        COUNT(*)::int AS count
      FROM ai_support_messages
      LEFT JOIN LATERAL jsonb_array_elements(suggested_products) AS product ON TRUE
      WHERE tenant_id = $1
        AND clicked_product_id IS NOT NULL
      GROUP BY clicked_product_id
      ORDER BY count DESC, product_id ASC
      LIMIT $2
      `,
      params
    ),
    db.query(
      `
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
      params
    ),
    db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND needs_human_support = TRUE
      `,
      [safeTenantId]
    ),
    db.query(
      `
      SELECT alias, mapped_product_id, usage_count, confidence::float AS confidence, updated_at
      FROM ai_support_product_aliases
      WHERE tenant_id = $1
        AND mapped_product_id IS NULL
      ORDER BY usage_count DESC, updated_at DESC
      LIMIT $2
      `,
      params
    ),
  ]);

  return {
    top_questions: topQuestions.rows,
    top_product_terms: topProductTerms.rows,
    top_requested_sizes: topRequestedSizes.rows,
    top_requested_colors: topRequestedColors.rows,
    most_suggested_products: mostSuggestedProducts.rows,
    most_clicked_suggested_products: mostClickedProducts.rows,
    fallback_questions: fallbackQuestions.rows,
    human_handoff_count: humanHandoff.rows[0]?.count || 0,
    pending_aliases: pendingAliases.rows,
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
