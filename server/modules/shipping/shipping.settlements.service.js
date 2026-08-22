// Courier COD money has two moments, not one. The courier hands the parcel over and
// takes the customer's cash: from then on the customer owes nothing, but the shop has
// not been paid either — the money sits with Bosta until its cash-out cycle lands in
// the bank. The webhook only ever told us about the first moment and never touched a
// money column, so every delivered COD order stayed "آجل" with the full amount due.
//
// Step one (collection) runs on the Delivered event: the order is marked as collected
// by the courier, the customer's balance closes, and the amount becomes a receivable
// from the courier. Step two (settlement) is a human act: the bank transfer arrives,
// the operator matches it against the collected parcels, the courier's fees are
// posted as an expense, and the net lands on the bank money account.
import db from "../../database/db.js";
import { postMoneyTransaction } from "../../services/accountingService.js";

const text = (value) => String(value ?? "").trim();
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

let schemaReady = null;
export const ensureCourierSettlementSchema = async () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_collected_at TIMESTAMPTZ`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_collected_amount NUMERIC(12,2)`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_settlement_id BIGINT`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS courier_settled_at TIMESTAMPTZ`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_orders_courier_collected_pending ON orders (shipping_provider, courier_collected_at) WHERE courier_collected_at IS NOT NULL AND courier_settlement_id IS NULL`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS courier_settlements (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          provider VARCHAR(40) NOT NULL DEFAULT 'bosta',
          reference VARCHAR(160) NULL,
          settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          gross_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          fees_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          net_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          orders_count INTEGER NOT NULL DEFAULT 0,
          money_account_id BIGINT NULL,
          money_transaction_id BIGINT NULL,
          fee_transaction_id BIGINT NULL,
          notes TEXT NULL,
          created_by BIGINT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS courier_settlement_items (
          id BIGSERIAL PRIMARY KEY,
          settlement_id BIGINT NOT NULL REFERENCES courier_settlements(id) ON DELETE CASCADE,
          order_id BIGINT NOT NULL,
          collected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          UNIQUE (settlement_id, order_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_courier_settlements_tenant_time ON courier_settlements (tenant_id, settled_at DESC)`);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

const orderTotal = (order = {}) => Number(order.total_amount ?? order.total ?? order.total_price ?? 0) || 0;

// How much the courier actually took at the door: what we told Bosta to collect,
// capped by what the customer still owed (a partial payment recorded after the
// parcel left must not be collected twice).
export const courierCollectibleAmount = (order = {}) => {
  const total = orderTotal(order);
  const paid = Number(order.paid_amount ?? 0) || 0;
  const owed = total > 0 ? Math.max(0, total - paid) : Math.max(0, Number(order.remaining_amount ?? 0) || 0);
  if (owed <= 0) return 0;
  const cod = Number(order.cod_amount ?? 0) || 0;
  return round2(cod > 0 ? Math.min(cod, owed) : owed);
};

// Runs inside the caller's transaction (webhook / manual refresh / backfill). Idempotent:
// a second Delivered event for an already-collected order is a no-op.
export const markCourierCollected = async (client, order, { source = "bosta_webhook", at = null } = {}) => {
  if (!order?.id) return { applied: false, reason: "no_order" };
  if (order.courier_collected_at) return { applied: false, reason: "already_collected", amount: Number(order.courier_collected_amount || 0) };
  const amount = courierCollectibleAmount(order);
  if (amount <= 0) return { applied: false, reason: "nothing_to_collect", amount: 0 };
  const timelineEvent = {
    at: at || new Date().toISOString(),
    action: "courier_collected",
    provider: text(order.shipping_provider || order.shipping_provider_id || "bosta"),
    amount,
    source,
  };
  const result = await client.query(
    `
    UPDATE orders SET
      courier_collected_at = COALESCE($2::timestamptz, NOW()),
      courier_collected_amount = $3,
      paid_amount = COALESCE(paid_amount, 0) + $3::numeric,
      remaining_amount = GREATEST(COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) - (COALESCE(paid_amount, 0) + $3::numeric), 0),
      payment_status = CASE
        WHEN COALESCE(paid_amount, 0) + $3::numeric >= COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) THEN 'paid'
        ELSE 'partially_paid'
      END,
      shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $4::jsonb,
      updated_at = NOW()
    WHERE id = $1 AND courier_collected_at IS NULL
    RETURNING *
    `,
    [order.id, at, amount, JSON.stringify([timelineEvent])]
  );
  if (!result.rowCount) return { applied: false, reason: "already_collected", amount };
  return { applied: true, amount, order: result.rows[0] };
};

