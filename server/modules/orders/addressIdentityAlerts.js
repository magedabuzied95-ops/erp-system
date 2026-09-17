/*
 * "Same address, another name and phone" alerts on online orders.
 *
 * How an order gets checked, whichever of the many write paths created or edited it (checkout,
 * AI Inbox, Messenger flows, the order edit form):
 *   1. a trigger on orders clears identity_checked_at whenever the address, name or phone
 *      changes (and on INSERT, where the column simply starts NULL);
 *   2. a sweeper picks up online orders with identity_checked_at IS NULL, stores the address
 *      fingerprint, compares it with earlier orders in the same governorate and writes one
 *      order_identity_alerts row per match.
 * The very first sweep is therefore the backfill of the whole history. It never notifies for old
 * orders — only an order created in the last two days raises a manager notification.
 *
 * Severity is NOT stored: a matched order that is refused tomorrow turns today's yellow alert red,
 * so it is read from the matched order's live status every time.
 */
import db from "../../database/db.js";
import { getTenantId, isSuperAdminUser } from "../../utils/requestScope.js";
import { createNotification } from "../../services/notificationsService.js";
import {
  alertSeverity,
  buildAddressFingerprint,
  compareAddressTokens,
  isDifferentIdentity,
} from "./addressIdentity.js";

const SWEEP_BATCH = 200;
const SWEEP_BUDGET_MS = 20_000;
const CANDIDATE_LIMIT = 400;
const MAX_ALERTS_PER_ORDER = 20;
const NOTIFY_WINDOW_HOURS = 48;
const SWEEP_LOCK_KEY = 74_119_031;

// The channels that are not a delivery to an address: the till, and Amazon (Seller Central ships it).
const OFFLINE_CHANNELS_SQL = `('pos', 'amazon')`;

// Everything the fingerprint and the identity check read. The sweeper refuses to store a
// result if any of these changed between its read and its write.
const INPUT_HASH_SQL = (alias = "") => {
  const p = alias ? `${alias}.` : "";
  return `md5(concat_ws('|', ${p}customer_address, ${p}street_address, ${p}building_number, ${p}floor_number, ${p}apartment_number, ${p}governorate, ${p}governorate_id, ${p}customer_name, ${p}customer_phone, ${p}customer_secondary_phone, ${p}customer_id::text))`;
};

export const isOrderIdentityAlertsEnabled = () =>
  !["1", "true", "yes", "on"].includes(String(process.env.ORDER_IDENTITY_ALERTS_DISABLED || "").trim().toLowerCase());

/*
 * Boot-time DDL. Everything here is metadata-only on orders (nullable columns, no default, a
 * trigger that does no I/O) plus a brand-new table. The three indexes on orders are built
 * CONCURRENTLY by the first sweep instead, so the boot never waits on a hot table.
 */
