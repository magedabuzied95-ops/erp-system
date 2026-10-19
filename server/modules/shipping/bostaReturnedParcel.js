import db from "../../database/db.js";
import { exchangeParcelContextOf } from "../orders/exchangeParcel.js";

// A parcel Bosta hands back to the shop (state 46 "Returned to business", 60 "Returned to
// stock") is the sale undone: the goods are on our shelf again. Before this, the courier's
// "returned" only moved shipping_status — the order kept saying "جاهز للشحن", the pieces
// stayed out of stock, and nothing recorded when the parcel came back (owner, 2026-10-19,
// INV-2074). Now the order is cancelled through the ERP's own cancelOrder — the same stock
// restore, loyalty, coupon, money reversal and manager alert as cancelling from the Orders
// page — and the return is stamped on the order with its date.
//
// Only "returned" restocks. Bosta's "cancelled" (49) is a parcel that never left, and the
// shop cancels a parcel to re-issue it; "terminated" (48) is still in Bosta's hands and
// reaches 46 once it is back with us.

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const createMockResponse = () => {
  let resolve;
  const done = new Promise((finish) => { resolve = finish; });
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(payload) { this.headersSent = true; resolve({ statusCode: this.statusCode, payload }); return payload; },
    send(payload) { this.headersSent = true; resolve({ statusCode: this.statusCode, payload }); return payload; },
  };
  return { res, done };
};

const invokeHandler = async (handler, req) => {
  const { res, done } = createMockResponse();
  const running = Promise.resolve(handler(req, res));
  const result = await Promise.race([done, running.then(() => null)]);
  await running.catch(() => {});
  return result || { statusCode: 500, payload: { message: "cancelOrder returned without answering" } };
};

export const RETURNED_TO_STORE_REASON = "الشحنة رجعت من بوسطة للمحل — اتلغت والمخزون رجع";

// No users row behind the courier: user id stays null, and the role is NOT super_admin
// (that would drop tenant scoping inside cancelOrder).
const courierRequest = (order) => ({
  params: { id: String(order.id) },
  body: { reason: RETURNED_TO_STORE_REASON },
  query: {},
  headers: {},
  tenantId: order.tenant_id ?? null,
  user: { id: null, tenant_id: order.tenant_id ?? null, tenantId: order.tenant_id ?? null, role: "system", name: "بوسطة" },
});

const defaultDeps = {
  cancelHandler: async (req) => {
    // cancelOrder reverses money through accountingService; its first-ever call runs an
    // ALTER TABLE orders that deadlocks cancelOrder's own row lock (see
    // shipping.portal.manage.js). Awaiting the memoised schema first keeps this safe.
    await (await import("../../services/accountingService.js")).ensureAccountingSchema();
    return invokeHandler((await import("../../controllers/ordersController.js")).cancelOrder, req);
  },
  stamp: async ({ orderId, at, source }) => {
    const event = { action: "returned_to_store", provider: "bosta", status: "returned", source, at, label: "رجعت من بوسطة للمخزن" };
    await db.query(
      `UPDATE orders SET
         shipping_status = 'returned',
         shipment_status = 'returned',
         shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $2::jsonb,
         timeline = COALESCE(timeline, '[]'::jsonb) || $2::jsonb,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [orderId, JSON.stringify([event])]
    );
  },
};

// Why a returned parcel is left alone, or "" when it should be received.
export const returnedParcelSkipReason = (order = {}) => {
  if (!order?.id) return "no_order";
  if (order.deleted_at) return "deleted";
  if (order.cancelled_at || ["cancelled", "canceled"].includes(lower(order.status))) return "already_cancelled";
  if (order.stock_restored_at || order.stock_reverted_at || order.inventory_rollback_done === true) return "stock_already_restored";
  if (["delivered", "completed", "complete", "returned", "refunded", "fully_refunded"].includes(lower(order.status))) return "order_closed";
  // An exchange parcel carries a replacement out and the old piece back; its own return
  // row decides what lands on the shelf, so cancelling the order here would double it.
  if (exchangeParcelContextOf(order)) return "exchange_parcel";
  return "";
};

export const receiveReturnedBostaParcel = async (order = {}, { source = "bosta", at = null, deps: injected = {} } = {}) => {
  const deps = { ...defaultDeps, ...injected };
  const skip = returnedParcelSkipReason(order);
  if (skip) return { received: false, reason: skip };
  const { statusCode, payload } = await deps.cancelHandler(courierRequest(order));
  if (statusCode >= 400) {
    console.warn("[bosta-return] cancel refused", { orderId: order.id, statusCode, message: payload?.message });
    return { received: false, reason: "cancel_refused", message: payload?.message || "" };
  }
  // cancelOrder leaves the shipment columns alone; the stamp keeps them on "returned" and
  // records when the parcel came back, for the board and the order's history.
  await deps.stamp({ orderId: order.id, at: at || new Date().toISOString(), source });
  console.log("[bosta-return] parcel received back; order cancelled and stock restored", { orderId: order.id, source });
  return { received: true, order: payload?.order || null };
};