const tenantClause = (tenantId, params, column = "o.tenant_id") => {
  if (tenantId === null || tenantId === undefined) return "TRUE";
  params.push(Number(tenantId));
  return `(${column} = $${params.length} OR ${column} IS NULL)`;
};

const collectionRowSql = `
  SELECT
    o.id,
    COALESCE(o.public_order_number, o.display_order_number, o.invoice_number, 'ORD-' || o.id::text) AS order_number,
    o.invoice_number,
    o.customer_name,
    o.customer_phone,
    COALESCE(o.shipping_provider, o.shipping_provider_id, '') AS provider,
    COALESCE(o.shipping_tracking_number, o.tracking_number, '') AS tracking_number,
    COALESCE(o.shipment_status, o.shipping_status, '') AS shipment_status,
    COALESCE(o.total_amount, o.total, o.total_price, 0)::numeric AS order_total,
    COALESCE(o.cod_amount, 0)::numeric AS cod_amount,
    COALESCE(o.paid_amount, 0)::numeric AS paid_amount,
    o.courier_collected_at,
    COALESCE(o.courier_collected_amount, 0)::numeric AS collected_amount,
    o.courier_settlement_id,
    o.courier_settled_at,
    o.created_at
  FROM orders o
`;

// Delivered COD parcels, split by whether the courier's transfer for them has landed.
export const listCourierCollections = async ({ tenantId = null, provider = "bosta", state = "pending", dateFrom = "", dateTo = "", search = "", limit = 500 } = {}) => {
  await ensureCourierSettlementSchema();
  const params = [];
  const where = [tenantClause(tenantId, params), "o.courier_collected_at IS NOT NULL"];
  if (provider) {
    params.push(provider);
    where.push(`LOWER(COALESCE(o.shipping_provider, o.shipping_provider_id, '')) = LOWER($${params.length})`);
  }
  if (state === "pending") where.push("o.courier_settlement_id IS NULL");
  if (state === "settled") where.push("o.courier_settlement_id IS NOT NULL");
  if (dateFrom) { params.push(dateFrom); where.push(`o.courier_collected_at >= $${params.length}::date`); }
  if (dateTo) { params.push(dateTo); where.push(`o.courier_collected_at < ($${params.length}::date + INTERVAL '1 day')`); }
  if (text(search)) {
    params.push(`%${text(search)}%`);
    const i = params.length;
    where.push(`(
      COALESCE(o.public_order_number, '') ILIKE $${i} OR COALESCE(o.display_order_number, '') ILIKE $${i} OR COALESCE(o.invoice_number, '') ILIKE $${i}
      OR COALESCE(o.customer_name, '') ILIKE $${i} OR COALESCE(o.customer_phone, '') ILIKE $${i}
      OR COALESCE(o.shipping_tracking_number, '') ILIKE $${i} OR COALESCE(o.tracking_number, '') ILIKE $${i}
    )`);
  }
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 2000));
  const result = await db.query(`${collectionRowSql} WHERE ${where.join(" AND ")} ORDER BY o.courier_collected_at DESC, o.id DESC LIMIT $${params.length}`, params);

  const summaryParams = [];
  const summaryWhere = [tenantClause(tenantId, summaryParams), "o.courier_collected_at IS NOT NULL"];
  if (provider) { summaryParams.push(provider); summaryWhere.push(`LOWER(COALESCE(o.shipping_provider, o.shipping_provider_id, '')) = LOWER($${summaryParams.length})`); }
  const summary = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN o.courier_settlement_id IS NULL THEN o.courier_collected_amount ELSE 0 END), 0)::numeric AS pending_amount,
      COUNT(*) FILTER (WHERE o.courier_settlement_id IS NULL)::int AS pending_count,
      COALESCE(SUM(CASE WHEN o.courier_settlement_id IS NOT NULL THEN o.courier_collected_amount ELSE 0 END), 0)::numeric AS settled_amount,
      COUNT(*) FILTER (WHERE o.courier_settlement_id IS NOT NULL)::int AS settled_count
    FROM orders o
    WHERE ${summaryWhere.join(" AND ")}
    `,
    summaryParams
  );
  return { rows: result.rows, summary: summary.rows[0] || { pending_amount: 0, pending_count: 0, settled_amount: 0, settled_count: 0 } };
};

// Delivered parcels that reached "delivered" before collection existed (or while the
// webhook was down) are marked from their stored state. Never pays an order twice:
// markCourierCollected skips anything already collected or fully paid.
export const backfillCourierCollections = async ({ tenantId = null, provider = "bosta", orderIds = [] } = {}) => {
  await ensureCourierSettlementSchema();
  const params = [];
  const where = [
    tenantClause(tenantId, params),
    "o.courier_collected_at IS NULL",
    "LOWER(COALESCE(o.shipment_status, o.shipping_status, '')) = 'delivered'",
    "o.cancelled_at IS NULL",
  ];
  if (provider) { params.push(provider); where.push(`LOWER(COALESCE(o.shipping_provider, o.shipping_provider_id, '')) = LOWER($${params.length})`); }
  const ids = (Array.isArray(orderIds) ? orderIds : []).map(Number).filter(Number.isFinite);
  if (ids.length) { params.push(ids); where.push(`o.id = ANY($${params.length}::bigint[])`); }
  const candidates = await db.query(`SELECT o.* FROM orders o WHERE ${where.join(" AND ")} ORDER BY o.id ASC LIMIT 1000`, params);

  const client = await db.connect();
  const applied = [];
  const skipped = [];
  try {
    await client.query("BEGIN");
    for (const order of candidates.rows) {
      // The delivery moment is the timeline's own word for it, so the collection
      // date is the real one and not the day someone pressed the button.
      const deliveredAt = await client.query(
        `SELECT created_at FROM shipping_events WHERE order_id = $1 AND status = 'delivered' ORDER BY created_at ASC LIMIT 1`,
        [order.id]
      );
      const at = deliveredAt.rows[0]?.created_at ? new Date(deliveredAt.rows[0].created_at).toISOString() : (order.shipping_last_synced_at ? new Date(order.shipping_last_synced_at).toISOString() : null);
      const outcome = await markCourierCollected(client, order, { source: "backfill", at });
      if (outcome.applied) applied.push({ order_id: order.id, amount: outcome.amount });
      else skipped.push({ order_id: order.id, reason: outcome.reason });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { applied, skipped, candidates: candidates.rowCount };
};

export const listCourierSettlements = async ({ tenantId = null, provider = "", limit = 100 } = {}) => {
  await ensureCourierSettlementSchema();
  const params = [];
  const where = [tenantClause(tenantId, params, "s.tenant_id")];
  if (provider) { params.push(provider); where.push(`LOWER(s.provider) = LOWER($${params.length})`); }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const result = await db.query(
    `
    SELECT s.*, ma.name AS money_account_name, u.name AS created_by_name
    FROM courier_settlements s
    LEFT JOIN money_accounts ma ON ma.id = s.money_account_id
    LEFT JOIN users u ON u.id = s.created_by
    WHERE ${where.join(" AND ")}
    ORDER BY s.settled_at DESC, s.id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows;
};

