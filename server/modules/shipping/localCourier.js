// The shop's own motorcycle courier (Damietta and New Damietta). These parcels never reach
// Bosta, so nothing ever told the ERP they were delivered: the order stayed "confirmed", the
// customer kept owing the whole amount, the sale never reached revenue, and the cash the
// courier brought back had no order to land on (owner, 2026-10-21).
//
// The same two moments as a Bosta parcel (shipping.settlements.service.js):
//   1. delivered  — the courier took the customer's cash: markCourierCollected closes the
//                   customer's balance and opens the courier's (provider "local_courier").
//   2. settlement — the courier hands the cash in at the shop: it goes into an open drawer
//                   shift as cash_in (net of his fee), and his fee becomes a shipping expense.
// A refused parcel comes back through cancelOrder, the same restock as a returned Bosta parcel.
import db from "../../database/db.js";
import { ensureAccountingSchema, recordCashDrawerEvent, recordFinancialAccountActivity } from "../../services/accountingService.js";
import { sendShipmentNotificationForStatus } from "../../services/whatsappShippingService.js";
import { syncDeliveryOrderFavorite } from "../../services/deliveryOrderFavoriteService.js";
import { resolveGovernorateId } from "../../../shared/codPolicy.js";
import { buildPortalOnlineSql, loadColumns } from "./onlineOrderSql.js";
import { DELIVERED_CLOSES_CONFIRMATION_SQL, ensureCourierSettlementSchema, markCourierCollected } from "./shipping.settlements.service.js";
import { ensureCourierCostSchema, expenseCategoryId, upsertCourierExpense } from "./shipping.costs.service.js";
import { receiveReturnedBostaParcel } from "./bostaReturnedParcel.js";
import { getAppTimeZone } from "../../utils/appTimezone.js";

export const LOCAL_COURIER_PROVIDER = "local_courier";
export const LOCAL_COURIER_EXPENSE_CATEGORY = "مصاريف شحن — مندوب";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const httpError = (status, code, message, payload) => Object.assign(new Error(message), { status, code, ...(payload ? { payload } : {}) });

// Couriers that mean "nobody booked yet" — the only ones the shop's courier may take over.
const UNBOOKED_PROVIDERS = new Set(["", "manual", "in_store_delivery", "in-store-delivery", "none", "null", "pickup", "store_pickup", LOCAL_COURIER_PROVIDER]);
const CLOSED_STATUSES = new Set(["cancelled", "canceled", "returned", "refunded", "fully_refunded"]);
const FINISHED_SHIPPING = new Set(["delivered", "returned", "cancelled", "canceled"]);

const providerOf = (order = {}) => lower(order.shipping_provider || order.shipping_provider_id);
const trackingOf = (order = {}) => text(order.shipping_tracking_number || order.tracking_number || order.shipping_provider_delivery_id);
const shippingStatusOf = (order = {}) => lower(order.shipment_status || order.shipping_status);

// Why this order cannot go with the shop's courier, or "" when it can.
export const localCourierBlockReason = (order = {}) => {
  if (!order?.id) return "order_not_found";
  if (order.deleted_at) return "order_not_found";
  if (order.cancelled_at || CLOSED_STATUSES.has(lower(order.status))) return "ORDER_LOCKED";
  // "bosta" with no parcel is only the default the portal's new-order sheet writes.
  if (!UNBOOKED_PROVIDERS.has(providerOf(order)) && providerOf(order) !== "bosta") return "OTHER_COURIER";
  // A booked parcel keeps its tracking even after the provider column is edited.
  if (trackingOf(order) && providerOf(order) !== LOCAL_COURIER_PROVIDER) return "OTHER_COURIER";
  return "";
};

// ---------------------------------------------------------------------------
// Settings: the courier's name and his fixed fee per delivered order.
// ---------------------------------------------------------------------------

