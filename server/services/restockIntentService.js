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
    // Criteria intents: "any men's mirror sneakers in 45" — no product yet. product_id
    // stays NULL until a restock event binds the row to the real variant, after which
    // it is an ordinary exact-variant intent for everything downstream.
    await client.query(`ALTER TABLE restock_intents ALTER COLUMN product_id DROP NOT NULL`);
    await client.query(`ALTER TABLE restock_intents ADD COLUMN IF NOT EXISTS criteria JSONB NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_intents_active_criteria
      ON restock_intents (tenant_id, COALESCE(phone, ''), md5(criteria::text))
      WHERE criteria IS NOT NULL AND product_id IS NULL AND status IN ('waiting','recovery_created','customer_notified')`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restock_intents_criteria ON restock_intents (tenant_id, status) WHERE criteria IS NOT NULL AND product_id IS NULL`);
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

// ---------------------------------------------------------------------------
// Criteria intents — a request by attributes instead of by product.
// ---------------------------------------------------------------------------
export const CRITERIA_ATTRIBUTE_KEYS = Object.freeze(["gender", "product_type", "grade", "brand"]);
const lowerTrim = (value = "") => String(value ?? "").trim().toLowerCase();

// Normalised, key-sorted, so the same request always hashes the same (dedup index).
export const normalizeCriteria = (input = {}) => {
  const out = {};
  for (const key of CRITERIA_ATTRIBUTE_KEYS) { const v = lowerTrim(input?.[key]); if (v && v !== "all") out[key] = v; }
  const size = String(input?.size ?? "").trim();
  if (!size) throw err("criteria.size is required");
  if (!Object.keys(out).length) throw err("at least one of gender / product_type / grade / brand is required");
  out.size = size;
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
};

// SQL fragment + params matching products/variants against a criteria object.
// Attribute matches are case-insensitive equality on the product columns; size is
// compared on the variant. `p` is the products alias, `v` the variant alias.
const criteriaWhere = (criteria, params, { p = "p", v = "v" } = {}) => {
  const parts = [];
  for (const key of CRITERIA_ATTRIBUTE_KEYS) {
    if (!criteria[key]) continue;
    params.push(criteria[key]);
    parts.push(`LOWER(TRIM(COALESCE(${p}.${key}, ''))) = $${params.length}`);
  }
  params.push(lowerTrim(criteria.size));
  parts.push(`LOWER(TRIM(COALESCE(${v}.size, ''))) = $${params.length}`);
  return parts.join(" AND ");
};

// What is sellable RIGHT NOW for these criteria (so the cashier can sell instead of waiting).
export const findCriteriaMatchesInStock = async ({ tenantId, criteria, limit = 5 } = {}) => {
  const params = [tenantId];
  const where = criteriaWhere(criteria, params);
  params.push(Math.min(Math.max(1, Number(limit) || 5), 20));
  const r = await db.query(
    `SELECT p.id AS product_id, p.name AS product_name, v.id AS variant_id, v.color, v.size, v.stock
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.tenant_id = $1 AND v.deleted_at IS NULL AND v.is_active IS DISTINCT FROM FALSE
        AND COALESCE(v.stock, 0) > 0 AND ${where}
      ORDER BY v.stock DESC, p.id ASC LIMIT $${params.length}`,
    params
  );
  return r.rows;
};

export const createCriteriaIntent = async ({ tenantId, customerId = null, phone = null, criteria: rawCriteria = {}, source = "admin", sourceReference = null } = {}) => {
  await ensureRestockIntentSchema();
  if (!tenantId) throw err("tenantId is required");
  if (!INTENT_SOURCES.includes(source)) source = "admin";
  const normPhone = phone ? normalizePhone(String(phone)) : null;
  if (!normPhone && !customerId) throw err("a phone or customer identity is required");
  const criteria = normalizeCriteria(rawCriteria);

  // Same rule as a variant intent: if something matching is on the shelf, sell it —
  // the request is for what is NOT here.
  const inStock = await findCriteriaMatchesInStock({ tenantId, criteria, limit: 5 });
  if (inStock.length) return { available_now: true, intent: null, matches: inStock };

  const findActive = () => db.query(
    `SELECT * FROM restock_intents WHERE tenant_id = $1 AND COALESCE(phone,'') = $2 AND product_id IS NULL AND criteria IS NOT NULL
        AND md5(criteria::text) = md5($3::jsonb::text) AND status IN ('waiting','recovery_created','customer_notified') LIMIT 1`,
    [tenantId, normPhone || "", JSON.stringify(criteria)]
  );
  const existing = await findActive();
  if (existing.rows[0]) return { reused: true, intent: existing.rows[0] };
  try {
    const ins = await db.query(
      `INSERT INTO restock_intents (tenant_id, customer_id, phone, product_id, variant_id, size, color, criteria, status, source, source_reference)
       VALUES ($1,$2,$3,NULL,NULL,$4,NULL,$5::jsonb,'waiting',$6,$7) RETURNING *`,
      [tenantId, customerId || null, normPhone, criteria.size, JSON.stringify(criteria), source, sourceReference]
    );
    return { created: true, intent: ins.rows[0] };
  } catch (e) {
    if (String(e?.code) === "23505") {
      const again = await findActive();
      if (again.rows[0]) return { reused: true, intent: again.rows[0] };
    }
    throw e;
  }
};

// Waiting criteria intents that the restocked variant satisfies.
export const findWaitingCriteriaIntents = async ({ tenantId, productId, variantId, limit } = {}) => {
  await ensureRestockIntentSchema();
  if (!tenantId || !productId || !variantId) return [];
  const cap = Math.min(Math.max(1, Number(limit) || INTENT_DEFAULT_LIMIT), INTENT_MAX_LIMIT);
  const r = await db.query(
    `SELECT ri.*, c.name AS customer_name
       FROM restock_intents ri
       JOIN products p ON p.id = $2 AND p.tenant_id = ri.tenant_id
       JOIN product_variants v ON v.id = $3 AND v.product_id = p.id
       LEFT JOIN customers c ON c.id = ri.customer_id AND c.tenant_id = ri.tenant_id
      WHERE ri.tenant_id = $1 AND ri.status = 'waiting' AND ri.product_id IS NULL AND ri.criteria IS NOT NULL
        AND (ri.criteria->>'gender' IS NULL OR LOWER(TRIM(COALESCE(p.gender,''))) = ri.criteria->>'gender')
        AND (ri.criteria->>'product_type' IS NULL OR LOWER(TRIM(COALESCE(p.product_type,''))) = ri.criteria->>'product_type')
        AND (ri.criteria->>'grade' IS NULL OR LOWER(TRIM(COALESCE(p.grade,''))) = ri.criteria->>'grade')
        AND (ri.criteria->>'brand' IS NULL OR LOWER(TRIM(COALESCE(p.brand,''))) = ri.criteria->>'brand')
        AND LOWER(TRIM(COALESCE(v.size,''))) = LOWER(TRIM(COALESCE(ri.criteria->>'size','')))
      ORDER BY ri.created_at ASC LIMIT $4`,
    [tenantId, productId, variantId, cap]
  );
  return r.rows;
};

// Turn a matched criteria intent into an exact-variant intent. Returns the bound row,
// or null when the customer already holds an active intent on that very variant (the
// criteria row is then cancelled as a duplicate rather than messaging them twice).
export const bindCriteriaIntentToVariant = async (tenantId, intentId, { productId, variantId, size = null, color = null, restockEventId = null } = {}) => {
  await ensureRestockIntentSchema();
  try {
    const r = await db.query(
      `UPDATE restock_intents
          SET product_id = $3, variant_id = $4, size = COALESCE($5, size), color = $6,
              metadata = metadata || jsonb_build_object('criteria_bound_at', NOW(), 'criteria_bound_event', $7::text),
              updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2 AND product_id IS NULL AND status = 'waiting' RETURNING *`,
      [tenantId, intentId, productId, variantId, size, color, restockEventId]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (String(e?.code) === "23505") {
      await db.query(
        `UPDATE restock_intents SET status = 'cancelled', cancelled_at = NOW(), metadata = metadata || '{"cancel_reason":"duplicate_of_variant_intent"}'::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, intentId]
      );
      return null;
    }
    throw e;
  }
};