export const ensureOrderIdentityAlertsSchema = async (pool = db) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS customer_secondary_phone VARCHAR(40) NULL,
        ADD COLUMN IF NOT EXISTS identity_checked_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS address_region VARCHAR(80) NULL,
        ADD COLUMN IF NOT EXISTS address_key TEXT NULL,
        ADD COLUMN IF NOT EXISTS address_tokens TEXT[] NULL
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_identity_alerts (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL,
        order_id BIGINT NOT NULL,
        matched_order_id BIGINT NOT NULL,
        match_kind VARCHAR(20) NOT NULL,
        score NUMERIC(4, 2) NOT NULL DEFAULT 1,
        status VARCHAR(30) NOT NULL DEFAULT 'open',
        reviewed_by BIGINT NULL,
        reviewed_by_name VARCHAR(255) NULL,
        reviewed_at TIMESTAMPTZ NULL,
        notified_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT order_identity_alerts_pair_unique UNIQUE (order_id, matched_order_id),
        CONSTRAINT order_identity_alerts_status_check CHECK (status IN ('open', 'same_person', 'different_person')),
        CONSTRAINT order_identity_alerts_kind_check CHECK (match_kind IN ('exact', 'similar'))
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_order_identity_alerts_matched ON order_identity_alerts (matched_order_id)`);
    await client.query(`
      CREATE OR REPLACE FUNCTION orders_identity_recheck() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          NEW.identity_checked_at := NULL;
        ELSIF NEW.customer_address IS DISTINCT FROM OLD.customer_address
           OR NEW.street_address IS DISTINCT FROM OLD.street_address
           OR NEW.building_number IS DISTINCT FROM OLD.building_number
           OR NEW.floor_number IS DISTINCT FROM OLD.floor_number
           OR NEW.apartment_number IS DISTINCT FROM OLD.apartment_number
           OR NEW.governorate IS DISTINCT FROM OLD.governorate
           OR NEW.governorate_id IS DISTINCT FROM OLD.governorate_id
           OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
           OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
           OR NEW.customer_secondary_phone IS DISTINCT FROM OLD.customer_secondary_phone
           OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
           OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
          NEW.identity_checked_at := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    const existing = await client.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_orders_identity_recheck' AND tgrelid = 'orders'::regclass`
    );
    if (!existing.rowCount) {
      await client.query(`
        CREATE TRIGGER trg_orders_identity_recheck
        BEFORE INSERT OR UPDATE ON orders
        FOR EACH ROW EXECUTE FUNCTION orders_identity_recheck()
      `);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

let indexesReady = false;
const ensureOrderIdentityIndexes = async () => {
  if (indexesReady) return;
  // CONCURRENTLY cannot run inside a transaction, and a failed concurrent build leaves an INVALID
  // index behind that IF NOT EXISTS would then skip forever — so an invalid one is dropped first.
  const statements = [
    ["idx_orders_identity_pending", `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_identity_pending ON orders (id) WHERE identity_checked_at IS NULL AND COALESCE(LOWER(channel), '') NOT IN ${OFFLINE_CHANNELS_SQL}`],
    ["idx_orders_address_key", `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_address_key ON orders (address_key) WHERE address_key IS NOT NULL`],
    ["idx_orders_address_tokens", `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_address_tokens ON orders USING GIN (address_tokens) WHERE address_tokens IS NOT NULL`],
  ];
  for (const [name, sql] of statements) {
    const invalid = await db.query(
      `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1 AND NOT i.indisvalid`,
      [name]
    );
    if (invalid.rowCount) await db.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
    await db.query(sql);
  }
  indexesReady = true;
};

const ORDER_IDENTITY_COLUMNS = `
  o.id, o.tenant_id, o.branch_id, o.created_at, o.invoice_number, o.customer_id, o.customer_name,
  o.customer_phone, o.customer_secondary_phone, o.customer_address, o.street_address,
  o.building_number, o.floor_number, o.apartment_number, o.governorate, o.governorate_id,
  o.status, o.shipping_status, o.shipment_status, o.deleted_at
`;

const findCandidates = async (client, order, fingerprint) => {
  const params = [order.id, order.tenant_id ?? null, fingerprint.region || "", fingerprint.key, fingerprint.numbers, fingerprint.words, CANDIDATE_LIMIT];
  const result = await client.query(
    `
    SELECT ${ORDER_IDENTITY_COLUMNS}, o.address_tokens
    FROM orders o
    WHERE o.id < $1
      AND o.tenant_id IS NOT DISTINCT FROM $2::bigint
      AND COALESCE(o.address_region, '') = $3
      AND o.address_tokens IS NOT NULL
      AND o.deleted_at IS NULL
      AND (
        o.address_key = $4
        OR (cardinality($5::text[]) > 0 AND o.address_tokens && $5::text[] AND o.address_tokens && $6::text[])
      )
    ORDER BY o.id DESC
    LIMIT $7
    `,
    params
  );
  return result.rows;
};

/**
 * Checks one order against EARLIER orders only, so a pair is stored once, on the order that
 * repeated the address. Rewrites its open alerts and returns the ones that are new.
 */
export const checkOrderIdentity = async (client, order) => {
  const fingerprint = buildAddressFingerprint(order);
  const matches = [];
  if (fingerprint.tokens && !order.deleted_at) {
    const candidates = await findCandidates(client, order, fingerprint);
    for (const candidate of candidates) {
      if (!isDifferentIdentity(order, candidate)) continue;
      const match = compareAddressTokens(fingerprint.tokens, candidate.address_tokens);
      if (!match) continue;
      matches.push({ candidate, ...match });
    }
  }
  // The refused ones first, so the cap never drops the match that matters.
  matches.sort((a, b) => {
    const red = (row) => (alertSeverity(row.candidate) === "red" ? 0 : 1);
    return red(a) - red(b) || (a.kind === "exact" ? 0 : 1) - (b.kind === "exact" ? 0 : 1) || Number(b.candidate.id) - Number(a.candidate.id);
  });
  const kept = matches.slice(0, MAX_ALERTS_PER_ORDER);

  const stored = await client.query(
    `
    UPDATE orders
    SET identity_checked_at = NOW(), address_region = $2, address_key = $3, address_tokens = $4::text[]
    WHERE id = $1 AND identity_checked_at IS NULL AND ${INPUT_HASH_SQL()} = $5
    RETURNING id
    `,
    [order.id, fingerprint.region || null, fingerprint.key, fingerprint.tokens, order.input_hash]
  );
  // Edited while we were looking: the trigger already queued it again.
  if (!stored.rowCount) return { skipped: true, created: [] };

  // Later orders that were matched against this one's old address get looked at again.
  await client.query(
    `UPDATE orders SET identity_checked_at = NULL
     WHERE id IN (SELECT order_id FROM order_identity_alerts WHERE matched_order_id = $1 AND status = 'open')`,
    [order.id]
  );
  const keptIds = kept.map((match) => match.candidate.id);
  // A reviewed alert is a person's decision and stays; an open one that no longer matches goes.
  await client.query(
    `DELETE FROM order_identity_alerts WHERE order_id = $1 AND status = 'open' AND NOT (matched_order_id = ANY($2::bigint[]))`,
    [order.id, keptIds]
  );
  const created = [];
  for (const match of kept) {
    const result = await client.query(
      `
      INSERT INTO order_identity_alerts (tenant_id, order_id, matched_order_id, match_kind, score)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (order_id, matched_order_id)
      DO UPDATE SET match_kind = EXCLUDED.match_kind, score = EXCLUDED.score, updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted
      `,
      [order.tenant_id ?? null, order.id, match.candidate.id, match.kind, match.score]
    );
    if (result.rows[0]?.inserted) created.push({ ...match, alertId: result.rows[0].id });
  }
  return { skipped: false, created };
};

const notifyRedAlert = async (order, created) => {
  const red = created.filter((match) => alertSeverity(match.candidate) === "red");
  if (!red.length) return;
  const createdAt = new Date(order.created_at).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > NOTIFY_WINDOW_HOURS * 3600 * 1000) return;
  const first = red[0].candidate;
  await createNotification({
    tenant_id: order.tenant_id || null,
    role_key: "manager",
    branch_id: order.branch_id || null,
    type: "order_identity_alert",
    category: "orders",
    priority: "high",
    title: "أوردر على عنوان اترفض قبل كده باسم ورقم تانيين",
    message: `${order.invoice_number || `#${order.id}`} — ${order.customer_name || "عميل"}: نفس العنوان اتطلب قبل كده باسم ${first.customer_name || "—"} (${first.invoice_number || `#${first.id}`})`,
    action_url: `/orders/${order.id}`,
    action_label: "افتح الطلب",
    entity_type: "order",
    entity_id: `${order.id}:identity`,
    metadata: { order_id: order.id, matched_order_ids: red.map((match) => match.candidate.id) },
  });
  await db.query(
    `UPDATE order_identity_alerts SET notified_at = NOW() WHERE id = ANY($1::bigint[])`,
    [red.map((match) => match.alertId)]
  );
};