let schemaReady = null;
export const ensureLocalCourierSchema = async () => {
  if (!schemaReady) {
    // courier_settlements must exist first, or the memoised ALTER below silently does nothing.
    schemaReady = ensureCourierSettlementSchema().then(() => db.query(`
      CREATE TABLE IF NOT EXISTS local_courier_settings (
        tenant_key BIGINT PRIMARY KEY,
        courier_name VARCHAR(120) NOT NULL DEFAULT '',
        courier_phone VARCHAR(40) NOT NULL DEFAULT '',
        fee_per_order NUMERIC(12,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `))
      // How a hand-in arrived: { cash, instapay, card } (nullable, metadata-only).
      .then(() => db.query(`ALTER TABLE IF EXISTS courier_settlements ADD COLUMN IF NOT EXISTS payment_breakdown JSONB NULL`))
      .catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

export const getLocalCourierSettings = async ({ tenantId = null } = {}, client = db) => {
  await ensureLocalCourierSchema();
  const row = (await client.query(`SELECT * FROM local_courier_settings WHERE tenant_key = $1`, [Number(tenantId) || 0])).rows[0];
  return {
    courier_name: text(row?.courier_name),
    courier_phone: text(row?.courier_phone),
    fee_per_order: round2(row?.fee_per_order),
  };
};

export const saveLocalCourierSettings = async ({ tenantId = null, courierName, courierPhone, feePerOrder } = {}) => {
  const current = await getLocalCourierSettings({ tenantId });
  const name = courierName === undefined ? current.courier_name : text(courierName).slice(0, 120);
  const phone = courierPhone === undefined ? current.courier_phone : text(courierPhone).slice(0, 40);
  const fee = feePerOrder === undefined ? current.fee_per_order : round2(feePerOrder);
  if (!Number.isFinite(Number(feePerOrder ?? fee)) || fee < 0) throw httpError(400, "INVALID_FEE", "أجرة المندوب لازم تكون رقم صفر أو أكتر");
  await db.query(
    `
    INSERT INTO local_courier_settings (tenant_key, courier_name, courier_phone, fee_per_order, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (tenant_key) DO UPDATE SET
      courier_name = EXCLUDED.courier_name, courier_phone = EXCLUDED.courier_phone,
      fee_per_order = EXCLUDED.fee_per_order, updated_at = NOW()
    `,
    [Number(tenantId) || 0, name, phone, fee]
  );
  return getLocalCourierSettings({ tenantId });
};

// ---------------------------------------------------------------------------
// The order's three moments with the courier.
// ---------------------------------------------------------------------------

const lockOrder = async (client, { orderId, tenantId }) => {
  const result = await client.query(
    `SELECT * FROM orders WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) FOR UPDATE`,
    [Number(orderId), tenantId ?? null]
  );
  return result.rows[0] || null;
};

const courierLabel = (settings) => (settings.courier_name ? `المندوب ${settings.courier_name}` : "المندوب");

const recordShippingEvent = (client, { orderId, status, payload }) => client.query(
  `INSERT INTO shipping_events (order_id, provider, status, payload) VALUES ($1, $2, $3, $4::jsonb)`,
  [orderId, LOCAL_COURIER_PROVIDER, status, JSON.stringify(payload || {})]
);

// The parcel left the shop with the courier.
export const dispatchWithLocalCourier = async ({ orderId, tenantId = null, actorName = "", source = "orders" } = {}) => {
  await ensureLocalCourierSchema();
  const settings = await getLocalCourierSettings({ tenantId });
  const client = await db.connect();
  let updated;
  try {
    await client.query("BEGIN");
    const order = await lockOrder(client, { orderId, tenantId });
    const blocked = localCourierBlockReason(order);
    if (blocked) throw httpError(blocked === "order_not_found" ? 404 : 409, blocked, "This order cannot go with the shop courier");
    if (FINISHED_SHIPPING.has(shippingStatusOf(order))) throw httpError(409, "ORDER_LOCKED", "This order is already delivered");
    const at = new Date().toISOString();
    const event = { at, action: "local_courier_dispatched", provider: LOCAL_COURIER_PROVIDER, status: "out_for_delivery", courier: settings.courier_name, actor: actorName, source, label: `خرج مع ${courierLabel(settings)}` };
    updated = (await client.query(
      `
      UPDATE orders SET
        shipping_provider = $2,
        shipping_provider_id = $2,
        shipping_status = 'out_for_delivery',
        shipment_status = 'out_for_delivery',
        shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $3::jsonb,
        timeline = COALESCE(timeline, '[]'::jsonb) || $3::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [order.id, LOCAL_COURIER_PROVIDER, JSON.stringify([event])]
    )).rows[0];
    await recordShippingEvent(client, { orderId: order.id, status: "out_for_delivery", payload: event });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  void Promise.resolve(sendShipmentNotificationForStatus(updated, "out_for_delivery"))
    .catch((error) => console.warn("[local-courier] out-for-delivery notice failed", { orderId: updated?.id, message: error?.message }));
  return updated;
};

// The courier handed the parcel over and took the customer's cash. Works straight from
// "confirmed" too — staff who forgot to press "خرج مع المندوب" must not be stuck.
export const deliverLocked = async (client, order, { settings, at = null, actorName = "", source = "orders" }) => {
  const blocked = localCourierBlockReason(order);
  if (blocked) return { applied: false, reason: blocked };
  if (shippingStatusOf(order) === "delivered") return { applied: false, reason: "already_delivered" };
  if (FINISHED_SHIPPING.has(shippingStatusOf(order))) return { applied: false, reason: "ORDER_LOCKED" };
  const when = at || new Date().toISOString();
  const event = { at: when, action: "local_courier_delivered", provider: LOCAL_COURIER_PROVIDER, status: "delivered", courier: settings.courier_name, actor: actorName, source, label: `اتسلم مع ${courierLabel(settings)}` };
  const delivered = (await client.query(
    `
    UPDATE orders SET
      status = ${DELIVERED_CLOSES_CONFIRMATION_SQL("$2::varchar")},
      shipping_provider = $3,
      shipping_provider_id = $3,
      shipping_status = $2::varchar,
      shipment_status = $2::varchar,
      shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $4::jsonb,
      timeline = COALESCE(timeline, '[]'::jsonb) || $4::jsonb,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [order.id, "delivered", LOCAL_COURIER_PROVIDER, JSON.stringify([event])]
  )).rows[0];
  await recordShippingEvent(client, { orderId: order.id, status: "delivered", payload: event });
  // Same transaction as the status: a parcel can never read delivered while the customer owes.
  const collection = await markCourierCollected(client, delivered, { source: `local_courier:${source}`, at: when });
  return { applied: true, order: collection.applied ? collection.order : delivered, collected: collection.applied ? collection.amount : 0 };
};

const afterDelivered = (order) => {
  void Promise.resolve(sendShipmentNotificationForStatus(order, "delivered"))
    .catch((error) => console.warn("[local-courier] delivered notice failed", { orderId: order?.id, message: error?.message }));
  void syncDeliveryOrderFavorite({ tenantId: order?.tenant_id, order, source: "local_courier:delivered" });
  void import("./shipping.service.js")
    .then((module) => module.settleExchangeReturnOnDelivery(order, { source: "local_courier" }))
    .catch((error) => console.warn("[local-courier] exchange restock failed", { orderId: order?.id, message: error?.message }));
};

export const markLocalCourierDelivered = async ({ orderId, tenantId = null, actorName = "", source = "orders" } = {}) => {
  await ensureLocalCourierSchema();
  await ensureCourierSettlementSchema();
  const settings = await getLocalCourierSettings({ tenantId });
  const client = await db.connect();
  let outcome;
  try {
    await client.query("BEGIN");
    const order = await lockOrder(client, { orderId, tenantId });
    outcome = await deliverLocked(client, order, { settings, actorName, source });
    if (!outcome.applied) {
      const code = outcome.reason;
      throw httpError(code === "order_not_found" ? 404 : 409, code === "already_delivered" ? "ORDER_LOCKED" : code, "This order cannot be marked delivered");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  afterDelivered(outcome.order);
  return { order: outcome.order, collected: outcome.collected };
};

// The customer refused the parcel and the courier brought it back: cancel + restock.
export const markLocalCourierReturned = async ({ orderId, tenantId = null, source = "orders" } = {}) => {
  const order = (await db.query(
    `SELECT * FROM orders WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)`,
    [Number(orderId), tenantId ?? null]
  )).rows[0];
  if (!order) throw httpError(404, "order_not_found", "Order not found");
  if (providerOf(order) !== LOCAL_COURIER_PROVIDER) throw httpError(409, "OTHER_COURIER", "This order did not go with the shop courier");
  if (shippingStatusOf(order) === "delivered") throw httpError(409, "ORDER_LOCKED", "A delivered order is returned from the returns screen");
  const result = await receiveReturnedBostaParcel(order, {
    source: `local_courier:${source}`,
    courier: { provider: LOCAL_COURIER_PROVIDER, name: "المندوب", reason: "العميل رفض الأوردر ورجع مع المندوب — اتلغى والمخزون رجع", label: "رجع مع المندوب للمحل" },
  });
  if (!result.received) throw httpError(409, result.reason === "cancel_refused" ? "RETURN_REFUSED" : "ORDER_LOCKED", result.message || "The order could not be returned");
  return result;
};

// ---------------------------------------------------------------------------
// Orders that already went with the courier before this existed — still "confirmed" and owing.
// The owner picks the ones that were really delivered; nothing is closed by a guess.
// ---------------------------------------------------------------------------

export const listLocalCourierBacklog = async ({ tenantId = null, limit = 300 } = {}) => {
  const columns = await loadColumns("orders");
  const { onlineExpr, groupExpr, liveExpr, trackingExpr } = buildPortalOnlineSql(columns);
  const pick = (...names) => {
    const present = names.filter((name) => columns.has(name)).map((name) => `NULLIF(TRIM(o.${name}::text), '')`);
    return present.length ? `COALESCE(${present.join(", ")}, '')` : "''";
  };
  const params = [];
  const where = [onlineExpr, liveExpr, `${groupExpr} IN ('new', 'confirmed')`, `${trackingExpr} = ''`];
  if (columns.has("cancelled_at")) where.push("o.cancelled_at IS NULL");
  if (tenantId !== null && tenantId !== undefined) {
    params.push(Number(tenantId));
    where.push(`(o.tenant_id = $${params.length} OR o.tenant_id IS NULL)`);
  }
  params.push(Math.min(Math.max(Number(limit) || 300, 1), 1000));
  const result = await db.query(
    `
    SELECT
      o.id,
      COALESCE(o.public_order_number, o.display_order_number, o.invoice_number, 'ORD-' || o.id::text) AS order_number,
      o.customer_name, o.customer_phone, o.status, o.payment_method,
      ${groupExpr} AS stage,
      ${pick("shipping_address", "customer_address", "address")} AS address,
      ${pick("governorate", "shipping_governorate", "city", "shipping_city")} AS governorate,
      COALESCE(o.total_amount, o.total, o.total_price, 0)::numeric AS order_total,
      COALESCE(o.paid_amount, 0)::numeric AS paid_amount,
      o.created_at
    FROM orders o
    WHERE ${where.join(" AND ")}
    ORDER BY o.created_at ASC, o.id ASC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows.map((row) => {
    const governorateId = resolveGovernorateId(row.governorate, row.address);
    return {
      ...row,
      order_total: round2(row.order_total),
      paid_amount: round2(row.paid_amount),
      owed: round2(Math.max(0, Number(row.order_total) - Number(row.paid_amount))),
      is_damietta: governorateId === "damietta",
    };
  });
};

export const markLocalCourierBacklogDelivered = async ({ tenantId = null, orderIds = [], actorName = "" } = {}) => {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw httpError(400, "NO_ORDERS_SELECTED", "اختار الأوردرات اللي اتسلمت الأول");
  if (ids.length > 300) throw httpError(400, "TOO_MANY_ORDERS", "300 أوردر بالكتير في المرة");
  await ensureLocalCourierSchema();
  await ensureCourierSettlementSchema();
  const settings = await getLocalCourierSettings({ tenantId });
  const client = await db.connect();
  const applied = [];
  const skipped = [];
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      const order = await lockOrder(client, { orderId: id, tenantId });
      const outcome = await deliverLocked(client, order, { settings, actorName, source: "backlog" });
      if (outcome.applied) applied.push({ order_id: id, collected: outcome.collected, order: outcome.order });
      else skipped.push({ order_id: id, reason: outcome.reason });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // No "تم تسليم طلبك" for these: they arrived days ago, the message would be news to nobody.
  for (const row of applied) void syncDeliveryOrderFavorite({ tenantId: row.order?.tenant_id, order: row.order, source: "local_courier:backlog" });
  return { applied: applied.map(({ order_id, collected }) => ({ order_id, collected })), skipped };
};

// ---------------------------------------------------------------------------
// The courier hands the cash in.
// ---------------------------------------------------------------------------

export const listOpenDrawerShifts = async ({ tenantId = null } = {}) => {
  if (tenantId === null || tenantId === undefined) return [];
  await ensureAccountingSchema();
  const result = await db.query(
    `
    SELECT s.id, s.branch_id, s.opened_at, b.name AS branch_name,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'User #' || s.opened_by) AS cashier_name
    FROM cash_drawer_shifts s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN users u ON u.id = s.opened_by
    WHERE s.tenant_id = $1 AND s.status = 'open'
    ORDER BY s.opened_at DESC
    `,
    [Number(tenantId)]
  );
  return result.rows;
};

// How the hand-in arrived. Customers pay the courier in cash, but also by InstaPay or card
// straight to the shop: cash goes into the drawer shift, the rest to the account each method
// maps to (the same mapping the till uses).
export const LOCAL_COURIER_PAYMENT_METHODS = ["cash", "instapay", "card"];
export const normalizeHandInPayments = (payments, net) => {
  if (!payments || typeof payments !== "object") return { cash: round2(net), instapay: 0, card: 0 };
  const split = Object.fromEntries(LOCAL_COURIER_PAYMENT_METHODS.map((method) => [method, round2(payments[method])]));
  if (Object.values(split).some((value) => !Number.isFinite(value) || value < 0)) throw httpError(400, "INVALID_PAYMENTS", "المبالغ لازم تكون أرقام صفر أو أكتر");
  const total = round2(split.cash + split.instapay + split.card);
  if (Math.abs(total - round2(net)) > 0.009) {
    throw httpError(400, "PAYMENTS_MISMATCH", `الكاش + انستا باي + فيزا (${total.toFixed(2)}) لازم يساوي الصافي (${round2(net).toFixed(2)})`, { total, net: round2(net) });
  }
  return split;
};

export const createLocalCourierSettlement = async ({ tenantId = null, orderIds = [], feesAmount = null, shiftId = null, payments = null, notes = "", createdBy = null } = {}) => {
  if (tenantId === null || tenantId === undefined) throw httpError(400, "TENANT_REQUIRED", "tenant_id is required");
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw httpError(400, "NO_ORDERS_SELECTED", "اختار الأوردرات اللي المندوب سلّم فلوسها");
  if (!toNumberOrNull(createdBy)) throw httpError(400, "USER_REQUIRED", "لازم تكون داخل بحساب مستخدم");
  // DDL before the transaction: inside it, ALTER TABLE waits on the transaction's own row locks.
  await ensureAccountingSchema();
  await ensureCourierSettlementSchema();
  await ensureCourierCostSchema();
  await ensureLocalCourierSchema();
  // Created outside the transaction: its INSERT is wrapped in a catch, and a failed statement
  // inside a transaction would abort it and turn the COMMIT into a silent rollback.
  await expenseCategoryId(db, Number(tenantId), LOCAL_COURIER_EXPENSE_CATEGORY);
  const settings = await getLocalCourierSettings({ tenantId });
  const fees = feesAmount === null || feesAmount === undefined || feesAmount === "" ? round2(settings.fee_per_order * ids.length) : round2(feesAmount);
  if (!Number.isFinite(Number(fees)) || fees < 0) throw httpError(400, "INVALID_FEE", "أجرة المندوب لازم تكون رقم صفر أو أكتر");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const rows = (await client.query(
      `SELECT * FROM orders WHERE id = ANY($1::bigint[]) AND (tenant_id = $2 OR tenant_id IS NULL) ORDER BY id FOR UPDATE`,
      [ids, Number(tenantId)]
    )).rows;
    const numberOf = (row) => row.public_order_number || row.invoice_number || row.id;
    if (rows.length !== ids.length) throw httpError(404, "order_not_found", "فيه أوردرات مش موجودة");
    const wrong = rows.filter((row) => providerOf(row) !== LOCAL_COURIER_PROVIDER || !row.courier_collected_at);
    if (wrong.length) throw httpError(409, "NOT_COLLECTED", `الأوردرات دي مش متسلمة مع المندوب: ${wrong.map(numberOf).join(", ")}`);
    const settled = rows.filter((row) => row.courier_settlement_id);
    if (settled.length) throw httpError(409, "ALREADY_SETTLED", `الأوردرات دي اتسوّت قبل كده: ${settled.map(numberOf).join(", ")}`);
    const gross = round2(rows.reduce((sum, row) => sum + (Number(row.courier_collected_amount) || 0), 0));
    const net = round2(gross - fees);
    if (net < 0) throw httpError(400, "FEES_EXCEED", "أجرة المندوب أكبر من الفلوس اللي حصّلها");
    const split = normalizeHandInPayments(payments, net);
    // Only cash needs a drawer; an all-InstaPay hand-in never touches one.
    let shift = null;
    if (split.cash > 0) {
      if (!toNumberOrNull(shiftId)) throw httpError(400, "SHIFT_REQUIRED", "اختار الوردية اللي الكاش هيدخل درجها");
      shift = (await client.query(
        `SELECT id, branch_id FROM cash_drawer_shifts WHERE id = $1 AND tenant_id = $2 AND status = 'open' FOR UPDATE`,
        [Number(shiftId), Number(tenantId)]
      )).rows[0];
      if (!shift) throw httpError(409, "SHIFT_CLOSED", "الوردية دي اتقفلت — اختار وردية مفتوحة");
    }
    const when = new Date();

    const settlement = (await client.query(
      `
      INSERT INTO courier_settlements (tenant_id, provider, reference, settled_at, gross_amount, fees_amount, net_amount, orders_count, notes, created_by, expected_fees_amount, payment_breakdown)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      RETURNING *
      `,
      [Number(tenantId), LOCAL_COURIER_PROVIDER, shift ? `shift:${shift.id}` : null, when.toISOString(), gross, fees, net, ids.length, text(notes) || null, Number(createdBy), round2(settings.fee_per_order * ids.length), JSON.stringify(split)]
    )).rows[0];
    let allocated = 0;
    for (const [index, row] of rows.entries()) {
      const share = index === rows.length - 1 ? round2(fees - allocated) : round2(fees / rows.length);
      allocated = round2(allocated + share);
      await client.query(
        `INSERT INTO courier_settlement_items (settlement_id, order_id, collected_amount, fee_amount) VALUES ($1, $2, $3, $4)`,
        [settlement.id, row.id, round2(row.courier_collected_amount), share]
      );
    }
    const event = { at: when.toISOString(), action: "courier_settled", provider: LOCAL_COURIER_PROVIDER, settlement_id: settlement.id, shift_id: shift?.id || null, payments: split };
    await client.query(
      `UPDATE orders SET courier_settlement_id = $2, courier_settled_at = $3, shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $4::jsonb, updated_at = NOW() WHERE id = ANY($1::bigint[])`,
      [ids, settlement.id, when.toISOString(), JSON.stringify([event])]
    );
    // The courier kept his fee, so the methods add up to the net. Cash physically lands in the
    // drawer; InstaPay and card land on the account each method maps to.
    if (split.cash > 0) {
      await recordCashDrawerEvent(client, {
        tenantId: Number(tenantId),
        shiftId: shift.id,
        branchId: shift.branch_id,
        eventType: "cash_in",
        sourceType: "courier_settlement",
        sourceId: settlement.id,
        amount: split.cash,
        createdBy: Number(createdBy),
        requireOpenShift: true,
      });
    }
    for (const method of ["instapay", "card"]) {
      if (!(split[method] > 0)) continue;
      await recordFinancialAccountActivity(client, {
        tenantId: Number(tenantId),
        branchId: shift?.branch_id || null,
        paymentMethod: method,
        entryType: "in",
        sourceType: "courier_settlement",
        sourceId: settlement.id,
        amount: split[method],
        notes: `${courierLabel(settings)} — تسوية #${settlement.id} (${method === "card" ? "فيزا" : "انستا باي"})`,
        createdBy: Number(createdBy),
        idempotent: false,
      });
    }
    // His fee is a cost of the shop; the profit report reads only the expenses table.
    let feeExpenseId = null;
    if (fees > 0) {
      feeExpenseId = await upsertCourierExpense(client, {
        tenantId: Number(tenantId),
        amount: fees,
        title: `أجرة ${courierLabel(settings)} — ${ids.length} أوردر — تسوية #${settlement.id}`,
        day: new Intl.DateTimeFormat("en-CA", { timeZone: getAppTimeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(when),
        notes: "قيد تلقائي: المندوب خصم أجرته من فلوس الأوردرات قبل ما يسلّمها للدرج.",
        paymentMethod: "cash",
        category: LOCAL_COURIER_EXPENSE_CATEGORY,
      });
      if (feeExpenseId) await client.query(`UPDATE courier_settlements SET fee_expense_id = $2 WHERE id = $1`, [settlement.id, feeExpenseId]);
    }
    await client.query("COMMIT");
    return { ...settlement, fee_expense_id: feeExpenseId, order_ids: ids, shift_id: shift?.id || null, payments: split };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
