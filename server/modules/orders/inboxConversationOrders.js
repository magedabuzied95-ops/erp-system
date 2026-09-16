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

// An exchange can only be offered on goods the customer actually has, or is about to:
// there is nothing for the courier to swap on an order still sitting in the shop, and a
// cancelled or fully returned one has nothing left to give back.
const ORDER_OPEN_TO_EXCHANGE = new Set(["shipped", "out_for_delivery", "delivered", "completed", "partially_returned"]);

// A parcel is booked for an order the shop has agreed to send. Offering it on a draft is
// how a half-written order ends up with a courier standing at the door.
const ORDER_READY_FOR_A_PARCEL = new Set(["confirmed", "processing", "ready", "ready_to_ship", "edit_requested"]);

// The lines of one order, lean enough to sit in a chat panel: enough to pick what comes
// back and to show the customer's own words for it.
export const projectInboxConversationOrderItem = (item = {}) => {
  const sold = Number(item.quantity || 0);
  const returned = Number(item.returned_quantity || 0);
  const lineTotal = money(item.total_amount ?? Number(item.unit_price || 0) * sold);
  return {
    id: item.id,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    product_name: text(item.product_name),
    color: text(item.color || item.variant_color),
    size: text(item.size || item.variant_size),
    image_url: text(item.image_url || item.product_image || item.image),
    quantity: sold,
    returned_quantity: returned,
    returnable_quantity: Math.max(0, sold - returned),
    unit_price: money(item.unit_price ?? (sold > 0 ? lineTotal / sold : 0)),
    total_amount: lineTotal,
  };
};

/**
 * One order as the inbox panel needs it: what is owed, what the courier collects, and which
 * of the two payment questions is still open (a transfer waiting on review, a confirmation
 * nobody sent). Pure, so the rules are testable without a database.
 */
export const projectInboxConversationOrder = ({ order = {}, policy = null, items = [] } = {}) => {
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
    items: (Array.isArray(items) ? items : []).map(projectInboxConversationOrderItem),
    is_exchange: Boolean(order.exchange_mode),
    // One parcel per order: the button goes away the moment a tracking number exists,
    // because a second create is a second van for the same box.
    can_create_shipment: ORDER_READY_FOR_A_PARCEL.has(status) && !text(order.tracking_number),
    can_print_label: Boolean(text(order.tracking_number)),
    // The replacement order of an exchange is not itself exchangeable until it lands, and
    // an order with every line already returned has nothing left to swap.
    can_exchange:
      ORDER_OPEN_TO_EXCHANGE.has(status)
      && Boolean(order.customer_id)
      && (Array.isArray(items) ? items : []).some((item) => Number(item.quantity || 0) - Number(item.returned_quantity || 0) > 0),
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
  // One query for every card's lines: the exchange sheet picks the piece that comes back
  // straight from the panel, with no second trip for an order already on screen.
  const itemsResult = await db.query(
    `SELECT * FROM order_items WHERE order_id = ANY($1::bigint[]) ORDER BY id ASC`,
    [result.rows.map((order) => order.id)]
  );
  const itemsByOrder = new Map();
  for (const item of itemsResult.rows) {
    const key = String(item.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(item);
  }
  return result.rows.map((order) => projectInboxConversationOrder({ order, policy, items: itemsByOrder.get(String(order.id)) || [] }));
};
