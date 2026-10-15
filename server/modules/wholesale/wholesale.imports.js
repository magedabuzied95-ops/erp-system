import db from "../../database/db.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import { buildWholesaleStatement } from "./wholesale.statement.js";

// Import shipments (phase 4). Goods are priced in CNY or USD; the money reaches the supplier
// two ways — through an agent, or as cash dollars bought and sent — and each transfer records
// the foreign amount AND what it actually cost in pounds. Freight / customs / clearance are
// spread equally per piece. The landed cost per piece can then be written onto the products,
// so every sale's profit uses the real cost.
//
// FX loss/gain = what the goods really cost in pounds − what they were worth at the rate the
// order was booked at.

export const CURRENCIES = Object.freeze(["USD", "CNY"]);
export const CHANNELS = Object.freeze(["agent", "cash_usd"]);
export const COST_KINDS = Object.freeze(["freight", "customs", "clearance", "local_transport", "agent_fee", "other"]);
export const SHIPMENT_STATUSES = Object.freeze(["open", "arrived"]);

const text = (value) => String(value ?? "").trim();
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const round2 = (value) => Math.round(num(value) * 100) / 100;
const round4 = (value) => Math.round(num(value) * 10000) / 10000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: "WHOLESALE_IMPORT_INVALID" });
const dateOrNull = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : null);

/**
 * Pure: the money picture of one shipment.
 * Paid foreign is converted at the transfers' own effective rate (fees included); what is still
 * unpaid is estimated at the booking rate (or the effective rate when no booking rate was set).
 */
export const computeShipment = ({ shipment = {}, lines = [], costs = [], transfers = [] }) => {
  const bookingRate = num(shipment.booking_rate);
  const goodsForeign = round2(lines.reduce((sum, line) => sum + num(line.pieces) * num(line.unit_foreign), 0));
  const pieces = lines.reduce((sum, line) => sum + Math.max(0, Math.trunc(num(line.pieces))), 0);
  const paidForeign = round2(transfers.reduce((sum, row) => sum + num(row.foreign_amount), 0));
  const paidEgp = round2(transfers.reduce((sum, row) => sum + num(row.egp_amount) + num(row.fees_egp), 0));
  const effectiveRate = paidForeign > 0 ? paidEgp / paidForeign : bookingRate;
  const coveredForeign = Math.min(paidForeign, goodsForeign);
  const remainingForeign = round2(Math.max(0, goodsForeign - paidForeign));
  const overpaidForeign = round2(Math.max(0, paidForeign - goodsForeign));
  const estimateRate = bookingRate || effectiveRate;
  const goodsEgp = round2(coveredForeign * effectiveRate + remainingForeign * estimateRate);
  const costsEgp = round2(costs.reduce((sum, row) => sum + num(row.amount_egp), 0));
  const rateUsed = goodsForeign > 0 ? goodsEgp / goodsForeign : effectiveRate;
  const extraPerPiece = pieces > 0 ? costsEgp / pieces : 0;
  const bookedEgp = round2(goodsForeign * bookingRate);
  const fxLoss = bookingRate > 0 ? round2(goodsEgp - bookedEgp) : 0;
  return {
    goods_foreign: goodsForeign,
    pieces,
    paid_foreign: paidForeign,
    paid_egp: paidEgp,
    effective_rate: round4(effectiveRate),
    remaining_foreign: remainingForeign,
    remaining_egp_estimate: round2(remainingForeign * estimateRate),
    overpaid_foreign: overpaidForeign,
    overpaid_egp: round2(overpaidForeign * effectiveRate),
    goods_egp: goodsEgp,
    costs_egp: costsEgp,
    extra_per_piece: round4(extraPerPiece),
    landed_total: round2(goodsEgp + costsEgp),
    booked_egp: bookedEgp,
    fx_loss: fxLoss,
    fully_paid: goodsForeign > 0 && remainingForeign <= 0,
    lines: lines.map((line) => ({
      ...line,
      unit_egp: round4(num(line.unit_foreign) * rateUsed),
      landed_unit: round2(num(line.unit_foreign) * rateUsed + extraPerPiece),
    })),
  };
};