export const getCourierSettlement = async ({ tenantId = null, id } = {}) => {
  await ensureCourierSettlementSchema();
  const params = [Number(id)];
  const where = [`s.id = $1`, tenantClause(tenantId, params, "s.tenant_id")];
  const head = await db.query(`SELECT s.*, ma.name AS money_account_name FROM courier_settlements s LEFT JOIN money_accounts ma ON ma.id = s.money_account_id WHERE ${where.join(" AND ")} LIMIT 1`, params);
  const settlement = head.rows[0];
  if (!settlement) {
    const error = new Error("Settlement not found");
    error.status = 404;
    throw error;
  }
  const items = await db.query(
    `
    SELECT i.collected_amount, i.fee_amount, o.id, o.customer_name, o.customer_phone,
      COALESCE(o.public_order_number, o.display_order_number, o.invoice_number, 'ORD-' || o.id::text) AS order_number,
      COALESCE(o.shipping_tracking_number, o.tracking_number, '') AS tracking_number,
      o.courier_collected_at
    FROM courier_settlement_items i
    JOIN orders o ON o.id = i.order_id
    WHERE i.settlement_id = $1
    ORDER BY o.courier_collected_at ASC, o.id ASC
    `,
    [settlement.id]
  );
  return { ...settlement, items: items.rows };
};

