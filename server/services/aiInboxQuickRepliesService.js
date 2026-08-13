import db from "../database/db.js";

const DEFAULT_QUICK_REPLIES = Object.freeze([
  { name: "Greeting", message: "Hi {{name}} 👋 How can I help you today?" },
  { name: "Contact Support", message: "You can reply here and our support team will assist you." },
  { name: "Thanks & Close", message: "Thanks for reaching out — if you need anything else just send us a message." },
]);

let schemaReadyPromise = null;

const text = (value = "") => String(value ?? "").trim();
const tenant = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw Object.assign(new Error("A valid tenant id is required"), { status: 400 });
  return Math.trunc(parsed);
};
const replyId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw Object.assign(new Error("A valid quick reply id is required"), { status: 400 });
  return Math.trunc(parsed);
};
const shortcut = (value) => {
  const normalized = text(value);
  if (!/^\d{1,4}$/.test(normalized) || Number(normalized) <= 0) {
    throw Object.assign(new Error("Shortcut must be a number between 1 and 9999"), { status: 400 });
  }
  return String(Number(normalized));
};

const normalizeInput = (value = {}, { partial = false } = {}) => {
  const normalized = {};
  if (!partial || Object.prototype.hasOwnProperty.call(value, "name")) {
    normalized.name = text(value.name).slice(0, 120);
    if (!normalized.name) throw Object.assign(new Error("Quick reply name is required"), { status: 400 });
  }
  if (!partial || Object.prototype.hasOwnProperty.call(value, "message")) {
    normalized.message = text(value.message).slice(0, 4000);
    if (!normalized.message) throw Object.assign(new Error("Quick reply message is required"), { status: 400 });
  }
  if (Object.prototype.hasOwnProperty.call(value, "shortcut")) normalized.shortcut = shortcut(value.shortcut);
  if (Object.prototype.hasOwnProperty.call(value, "is_active")) normalized.is_active = value.is_active !== false;
  if (Object.prototype.hasOwnProperty.call(value, "sort_order")) normalized.sort_order = Math.max(0, Math.trunc(Number(value.sort_order) || 0));
  return normalized;
};