const shipmentRow = (row) => ({
  id: Number(row.id),
  name: row.name,
  supplier_name: row.supplier_name,
  currency: row.currency,
  booking_rate: num(row.booking_rate),
  purchase_id: row.purchase_id ? Number(row.purchase_id) : null,
  purchase_number: row.purchase_number || "",
  status: row.status,
  notes: row.notes,
  ordered_at: row.ordered_at,
  arrived_at: row.arrived_at,
  cost_applied_at: row.cost_applied_at,
  created_at: row.created_at,
});

const loadParts = async (tenantId, shipmentIds) => {
  if (!shipmentIds.length) return { lines: [], costs: [], transfers: [] };
  const [lines, costs, transfers] = await Promise.all([
    db.query(
      `SELECT l.id, l.shipment_id, l.product_id, l.variant_id, l.label, l.pieces, l.unit_foreign,
              p.name AS product_name, COALESCE(NULLIF(l.color, ''), v.color, '') AS color
         FROM wholesale_shipment_lines l
         LEFT JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id
        WHERE l.tenant_id = $1 AND l.shipment_id = ANY($2::bigint[])
        ORDER BY l.id`,
      [tenantId, shipmentIds]
    ),
    db.query("SELECT * FROM wholesale_shipment_costs WHERE tenant_id = $1 AND shipment_id = ANY($2::bigint[]) ORDER BY id", [tenantId, shipmentIds]),
    db.query(
      "SELECT * FROM wholesale_fx_transfers WHERE tenant_id = $1 AND shipment_id = ANY($2::bigint[]) AND deleted_at IS NULL ORDER BY transfer_date, id",
      [tenantId, shipmentIds]
    ),
  ]);
  const shape = (rows) => rows.map((row) => ({ ...row, id: Number(row.id), shipment_id: row.shipment_id ? Number(row.shipment_id) : null }));
  return {
    lines: shape(lines.rows).map((row) => ({
      ...row,
      product_id: row.product_id ? Number(row.product_id) : null,
      variant_id: row.variant_id ? Number(row.variant_id) : null,
      pieces: Number(row.pieces),
      unit_foreign: num(row.unit_foreign),
      label: row.label || [row.product_name, row.color].filter(Boolean).join(" · "),
    })),
    costs: shape(costs.rows).map((row) => ({ ...row, amount_egp: num(row.amount_egp) })),
    transfers: shape(transfers.rows).map(transferRow),
  };
};

const transferRow = (row) => ({
  id: Number(row.id),
  shipment_id: row.shipment_id ? Number(row.shipment_id) : null,
  shipment_name: row.shipment_name || "",
  channel: row.channel,
  currency: row.currency,
  foreign_amount: num(row.foreign_amount),
  egp_amount: num(row.egp_amount),
  fees_egp: num(row.fees_egp),
  rate: num(row.foreign_amount) > 0 ? round4((num(row.egp_amount) + num(row.fees_egp)) / num(row.foreign_amount)) : 0,
  agent_name: row.agent_name,
  transfer_date: row.transfer_date,
  note: row.note,
  created_at: row.created_at,
});

const SHIPMENT_SELECT = `
  SELECT s.*, pu.purchase_number
    FROM wholesale_shipments s
    LEFT JOIN purchases pu ON pu.id = s.purchase_id AND pu.tenant_id = s.tenant_id`;

export const listShipments = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(`${SHIPMENT_SELECT} WHERE s.tenant_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 300`, [tenantId]);
  const ids = rows.map((row) => Number(row.id));
  const parts = await loadParts(tenantId, ids);
  return rows.map((row) => {
    const id = Number(row.id);
    const summary = computeShipment({
      shipment: row,
      lines: parts.lines.filter((line) => line.shipment_id === id),
      costs: parts.costs.filter((cost) => cost.shipment_id === id),
      transfers: parts.transfers.filter((transfer) => transfer.shipment_id === id),
    });
    const { lines: _lines, ...totals } = summary;
    return { ...shipmentRow(row), summary: totals };
  });
};