// Vocabulary for the criteria form: the attribute values products actually carry,
// plus every size any variant was ever cut in.
export const getCriteriaOptions = async (tenantId) => {
  const [attrs, sizes] = await Promise.all([
    db.query(
      `SELECT 'gender' AS key, LOWER(TRIM(gender)) AS value, COUNT(*)::int AS count FROM products WHERE tenant_id = $1 AND COALESCE(TRIM(gender),'') <> '' GROUP BY 2
       UNION ALL SELECT 'product_type', LOWER(TRIM(product_type)), COUNT(*)::int FROM products WHERE tenant_id = $1 AND COALESCE(TRIM(product_type),'') <> '' GROUP BY 2
       UNION ALL SELECT 'grade', LOWER(TRIM(grade)), COUNT(*)::int FROM products WHERE tenant_id = $1 AND COALESCE(TRIM(grade),'') <> '' GROUP BY 2
       UNION ALL SELECT 'brand', LOWER(TRIM(brand)), COUNT(*)::int FROM products WHERE tenant_id = $1 AND COALESCE(TRIM(brand),'') <> '' GROUP BY 2`,
      [tenantId]
    ),
    db.query(
      `SELECT DISTINCT TRIM(v.size) AS size FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.tenant_id = $1 AND v.deleted_at IS NULL AND COALESCE(TRIM(v.size),'') <> ''`,
      [tenantId]
    ),
  ]);
  const out = { gender: [], product_type: [], grade: [], brand: [], sizes: [] };
  for (const row of attrs.rows) if (out[row.key]) out[row.key].push({ value: row.value, count: row.count });
  for (const key of CRITERIA_ATTRIBUTE_KEYS) out[key].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const numeric = (s) => { const n = parseFloat(String(s).replace(/[^\d.]/g, "")); return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY; };
  out.sizes = sizes.rows.map((r) => r.size).sort((a, b) => numeric(a) - numeric(b) || String(a).localeCompare(String(b)));
  return out;
};
