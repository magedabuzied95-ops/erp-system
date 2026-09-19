import { resolveCodPolicy } from "../../../shared/codPolicy.js";
import { collectOnDeliveryAmount } from "../../utils/orderConfirmationMessage.js";
import { buildShippingFeeAdvanceNotice } from "../codPolicyReplyService.js";
import { confirmationFeeExempt as orderIsConfirmationFeeExempt } from "../../modules/shipping/shippingFeeAdvance.js";

// The money half of the order emails, read the way every other surface reads it since
// 2026-09-15: what is collected on delivery is total - paid (never a stale cod_amount), a
// transfer is "under review" until someone approves it, and under the restricted closing
// system a governorate outside the COD list must transfer its shipping fee first.

const money = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 100) / 100 : 0;
};

const TRANSFER_METHODS = new Set(["instapay", "vodafone_cash", "transfer", "bank_transfer", "electronic"]);

/**
 * kind:
 *  "transfer_review"  — the customer uploaded a transfer (all or the shipping fee) nobody approved yet
 *  "advance_required" — cash on delivery outside the COD list: the fee must be transferred first
 *  "cod"              — pay on delivery
 *  "paid"             — nothing left to collect
 */
export const buildOrderEmailPayment = ({ order = {}, policy, transfer = {} } = {}) => {
  const total = money(order.total_amount ?? order.total_price ?? order.total);
  const shippingFee = money(order.shipping_fee ?? order.delivery_fee ?? order.service_fee);
  const method = String(order.payment_method || "").trim().toLowerCase();
  const proofStatus = String(order.transfer_proof_status || "").trim().toLowerCase();
  const paid = money(order.paid_amount);
  const storedCod = money(order.cod_amount);

  if (TRANSFER_METHODS.has(method) && proofStatus === "pending") {
    // Checkout stores a shipping-fee transfer as cod_amount = the goods left to collect.
    const transferred = storedCod > 0 && storedCod < total ? money(total - storedCod) : total;
    return { kind: "transfer_review", transferred, collect: money(total - transferred), total };
  }

  const collect = money(collectOnDeliveryAmount(order));
  if (collect <= 0) return { kind: "paid", collect: 0, paid, total };

  const confirmationFeeExempt = orderIsConfirmationFeeExempt(order);
  const cod = resolveCodPolicy({
    policy,
    confirmationFeeExempt,
    governorate: order.governorate || "",
    governorateId: order.governorate_id || "",
    shippingFee,
    orderTotal: total,
  });
  if (!cod.cod_allowed && paid + 0.009 < cod.advance_amount) {
    const notice = buildShippingFeeAdvanceNotice({ policy, governorate: order.governorate, governorateId: order.governorate_id, shippingFee, orderTotal: total, transfer, confirmationFeeExempt });
    return { kind: "advance_required", advance: cod.advance_amount, collect: money(total - cod.advance_amount), paid, total, notice };
  }
  return { kind: "cod", collect, paid, total };
};
