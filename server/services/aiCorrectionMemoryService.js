import db from "../database/db.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const lower = (value = "") => text(value).toLowerCase();
const int = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};
const json = (value) => JSON.stringify(value === undefined ? null : value);
const asArray = (value) => (Array.isArray(value) ? value : []);

let schemaReadyPromise = null;

const CORRECTION_TYPES = new Set([
  "wrong_price",
  "wrong_stock",
  "wrong_policy",
  "bad_tone",
  "incomplete_answer",
  "other",
]);

const normalizeCorrectionType = (value = "") => {
  const normalized = lower(value).replace(/\s+/g, "_");
  return CORRECTION_TYPES.has(normalized) ? normalized : "other";
};

const normalizeCorrectionRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  conversation_id: text(row.conversation_id),
  message_id: text(row.message_id),
  customer_question: text(row.customer_question),
  ai_wrong_answer: text(row.ai_wrong_answer),
  employee_correct_answer: text(row.employee_correct_answer),
  correction_type: normalizeCorrectionType(row.correction_type),
  product_id: row.product_id ?? null,
  channel: text(row.channel || "web_chat"),
  created_by: row.created_by ?? null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || row.created_at || null,
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
});

export const ensureCorrectionMemorySchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_reply_corrections (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          conversation_id TEXT NOT NULL DEFAULT '',
          message_id TEXT NOT NULL DEFAULT '',
          customer_question TEXT NOT NULL DEFAULT '',
          ai_wrong_answer TEXT NOT NULL DEFAULT '',
          employee_correct_answer TEXT NOT NULL DEFAULT '',
          correction_type TEXT NOT NULL DEFAULT 'other',
          product_id BIGINT NULL,
          channel TEXT NOT NULL DEFAULT 'web_chat',
          created_by BIGINT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS tenant_id BIGINT NOT NULL DEFAULT 0`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS conversation_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS message_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS customer_question TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS ai_wrong_answer TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS employee_correct_answer TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS correction_type TEXT NOT NULL DEFAULT 'other'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS product_id BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS created_by BIGINT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_tenant_id ON ai_reply_corrections (tenant_id)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_conversation_id ON ai_reply_corrections (tenant_id, conversation_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_product_id ON ai_reply_corrections (tenant_id, product_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_correction_type ON ai_reply_corrections (tenant_id, correction_type, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_created_at ON ai_reply_corrections (created_at DESC)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const createCorrection = async ({
  tenantId,
  conversationId = "",
  messageId = "",
  customerQuestion = "",
  aiWrongAnswer = "",
  employeeCorrectAnswer = "",
  correctionType = "other",
  productId = null,
  channel = "web_chat",
  createdBy = null,
  metadata = {},
} = {}) => {
  await ensureCorrectionMemorySchema();
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) {
    throw Object.assign(new Error("tenant_id is required"), { status: 400, code: "MISSING_TENANT" });
  }
  const safeConversationId = text(conversationId);
  const safeMessageId = text(messageId);
  const safeCustomerQuestion = text(customerQuestion);
  const safeWrongAnswer = text(aiWrongAnswer);
  const safeCorrectAnswer = text(employeeCorrectAnswer);
  if (!safeConversationId || !safeMessageId) {
    throw Object.assign(new Error("conversation_id and message_id are required"), { status: 400, code: "MISSING_CONTEXT" });
  }
  if (!safeCustomerQuestion || !safeWrongAnswer || !safeCorrectAnswer) {
    throw Object.assign(new Error("customer_question, ai_wrong_answer, and employee_correct_answer are required"), {
      status: 400,
      code: "EMPTY_CORRECTION",
    });
  }

  const result = await db.query(
    `
    INSERT INTO ai_reply_corrections (
      tenant_id, conversation_id, message_id, customer_question, ai_wrong_answer,
      employee_correct_answer, correction_type, product_id, channel, created_by, metadata, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, NOW())
    RETURNING *
    `,
    [
      safeTenantId,
      safeConversationId,
      safeMessageId,
      safeCustomerQuestion,
      safeWrongAnswer,
      safeCorrectAnswer,
      normalizeCorrectionType(correctionType),
      Number.isFinite(Number(productId)) ? Number(productId) : null,
      text(channel || "web_chat"),
      Number.isFinite(Number(createdBy)) ? Number(createdBy) : null,
      json(metadata || {}),
    ]
  );
  return normalizeCorrectionRow(result.rows[0] || {});
};

export const listConversationCorrections = async ({
  tenantId,
  conversationId = "",
  limit = 50,
} = {}) => {
  await ensureCorrectionMemorySchema();
  const safeTenantId = Number(tenantId);
  const safeConversationId = text(conversationId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0 || !safeConversationId) return [];
  const safeLimit = Math.max(1, Math.min(200, int(limit, 50)));
  const result = await db.query(
    `
    SELECT *
    FROM ai_reply_corrections
    WHERE tenant_id = $1
      AND conversation_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [safeTenantId, safeConversationId, safeLimit]
  );
  return result.rows.map(normalizeCorrectionRow);
};