let sweepRunning = false;

/** One pass. Safe to call from several processes: an advisory lock lets only one of them work. */
export const runOrderIdentitySweep = async ({ budgetMs = SWEEP_BUDGET_MS, batch = SWEEP_BATCH } = {}) => {
  if (!isOrderIdentityAlertsEnabled() || sweepRunning) return { skipped: true };
  sweepRunning = true;
  const startedAt = Date.now();
  const client = await db.connect();
  let processed = 0;
  let alerts = 0;
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [SWEEP_LOCK_KEY]);
    locked = Boolean(lock.rows[0]?.ok);
    if (!locked) return { skipped: true, reason: "locked" };
    await ensureOrderIdentityIndexes();
    while (Date.now() - startedAt < budgetMs) {
      const pending = await client.query(
        `
        SELECT ${ORDER_IDENTITY_COLUMNS}, ${INPUT_HASH_SQL("o")} AS input_hash
        FROM orders o
        WHERE o.identity_checked_at IS NULL
          AND COALESCE(LOWER(o.channel), '') NOT IN ${OFFLINE_CHANNELS_SQL}
        ORDER BY o.id
        LIMIT $1
        `,
        [batch]
      );
      if (!pending.rowCount) break;
      for (const order of pending.rows) {
        try {
          await client.query("BEGIN");
          const result = await checkOrderIdentity(client, order);
          await client.query("COMMIT");
          processed += 1;
          alerts += result.created.length;
          if (result.created.length) {
            await notifyRedAlert(order, result.created).catch((error) =>
              console.warn("[order-identity] notification skipped", { orderId: order.id, message: error?.message || String(error) })
            );
          }
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          // Park it, or one bad row would be picked first on every pass forever.
          await client.query(`UPDATE orders SET identity_checked_at = NOW() WHERE id = $1`, [order.id]).catch(() => {});
          console.warn("[order-identity] order check failed", { orderId: order.id, message: error?.message || String(error) });
        }
      }
      if (pending.rowCount < batch) break;
    }
    return { processed, alerts, ms: Date.now() - startedAt };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [SWEEP_LOCK_KEY]).catch(() => {});
    client.release();
    sweepRunning = false;
  }
};

