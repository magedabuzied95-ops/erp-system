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
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
      // Phase 11.2 — intent/use-case key for normalized STYLE retrieval (backfilled from metadata.detected_intent).
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_reply_corrections ADD COLUMN IF NOT EXISTS intent TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_reply_corrections_intent ON ai_reply_corrections (tenant_id, intent, created_at DESC)`);
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
  intent = "",
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
      employee_correct_answer, correction_type, product_id, channel, created_by, intent, metadata, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, NOW())
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
      String(intent || metadata?.detected_intent || "").toUpperCase(),
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
      const wrongAnswer = text(item.ai_wrong_answer);
      const correctAnswer = text(item.employee_correct_answer);
      const correctionType = normalizeCorrectionType(item.correction_type);
      // Phase 11.2 — present corrections EXPLICITLY as STYLE EXAMPLES (tone/brevity/phrasing), never as factual
      // answer memory. The model may imitate wording; it must NEVER reuse the example's stock/price/size/
      // product/order/shipping/policy specifics — those come ONLY from the VERIFIED FACTS for the CURRENT
      // product (the grounding gate re-asserts them last). This keeps style transfer safe and facts authoritative.
      return {
        id: `reply_style_example_${item.id || index + 1}`,
        title: `STYLE EXAMPLE ${index + 1} (imitate tone/phrasing ONLY — not facts)`,
        content: [
          "This shows HOW an employee prefers to phrase a reply. Imitate ONLY the tone, brevity, greeting/closing,",
          "emoji use, and general phrasing. NEVER copy the specific stock count, price, size availability, product",
          "identity, order/shipping/policy details from this example — always use the VERIFIED FACTS for the",
          "current product instead.",
          `Intent/type: ${correctionType}`,
          `Employee's preferred phrasing (style to imitate): ${correctAnswer}`,
          `Earlier AI phrasing the employee replaced (style to avoid): ${wrongAnswer}`,
        ].join("\n"),
      };
    });

export const normalizeCorrectionTypeValue = normalizeCorrectionType;

// ============================ Phase 11.2 — bounded TENANT STYLE PROFILE ============================
// Derives a SMALL, inspectable set of safe PRESENTATION preferences (brevity / omit-stock / emoji) from
// repeated approved employee edits, per intent. It NEVER stores stock/price/product/policy VALUES — only
// "how to phrase", learned only after >= threshold consistent examples. Conflicting edits disable a signal.

// Digit-fold (Arabic→ASCII) + Arabic letter normalization so "٤٥" and "45" match, and wording varies freely.
export const normalizeStyleText = (value = "") =>
  String(value ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Style-relevant intents; anything else never contributes to (or is contaminated by) availability style.
export const STYLE_INTENTS = new Set(["PRODUCT_AVAILABILITY", "ORDER_STATUS", "RETURN_POLICY", "RESTOCK_REQUEST", "PRICE_INQUIRY"]);
const STYLE_THRESHOLD = 5;

const countEmoji = (s = "") => (String(s).match(/\p{Extended_Pictographic}/gu) || []).length;
// A customer-facing exact stock count, e.g. "(3 قطع)" / "3 قطعة" / "متبقي 2".
const hasStockCount = (s = "") => /\d+\s*(?:قطع|قطعة|pcs?|pieces?)/i.test(normalizeStyleText(s)) || /متبقي\s*\d+|متبقى\s*\d+/.test(normalizeStyleText(s));

// Deterministic per-edit signal votes from (original AI text → final employee text). Presentation only.
export const correctionStyleSignals = (correction = {}) => {
  const orig = text(correction.ai_wrong_answer);
  const final = text(correction.employee_correct_answer);
  if (!orig || !final) return null;
  const signals = {};
  signals.brevity = final.length <= orig.length * 0.6 ? "concise" : "normal";
  const origStock = hasStockCount(orig);
  const finalStock = hasStockCount(final);
  if (origStock && !finalStock) signals.exact_stock_count = "usually_omit";
  else if (finalStock) signals.exact_stock_count = "usually_include";
  const e = countEmoji(final);
  signals.emoji = e === 0 ? "none" : e <= 1 ? "light" : "heavy";
  return signals;
};

const correctionIntent = (c = {}) =>
  String(c.intent || c.metadata?.detected_intent || c.metadata?.intent || "").toUpperCase();

// Build the bounded profile: { INTENT: { signal: { value, status: learning|stable|conflicting, evidence, total, threshold } } }
export const deriveTenantStyleProfile = (corrections = [], { threshold = STYLE_THRESHOLD } = {}) => {
  const tally = {};
  for (const c of asArray(corrections)) {
    const intent = correctionIntent(c);
    if (!STYLE_INTENTS.has(intent)) continue;
    const sig = correctionStyleSignals(c);
    if (!sig) continue;
    tally[intent] = tally[intent] || {};
    for (const [signal, val] of Object.entries(sig)) {
      tally[intent][signal] = tally[intent][signal] || {};
      tally[intent][signal][val] = (tally[intent][signal][val] || 0) + 1;
    }
  }
  const profile = {};
  for (const [intent, signals] of Object.entries(tally)) {
    profile[intent] = {};
    for (const [signal, votes] of Object.entries(signals)) {
      const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      const [topVal, topN] = ranked[0];
      const total = ranked.reduce((s, [, n]) => s + n, 0);
      // A meaningful minority (>= half of the top) means employees disagree → do not guess.
      const conflicting = ranked.length > 1 && ranked[1][1] >= Math.ceil(topN / 2);
      let status = "learning";
      let value = null;
      if (conflicting) status = "conflicting";
      else if (topN >= threshold) { status = "stable"; value = topVal; }
      profile[intent][signal] = { value, status, evidence: topN, total, threshold };
    }
  }
  return profile;
};

// Normalized style-example retrieval: match primarily by INTENT (+ optional channel), digit/text normalized —
// NOT by near-identical customer wording, and never by customer identity. Bounded LIMIT, no embeddings.
export const fetchStyleCorrectionsByIntent = async ({ tenantId, intent, channel = "", limit = 50, afterTs = null } = {}) => {
  await ensureCorrectionMemorySchema();
  const wantIntent = String(intent || "").toUpperCase();
  if (!STYLE_INTENTS.has(wantIntent)) return [];
  const rows = (await db.query(
    `SELECT * FROM ai_reply_corrections
      WHERE tenant_id = $1
        AND UPPER(COALESCE(intent, metadata->>'detected_intent', '')) = $2
        AND ($3 = '' OR channel = $3)
        AND ($4::timestamptz IS NULL OR created_at > $4::timestamptz)
      ORDER BY id DESC LIMIT $5`,
    [tenantId, wantIntent, String(channel || ""), afterTs || null, Math.max(1, Math.min(500, Number(limit) || 50))]
  ).catch(() => ({ rows: [] }))).rows;
  return rows.map(normalizeCorrectionRow);
};

// Load + derive the current tenant style profile (for generation + the AI Studio inspector). `resetAt` (from
// tenant settings) lets an admin CLEAR the learned profile without deleting audit rows: only edits after it count.
export const getTenantStyleProfile = async ({ tenantId, intent = null, channel = "", resetAt = null } = {}) => {
  await ensureCorrectionMemorySchema();
  const intents = intent ? [String(intent).toUpperCase()] : [...STYLE_INTENTS];
  const all = [];
  for (const it of intents) all.push(...(await fetchStyleCorrectionsByIntent({ tenantId, intent: it, channel, afterTs: resetAt })));
  return { profile: deriveTenantStyleProfile(all), evidence_count: all.length };
};
