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
  if (Object.prototype.hasOwnProperty.call(value, "is_active")) normalized.is_active = value.is_active !== false;
  if (Object.prototype.hasOwnProperty.call(value, "sort_order")) normalized.sort_order = Math.max(0, Math.trunc(Number(value.sort_order) || 0));
  return normalized;
};

const mapRow = (row = {}) => ({
  id: Number(row.id),
  name: text(row.name),
  message: text(row.message),
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
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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
    `INSERT INTO ai_inbox_quick_replies (tenant_id, name, message, sort_order, created_by)
     SELECT $1, seed.name, seed.message, seed.sort_order, $2
     FROM jsonb_to_recordset($3::jsonb) AS seed(name text, message text, sort_order integer)
     WHERE NOT EXISTS (SELECT 1 FROM ai_inbox_quick_replies WHERE tenant_id = $1)`,
    [tenantId, userId || null, JSON.stringify(DEFAULT_QUICK_REPLIES.map((item, index) => ({ ...item, sort_order: index })))]
  );
}

export async function listAiInboxQuickReplies({ tenantId, includeInactive = false, userId = null } = {}) {
  const safeTenantId = tenant(tenantId);
  await ensureAiInboxQuickRepliesTable();
  await seedDefaultsIfEmpty(safeTenantId, userId);
  const result = await db.query(
    `SELECT id, name, message, is_active, sort_order, created_at, updated_at
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
  const result = await db.query(
    `INSERT INTO ai_inbox_quick_replies (tenant_id, name, message, is_active, sort_order, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ai_inbox_quick_replies WHERE tenant_id = $1)), $6)
     RETURNING id, name, message, is_active, sort_order, created_at, updated_at`,
    [safeTenantId, normalized.name, normalized.message, normalized.is_active !== false, normalized.sort_order ?? null, userId || null]
  );
  return mapRow(result.rows[0]);
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
  const result = await db.query(
    `UPDATE ai_inbox_quick_replies SET ${fields.join(", ")}, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id, name, message, is_active, sort_order, created_at, updated_at`,
    values
  );
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
