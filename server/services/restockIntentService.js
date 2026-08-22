// AI Studio Phase 7 — Restock Intent (variant-level, explicit consent).
// ---------------------------------------------------------------------------
// A Restock Intent is an EXPLICIT customer request: "notify/contact me when THIS
// product/variant/size/color becomes available." It is NOT a wishlist entry (a saved product).
// Phase 6's product-level customer_wishlist stays untouched as a legacy product-only fallback.
//
// Canonical identity (audited): product_variants.id is the sellable variant id; size/color/stock
// live on that row. Customer identity + phone come from the storefront JWT; phone is normalized
// with the ERP's canonical normalizePhone (server/utils/phoneSearch.js) — no second normalizer.
// Availability re-check reuses getInventoryFacts. No customer message is ever sent.

import db from "../database/db.js";
import { normalizePhone } from "../utils/phoneSearch.js";
import { getInventoryFacts } from "./aiBusinessToolsService.js";

export const INTENT_STATUSES = Object.freeze(["waiting", "recovery_created", "customer_notified", "fulfilled", "cancelled", "expired"]);
export const INTENT_SOURCES = Object.freeze(["storefront", "ai_inbox", "admin", "legacy_wishlist"]);
export const ACTIVE_STATUSES = Object.freeze(["waiting", "recovery_created", "customer_notified"]);
export const INTENT_DEFAULT_LIMIT = 25;
export const INTENT_MAX_LIMIT = 100;

const err = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };

let schemaReady = null;
export const ensureRestockIntentSchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS restock_intents (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        customer_id BIGINT NULL,
        phone TEXT NULL,                 -- normalized
        product_id BIGINT NOT NULL,
        variant_id BIGINT NULL,          -- canonical product_variants.id (null = product-level intent)
        size TEXT NULL,                  -- snapshot for human readability/audit (variant_id authoritative)
        color TEXT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        source TEXT NOT NULL DEFAULT 'storefront',
        source_reference TEXT NULL,
        last_restock_event_id TEXT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        customer_notified_at TIMESTAMP NULL,  -- set ONLY by a future confirmed customer-contact; NEVER by an internal follow-up
        fulfilled_at TIMESTAMP NULL,
        cancelled_at TIMESTAMP NULL
      )
    `);
    // One ACTIVE intent per (tenant, phone, product, variant). Repeated "Notify me" reuses it.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_intents_active
      ON restock_intents (tenant_id, COALESCE(phone, ''), product_id, COALESCE(variant_id, 0))
      WHERE status IN ('waiting','recovery_created','customer_notified')`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restock_intents_match ON restock_intents (tenant_id, product_id, variant_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restock_intents_tenant ON restock_intents (tenant_id, created_at DESC)`);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

// ---- Availability (variant-precise; reuses getInventoryFacts) ----
const readAvailability = async ({ tenantId, productId, variantId }) => {
  try {
    const facts = await getInventoryFacts({ tenantId, productId, variantId: variantId || null, query: "" });
    const rows = Array.isArray(facts?.variant_stock) ? facts.variant_stock : [];
    if (variantId) {
      const m = rows.find((r) => String(r.variant_id) === String(variantId));
      return { available: m ? Number(m.stock || 0) : 0, size: m?.size ?? null, color: m?.color ?? null, productName: facts?.product_name || facts?.name || null };
    }
    return { available: rows.reduce((a, r) => a + Number(r.stock || 0), 0), size: null, color: null, productName: facts?.product_name || facts?.name || null };
  } catch { return { available: 0, size: null, color: null, productName: null }; } // fail-safe: treat as unavailable
};

// ---- Create an explicit intent (requires an explicit customer/employee action upstream) ----
export const createIntent = async ({ tenantId, customerId = null, phone = null, productId, variantId = null, source = "storefront", sourceReference = null } = {}) => {
  await ensureRestockIntentSchema();
  if (!tenantId || !productId) throw err("tenantId and productId are required");
  if (!INTENT_SOURCES.includes(source)) source = "storefront";
  const normPhone = phone ? normalizePhone(String(phone)) : null;
  if (!normPhone && !customerId) throw err("a phone or customer identity is required");

  const prod = await db.query(`SELECT id, name FROM products WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [productId, tenantId]);
  if (!prod.rows[0]) throw err("product not found", 404);

  let size = null, color = null;
  if (variantId) {
    const v = await db.query(`SELECT product_id, size, color FROM product_variants WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`, [variantId, tenantId]);
    const vr = v.rows[0];
    if (!vr) throw err("variant not found", 404);
    if (String(vr.product_id) !== String(productId)) throw err("variant does not belong to this product");
    size = vr.size; color = vr.color;
  }

  // Availability re-check: never create an intent for an in-stock item (available_now race).
  const avail = await readAvailability({ tenantId, productId, variantId });
  if (avail.available > 0) return { available_now: true, intent: null };

  // Reuse an existing active intent instead of creating a duplicate.
  const existing = await db.query(
    `SELECT * FROM restock_intents WHERE tenant_id = $1 AND COALESCE(phone,'') = $2 AND product_id = $3 AND COALESCE(variant_id,0) = $4 AND status IN ('waiting','recovery_created','customer_notified') LIMIT 1`,
    [tenantId, normPhone || "", productId, variantId || 0]
  );
  if (existing.rows[0]) return { reused: true, intent: existing.rows[0] };

  try {
    const ins = await db.query(
      `INSERT INTO restock_intents (tenant_id, customer_id, phone, product_id, variant_id, size, color, status, source, source_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'waiting',$8,$9) RETURNING *`,
      [tenantId, customerId || null, normPhone, productId, variantId || null, size, color, source, sourceReference]
    );
    return { created: true, intent: ins.rows[0] };
  } catch (e) {
    // Unique-violation backstop for a concurrent create → return the winner.
    if (String(e?.code) === "23505") {
      const again = await db.query(
        `SELECT * FROM restock_intents WHERE tenant_id = $1 AND COALESCE(phone,'') = $2 AND product_id = $3 AND COALESCE(variant_id,0) = $4 AND status IN ('waiting','recovery_created','customer_notified') LIMIT 1`,
        [tenantId, normPhone || "", productId, variantId || 0]
      );
      if (again.rows[0]) return { reused: true, intent: again.rows[0] };
    }
    throw e;
  }
};