export const getShipment = async ({ tenantId, shipmentId }) => {
  await ensureWholesaleSchema();
  const id = idOf(shipmentId);
  const { rows: [row] } = await db.query(`${SHIPMENT_SELECT} WHERE s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL`, [tenantId, id]);
  if (!row) throw fail("الشحنة مش موجودة", 404);
  const parts = await loadParts(tenantId, [id]);
  const summary = computeShipment({ shipment: row, ...parts });
  return { ...shipmentRow(row), lines: summary.lines, costs: parts.costs, transfers: parts.transfers, summary: { ...summary, lines: undefined } };
};

const cleanHeader = (input = {}) => {
  const name = text(input.name).slice(0, 160);
  if (!name) throw fail("اكتب اسم الشحنة");
  const currency = CURRENCIES.includes(text(input.currency).toUpperCase()) ? text(input.currency).toUpperCase() : null;
  if (!currency) throw fail("العملة لازم تكون دولار أو يوان");
  const bookingRate = num(input.booking_rate);
  if (bookingRate < 0) throw fail("سعر الصرف لازم يكون رقم موجب");
  return {
    name,
    supplier_name: text(input.supplier_name).slice(0, 160),
    currency,
    booking_rate: round4(bookingRate),
    status: SHIPMENT_STATUSES.includes(text(input.status)) ? text(input.status) : "open",
    notes: text(input.notes).slice(0, 2000),
    ordered_at: dateOrNull(input.ordered_at),
    arrived_at: dateOrNull(input.arrived_at),
  };
};

const cleanLines = (lines = []) => (Array.isArray(lines) ? lines : []).map((line) => ({
  product_id: idOf(line.product_id),
  variant_id: idOf(line.variant_id),
  color: text(line.color).slice(0, 120),
  label: text(line.label).slice(0, 255),
  pieces: Math.max(0, Math.trunc(num(line.pieces))),
  unit_foreign: round4(Math.max(0, num(line.unit_foreign))),
})).filter((line) => line.pieces > 0 && (line.product_id || line.label));

const cleanCosts = (costs = []) => (Array.isArray(costs) ? costs : []).map((cost) => ({
  kind: COST_KINDS.includes(text(cost.kind)) ? text(cost.kind) : "other",
  amount_egp: round2(Math.max(0, num(cost.amount_egp))),
  note: text(cost.note).slice(0, 500),
})).filter((cost) => cost.amount_egp > 0);

