/*
 * The messages staff send a customer about one order, in one place.
 *
 * Every one of them used to be its own button, route and controller (the confirmation on the
 * order page and the inbox, the receipt resend on the till, the payment card in the inbox), each
 * with its own copy of "load the order, call the service, never dress a refusal as a success".
 * Now each is one entry here, sent through one route: POST /orders/:id/messages/:key. Adding a
 * message is adding an entry.
 *
 * The keys are the automation types of the template registry (server/services/whatsappTemplates.js),
 * so the message picked here is the same one the template studio edits and Meta approves.
 * shipping_update is the exception: it is whichever of the shipping messages fits where the
 * parcel is now, so staff never pick "delivered" for a parcel still on the road.
 */

import db from "../../database/db.js";
import {
  ensureWhatsappOrderConfirmationSchema,
  sendInvoiceWhatsapp,
  sendOrderConfirmation,
} from "../../services/whatsappOrderConfirmationService.js";
import {
  ensureWhatsappShippingSchema,
  resendShipmentNotification,
  shipmentNotificationColumnFor,
  shipmentNotificationTypeFor,
} from "../../services/whatsappShippingService.js";
import { sendShippingFeePaymentRequest } from "../shipping/paymentProofLink.js";
import { isWhatsappNumberMissingError, WHATSAPP_NUMBER_MISSING_MESSAGE } from "../../utils/whatsappNotOnNumber.js";

// What stops any send, whichever message it is. The reason code travels with the Arabic text so
// the page can translate it instead of showing a bare failure.
const SHARED_FAILURES = Object.freeze({
  order_missing: "الطلب غير موجود",
  missing_phone: "لا يوجد رقم واتساب مسجل لهذا العميل",
  gateway_error: "تعذر الإرسال عبر واتساب. تأكد أن رقم المتجر متصل.",
  not_on_whatsapp: WHATSAPP_NUMBER_MISSING_MESSAGE,
});

const shipmentStatusOf = (order = {}) => order.shipment_status || order.shipping_status || "";

// The payment card's service answers a refusal by throwing an HTTP error with a code. Here that
// is an answer like any other message's, so the code becomes the reason and the text travels.
const PAYMENT_CARD_REASONS = Object.freeze({ ORDER_NOT_FOUND: "order_missing", NO_CUSTOMER_PHONE: "missing_phone" });

