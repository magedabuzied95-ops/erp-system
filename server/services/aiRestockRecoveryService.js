// AI Studio Phase 6 — Restock Customer Recovery.
// ---------------------------------------------------------------------------
// When a variant crosses <=0 -> >0, find customers who asked to be notified for that PRODUCT
// (canonical source: customer_wishlist, product-level, notify_back_in_stock opt-in) and create ONE
// INTERNAL employee follow-up per eligible customer. NEVER messages the customer, never touches
// orders/stock/accounting. The write is a DELEGATABLE tool (grant-required) and is bounded +
// business-deduplicated via ai_restock_recoveries. Fan-out is bounded server-side (the executor is
// single-path), not a new node semantic.
//
// Data reality (audited): the wishlist stores product_id + phone (+ nullable customer_id) only — no
// variant/size/color and no status column — so matching is PRODUCT-granular and prioritization uses
// only the fields that actually exist. See docs/ai-restock-customer-recovery.md.

import db from "../database/db.js";
import { getInventoryFacts } from "./aiBusinessToolsService.js";
import { createStaffTask } from "./staffTasksService.js";

export const RECOVERY_DEFAULT_LIMIT = 25;
export const RECOVERY_MAX_LIMIT = 100;
// Suppress re-recovering the same customer+product if an employee task was created recently, even
// across separate restock events (anti-spam). A genuinely later restock after this window is allowed.
export const RECOVERY_COOLDOWN_DAYS = 14;

let schemaReady = null;
export const ensureRestockRecoverySchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_restock_recoveries (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        restock_event_id TEXT NOT NULL,
        request_id BIGINT NULL,            -- customer_wishlist.id
        customer_id BIGINT NULL,
        phone TEXT NULL,
        product_id BIGINT NULL,
        variant_id BIGINT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',  -- followup_created | skipped_duplicate | skipped_no_stock | skipped_inactive | failed
        followup_task_id BIGINT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        reason TEXT NULL,
        workflow_id BIGINT NULL,
        run_id BIGINT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Business-level dedup: at most one recovery row per (event, request). Replaying the same
    // restock event never creates a second follow-up for the same waiting request.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_restock_recoveries_event_req ON ai_restock_recoveries (tenant_id, restock_event_id, request_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_restock_recoveries_tenant ON ai_restock_recoveries (tenant_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_restock_recoveries_cooldown ON ai_restock_recoveries (tenant_id, product_id, phone, created_at DESC)`);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

// ---- Pure helpers (unit-tested; no DB) ----

export const boundLimit = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return RECOVERY_DEFAULT_LIMIT;
  return Math.min(Math.floor(v), RECOVERY_MAX_LIMIT);
};

export const maskPhone = (phone) => {
  const p = String(phone || "");
  if (p.length <= 4) return p ? "***" : "";
  return `${p.slice(0, 2)}****${p.slice(-3)}`;
};

// Deterministic, explainable priority from the ONLY fields the wishlist provides. No fake "AI score".
export const scoreCandidate = (candidate = {}, now = new Date()) => {
  let score = 0;
  const reasons = [];
  if (candidate.customerId) { score += 20; reasons.push("registered customer +20"); }
  const created = candidate.createdAt ? new Date(candidate.createdAt) : null;
  if (created && Number.isFinite(created.getTime())) {
    const ageDays = (now.getTime() - created.getTime()) / 86400000;
    if (ageDays <= 7) { score += 15; reasons.push("requested within 7d +15"); }
    else if (ageDays <= 30) { score += 5; reasons.push("requested within 30d +5"); }
  }
  if (candidate.notifyBackInStock) { score += 10; reasons.push("opted into back-in-stock +10"); }
  return { score, reason: reasons.join(", ") || "no priority signals" };
};

export const prioritize = (candidates = [], now = new Date()) =>
  candidates
    .map((c) => ({ ...c, ...scoreCandidate(c, now) }))
    .sort((a, b) => b.score - a.score || (new Date(a.createdAt || 0) - new Date(b.createdAt || 0)));

// Employee-facing internal task content — readable without opening AI Studio, no raw JSON / no ids.
export const formatRecoveryTask = ({ productName, size, color, availableQty, candidate, priority }) => {
  const item = [productName || "Product", color, size].filter(Boolean).join(" ");
  const who = candidate.customerName || (candidate.phone ? `Customer ${maskPhone(candidate.phone)}` : "A customer");
  const when = candidate.createdAt ? new Date(candidate.createdAt).toLocaleDateString() : "earlier";
  const title = `Restock follow-up — ${(productName || "product").slice(0, 80)}`;
  const note = [
    `${who} asked to be notified when "${item}" came back in stock.`,
    availableQty != null ? `It is back in stock (${availableQty} available).` : `It is back in stock.`,
    `Requested on ${when}.`,
    priority?.reason ? `Priority: ${priority.score} (${priority.reason}).` : "",
    `Suggested next action: contact the customer to confirm interest. (No message was sent automatically.)`,
  ].filter(Boolean).join("\n");
  return { title, note };
};

