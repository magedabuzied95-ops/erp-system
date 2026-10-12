import db from "../../database/db.js";
import { resolveCodPolicy, resolveGovernorateId } from "../../../shared/codPolicy.js";
import { isOnlineShippingOrder } from "./onlineOrderSql.js";
import { isExternalMarketplaceOrder } from "../amazon/amazonOrderGuards.js";
import { exchangeParcelContextOf } from "../orders/exchangeParcel.js";

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

// Free shipping owes the order confirmation fee only where a courier fee was ever on the
// table: a till sale, a pickup, an Amazon order and an exchange parcel also carry a zero fee,
// and none of them is "free shipping".
export const confirmationFeeExempt = (order = {}) =>
  !isOnlineShippingOrder(order)
  || isExternalMarketplaceOrder(order)
  || ["pickup", "store_pickup"].includes(text(order.shipping_provider || order.shipping_method).toLowerCase())
  || Boolean(exchangeParcelContextOf(order));

export const DEPOSIT_REQUEST_TIMELINE_ACTION = "deposit_requested";
export const SHIPPING_FEE_WAIVED_TIMELINE_ACTION = "shipping_fee_waived";

/**
 * What a person decided about this order's advance, kept on the order's timeline so neither
 * decision needs a column of its own (production takes no runtime DDL): a deposit staff asked
 * for by hand, or a waiver — this customer ships now and the courier collects everything at
 * the door. The NEWEST entry wins, so asking for a deposit after a waiver asks again, and
 * waiving after an ask drops the ask. Null when nobody touched it and the closing system alone
 * decides.
 */
const advanceOverrideOf = (order = {}) => {
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const action = text(timeline[index]?.action);
    if (action === SHIPPING_FEE_WAIVED_TIMELINE_ACTION) return { waived: true, amount: 0 };
    if (action === DEPOSIT_REQUEST_TIMELINE_ACTION) {
      const asked = money(timeline[index]?.amount);
      const total = orderTotal(order);
      return { waived: false, amount: total > 0 ? Math.min(asked, total) : asked };
    }
  }
  return null;
};

/** A deposit staff asked for; 0 when they asked for none, or waived the advance afterwards. */
export const requestedDepositAmount = (order = {}) => {
  const override = advanceOverrideOf(order);
  return override && !override.waived ? override.amount : 0;
};

/** Staff said this one ships without the advance the closing system asks for. */
export const shippingFeeAdvanceWaived = (order = {}) => advanceOverrideOf(order)?.waived === true;

/**
 * status: "not_required" | "awaiting_payment" | "awaiting_review" | "paid" | "waived"
 * `awaiting_review` is a transfer the customer says they made (a screenshot) that no
 * one has approved yet — it does not open the gate.
 * `waived` is staff skipping the advance for this order: nothing is owed up front and no
 * money is recorded, so every screen, badge and customer message goes quiet while the
 * courier still collects the full amount (see `waiveShippingFeeAdvance`).
 */
