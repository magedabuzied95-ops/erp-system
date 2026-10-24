/*
 * The messages staff send a customer about one order, in one place.
 *
 * Every one of them used to be its own button, route and controller (the confirmation on the
 * order page and the inbox, the receipt resend on the till), each with its own copy of "load the
 * order, call the service, never dress a refusal as a success". Now each is one entry here, sent
 * through one route: POST /orders/:id/messages/:key. Adding a message is adding an entry.
 *
 * The keys are the automation types of the template registry (server/services/whatsappTemplates.js),
 * so the message picked here is the same one the template studio edits and Meta approves.
 */

import db from "../../database/db.js";
import {
  ensureWhatsappOrderConfirmationSchema,
  sendInvoiceWhatsapp,
  sendOrderConfirmation,
} from "../../services/whatsappOrderConfirmationService.js";
import { isWhatsappNumberMissingError, WHATSAPP_NUMBER_MISSING_MESSAGE } from "../../utils/whatsappNotOnNumber.js";

// What stops any send, whichever message it is. The reason code travels with the Arabic text so
// the page can translate it instead of showing a bare failure.
const SHARED_FAILURES = Object.freeze({
  order_missing: "الطلب غير موجود",
  missing_phone: "لا يوجد رقم واتساب مسجل لهذا العميل",
  gateway_error: "تعذر الإرسال عبر واتساب. تأكد أن رقم المتجر متصل.",
  not_on_whatsapp: WHATSAPP_NUMBER_MISSING_MESSAGE,
});

export const ORDER_MESSAGES = Object.freeze({
  order_confirmation: Object.freeze({
    key: "order_confirmation",
    // A tap on what this sends can confirm, edit or cancel the order, so viewing is not enough.
    permission: Object.freeze(["orders", "edit"]),
    sentAtColumn: "whatsapp_confirmation_sent_at",
    send: (order) => sendOrderConfirmation(order, { force: true }),
    failures: Object.freeze({
      ...SHARED_FAILURES,
      order_already_dispatched: "الطلب خرج للشحن بالفعل، لا يمكن طلب تأكيده من العميل",
      status_not_confirmable: "حالة الطلب لا تسمح بطلب تأكيد من العميل",
    }),
    fallbackFailure: "تعذر إرسال رسالة التأكيد على واتساب",
    sentMessage: "تم إرسال رسالة التأكيد على واتساب",
    queuedMessage: "تم إدراج رسالة التأكيد في طابور الإرسال",
  }),
  invoice_receipt: Object.freeze({
    key: "invoice_receipt",
    // Re-sending a receipt is the digital twin of reprinting it, so it sits behind the same
    // grant - the cashier who can hand the paper slip over again can resend the link.
    permission: Object.freeze(["orders", "view"]),
    sentAtColumn: "whatsapp_invoice_sent_at",
    send: (order) => sendInvoiceWhatsapp(order, { force: true }),
    failures: Object.freeze({
      ...SHARED_FAILURES,
      order_missing: "الفاتورة غير موجودة",
      missing_invoice_number: "الفاتورة بدون رقم، لا يمكن إرسالها",
      missing_invoice_url: "تعذر تجهيز رابط الفاتورة",
      cancelled_order: "لا يمكن إعادة إرسال فاتورة ملغاة",
    }),
    fallbackFailure: "تعذر إرسال الفاتورة على واتساب",
    sentMessage: "تم إرسال الفاتورة على واتساب",
    queuedMessage: "تم إدراج الفاتورة في طابور الإرسال",
  }),
});

export const orderMessageOf = (key) => (Object.hasOwn(ORDER_MESSAGES, String(key || "")) ? ORDER_MESSAGES[key] : null);

export const orderMessageFailure = (entry, reason) => entry?.failures?.[reason] || entry?.fallbackFailure || "تعذر إرسال الرسالة على واتساب";

