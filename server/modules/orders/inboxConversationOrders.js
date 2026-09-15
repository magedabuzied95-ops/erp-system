import db from "../../database/db.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../../utils/phoneSearch.js";
import { describeShippingFeeAdvance } from "../shipping/shippingFeeAdvance.js";
import { loadCodPolicySettings } from "../../services/storefrontShippingService.js";

// The orders a staff member can act on from the AI Inbox: everything this customer has,
// not only what the bot drafted — the sale often starts on the website and finishes in chat.

const text = (value = "") => String(value ?? "").trim();
const money = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 100) / 100 : 0;
};

const ORDER_OPEN_TO_CONFIRMATION = new Set(["", "pending", "new", "created", "draft", "ai_draft", "processing", "confirmed", "edit_requested"]);

/**
 * One order as the inbox panel needs it: what is owed, what the courier collects, and which
 * of the two payment questions is still open (a transfer waiting on review, a confirmation
 * nobody sent). Pure, so the rules are testable without a database.
 */
export const projectInboxConversationOrder = ({ order = {}, policy = null } = {}) => {
  const total = money(order.total_amount ?? order.total ?? order.total_price);
  const paid = money(order.paid_amount);
  const advance = describeShippingFeeAdvance({ order, policy });
  const storedCod = money(order.cod_amount);
  const owed = Math.max(0, money(total - paid));
  const collectOnDelivery = storedCod > 0 ? Math.min(storedCod, owed) : owed;
  const proofStatus = text(order.transfer_proof_status).toLowerCase();
  const status = text(order.status).toLowerCase();
  return {
    id: order.id,
    invoice_number: text(order.invoice_number) || text(order.public_order_number) || `INV-${order.id}`,
    status: text(order.status),
    created_at: order.created_at || null,
    customer_name: text(order.customer_name),
    customer_phone: text(order.customer_phone),
    total_amount: total,
    shipping_fee: money(order.shipping_fee ?? order.delivery_fee ?? order.service_fee),
    paid_amount: paid,
    collect_on_delivery: collectOnDelivery,
    payment_status: text(order.payment_status),
    transfer_proof_status: proofStatus,
    has_payment_proof: Boolean(text(order.shipping_payment_screenshot)),
    awaiting_payment_review: proofStatus === "pending" && Boolean(text(order.shipping_payment_screenshot)),
    shipping_fee_advance: advance,
    tracking_number: text(order.tracking_number),
    shipment_status: text(order.shipment_status || order.shipping_status),
    customer_confirmed_at: order.customer_confirmed_at || null,
    can_send_confirmation: ORDER_OPEN_TO_CONFIRMATION.has(status) && !text(order.tracking_number),
  };
};

export const listInboxConversationOrders = async ({ tenantId = null, sessionId = "", phone = "", limit = 5 } = {}) => {
  const safeSession = text(sessionId);
  const phoneKey = canonicalPhoneKey(phone);
  if (!safeSession && !phoneKey) return [];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 5), 20);
  const result = await db.query(
    `
    SELECT *
    FROM orders o
    WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint OR o.tenant_id IS NULL)
      AND (
        ($2 <> '' AND o.ai_agent_conversation_id = $2)
        OR ($3 <> '' AND ${canonicalPhoneSql("o.customer_phone")} = $3)
      )
    ORDER BY o.created_at DESC
    LIMIT $4
    `,
    [tenantId, safeSession, phoneKey, safeLimit]
  );
  if (!result.rows.length) return [];
  const policy = await loadCodPolicySettings();
  return result.rows.map((order) => projectInboxConversationOrder({ order, policy }));
};