export const describeShippingFeeAdvance = ({ order = {}, city = null, policy } = {}) => {
  const shippingFee = orderShippingFee(order);
  const cod = resolveCodPolicy({
    policy,
    governorate: orderGovernorate(order, city),
    governorateId: order.governorate_id,
    shippingFee,
    orderTotal: orderTotal(order),
    confirmationFeeExempt: confirmationFeeExempt(order),
  });
  const paid = money(order.paid_amount);
  const override = advanceOverrideOf(order);
  // Waived: no money changed hands and none is owed before the parcel leaves. Reported as its
  // own status rather than "not_required" so a screen can say WHY the fee card is gone.
  if (override?.waived) return { required: false, status: "waived", waived: true, amount: 0, paid_amount: paid };
  const deposit = override ? override.amount : 0;
  // The policy asks for the shipping fee; a person can ask for more (or ask at all, under the
  // open system). Whichever is larger is what this order owes before it moves.
  const amount = Math.max(cod.cod_allowed ? 0 : cod.advance_amount, deposit);
  if (!(amount > 0)) return { required: false, status: "not_required", amount: 0, paid_amount: paid };
  // "confirmation_fee" when the policy's share of it is the confirmation fee, so every screen
  // and message can call the money by its name.
  const kind = !cod.cod_allowed && cod.advance_kind === "confirmation_fee" ? "confirmation_fee" : "shipping_fee";
  const proofStatus = text(order.transfer_proof_status).toLowerCase();
  const verified = !proofStatus || proofStatus === "approved";
  const covered = paid + 0.009 >= amount;
  const status = covered && verified ? "paid" : proofStatus === "pending" ? "awaiting_review" : "awaiting_payment";
  return { required: true, status, kind, amount, paid_amount: paid, requested_deposit: deposit };
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
    // Free shipping has no shipping fee to record; what the customer paid is the confirmation fee.
    let fee = Math.min(orderShippingFee(order), total);
    let confirmationFee = false;
    if (fee <= 0) {
      const { loadCodPolicySettings } = await import("../../services/storefrontShippingService.js");
      const advance = describeShippingFeeAdvance({ order, policy: await loadCodPolicySettings() });
      if (advance.kind === "confirmation_fee") {
        fee = Math.min(advance.amount, total);
        confirmationFee = true;
      }
    }
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
      label: confirmationFee ? "تم دفع رسوم تأكيد الأوردر" : "تم دفع الشحن",
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

/**
 * "اشحن من غير تحويل": skip the advance on ONE order — a customer the owner trusts, or one who
 * settled it off the books. The exact opposite of markShippingFeePaid, which records money and
 * therefore LOWERS what the courier collects: that is the one thing that must not happen here.
 * Nothing is added to paid_amount, nothing is marked verified, no receipt is sent to the
 * customer; cod_amount is rewritten to everything still owed, so the parcel leaves carrying the
 * full collection. The order stays where it is in the flow — money only, like its opposite.
 */
export const waiveShippingFeeAdvance = async ({ orderId, tenantId = null, note = "", actorName = "", source = "orders", policy: givenPolicy = null, client: givenClient = null } = {}) => {
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
      throw httpError(409, "ORDER_LOCKED", "الأوردر ده مقفول.");
    }
    if (shippingFeeAdvanceWaived(order)) throw httpError(409, "ALREADY_WAIVED", "المقدّم متخطّي على الأوردر ده خلاص.");
    const policy = givenPolicy || (await (await import("../../services/storefrontShippingService.js")).loadCodPolicySettings());
    const advance = describeShippingFeeAdvance({ order, policy });
    if (advance.status === "paid") throw httpError(409, "ALREADY_PAID", "الأوردر ده دفع المقدّم خلاص، مفيش حاجة تتخطّى.");
    if (!advance.required) throw httpError(409, "ADVANCE_NOT_REQUIRED", "الأوردر ده مش مطلوب منه مقدّم.");
    const total = orderTotal(order);
    // Everything still owed goes on the parcel. On a website order the checkout had already
    // taken the fee off (cod_amount = total - fee) in the expectation of a transfer that is
    // now never coming, so this line is what stops the fee being lost at the door.
    const owed = Math.max(0, money(total - money(order.paid_amount)));
    // Bosta keeps the amount it was booked with, so raising the collection after the parcel
    // exists would promise money nobody collects (mirrors FULL_PAYMENT_AFTER_SHIPMENT).
    const booked = text(order.tracking_number || order.shipping_tracking_number || order.shipping_provider_delivery_id);
    if (booked && Math.abs(owed - money(order.cod_amount)) > 0.009) {
      throw httpError(409, "WAIVE_AFTER_SHIPMENT", "الشحنة محجوزة بمبلغ تحصيل أقل، عدّل التحصيل من الشحنة نفسها.");
    }
    const timelineEntry = JSON.stringify([{
      action: SHIPPING_FEE_WAIVED_TIMELINE_ACTION,
      status: text(order.status),
      note: text(note),
      source,
      actor: actorName,
      label: advance.kind === "confirmation_fee" ? "تخطّي رسوم تأكيد الأوردر" : "تخطّي رسوم الشحن",
      // What was skipped, for the record. Read by nothing: only a deposit ask carries a
      // demand, and this entry retires that ask rather than making one.
      amount: advance.amount,
      at: new Date().toISOString(),
    }]);
    const result = await client.query(
      `
      UPDATE orders
      SET cod_amount = $2,
          remaining_amount = $2,
          timeline = COALESCE(timeline, '[]'::jsonb) || $3::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [order.id, owed, timelineEntry]
    );
    if (ownsClient) await client.query("COMMIT");
    console.info("[shipping-fee-advance] waived", { orderId: order.id, skipped: advance.amount, collect_on_delivery: owed, source, actor: actorName });
    return result.rows[0];
  } catch (error) {
    if (ownsClient) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
};