// tenantId null is the super admin, who reaches every tenant's orders.
const loadOrder = async ({ orderId, tenantId }) => {
  // The sent-at columns are added by the WhatsApp schema, which may not have run yet.
  await ensureWhatsappOrderConfirmationSchema();
  const sentAt = Object.values(ORDER_MESSAGES).map((entry) => `, o.${entry.sentAtColumn}`).join("");
  const found = await db.query(
    `
    SELECT o.id, o.invoice_number, o.customer_name, o.customer_phone, o.status, o.source, o.channel${sentAt}
    FROM orders o
    WHERE o.id = $1
      AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
    LIMIT 1
    `,
    [orderId, tenantId]
  );
  return found.rows[0] || null;
};

// A non-numeric id would blow up inside Postgres and come back as a 5xx, which the browser then
// reports as a CORS failure. Answer it as the missing order it is.
const validOrderId = (orderId) => /^\d+$/.test(String(orderId || ""));

/* The picker's list: every message this order can carry, with when it last went out. */
export const listOrderMessages = async ({ orderId, tenantId }) => {
  const order = validOrderId(orderId) ? await loadOrder({ orderId, tenantId }) : null;
  if (!order) return null;
  return Object.values(ORDER_MESSAGES).map((entry) => ({
    key: entry.key,
    permission: entry.permission.join("."),
    last_sent_at: order[entry.sentAtColumn] || null,
  }));
};

/*
 * Sends one message and answers { status, body } for the route to return as-is. A refusal is a
 * 400 with a reason, never a 5xx (it reaches the browser as an opaque CORS error) and never a 200.
 */
export const sendOrderMessage = async ({ key, orderId, tenantId, user = null }) => {
  const entry = orderMessageOf(key);
  if (!entry) return { status: 404, body: { success: false, sent: false, reason: "unknown_message", message: "نوع الرسالة غير معروف" } };
  const refuse = (status, reason, extra = {}) => ({
    status,
    body: { success: false, sent: false, key: entry.key, reason, message: orderMessageFailure(entry, reason), ...extra },
  });

  if (!validOrderId(orderId)) return refuse(404, "order_missing");
  const order = await loadOrder({ orderId, tenantId });
  if (!order) return refuse(404, "order_missing");

  const logContext = {
    key: entry.key,
    order_id: order.id,
    invoice_number: order.invoice_number || "",
  };
  console.info("[whatsapp:order-message-requested]", {
    ...logContext,
    status: order.status || "",
    user_id: user?.id || null,
    user_name: user?.name || "",
    tenant_id: tenantId,
    phone_suffix: String(order.customer_phone || "").slice(-4),
  });

  let result;
  try {
    result = await entry.send(order);
  } catch (gatewayError) {
    // The gateway refusing us is an outcome the operator has to read, not a server fault.
    console.error("[whatsapp:order-message-failed]", {
      ...logContext,
      message: gatewayError?.message || String(gatewayError),
      code: gatewayError?.code || "",
      status: gatewayError?.status || "",
    });
    const reason = isWhatsappNumberMissingError(gatewayError) ? "not_on_whatsapp" : "gateway_error";
    return refuse(400, reason, { error: gatewayError?.message || String(gatewayError) });
  }

  // The outbound queue is a normal path, so a queued message IS a success: it is recorded, paced
  // and retried. Only a service that declined outright is a failure - and it declines by
  // answering, not throwing, so that answer has to surface here.
  const queued = Boolean(result?.queued);
  if (!result?.sent && !queued) {
    const reason = result?.reason || "unknown";
    console.warn("[whatsapp:order-message-skipped]", { ...logContext, reason });
    return refuse(400, reason);
  }

  return {
    status: 200,
    body: {
      success: true,
      sent: true,
      queued,
      key: entry.key,
      invoice_number: order.invoice_number || "",
      customer_phone: order.customer_phone || "",
      invoice_url: result?.invoiceUrl || "",
      message: queued ? entry.queuedMessage : entry.sentMessage,
    },
  };
};