export const ORDER_MESSAGES = Object.freeze({
  order_confirmation: Object.freeze({
    key: "order_confirmation",
    // A tap on what this sends can confirm, edit or cancel the order, so viewing is not enough.
    permission: Object.freeze(["orders", "edit"]),
    columns: Object.freeze(["whatsapp_confirmation_sent_at"]),
    lastSentAt: (order) => order.whatsapp_confirmation_sent_at || null,
    send: ({ order }) => sendOrderConfirmation(order, { force: true }),
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
    columns: Object.freeze(["whatsapp_invoice_sent_at"]),
    lastSentAt: (order) => order.whatsapp_invoice_sent_at || null,
    send: ({ order }) => sendInvoiceWhatsapp(order, { force: true }),
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
  shipping_update: Object.freeze({
    key: "shipping_update",
    // What it says is what the courier already reported, so it changes nothing on the order.
    permission: Object.freeze(["orders", "view"]),
    columns: Object.freeze([
      "shipment_status",
      "shipping_status",
      "whatsapp_shipment_created_sent_at",
      "whatsapp_shipped_sent_at",
      "whatsapp_out_for_delivery_sent_at",
      "whatsapp_delivered_sent_at",
    ]),
    // The failed-attempt column counts attempts rather than stamping a time, so it has no date.
    lastSentAt: (order) => {
      const column = shipmentNotificationColumnFor(shipmentNotificationTypeFor(shipmentStatusOf(order)));
      return column.endsWith("_sent_at") ? order[column] || null : null;
    },
    send: ({ order }) => resendShipmentNotification(order),
    failures: Object.freeze({
      ...SHARED_FAILURES,
      no_shipping_update: "الطلب لسه ماخرجش للشحن، مفيش تحديث شحن نبعته",
      missing_shipment_id: "الشحنة لسه مااتعملتش عند شركة الشحن",
      reason_not_customer_actionable: "سبب فشل التسليم مش حاجة العميل يقدر يتصرف فيها، فمش هنبعتله",
      empty_template: "نص رسالة الشحن فاضي في إعدادات الإشعارات",
    }),
    fallbackFailure: "تعذر إرسال تحديث الشحن على واتساب",
    sentMessage: "تم إرسال تحديث الشحن على واتساب",
    queuedMessage: "تم إدراج تحديث الشحن في طابور الإرسال",
  }),
  shipping_fee_payment_card: Object.freeze({
    key: "shipping_fee_payment_card",
    // The card writes the asked amount onto the order, so it takes the grant that edits it.
    permission: Object.freeze(["orders", "edit"]),
    columns: Object.freeze([]),
    lastSentAt: () => null,
    // input.amount is a deposit staff typed; without it the shop's COD policy decides the amount.
    send: async ({ order, tenantId, input = {} }) => {
      try {
        const result = await sendShippingFeePaymentRequest({ orderId: order.id, tenantId, amount: Number(input.amount) || 0 });
        if (!result?.sent) return { sent: false, reason: "queue_refused" };
        return { sent: false, queued: true, response: { amount: result.amount, upload_url: result.upload_url || "" } };
      } catch (error) {
        // A crash is still a crash; only a coded refusal (CARD_UNAVAILABLE is a 502 that means
        // "no card to send") is the customer-facing answer.
        const refusal = error?.code && (Number(error.status || 500) < 500 || error.code === "CARD_UNAVAILABLE");
        if (!refusal) throw error;
        return { sent: false, reason: PAYMENT_CARD_REASONS[error.code] || String(error.code).toLowerCase(), message: error.message };
      }
    },
    failures: Object.freeze({ ...SHARED_FAILURES }),
    fallbackFailure: "تعذر إرسال كارت دفع الشحن على واتساب",
    sentMessage: "تم إرسال كارت دفع الشحن على واتساب",
    queuedMessage: "تم إدراج كارت دفع الشحن في طابور الإرسال",
  }),
});

export const orderMessageOf = (key) => (Object.hasOwn(ORDER_MESSAGES, String(key || "")) ? ORDER_MESSAGES[key] : null);

export const orderMessageFailure = (entry, reason, serviceMessage = "") =>
  entry?.failures?.[reason] || String(serviceMessage || "").trim() || entry?.fallbackFailure || "تعذر إرسال الرسالة على واتساب";

// tenantId null is the super admin, who reaches every tenant's orders.
const loadOrder = async ({ orderId, tenantId }) => {
  // The sent-at columns are added by the WhatsApp schemas, which may not have run yet.
  await Promise.all([ensureWhatsappOrderConfirmationSchema(), ensureWhatsappShippingSchema()]);
  const columns = [...new Set(Object.values(ORDER_MESSAGES).flatMap((entry) => entry.columns))];
  const found = await db.query(
    `
    SELECT o.id, o.invoice_number, o.customer_name, o.customer_phone, o.status, o.source, o.channel${columns.map((column) => `, o.${column}`).join("")}
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
    // A message with no stamp column says so, rather than claiming it was never sent.
    tracks_last_sent: entry.columns.some((column) => column.endsWith("_sent_at")),
    last_sent_at: entry.lastSentAt(order),
  }));
};

/*
 * Sends one message and answers { status, body } for the route to return as-is. A refusal is a
 * 400 with a reason, never a 5xx (it reaches the browser as an opaque CORS error) and never a 200.
 */
export const sendOrderMessage = async ({ key, orderId, tenantId, user = null, input = {} }) => {
  const entry = orderMessageOf(key);
  if (!entry) return { status: 404, body: { success: false, sent: false, reason: "unknown_message", message: "نوع الرسالة غير معروف" } };
  const refuse = (status, reason, extra = {}, serviceMessage = "") => ({
    status,
    body: { success: false, sent: false, key: entry.key, reason, message: orderMessageFailure(entry, reason, serviceMessage), ...extra },
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
    result = await entry.send({ order, tenantId, input: input || {} });
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
    return refuse(400, reason, {}, result?.message);
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
      ...(result?.response || {}),
      message: queued ? entry.queuedMessage : entry.sentMessage,
    },
  };
};