export const cancelIntent = async (tenantId, intentId, { actorPhone = null } = {}) => {
  await ensureRestockIntentSchema();
  const params = [tenantId, intentId];
  let where = `tenant_id = $1 AND id = $2 AND status IN ('waiting','recovery_created','customer_notified')`;
  if (actorPhone) { params.push(normalizePhone(String(actorPhone))); where += ` AND COALESCE(phone,'') = $${params.length}`; } // storefront: only your own
  const r = await db.query(`UPDATE restock_intents SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE ${where} RETURNING *`, params);
  return r.rows[0] || null;
};

export const markIntentFulfilled = async (tenantId, intentId) => {
  await ensureRestockIntentSchema();
  const r = await db.query(`UPDATE restock_intents SET status = 'fulfilled', fulfilled_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND id = $2 AND status <> 'cancelled' RETURNING *`, [tenantId, intentId]);
  return r.rows[0] || null;
};

// Mark an intent as having had an internal recovery follow-up created. This is NOT customer_notified.
export const markIntentRecoveryCreated = async (tenantId, intentId, restockEventId) => {
  await ensureRestockIntentSchema();
  await db.query(
    `UPDATE restock_intents SET status = CASE WHEN status = 'waiting' THEN 'recovery_created' ELSE status END,
       last_restock_event_id = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, intentId, restockEventId || null]
  );
};

export const getIntent = async (tenantId, id) => {
  await ensureRestockIntentSchema();
  const r = await db.query(`SELECT * FROM restock_intents WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return r.rows[0] || null;
};

// Set customer_notified_at ONLY after a confirmed successful send (Phase 8). Never on draft/approval.
export const markIntentNotified = async (tenantId, id, { channel = null } = {}) => {
  await ensureRestockIntentSchema();
  const r = await db.query(
    `UPDATE restock_intents SET status = 'customer_notified', customer_notified_at = NOW(),
       metadata = jsonb_set(COALESCE(metadata,'{}'::jsonb), '{notified_channel}', to_jsonb($3::text)), updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 AND customer_notified_at IS NULL RETURNING *`,
    [tenantId, id, channel || ""]
  );
  return r.rows[0] || null;
};

export const listIntents = async (tenantId, { status = null, limit = 100, phone = null, customerId = null } = {}) => {
  await ensureRestockIntentSchema();
  const params = [tenantId];
  let where = `ri.tenant_id = $1`;
  if (status && status !== "all") { params.push(status); where += ` AND ri.status = $${params.length}`; }
  if (phone) { params.push(normalizePhone(String(phone))); where += ` AND COALESCE(ri.phone,'') = $${params.length}`; }
  if (customerId) { params.push(customerId); where += ` AND ri.customer_id = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 300));
  const r = await db.query(
    `SELECT ri.*, c.name AS customer_name, p.name AS product_name,
            COALESCE(NULLIF(TRIM(COALESCE(v.image_url, v.image, '')), ''), NULLIF(TRIM(COALESCE(p.image_url, p.image, '')), '')) AS image_url
       FROM restock_intents ri
       LEFT JOIN customers c ON c.id = ri.customer_id AND c.tenant_id = ri.tenant_id
       LEFT JOIN products p ON p.id = ri.product_id AND p.tenant_id = ri.tenant_id
       LEFT JOIN product_variants v ON v.id = ri.variant_id
      WHERE ${where} ORDER BY ri.created_at DESC LIMIT $${params.length}`,
    params
  );
  return r.rows;
};

// Hard delete is for rows that are already over (cancelled / fulfilled / expired /
// notified). A waiting intent is cancelled instead so the audit trail keeps it.
export const deleteIntent = async (tenantId, intentId) => {
  await ensureRestockIntentSchema();
  const cur = await getIntent(tenantId, intentId);
  if (!cur) { const e = new Error("Restock intent not found"); e.status = 404; throw e; }
  if (["waiting", "recovery_created"].includes(cur.status)) { const e = new Error("Cancel the request before deleting it."); e.status = 409; throw e; }
  await db.query(`DELETE FROM restock_intents WHERE tenant_id = $1 AND id = $2`, [tenantId, intentId]);
  return cur;
};

// Waiting intents for a restock: EXACT_VARIANT first, then PRODUCT_ONLY (variant_id null). Bounded.
export const findWaitingIntents = async ({ tenantId, productId, variantId = null, limit } = {}) => {
  await ensureRestockIntentSchema();
  if (!tenantId || !productId) return [];
  const cap = Math.min(Math.max(1, Number(limit) || INTENT_DEFAULT_LIMIT), INTENT_MAX_LIMIT);
  const r = await db.query(
    `SELECT ri.*, c.name AS customer_name,
            CASE WHEN $3::bigint IS NOT NULL AND ri.variant_id = $3 THEN 'EXACT_VARIANT'
                 WHEN ri.variant_id IS NULL THEN 'PRODUCT_ONLY'
                 ELSE 'OTHER_VARIANT' END AS match_quality
       FROM restock_intents ri
       LEFT JOIN customers c ON c.id = ri.customer_id AND c.tenant_id = ri.tenant_id
      WHERE ri.tenant_id = $1 AND ri.product_id = $2 AND ri.status = 'waiting'
        AND ( ($3::bigint IS NOT NULL AND ri.variant_id = $3) OR ri.variant_id IS NULL )
      ORDER BY (($3::bigint IS NOT NULL AND ri.variant_id = $3)) DESC, ri.created_at ASC
      LIMIT $4`,
    [tenantId, productId, variantId || null, cap]
  );
  return r.rows;
};

export const getIntentCounts = async (tenantId) => {
  await ensureRestockIntentSchema();
  const r = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
       COUNT(*) FILTER (WHERE status = 'waiting' AND variant_id IS NOT NULL)::int AS waiting_exact_variant,
       COUNT(*) FILTER (WHERE status = 'recovery_created')::int AS recovery_created,
       COUNT(*) FILTER (WHERE status = 'customer_notified')::int AS customer_notified,
       COUNT(*) FILTER (WHERE status = 'fulfilled')::int AS fulfilled,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
     FROM restock_intents WHERE tenant_id = $1`,
    [tenantId]
  );
  return r.rows[0] || { waiting: 0, waiting_exact_variant: 0, recovery_created: 0, customer_notified: 0, fulfilled: 0, cancelled: 0 };
};