export const startOrderIdentitySweeper = ({ intervalMs = 60_000 } = {}) => {
  if (!isOrderIdentityAlertsEnabled()) return null;
  const tick = () => {
    void runOrderIdentitySweep()
      .then((result) => {
        if (result?.processed) console.log("[order-identity] sweep", result);
      })
      .catch((error) => console.error("[order-identity] sweep error", { message: error?.message || String(error) }));
  };
  setTimeout(tick, 15_000).unref?.();
  return setInterval(tick, Math.max(30_000, intervalMs));
};

/* ------------------------------------------------------------------ reads */

const toAlertView = (row, orderId) => {
  const incoming = String(row.order_id) !== String(orderId);
  return {
    id: row.id,
    direction: incoming ? "later_order" : "earlier_order",
    match_kind: row.match_kind,
    score: Number(row.score),
    status: row.status,
    severity: alertSeverity({ status: row.other_status, shipping_status: row.other_shipping_status, shipment_status: row.other_shipment_status }),
    reviewed_by_name: row.reviewed_by_name || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    other_order: {
      id: row.other_id,
      invoice_number: row.other_invoice_number,
      customer_name: row.other_customer_name,
      customer_phone: row.other_customer_phone,
      customer_address: row.other_customer_address,
      governorate: row.other_governorate,
      city_area: row.other_city_area,
      status: row.other_status,
      shipping_status: row.other_shipping_status,
      created_at: row.other_created_at,
    },
  };
};

/**
 * Every alert that involves the order, in both directions: the order that repeats an earlier
 * address shows the earlier one, and the earlier one shows who came back to it.
 */
export const getOrderIdentityAlerts = async ({ orderId, tenantId = null }) => {
  const result = await db.query(
    `
    SELECT a.*,
      other.id AS other_id, other.invoice_number AS other_invoice_number,
      other.customer_name AS other_customer_name, other.customer_phone AS other_customer_phone,
      COALESCE(NULLIF(other.customer_address, ''), other.shipping_address_line) AS other_customer_address,
      other.governorate AS other_governorate, other.city_area AS other_city_area,
      other.status AS other_status, other.shipping_status AS other_shipping_status,
      other.shipment_status AS other_shipment_status, other.created_at AS other_created_at
    FROM order_identity_alerts a
    JOIN orders other ON other.id = CASE WHEN a.order_id = $1 THEN a.matched_order_id ELSE a.order_id END
    WHERE (a.order_id = $1 OR a.matched_order_id = $1)
      AND ($2::bigint IS NULL OR a.tenant_id IS NOT DISTINCT FROM $2::bigint)
      AND other.deleted_at IS NULL
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 50
    `,
    [orderId, tenantId]
  );
  const alerts = result.rows
    .map((row) => toAlertView(row, orderId))
    .sort((a, b) => (a.severity === "red" ? 0 : 1) - (b.severity === "red" ? 0 : 1));
  const own = alerts.filter((alert) => alert.direction === "earlier_order");
  const open = own.filter((alert) => alert.status !== "different_person");
  return {
    order_id: Number(orderId),
    level: open.some((alert) => alert.severity === "red") ? "red" : open.length ? "yellow" : null,
    review_status: own.length && own.every((alert) => alert.status !== "open") ? own[0].status : own.length ? "open" : null,
    alerts,
  };
};

