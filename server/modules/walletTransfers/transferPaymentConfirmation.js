import { processOrderLoyalty } from "../../services/loyaltyService.js";

// Approving a transfer is one act whoever does it: a person on the order page, or the
// Vodafone Cash SMS matching the order by itself. Both land here so the order ends in
// the same state and earns loyalty the same way. The caller owns the transaction
// (loyalty runs in a savepoint) and has already decided the transfer is real.
// `fullOrder`: staff checked the screenshot and it covers the whole order, even though the customer
// uploaded it where the shipping-fee deposit goes (INV-1637) — nothing is left for the courier.
export const applyTransferPaymentConfirmation = async (client, { order, tenantId = null, loyaltyTenantId = null, userId = null, logTag = "orders.confirm-payment", fullOrder = false } = {}) => {
  const paymentMethod = String(order.payment_method || "").trim().toLowerCase();
  const totalAmount = Number(order.total_amount ?? order.total ?? order.total_price ?? 0);
  const shippingAmount = Number(order.shipping_fee ?? order.delivery_fee ?? order.service_fee ?? 0);
  const existingPaidAmount = Number(order.paid_amount || 0);
  const codAmount = Number(order.cod_amount || 0);
  const isCodShippingOnlyTransfer = ["cod", "cash_on_delivery", "cash on delivery"].includes(paymentMethod) && shippingAmount > 0 && totalAmount > shippingAmount;
  // The restricted closing system: the customer transferred the shipping fee and
  // the courier collects the goods (cod_amount). Approving it is not a full payment.
  const isShippingAdvanceTransfer = !isCodShippingOnlyTransfer && codAmount > 0 && codAmount < totalAmount;
  const nextPaidAmount = fullOrder
    ? Math.max(totalAmount, existingPaidAmount)
    : isCodShippingOnlyTransfer
    ? Math.min(totalAmount, Math.max(existingPaidAmount, shippingAmount))
    : isShippingAdvanceTransfer
      ? Math.min(totalAmount, Math.max(existingPaidAmount, totalAmount - codAmount))
      : Math.max(totalAmount, existingPaidAmount);
  const nextPaymentStatus = nextPaidAmount < totalAmount ? "partially_paid" : "paid";

  const result = await client.query(
    `
    UPDATE orders
    SET payment_status = $4,
        transfer_proof_status = 'approved',
        status = 'confirmed',
        paid_amount = $5,
        remaining_amount = GREATEST(COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) - $5::numeric, 0),
        -- A stored cod_amount wins at Bosta, so it has to follow the payment down:
        -- a COD order that paid its shipping would otherwise collect the fee twice.
        cod_amount = GREATEST(COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) - $5::numeric, 0),
        shipping_payment_verified_at = NOW(),
        shipping_payment_verified_by = $2,
        updated_at = NOW()
    WHERE id = $1
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint OR tenant_id IS NULL)
    RETURNING *
    `,
    [order.id, userId, tenantId, nextPaymentStatus, nextPaidAmount]
  );
  const updated = result.rows[0];
  if (!updated) return { order: null, loyalty: { earned: false, reason: "not_found" }, warning: null };

  const effectiveTenantId = updated.tenant_id ?? order.tenant_id ?? loyaltyTenantId ?? tenantId ?? null;
  console.log(`[${logTag}] loyalty tenant context`, {
    order_id: updated.id,
    order_tenant_id: updated.tenant_id ?? order.tenant_id ?? null,
    final_tenant_id: effectiveTenantId,
  });
  let loyalty = { earned: false, reason: "skipped" };
  let warning = null;
  if (effectiveTenantId === undefined || effectiveTenantId === null || String(effectiveTenantId).trim() === "") {
    warning = "Loyalty skipped: missing tenant_id";
    console.warn(`[${logTag}] loyalty skipped missing tenant`, { order_id: updated.id });
    return { order: updated, loyalty, warning };
  }

  await client.query("SAVEPOINT confirm_payment_loyalty");
  try {
    loyalty = await processOrderLoyalty(client, {
      tenantId: effectiveTenantId,
      orderId: updated.id,
      customerId: updated.customer_id,
      orderTotal: updated.total_amount || updated.total || updated.total_price || 0,
      paidAmount: updated.paid_amount || updated.total_amount || updated.total || 0,
      status: updated.status,
      paymentStatus: updated.payment_status,
      userId,
    });
    if (loyalty?.reason === "missing_tenant") warning = "Loyalty skipped: missing tenant_id";
    await client.query("RELEASE SAVEPOINT confirm_payment_loyalty");
  } catch (loyaltyError) {
    await client.query("ROLLBACK TO SAVEPOINT confirm_payment_loyalty");
    await client.query("RELEASE SAVEPOINT confirm_payment_loyalty");
    warning = loyaltyError?.message || "Loyalty failed";
    loyalty = { earned: false, reason: "loyalty_failed", error: warning };
    console.error(`[${logTag}] loyalty failed; payment confirmation will still commit`, {
      order_id: updated.id,
      final_tenant_id: effectiveTenantId,
      message: warning,
    });
  }
  return { order: updated, loyalty, warning };
};
