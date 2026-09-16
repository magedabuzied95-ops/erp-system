import db from "../../database/db.js";
import { resolveCodPolicy, resolveGovernorateId } from "../../../shared/codPolicy.js";

// The restricted closing system, seen from an order that already exists: does it owe
// its shipping fee before it may ship, and has that been paid? One answer for the
// Bosta gate, the order page, both portals' boards and the staff button.

const text = (value = "") => String(value ?? "").trim();
const money = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 100) / 100 : 0;
};

const orderTotal = (order = {}) => money(order.total_amount ?? order.total_price ?? order.total ?? 0);
const orderShippingFee = (order = {}) => money(order.shipping_fee ?? order.delivery_fee ?? order.service_fee ?? 0);

// The Bosta city is where the parcel actually goes; the typed governorate is next.
const orderGovernorate = (order = {}, city = null) =>
  [city?.name_en, city?.name_ar, order.shipping_city_name_en, order.shipping_city_name_ar, order.governorate]
    .find((name) => resolveGovernorateId(name)) || text(order.governorate);

export const DEPOSIT_REQUEST_TIMELINE_ACTION = "deposit_requested";

/**
 * A deposit staff asked for by hand, kept on the order's timeline so it needs no column of its
 * own (production takes no runtime DDL). The newest ask wins, and anything already paid retires
 * it — the closing system never demanded this money, a person did.
 */
export const requestedDepositAmount = (order = {}) => {
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index] || {};
    if (text(entry.action) !== DEPOSIT_REQUEST_TIMELINE_ACTION) continue;
    const asked = money(entry.amount);
    const total = orderTotal(order);
    return total > 0 ? Math.min(asked, total) : asked;
  }
  return 0;
};

/**
 * status: "not_required" | "awaiting_payment" | "awaiting_review" | "paid"
 * `awaiting_review` is a transfer the customer says they made (a screenshot) that no
 * one has approved yet — it does not open the gate.
 */
export const describeShippingFeeAdvance = ({ order = {}, city = null, policy } = {}) => {
  const shippingFee = orderShippingFee(order);
  const cod = resolveCodPolicy({
    policy,
    governorate: orderGovernorate(order, city),
    governorateId: order.governorate_id,
    shippingFee,
    orderTotal: orderTotal(order),
  });
  const paid = money(order.paid_amount);
  const deposit = requestedDepositAmount(order);
  // The policy asks for the shipping fee; a person can ask for more (or ask at all, under the
  // open system). Whichever is larger is what this order owes before it moves.
  const amount = Math.max(cod.cod_allowed ? 0 : cod.advance_amount, deposit);
  if (!(amount > 0)) return { required: false, status: "not_required", amount: 0, paid_amount: paid };
  const proofStatus = text(order.transfer_proof_status).toLowerCase();
  const verified = !proofStatus || proofStatus === "approved";
  const covered = paid + 0.009 >= amount;
  const status = covered && verified ? "paid" : proofStatus === "pending" ? "awaiting_review" : "awaiting_payment";
  return { required: true, status, amount, paid_amount: paid, requested_deposit: deposit };
};

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

const TRANSFER_METHODS = new Set(["instapay", "vodafone_cash", "cash", "bank_transfer"]);

/**
 * Staff record that the customer paid the shipping fee (a till order, an inbox order, an
 * AI draft — none of them carries a screenshot). The order's fulfilment status is not
 * touched; only the money: the fee moves into paid_amount and the courier collects the rest.
 */
export const markShippingFeePaid = async ({ orderId, tenantId = null, method = "", proofPath = "", reference = "", actorName = "", userId = null, source = "orders", client: givenClient = null } = {}) => {
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
    if (["cancelled", "canceled", "returned", "delivered"].includes(text(order.status).toLowerCase())) {
      throw httpError(409, "ORDER_LOCKED", "This order is closed");
    }
    const total = orderTotal(order);
    const fee = Math.min(orderShippingFee(order), total);
    if (fee <= 0) throw httpError(409, "NO_SHIPPING_FEE", "This order has no shipping fee to pay");
    const nextPaid = Math.min(total, Math.max(money(order.paid_amount), fee));
    const remaining = Math.max(0, money(total - nextPaid));
    const paymentMethod = TRANSFER_METHODS.has(text(method).toLowerCase()) ? text(method).toLowerCase() : "";
    const timelineEntry = JSON.stringify([{
      action: "shipping_fee_paid",
      status: text(order.status),
      note: [paymentMethod, reference].filter(Boolean).join(" · "),
      source,
      actor: actorName,
      label: "تم دفع الشحن",
      amount: fee,
      at: new Date().toISOString(),
    }]);
    const result = await client.query(
      `
      UPDATE orders
      SET paid_amount = $2,
          remaining_amount = $3,
          cod_amount = $3,
          payment_status = CASE WHEN $3::numeric > 0 THEN 'partially_paid' ELSE 'paid' END,
          transfer_proof_status = 'approved',
          shipping_payment_method = COALESCE(NULLIF($4, ''), NULLIF(shipping_payment_method, ''), shipping_payment_method),
          shipping_payment_screenshot = COALESCE(NULLIF($5, ''), shipping_payment_screenshot),
          shipping_payment_reference = COALESCE(NULLIF($6, ''), shipping_payment_reference),
          shipping_payment_verified_at = NOW(),
          shipping_payment_verified_by = $7,
          timeline = COALESCE(timeline, '[]'::jsonb) || $8::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [order.id, nextPaid, remaining, paymentMethod, text(proofPath), text(reference), userId, timelineEntry]
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
