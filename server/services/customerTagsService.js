import db from "../database/db.js";

/*
 * Tags on the customer, not on the conversation.
 *
 * Conversation labels live in `ai_channel_conversations.metadata` and describe
 * one thread. A tag like "VIP" or "بيرجّع كتير" describes the person, so it has
 * to follow them across WhatsApp, Instagram and the till — which means the
 * `customers` row, the one identity everything else already hangs on.
 */
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

let schemaReadyPromise = null;

const text = (value = "") => String(value ?? "").trim();
const tenant = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw Object.assign(new Error("A valid tenant id is required"), { status: 400 });
  return Math.trunc(parsed);
};
const customerId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw Object.assign(new Error("A valid customer id is required"), { status: 400 });
  return Math.trunc(parsed);
};

export const normalizeCustomerTags = (value) => {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,،\n]/) : [];
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = text(raw).replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
};

export const ensureCustomerTagsSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_customers_tags_gin ON customers USING GIN (tags jsonb_path_ops)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
};

export const listCustomerTags = async ({ tenantId } = {}) => {
  await ensureCustomerTagsSchema();
  const result = await db.query(
    `
    SELECT tag, COUNT(*)::int AS customers
    FROM customers c, jsonb_array_elements_text(COALESCE(c.tags, '[]'::jsonb)) AS tag
    WHERE c.tenant_id = $1
    GROUP BY tag
    ORDER BY customers DESC, tag ASC
    LIMIT 200
    `,
    [tenant(tenantId)]
  );
  return result.rows.map((row) => ({ tag: row.tag, customers: Number(row.customers || 0) }));
};

export const setCustomerTags = async ({ tenantId, id, tags } = {}) => {
  await ensureCustomerTagsSchema();
  const normalized = normalizeCustomerTags(tags);
  const result = await db.query(
    `UPDATE customers SET tags = $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING id, tags`,
    [tenant(tenantId), customerId(id), JSON.stringify(normalized)]
  );
  if (!result.rows.length) throw Object.assign(new Error("Customer not found"), { status: 404 });
  return { id: Number(result.rows[0].id), tags: normalizeCustomerTags(result.rows[0].tags) };
};

export const addCustomerTags = async ({ tenantId, id, tags } = {}) => {
  await ensureCustomerTagsSchema();
  const current = await db.query(`SELECT tags FROM customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenant(tenantId), customerId(id)]);
  if (!current.rows.length) throw Object.assign(new Error("Customer not found"), { status: 404 });
  return setCustomerTags({ tenantId, id, tags: [...normalizeCustomerTags(current.rows[0].tags), ...normalizeCustomerTags(tags)] });
};

// The SQL fragment the broadcast audience uses: "has ANY of these tags".
export const customerTagsAnyClauseSql = (paramIndex) => `COALESCE(c.tags, '[]'::jsonb) ?| ${paramIndex}::text[]`;