/** One level per order, for the badges on the orders list. Only the order that repeats. */
export const getOrderIdentityAlertLevels = async ({ orderIds = [], tenantId = null }) => {
  const ids = [...new Set(orderIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500);
  if (!ids.length) return {};
  const result = await db.query(
    `
    SELECT a.order_id, a.status,
      other.status AS other_status, other.shipping_status AS other_shipping_status, other.shipment_status AS other_shipment_status
    FROM order_identity_alerts a
    JOIN orders other ON other.id = a.matched_order_id AND other.deleted_at IS NULL
    WHERE a.order_id = ANY($1::bigint[])
      AND a.status <> 'different_person'
      AND ($2::bigint IS NULL OR a.tenant_id IS NOT DISTINCT FROM $2::bigint)
    `,
    [ids, tenantId]
  );
  const levels = {};
  for (const row of result.rows) {
    const severity = alertSeverity({ status: row.other_status, shipping_status: row.other_shipping_status, shipment_status: row.other_shipment_status });
    const current = levels[row.order_id];
    const next = {
      level: current?.level === "red" || severity === "red" ? "red" : "yellow",
      count: (current?.count || 0) + 1,
      confirmed: Boolean(current?.confirmed) || row.status === "same_person",
    };
    levels[row.order_id] = next;
  }
  return levels;
};

export const REVIEW_DECISIONS = new Set(["same_person", "different_person", "open"]);

/** A person's decision on every alert the order raised (not on alerts about later orders). */
export const reviewOrderIdentityAlerts = async ({ orderId, tenantId = null, decision, user = {} }) => {
  if (!REVIEW_DECISIONS.has(decision)) {
    const error = new Error("decision must be same_person, different_person or open");
    error.statusCode = 400;
    throw error;
  }
  const reviewer = decision === "open" ? null : user;
  const result = await db.query(
    `
    UPDATE order_identity_alerts
    SET status = $3::varchar, reviewed_by = $4, reviewed_by_name = $5,
        reviewed_at = CASE WHEN $3::varchar = 'open' THEN NULL ELSE NOW() END, updated_at = NOW()
    WHERE order_id = $1 AND ($2::bigint IS NULL OR tenant_id IS NOT DISTINCT FROM $2::bigint)
    RETURNING id
    `,
    [
      orderId,
      tenantId,
      decision,
      reviewer?.id || null,
      reviewer ? String(reviewer.name || reviewer.full_name || reviewer.username || reviewer.email || "").slice(0, 255) || null : null,
    ]
  );
  return { updated: result.rowCount };
};

/* ------------------------------------------------------------------ http */

const requestTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id ?? req.user?.tenantId ?? null));
const parseOrderId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const getOrderIdentityAlertsController = async (req, res) => {
  const orderId = parseOrderId(req.params.id);
  if (!orderId) return res.status(400).json({ success: false, message: "invalid order id" });
  try {
    const data = await getOrderIdentityAlerts({ orderId, tenantId: requestTenantId(req) });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("[order-identity] read failed", { orderId, message: error?.message || String(error) });
    // The page must open even while the table is missing (feature switched off, boot DDL skipped).
    return res.json({ success: true, order_id: orderId, level: null, review_status: null, alerts: [], unavailable: true });
  }
};

export const getOrderIdentityAlertLevelsController = async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((value) => value.trim()).filter(Boolean);
  try {
    const levels = await getOrderIdentityAlertLevels({ orderIds: ids, tenantId: requestTenantId(req) });
    return res.json({ success: true, levels });
  } catch (error) {
    console.error("[order-identity] levels failed", { message: error?.message || String(error) });
    return res.json({ success: true, levels: {}, unavailable: true });
  }
};

export const reviewOrderIdentityAlertsController = async (req, res) => {
  const orderId = parseOrderId(req.params.id);
  if (!orderId) return res.status(400).json({ success: false, message: "invalid order id" });
  try {
    const tenantId = requestTenantId(req);
    const decision = String(req.body?.decision || "").trim();
    const result = await reviewOrderIdentityAlerts({ orderId, tenantId, decision, user: req.user || {} });
    const data = await getOrderIdentityAlerts({ orderId, tenantId });
    return res.json({ success: true, ...result, ...data });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || "review failed" });
  }
};