/** Create (no id) or replace a shipment with its lines and costs, in one transaction. */
export const saveShipment = async ({ tenantId, userId = null, shipmentId = null, input = {} }) => {
  await ensureWholesaleSchema();
  const header = cleanHeader(input);
  const lines = cleanLines(input.lines);
  const costs = cleanCosts(input.costs);
  const purchaseId = idOf(input.purchase_id);
  const client = await db.connect();
  let id = idOf(shipmentId);
  try {
    await client.query("BEGIN");
    if (id) {
      const { rowCount } = await client.query(
        `UPDATE wholesale_shipments SET name = $3, supplier_name = $4, currency = $5, booking_rate = $6, status = $7, notes = $8,
                ordered_at = $9::date, arrived_at = $10::date, purchase_id = $11::bigint, updated_at = NOW()
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id, header.name, header.supplier_name, header.currency, header.booking_rate, header.status, header.notes, header.ordered_at, header.arrived_at, purchaseId]
      );
      if (!rowCount) throw fail("الشحنة مش موجودة", 404);
      await client.query("DELETE FROM wholesale_shipment_lines WHERE tenant_id = $1 AND shipment_id = $2", [tenantId, id]);
      await client.query("DELETE FROM wholesale_shipment_costs WHERE tenant_id = $1 AND shipment_id = $2", [tenantId, id]);
    } else {
      const { rows: [created] } = await client.query(
        `INSERT INTO wholesale_shipments (tenant_id, name, supplier_name, currency, booking_rate, status, notes, ordered_at, arrived_at, purchase_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10::bigint, $11::bigint) RETURNING id`,
        [tenantId, header.name, header.supplier_name, header.currency, header.booking_rate, header.status, header.notes, header.ordered_at, header.arrived_at, purchaseId, idOf(userId)]
      );
      id = Number(created.id);
    }
    for (const line of lines) {
      await client.query(
        `INSERT INTO wholesale_shipment_lines (tenant_id, shipment_id, product_id, variant_id, color, label, pieces, unit_foreign)
         VALUES ($1, $2, $3::bigint, $4::bigint, $5, $6, $7, $8)`,
        [tenantId, id, line.product_id, line.variant_id, line.color, line.label, line.pieces, line.unit_foreign]
      );
    }
    for (const cost of costs) {
      await client.query(
        "INSERT INTO wholesale_shipment_costs (tenant_id, shipment_id, kind, amount_egp, note) VALUES ($1, $2, $3, $4, $5)",
        [tenantId, id, cost.kind, cost.amount_egp, cost.note]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getShipment({ tenantId, shipmentId: id });
};

export const deleteShipment = async ({ tenantId, shipmentId }) => {
  await ensureWholesaleSchema();
  const id = idOf(shipmentId);
  await db.query("UPDATE wholesale_fx_transfers SET shipment_id = NULL WHERE tenant_id = $1 AND shipment_id = $2", [tenantId, id]);
  const { rowCount } = await db.query("UPDATE wholesale_shipments SET deleted_at = NOW() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, id]);
  if (!rowCount) throw fail("الشحنة مش موجودة", 404);
  return { id, deleted: true };
};

/** A purchase's lines (one per variant) to start a shipment from what was already received. */
export const purchaseLinesForShipment = async ({ tenantId, purchase }) => {
  await ensureWholesaleSchema();
  const key = text(purchase);
  if (!key) throw fail("اكتب رقم فاتورة الشراء");
  const { rows: [found] } = await db.query(
    `SELECT pu.id, pu.purchase_number, s.name AS supplier_name
       FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pu.tenant_id = $1 AND (pu.purchase_number = $2 OR pu.id::text = $2)
        AND (pu.deleted_at IS NULL)
      ORDER BY pu.id DESC LIMIT 1`,
    [tenantId, key]
  );
  if (!found) throw fail("فاتورة الشراء دي مش موجودة", 404);
  const { rows } = await db.query(
    // One line per model + colour: the wholesale piece price is per colour, never per size.
    `SELECT pi.product_id, SUM(pi.quantity)::int AS pieces, p.name AS product_name, COALESCE(v.color, '') AS color
       FROM purchase_items pi
       LEFT JOIN products p ON p.id = pi.product_id
       LEFT JOIN product_variants v ON v.id = pi.variant_id
      WHERE pi.tenant_id = $1 AND pi.purchase_id = $2
      GROUP BY pi.product_id, p.name, COALESCE(v.color, '')
      ORDER BY p.name, 4`,
    [tenantId, found.id]
  );
  return {
    purchase_id: Number(found.id),
    purchase_number: found.purchase_number,
    supplier_name: found.supplier_name || "",
    lines: rows.map((row) => ({
      product_id: row.product_id ? Number(row.product_id) : null,
      variant_id: null,
      color: row.color || "",
      label: [row.product_name, row.color].filter(Boolean).join(" · "),
      pieces: Number(row.pieces) || 0,
      unit_foreign: 0,
    })),
  };
};

/**
 * Writes the landed cost per piece onto the products in the shipment: the exact variant when
 * the line has one, otherwise every variant of the model. Sales from now on carry that cost.
 */
export const applyLandedCost = async ({ tenantId, shipmentId }) => {
  const shipment = await getShipment({ tenantId, shipmentId });
  if (!shipment.lines.length) throw fail("الشحنة مفيهاش أصناف");
  if (shipment.summary.goods_foreign <= 0) throw fail("اكتب سعر القطعة بالعملة لكل صنف الأول");
  const client = await db.connect();
  let variants = 0;
  try {
    await client.query("BEGIN");
    for (const line of shipment.lines) {
      if (!line.product_id || !(line.landed_unit > 0)) continue;
      const owned = await client.query("UPDATE products SET cost_price = $3 WHERE tenant_id = $1 AND id = $2", [tenantId, line.product_id, line.landed_unit]);
      if (!owned.rowCount) continue;
      // The exact variant, else every size of that colour, else the whole model.
      const result = line.variant_id
        ? await client.query(
          "UPDATE product_variants SET cost_price = $3 WHERE product_id = $1 AND id = $2",
          [line.product_id, line.variant_id, line.landed_unit]
        )
        : await client.query(
          `UPDATE product_variants SET cost_price = $2
            WHERE product_id = $1 AND deleted_at IS NULL AND ($3 = '' OR LOWER(TRIM(COALESCE(color, ''))) = LOWER(TRIM($3)))`,
          [line.product_id, line.landed_unit, text(line.color)]
        );
      variants += result.rowCount;
    }
    await client.query("UPDATE wholesale_shipments SET cost_applied_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND id = $2", [tenantId, shipment.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ...(await getShipment({ tenantId, shipmentId })), variants_updated: variants };
};

export const listTransfers = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows } = await db.query(
    `SELECT t.*, s.name AS shipment_name FROM wholesale_fx_transfers t
       LEFT JOIN wholesale_shipments s ON s.id = t.shipment_id AND s.deleted_at IS NULL
      WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
      ORDER BY t.transfer_date DESC, t.id DESC LIMIT 500`,
    [tenantId]
  );
  return rows.map(transferRow);
};

export const saveTransfer = async ({ tenantId, userId = null, transferId = null, input = {} }) => {
  await ensureWholesaleSchema();
  const channel = CHANNELS.includes(text(input.channel)) ? text(input.channel) : null;
  if (!channel) throw fail("اختار طريقة التحويل: وكيل أو دولار كاش");
  const currency = CURRENCIES.includes(text(input.currency).toUpperCase()) ? text(input.currency).toUpperCase() : null;
  if (!currency) throw fail("العملة لازم تكون دولار أو يوان");
  const foreign = round2(num(input.foreign_amount));
  const egp = round2(num(input.egp_amount));
  const fees = round2(Math.max(0, num(input.fees_egp)));
  if (foreign <= 0 || egp <= 0) throw fail("اكتب المبلغ بالعملة والمبلغ اللي اتدفع بالجنيه");
  const shipmentId = idOf(input.shipment_id);
  if (shipmentId) {
    const { rows: [shipment] } = await db.query("SELECT currency FROM wholesale_shipments WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, shipmentId]);
    if (!shipment) throw fail("الشحنة مش موجودة", 404);
    if (shipment.currency !== currency) throw fail(`الشحنة دي بال${shipment.currency === "USD" ? "دولار" : "يوان"} — التحويل لازم يكون بنفس العملة`);
  }
  const values = [tenantId, shipmentId, channel, currency, foreign, egp, fees, text(input.agent_name).slice(0, 160), dateOrNull(input.transfer_date), text(input.note).slice(0, 1000)];
  const id = idOf(transferId);
  if (id) {
    const { rowCount } = await db.query(
      `UPDATE wholesale_fx_transfers SET shipment_id = $2::bigint, channel = $3, currency = $4, foreign_amount = $5, egp_amount = $6, fees_egp = $7,
              agent_name = $8, transfer_date = COALESCE($9::date, transfer_date), note = $10
        WHERE tenant_id = $1 AND id = $11 AND deleted_at IS NULL`,
      [...values, id]
    );
    if (!rowCount) throw fail("التحويل مش موجود", 404);
  } else {
    await db.query(
      `INSERT INTO wholesale_fx_transfers (tenant_id, shipment_id, channel, currency, foreign_amount, egp_amount, fees_egp, agent_name, transfer_date, note, created_by)
       VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10, $11::bigint)`,
      [...values, idOf(userId)]
    );
  }
  return listTransfers({ tenantId });
};

export const deleteTransfer = async ({ tenantId, transferId }) => {
  await ensureWholesaleSchema();
  const { rowCount } = await db.query("UPDATE wholesale_fx_transfers SET deleted_at = NOW() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL", [tenantId, idOf(transferId)]);
  if (!rowCount) throw fail("التحويل مش موجود", 404);
  return listTransfers({ tenantId });
};

/** FX: per shipment (booked vs real) and per channel (agent vs cash dollars, average rate). */
export const fxReport = async ({ tenantId }) => {
  const shipments = await listShipments({ tenantId });
  const transfers = await listTransfers({ tenantId });
  const byChannel = {};
  for (const transfer of transfers) {
    const key = `${transfer.channel}:${transfer.currency}`;
    const bucket = byChannel[key] || (byChannel[key] = { channel: transfer.channel, currency: transfer.currency, count: 0, foreign: 0, egp: 0, fees: 0 });
    bucket.count += 1;
    bucket.foreign += transfer.foreign_amount;
    bucket.egp += transfer.egp_amount;
    bucket.fees += transfer.fees_egp;
  }
  const channels = Object.values(byChannel).map((bucket) => ({
    ...bucket,
    foreign: round2(bucket.foreign),
    egp: round2(bucket.egp),
    fees: round2(bucket.fees),
    average_rate: bucket.foreign > 0 ? round4((bucket.egp + bucket.fees) / bucket.foreign) : 0,
  }));
  const rows = shipments.map((shipment) => ({
    id: shipment.id,
    name: shipment.name,
    currency: shipment.currency,
    status: shipment.status,
    goods_foreign: shipment.summary.goods_foreign,
    booking_rate: shipment.booking_rate,
    effective_rate: shipment.summary.effective_rate,
    booked_egp: shipment.summary.booked_egp,
    goods_egp: shipment.summary.goods_egp,
    fx_loss: shipment.summary.fx_loss,
    fully_paid: shipment.summary.fully_paid,
  }));
  return {
    shipments: rows,
    channels,
    total_fx_loss: round2(rows.reduce((sum, row) => sum + row.fx_loss, 0)),
  };
};

/**
 * Capital: what the business is worth in goods and money owed to it, at cost.
 *   stock on hand (pieces × cost) + goods still on the way + money with the agent not yet
 *   tied to a shipment + what customers owe − what is still owed to suppliers.
 * Cash in drawers / bank is not included (it lives in the accounting screens).
 */
export const capitalReport = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows: [stock] } = await db.query(
    `SELECT COALESCE(SUM(GREATEST(v.stock, 0) * COALESCE(NULLIF(v.cost_price, 0), p.cost_price, 0)), 0) AS value,
            COALESCE(SUM(GREATEST(v.stock, 0)), 0) AS pieces
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE p.tenant_id = $1 AND v.deleted_at IS NULL AND COALESCE(p.status, 'active') <> 'deleted'`,
    [tenantId]
  );
  const shipments = await listShipments({ tenantId });
  const open = shipments.filter((shipment) => shipment.status !== "arrived");
  const inTransit = round2(open.reduce((sum, shipment) => sum + shipment.summary.landed_total, 0));
  const owedToSuppliers = round2(shipments.reduce((sum, shipment) => sum + shipment.summary.remaining_egp_estimate, 0));
  const overpaid = round2(shipments.reduce((sum, shipment) => sum + shipment.summary.overpaid_egp, 0));
  const { rows: [loose] } = await db.query(
    "SELECT COALESCE(SUM(egp_amount + fees_egp), 0) AS egp FROM wholesale_fx_transfers WHERE tenant_id = $1 AND shipment_id IS NULL AND deleted_at IS NULL",
    [tenantId]
  );
  const { rows: customers } = await db.query(
    `SELECT DISTINCT customer_id FROM orders WHERE tenant_id = $1 AND customer_id IS NOT NULL
     UNION SELECT DISTINCT customer_id FROM customer_payments WHERE tenant_id = $1 AND customer_id IS NOT NULL`,
    [tenantId]
  );
  let receivables = 0;
  let debtors = 0;
  for (const { customer_id: customerId } of customers) {
    try {
      const { balance } = await buildWholesaleStatement({ tenantId, customerId: Number(customerId) });
      if (balance > 0) {
        receivables += balance;
        debtors += 1;
      }
    } catch {
      // a customer row that vanished; skip it
    }
  }
  const stockValue = round2(stock.value);
  const withAgents = round2(num(loose.egp) + overpaid);
  receivables = round2(receivables);
  return {
    stock_value: stockValue,
    stock_pieces: Number(stock.pieces) || 0,
    in_transit: inTransit,
    open_shipments: open.length,
    with_agents: withAgents,
    receivables,
    debtors,
    owed_to_suppliers: owedToSuppliers,
    capital: round2(stockValue + inTransit + withAgents + receivables - owedToSuppliers),
  };
};