// ---- Canonical matching (customer_wishlist, product-level) ----
export const findWaitingCustomersForRestock = async ({ tenantId, productId, limit } = {}) => {
  await ensureRestockRecoverySchema();
  if (!tenantId || !productId) return { matchedCount: 0, returnedCount: 0, hasMore: false, candidates: [] };
  const cap = boundLimit(limit);
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS n FROM customer_wishlist WHERE tenant_id = $1 AND product_id = $2 AND COALESCE(notify_back_in_stock, TRUE) = TRUE`,
    [tenantId, productId]
  );
  const matchedCount = Number(countRes.rows[0]?.n || 0);
  const rows = await db.query(
    `SELECT w.id AS request_id, w.customer_id, w.phone, w.product_id, w.created_at,
            COALESCE(w.notify_back_in_stock, TRUE) AS notify_back_in_stock,
            c.name AS customer_name
       FROM customer_wishlist w
       LEFT JOIN customers c ON c.id = w.customer_id AND c.tenant_id = w.tenant_id
      WHERE w.tenant_id = $1 AND w.product_id = $2 AND COALESCE(w.notify_back_in_stock, TRUE) = TRUE
      ORDER BY w.created_at ASC
      LIMIT $3`,
    [tenantId, productId, cap]
  );
  const candidates = rows.rows.map((r) => ({
    requestId: Number(r.request_id),
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    phone: r.phone || null,
    customerName: r.customer_name || null,
    productId: Number(r.product_id),
    createdAt: r.created_at,
    notifyBackInStock: Boolean(r.notify_back_in_stock),
  }));
  return { matchedCount, returnedCount: candidates.length, hasMore: matchedCount > candidates.length, candidates };
};

// Re-check that a restocked variant/product actually has sellable stock right now.
const readSellableStock = async ({ tenantId, productId, variantId }) => {
  try {
    const facts = await getInventoryFacts({ tenantId, productId, variantId: variantId || null, query: "" });
    const rows = Array.isArray(facts?.variant_stock) ? facts.variant_stock : [];
    let match = null;
    if (variantId) match = rows.find((r) => String(r.variant_id) === String(variantId)) || null;
    const total = (variantId && match) ? Number(match.stock || 0) : rows.reduce((a, r) => a + Number(r.stock || 0), 0);
    const size = match?.size || null;
    const color = match?.color || null;
    const productName = facts?.product_name || facts?.name || null;
    return { available: total, size, color, productName, hasStock: total > 0 };
  } catch { return { available: null, size: null, color: null, productName: null, hasStock: true }; } // fail-open on read errors
};

// ---- Recovery orchestration (the DELEGATABLE WRITE) ----
// Bounded. Re-checks stock, dedups per (event, request) and per recent (product, phone), creates one
// INTERNAL follow-up per eligible candidate, and records an ai_restock_recoveries audit row each.
export const runRestockRecovery = async ({ tenantId, productId, variantId = null, restockEventId, actorUserId = null, workflowId = null, runId = null, limit } = {}) => {
  await ensureRestockRecoverySchema();
  if (!tenantId || !productId) return { ok: false, reason: "missing tenantId/productId", matched: 0, returned: 0, created: 0, skippedDuplicate: 0, skippedNoStock: 0, failed: 0 };
  const eventKey = String(restockEventId || `inv:${tenantId}:${productId}:${variantId}`);

  const stock = await readSellableStock({ tenantId, productId, variantId });
  const { candidates, matchedCount, returnedCount, hasMore } = await findWaitingCustomersForRestock({ tenantId, productId, limit });
  const ranked = prioritize(candidates);

  let created = 0, skippedDuplicate = 0, skippedNoStock = 0, failed = 0;
  const results = [];
  for (const cand of ranked) {
    const base = { tenant_id: tenantId, restock_event_id: eventKey, request_id: cand.requestId, customer_id: cand.customerId, phone: cand.phone, product_id: productId, variant_id: variantId, workflow_id: workflowId, run_id: runId, priority: cand.score, reason: cand.reason };
    // No sellable stock right now -> record + skip (do not create a follow-up for an empty shelf).
    if (!stock.hasStock) {
      await recordRecovery({ ...base, status: "skipped_no_stock", followup_task_id: null });
      skippedNoStock += 1; results.push({ requestId: cand.requestId, status: "skipped_no_stock" });
      continue;
    }
    // Business dedup #1: one recovery per (event, request).
    const reserved = await recordRecovery({ ...base, status: "candidate", followup_task_id: null });
    if (!reserved) { skippedDuplicate += 1; results.push({ requestId: cand.requestId, status: "skipped_duplicate" }); continue; }
    // Business dedup #2: same customer+product recovered recently (anti-spam across events).
    const recent = await hasRecentRecovery({ tenantId, productId, phone: cand.phone, excludeId: reserved.id });
    if (recent) {
      await updateRecovery(reserved.id, tenantId, { status: "skipped_duplicate" });
      skippedDuplicate += 1; results.push({ requestId: cand.requestId, status: "skipped_duplicate" });
      continue;
    }
    try {
      const { title, note } = formatRecoveryTask({ productName: stock.productName, size: stock.size, color: stock.color, availableQty: stock.available, candidate: cand, priority: { score: cand.score, reason: cand.reason } });
      const task = await createStaffTask(
        { tenantId, title, description: note, priority: cand.score >= 30 ? "high" : "medium", allow_unassigned: true, task_type: "general", source_module: "ai_restock_recovery" },
        { id: actorUserId || null }
      );
      const taskId = task?.id ?? task?.task?.id ?? null;
      await updateRecovery(reserved.id, tenantId, { status: "followup_created", followup_task_id: taskId });
      created += 1; results.push({ requestId: cand.requestId, status: "followup_created", taskId });
    } catch (e) {
      await updateRecovery(reserved.id, tenantId, { status: "failed", reason: String(e?.message || e).slice(0, 300) });
      failed += 1; results.push({ requestId: cand.requestId, status: "failed" });
    }
  }
  return { ok: true, matched: matchedCount, returned: returnedCount, hasMore, created, skippedDuplicate, skippedNoStock, failed, results };
};

// Insert a recovery row; returns the row on success, null on (event,request) conflict.
const recordRecovery = async (row) => {
  const r = await db.query(
    `INSERT INTO ai_restock_recoveries (tenant_id, restock_event_id, request_id, customer_id, phone, product_id, variant_id, status, followup_task_id, priority, reason, workflow_id, run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, restock_event_id, request_id) DO NOTHING RETURNING *`,
    [row.tenant_id, row.restock_event_id, row.request_id, row.customer_id, row.phone, row.product_id, row.variant_id, row.status || "candidate", row.followup_task_id || null, row.priority || 0, row.reason || null, row.workflow_id || null, row.run_id || null]
  );
  return r.rows[0] || null;
};

const updateRecovery = async (id, tenantId, patch) => {
  const cols = []; const vals = []; let i = 1;
  for (const [k, v] of Object.entries(patch)) { cols.push(`${k} = $${i++}`); vals.push(v); }
  vals.push(id, tenantId);
  await db.query(`UPDATE ai_restock_recoveries SET ${cols.join(", ")} WHERE id = $${i++} AND tenant_id = $${i}`, vals);
};

const hasRecentRecovery = async ({ tenantId, productId, phone, excludeId }) => {
  if (!phone) return false;
  const r = await db.query(
    `SELECT 1 FROM ai_restock_recoveries
      WHERE tenant_id = $1 AND product_id = $2 AND phone = $3 AND status = 'followup_created'
        AND id <> $4 AND created_at > NOW() - ($5 || ' days')::interval LIMIT 1`,
    [tenantId, productId, phone, excludeId || 0, String(RECOVERY_COOLDOWN_DAYS)]
  );
  return Boolean(r.rows[0]);
};

// ---- Read APIs for the Restock Recovery UI ----
export const listRecoveries = async (tenantId, { limit = 100 } = {}) => {
  await ensureRestockRecoverySchema();
  const r = await db.query(
    `SELECT r.*, c.name AS customer_name, p.name AS product_name
       FROM ai_restock_recoveries r
       LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
       LEFT JOIN products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [tenantId, Math.min(Number(limit) || 100, 300)]
  );
  return r.rows.map((row) => ({ ...row, phone: maskPhone(row.phone) }));
};

export const getRecoveryCounts = async (tenantId) => {
  await ensureRestockRecoverySchema();
  const r = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'followup_created')::int AS followups_created,
       COUNT(*) FILTER (WHERE status = 'skipped_duplicate')::int AS skipped_duplicate,
       COUNT(*) FILTER (WHERE status = 'skipped_no_stock')::int AS skipped_no_stock,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM ai_restock_recoveries WHERE tenant_id = $1`,
    [tenantId]
  );
  return r.rows[0] || { total: 0, followups_created: 0, skipped_duplicate: 0, skipped_no_stock: 0, failed: 0 };
};