const mapRow = (row = {}) => ({
  id: Number(row.id),
  name: text(row.name),
  message: text(row.message),
  shortcut: text(row.shortcut),
  is_active: row.is_active !== false,
  sort_order: Number(row.sort_order || 0),
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

export async function ensureAiInboxQuickRepliesTable() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = db.query(`
      CREATE TABLE IF NOT EXISTS ai_inbox_quick_replies (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        name VARCHAR(120) NOT NULL,
        message TEXT NOT NULL,
        shortcut VARCHAR(4),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE ai_inbox_quick_replies ADD COLUMN IF NOT EXISTS shortcut VARCHAR(4);
      WITH tenant_max AS (
        SELECT tenant_id, COALESCE(MAX(CASE WHEN shortcut ~ '^[0-9]+$' THEN shortcut::integer END), 0) AS max_shortcut
        FROM ai_inbox_quick_replies
        GROUP BY tenant_id
      ), ranked AS (
        SELECT replies.id,
          (COALESCE(tenant_max.max_shortcut, 0) + ROW_NUMBER() OVER (PARTITION BY replies.tenant_id ORDER BY replies.sort_order ASC, replies.id ASC))::text AS generated_shortcut
        FROM ai_inbox_quick_replies AS replies
        LEFT JOIN tenant_max ON tenant_max.tenant_id = replies.tenant_id
        WHERE replies.shortcut IS NULL OR BTRIM(replies.shortcut) = ''
      )
      UPDATE ai_inbox_quick_replies AS replies
      SET shortcut = ranked.generated_shortcut
      FROM ranked
      WHERE replies.id = ranked.id;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_inbox_quick_replies_tenant_shortcut
        ON ai_inbox_quick_replies (tenant_id, shortcut)
        WHERE shortcut IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ai_inbox_quick_replies_tenant_order
        ON ai_inbox_quick_replies (tenant_id, sort_order, id);
    `).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

async function seedDefaultsIfEmpty(tenantId, userId = null) {
  const existing = await db.query("SELECT 1 FROM ai_inbox_quick_replies WHERE tenant_id = $1 LIMIT 1", [tenantId]);
  if (existing.rows.length) return;
  await db.query(
    `INSERT INTO ai_inbox_quick_replies (tenant_id, shortcut, name, message, sort_order, created_by)
     SELECT $1, seed.shortcut, seed.name, seed.message, seed.sort_order, $2
     FROM jsonb_to_recordset($3::jsonb) AS seed(shortcut text, name text, message text, sort_order integer)
     WHERE NOT EXISTS (SELECT 1 FROM ai_inbox_quick_replies WHERE tenant_id = $1)`,
    [tenantId, userId || null, JSON.stringify(DEFAULT_QUICK_REPLIES.map((item, index) => ({ ...item, shortcut: String(index + 1), sort_order: index })))]
  );
}

export async function listAiInboxQuickReplies({ tenantId, includeInactive = false, userId = null } = {}) {
  const safeTenantId = tenant(tenantId);
  await ensureAiInboxQuickRepliesTable();
  await seedDefaultsIfEmpty(safeTenantId, userId);
  const result = await db.query(
    `SELECT id, shortcut, name, message, is_active, sort_order, created_at, updated_at
     FROM ai_inbox_quick_replies
     WHERE tenant_id = $1 AND ($2::boolean OR is_active = TRUE)
     ORDER BY sort_order ASC, id ASC`,
    [safeTenantId, includeInactive === true]
  );
  return result.rows.map(mapRow);
}

export async function createAiInboxQuickReply({ tenantId, userId = null, input = {} } = {}) {
  const safeTenantId = tenant(tenantId);
  const normalized = normalizeInput(input);
  await ensureAiInboxQuickRepliesTable();
  try {
    const result = await db.query(
      `INSERT INTO ai_inbox_quick_replies (tenant_id, name, message, shortcut, is_active, sort_order, created_by)
       VALUES ($1, $2, $3,
         COALESCE($4, (SELECT (COALESCE(MAX(CASE WHEN shortcut ~ '^[0-9]+$' THEN shortcut::integer END), 0) + 1)::text FROM ai_inbox_quick_replies WHERE tenant_id = $1)),
         $5, COALESCE($6, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ai_inbox_quick_replies WHERE tenant_id = $1)), $7)
       RETURNING id, shortcut, name, message, is_active, sort_order, created_at, updated_at`,
      [safeTenantId, normalized.name, normalized.message, normalized.shortcut || null, normalized.is_active !== false, normalized.sort_order ?? null, userId || null]
    );
    return mapRow(result.rows[0]);
  } catch (error) {
    if (error?.code === "23505") throw Object.assign(new Error("This shortcut is already used by another quick reply"), { status: 409 });
    throw error;
  }
}

export async function updateAiInboxQuickReply({ tenantId, id, input = {} } = {}) {
  const safeTenantId = tenant(tenantId);
  const safeId = replyId(id);
  const normalized = normalizeInput(input, { partial: true });
  if (!Object.keys(normalized).length) throw Object.assign(new Error("No quick reply changes were supplied"), { status: 400 });
  await ensureAiInboxQuickRepliesTable();
  const fields = [];
  const values = [safeTenantId, safeId];
  Object.entries(normalized).forEach(([key, value]) => {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  });
  let result;
  try {
    result = await db.query(
      `UPDATE ai_inbox_quick_replies SET ${fields.join(", ")}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, shortcut, name, message, is_active, sort_order, created_at, updated_at`,
      values
    );
  } catch (error) {
    if (error?.code === "23505") throw Object.assign(new Error("This shortcut is already used by another quick reply"), { status: 409 });
    throw error;
  }
  if (!result.rows.length) throw Object.assign(new Error("Quick reply was not found"), { status: 404 });
  return mapRow(result.rows[0]);
}

export async function deleteAiInboxQuickReply({ tenantId, id } = {}) {
  await ensureAiInboxQuickRepliesTable();
  const result = await db.query(
    "DELETE FROM ai_inbox_quick_replies WHERE tenant_id = $1 AND id = $2 RETURNING id",
    [tenant(tenantId), replyId(id)]
  );
  if (!result.rows.length) throw Object.assign(new Error("Quick reply was not found"), { status: 404 });
  return true;
}

export async function reorderAiInboxQuickReplies({ tenantId, orderedIds = [] } = {}) {
  const safeTenantId = tenant(tenantId);
  const ids = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).map(Number).filter((id) => Number.isFinite(id) && id > 0).map(Math.trunc))];
  if (!ids.length) throw Object.assign(new Error("At least one quick reply id is required"), { status: 400 });
  await ensureAiInboxQuickRepliesTable();
  await db.query(
    `UPDATE ai_inbox_quick_replies AS replies
     SET sort_order = ordering.sort_order, updated_at = NOW()
     FROM unnest($2::bigint[]) WITH ORDINALITY AS ordering(id, sort_order)
     WHERE replies.tenant_id = $1 AND replies.id = ordering.id`,
    [safeTenantId, ids]
  );
  return listAiInboxQuickReplies({ tenantId: safeTenantId, includeInactive: true });
}