// The bank transfer arrived. Gross = what the courier collected on the chosen
// parcels; fees = what the courier kept; net = what hit the bank. The operator
// types net (the number on the bank statement) and fees — gross is derived from
// the parcels, and a mismatch between gross - fees and net is refused, not
// silently absorbed, because that gap is exactly what reconciliation exists to catch.
export const createCourierSettlement = async ({
  tenantId = null,
  provider = "bosta",
  orderIds = [],
  feesAmount = 0,
  netAmount = null,
  settledAt = null,
  reference = "",
  notes = "",
  moneyAccountId = null,
  createdBy = null,
} = {}) => {
  await ensureCourierSettlementSchema();
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) {
    const error = new Error("اختار الشحنات اللي دخلت في التحويل الأول");
    error.status = 400;
    throw error;
  }
  const fees = round2(feesAmount);
  if (fees < 0) {
    const error = new Error("مصاريف الشحن لا يمكن أن تكون بالسالب");
    error.status = 400;
    throw error;
  }
  const when = settledAt ? new Date(settledAt) : new Date();
  if (Number.isNaN(when.getTime())) {
    const error = new Error("تاريخ التحويل غير صحيح");
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const params = [ids];
    const where = [`o.id = ANY($1::bigint[])`, tenantClause(tenantId, params)];
    const rows = await client.query(`SELECT o.* FROM orders o WHERE ${where.join(" AND ")} FOR UPDATE`, params);
    const found = new Map(rows.rows.map((row) => [Number(row.id), row]));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) {
      const error = new Error(`طلبات غير موجودة: ${missing.join(", ")}`);
      error.status = 404;
      throw error;
    }
    const notCollected = rows.rows.filter((row) => !row.courier_collected_at);
    if (notCollected.length) {
      const error = new Error(`الطلبات دي لسه ماتحصّلتش من شركة الشحن: ${notCollected.map((row) => row.public_order_number || row.invoice_number || row.id).join(", ")}`);
      error.status = 409;
      throw error;
    }
    const alreadySettled = rows.rows.filter((row) => row.courier_settlement_id);
    if (alreadySettled.length) {
      const error = new Error(`الطلبات دي اتسوّت قبل كده: ${alreadySettled.map((row) => row.public_order_number || row.invoice_number || row.id).join(", ")}`);
      error.status = 409;
      throw error;
    }
    const gross = round2(rows.rows.reduce((sum, row) => sum + (Number(row.courier_collected_amount) || 0), 0));
    const expectedNet = round2(gross - fees);
    const net = netAmount === null || netAmount === undefined || netAmount === "" ? expectedNet : round2(netAmount);
    if (Math.abs(net - expectedNet) > 0.009) {
      const error = new Error(`الصافي (${net.toFixed(2)}) لا يساوي المحصّل (${gross.toFixed(2)}) ناقص المصاريف (${fees.toFixed(2)}) = ${expectedNet.toFixed(2)}. عدّل المصاريف أو راجع الشحنات المختارة.`);
      error.status = 400;
      error.code = "SETTLEMENT_MISMATCH";
      error.payload = { gross, fees, net, expected_net: expectedNet };
      throw error;
    }
    if (net < 0) {
      const error = new Error("الصافي بالسالب — المصاريف أكبر من المحصّل");
      error.status = 400;
      throw error;
    }

    const inserted = await client.query(
      `
      INSERT INTO courier_settlements (tenant_id, provider, reference, settled_at, gross_amount, fees_amount, net_amount, orders_count, money_account_id, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [tenantId, text(provider) || "bosta", text(reference) || null, when.toISOString(), gross, fees, net, ids.length, toNumberOrNull(moneyAccountId), text(notes) || null, toNumberOrNull(createdBy)]
    );
    const settlement = inserted.rows[0];

    // Fees are spread over the parcels in proportion to what each collected, so a
    // per-order view (and a later return of one parcel) still carries its share.
    const feeShares = new Map();
    let allocated = 0;
    rows.rows.forEach((row, index) => {
      const collected = Number(row.courier_collected_amount) || 0;
      const isLast = index === rows.rows.length - 1;
      const share = isLast ? round2(fees - allocated) : (gross > 0 ? round2((fees * collected) / gross) : 0);
      allocated = round2(allocated + share);
      feeShares.set(Number(row.id), share);
    });
    for (const row of rows.rows) {
      await client.query(
        `INSERT INTO courier_settlement_items (settlement_id, order_id, collected_amount, fee_amount) VALUES ($1, $2, $3, $4)`,
        [settlement.id, row.id, round2(row.courier_collected_amount), feeShares.get(Number(row.id)) || 0]
      );
    }
    const timelineEvent = { at: when.toISOString(), action: "courier_settled", provider: text(provider) || "bosta", settlement_id: settlement.id, reference: text(reference) || null };
    await client.query(
      `
      UPDATE orders SET
        courier_settlement_id = $2,
        courier_settled_at = $3,
        shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $4::jsonb,
        updated_at = NOW()
      WHERE id = ANY($1::bigint[])
      `,
      [ids, settlement.id, when.toISOString(), JSON.stringify([timelineEvent])]
    );

    // Two money movements on the bank account: the courier's gross transfer in, and
    // the courier's fee out as an expense. Net balance is right and the fee stays
    // visible as a cost instead of vanishing inside a smaller deposit.
    let moneyTransactionId = null;
    let feeTransactionId = null;
    if (tenantId !== null && tenantId !== undefined) {
      const providerLabel = text(provider) || "bosta";
      const inbound = await postMoneyTransaction(client, {
        __inTransaction: true,
        tenantId,
        direction: "in",
        amount: gross,
        transactionType: "courier_settlement",
        referenceType: "courier_settlement",
        referenceId: settlement.id,
        moneyAccountId: toNumberOrNull(moneyAccountId),
        accountType: toNumberOrNull(moneyAccountId) ? undefined : "bank",
        paymentMethod: "bank_transfer",
        notes: `تحويل ${providerLabel} — ${ids.length} شحنة${text(reference) ? ` — ${text(reference)}` : ""}`,
        createdBy: toNumberOrNull(createdBy),
        metadata: { provider: providerLabel, gross, fees, net, orders: ids },
      });
      moneyTransactionId = inbound?.id || null;
      if (fees > 0) {
        const outbound = await postMoneyTransaction(client, {
          __inTransaction: true,
          tenantId,
          direction: "out",
          amount: fees,
          transactionType: "expense_payment",
          referenceType: "courier_settlement_fee",
          referenceId: settlement.id,
          moneyAccountId: inbound?.account_id || toNumberOrNull(moneyAccountId),
          accountType: inbound?.account_id || toNumberOrNull(moneyAccountId) ? undefined : "bank",
          paymentMethod: "bank_transfer",
          notes: `مصاريف شحن ${providerLabel} — تسوية #${settlement.id}`,
          createdBy: toNumberOrNull(createdBy),
          metadata: { provider: providerLabel, settlement_id: settlement.id },
        });
        feeTransactionId = outbound?.id || null;
      }
      await client.query(
        `UPDATE courier_settlements SET money_transaction_id = $2, fee_transaction_id = $3, money_account_id = COALESCE(money_account_id, $4) WHERE id = $1`,
        [settlement.id, moneyTransactionId, feeTransactionId, inbound?.account_id || null]
      );
    }
    await client.query("COMMIT");
    return { ...settlement, money_transaction_id: moneyTransactionId, fee_transaction_id: feeTransactionId, order_ids: ids };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
