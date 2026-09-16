import db from "../../database/db.js";
import { applyTransferPaymentConfirmation } from "../walletTransfers/transferPaymentConfirmation.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

const TRANSFER_METHODS = new Set(["instapay", "vodafone_cash", "cash", "bank_transfer"]);
const CLOSED_STATUSES = new Set(["cancelled", "canceled", "returned", "delivered"]);
// Already past "new": approving the money must not move the order back to `confirmed`.
const KEEP_STATUSES = new Set(["ready_to_ship", "processing", "packed", "ready", "ready_for_shipping"]);

/**
 * Staff say the customer paid the WHOLE order (INV-1637: the full price transferred into the
 * shipping-deposit slot). Same approval the order page runs with scope "order_total", so
 * nothing is left for the courier to collect. Refused once a parcel exists: Bosta is not
 * re-priced, it would still collect the old amount.
 */
export const markOrderPaidInFull = async ({ orderId, tenantId = null, method = "", actorName = "", userId = null, source = "orders", client: givenClient = null } = {}) => {
  const client = givenClient || (await db.connect());
  const ownsClient = !givenClient;
  try {
    if (ownsClient) await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) FOR UPDATE`,
      [orderId, tenantId]
    );
    const order = locked.rows[0];
    if (!order) throw httpError(404, "order_not_found", "Order not found");
    if (CLOSED_STATUSES.has(lower(order.status))) throw httpError(409, "ORDER_LOCKED", "This order is closed");
    if (text(order.shipping_tracking_number) || text(order.tracking_number) || text(order.shipping_provider_delivery_id) || text(order.shipment_id)) {
      throw httpError(409, "FULL_PAYMENT_AFTER_SHIPMENT", "The courier is already booked for the old amount");
    }
    const confirmation = await applyTransferPaymentConfirmation(client, {
      order,
      tenantId,
      loyaltyTenantId: order.tenant_id ?? tenantId,
      userId,
      fullOrder: true,
      logTag: `${source}.order-paid-in-full`,
    });
    const paymentMethod = TRANSFER_METHODS.has(lower(method)) ? lower(method) : "";
    const timelineEntry = JSON.stringify([{
      action: "order_paid_in_full",
      status: KEEP_STATUSES.has(lower(order.status)) ? text(order.status) : "confirmed",
      note: paymentMethod,
      source,
      actor: actorName,
      label: "تم دفع الأوردر كامل",
      amount: Number(confirmation.order?.paid_amount) || 0,
      at: new Date().toISOString(),
    }]);
    const result = await client.query(
      `
      UPDATE orders
      SET status = CASE WHEN $2::text <> '' THEN $2::text ELSE status END,
          shipping_payment_method = COALESCE(NULLIF($3, ''), NULLIF(shipping_payment_method, ''), shipping_payment_method),
          timeline = COALESCE(timeline, '[]'::jsonb) || $4::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [order.id, KEEP_STATUSES.has(lower(order.status)) ? text(order.status) : "", paymentMethod, timelineEntry]
    );
    if (ownsClient) await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
};