export const searchRelevantCorrections = async ({
  tenantId,
  query = "",
  productId = null,
  correctionType = "",
  limit = 3,
} = {}) => {
  await ensureCorrectionMemorySchema();
  const safeTenantId = Number(tenantId);
  if (!Number.isFinite(safeTenantId) || safeTenantId <= 0) return [];
  const safeQuery = text(query).slice(0, 300);
  const safeLimit = Math.max(1, Math.min(20, int(limit, 3)));
  const safeType = normalizeCorrectionType(correctionType || "");
  const queryLike = safeQuery ? `%${lower(safeQuery)}%` : "";
  const params = [safeTenantId];
  const clauses = ["tenant_id = $1"];
  if (Number.isFinite(Number(productId)) && Number(productId) > 0) {
    params.push(Number(productId));
    clauses.push(`product_id = $${params.length}`);
  }
  if (safeType && safeType !== "other" && text(correctionType)) {
    params.push(safeType);
    clauses.push(`LOWER(correction_type) = LOWER($${params.length})`);
  }
  if (safeQuery) {
    params.push(queryLike);
    const idx = params.length;
    clauses.push(`(
      LOWER(COALESCE(customer_question, '')) LIKE $${idx}
      OR LOWER(COALESCE(ai_wrong_answer, '')) LIKE $${idx}
      OR LOWER(COALESCE(employee_correct_answer, '')) LIKE $${idx}
      OR LOWER(COALESCE(metadata::text, '')) LIKE $${idx}
    )`);
  }

  const scoreSql = safeQuery
    ? `
      (
        CASE WHEN LOWER(COALESCE(customer_question, '')) LIKE $${params.length} THEN 6 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(ai_wrong_answer, '')) LIKE $${params.length} THEN 4 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(employee_correct_answer, '')) LIKE $${params.length} THEN 5 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(metadata::text, '')) LIKE $${params.length} THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(product_id, 0) > 0 THEN 1 ELSE 0 END
      )`
    : `CASE WHEN COALESCE(product_id, 0) > 0 THEN 1 ELSE 0 END`;

  const result = await db.query(
    `
    SELECT *
    FROM (
      SELECT ai_reply_corrections.*, ${scoreSql} AS relevance_score
      FROM ai_reply_corrections
      WHERE ${clauses.join(" AND ")}
    ) ranked
    ORDER BY relevance_score DESC, created_at DESC, id DESC
    LIMIT $${params.length + 1}
    `,
    [...params, safeLimit]
  );
  return result.rows.map(normalizeCorrectionRow);
};

export const buildReplyCorrectionContextSource = (corrections = [], query = "") =>
  asArray(corrections)
    .slice(0, 3)
    .map((item, index) => {
      const question = text(item.customer_question);
      const wrongAnswer = text(item.ai_wrong_answer);
      const correctAnswer = text(item.employee_correct_answer);
      const correctionType = normalizeCorrectionType(item.correction_type);
      const productLabel = Number.isFinite(Number(item.product_id)) && Number(item.product_id) > 0 ? `Product ${item.product_id}` : "No product";
      return {
        id: `reply_correction_${item.id || index + 1}`,
        title: `Employee correction ${index + 1}`,
        content: [
          `Query: ${text(query) || "n/a"}`,
          `Correction type: ${correctionType}`,
          `Conversation: ${text(item.conversation_id)}`,
          `Message: ${text(item.message_id)}`,
          `Product: ${productLabel}`,
          `Customer question: ${question}`,
          `AI wrong answer: ${wrongAnswer}`,
          `Employee correct answer: ${correctAnswer}`,
        ].join("\n"),
      };
    });

export const normalizeCorrectionTypeValue = normalizeCorrectionType;
