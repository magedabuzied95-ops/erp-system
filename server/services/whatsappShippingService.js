import db from "../database/db.js";
import { normalizeEgyptPhone, sendTextMessage, sendCtaUrlMessage } from "./whatsappGatewayService.js";
import { getGoogleReviewUrl } from "../utils/publicUrl.js";
import { queueWhatsappAutomation } from "./whatsappQueue/index.js";
import { emitToRooms } from "../utils/socket.js";
import { appendWhatsappOutboundSupportReply } from "./aiSupportLogService.js";
import { getSetting } from "./settingsService.js";
import { normalizeShipmentNotificationConfig, renderShipmentTemplate } from "../../shared/shipmentNotificationTemplates.js";

const text = (value, fallback = "") => String(value ?? fallback).trim();

const providerName = (order = {}) => {
  const value = text(order.shipping_provider || order.shipping_provider_id || order.provider || "شركة الشحن");
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "bosta") return "Bosta";
  if (["in_store_delivery", "in_store", "manual"].includes(normalized)) return "التوصيل بواسطة فريق M1 Store";
  return value || "شركة الشحن";
};

const invoiceNumber = (order = {}) => text(order.invoice_number || order.public_order_number || order.display_order_number || order.order_number || order.id, "-");
const phoneForOrder = (order = {}) => normalizeEgyptPhone(order.customer_phone || order.phone || order.whatsapp || order.mobile);
const extractWhatsAppMessageId = (result = {}) => String(result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || result?.id || "").trim();

let schemaReadyPromise = null;

export const ensureWhatsappShippingSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise || clientOrPool !== db) {
    const run = async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_shipment_created_sent_at TIMESTAMPTZ NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_shipped_sent_at TIMESTAMPTZ NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_out_for_delivery_sent_at TIMESTAMPTZ NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_delivered_sent_at TIMESTAMPTZ NULL`);
    };
    if (clientOrPool !== db) return run();
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const loadOrder = async (order = {}) => {
  if (!order?.id) return order || {};
  const result = await db.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [order.id]);
  return result.rows[0] || order;
};

const NOTIFICATIONS = {
  shipment_created: {
    column: "whatsapp_shipment_created_sent_at",
    log: "[whatsapp:shipment-created]",
    shouldSend: (order) => Boolean(text(order.shipment_id || order.shipping_provider_delivery_id || order.tracking_number)),
    skipReason: "missing_shipment_id",
  },
  shipped: {
    column: "whatsapp_shipped_sent_at",
    log: "[whatsapp:shipment-shipped]",
  },
  out_for_delivery: {
    column: "whatsapp_out_for_delivery_sent_at",
    log: "[whatsapp:shipment-out-for-delivery]",
  },
  delivered: {
    column: "whatsapp_delivered_sent_at",
    log: "[whatsapp:shipment-delivered]",
  },
};

export const loadShipmentNotificationSettings = async () =>
  normalizeShipmentNotificationConfig(await getSetting("orders.shipment_notifications", undefined));

/*
 * The values behind the placeholders. A field with nothing in it renders empty, and
 * renderShipmentTemplate then drops the whole line — label included — so a missing
 * tracking link can never leave the customer a bare "رابط التتبع:".
 */
export const shipmentTemplateValues = async (order = {}) => {
  const collectible = Number(order.cod_amount || 0);
  // Zero renders empty on purpose: a prepaid parcel must not carry a line telling the
  // customer to have 0 ready. The empty value takes the line with it.
  const symbol = collectible > 0 ? await getSetting("general.currency_symbol", "ج.م") : "";
  return {
    order_number: invoiceNumber(order),
    customer_name: text(order.customer_name),
    provider: providerName(order),
    tracking_number: text(order.shipping_tracking_number || order.tracking_number),
    tracking_url: text(order.tracking_url),
    cod_amount: collectible > 0 ? `${collectible.toLocaleString("en-US")} ${symbol}`.trim() : "",
  };
};

const sendShippingNotification = async (order = {}, type) => {
  await ensureWhatsappShippingSchema();
  const config = NOTIFICATIONS[type];
  if (!config) return { sent: false, reason: "unsupported_notification" };
  const current = await loadOrder(order);
  const phone = phoneForOrder(current);
  const settings = (await loadShipmentNotificationSettings())[type];
  // Rendered before the claim: claiming first would burn the once-only column on a
  // message that was never sent, and the customer would never get it at all.
  const message = current?.id ? renderShipmentTemplate(settings.template, await shipmentTemplateValues(current)) : "";
  const reason = !current?.id
    ? "order_missing"
    : !settings.enabled
      ? "disabled"
      : !phone
        ? "missing_phone"
        : !message
          ? "empty_template"
          : config.shouldSend && !config.shouldSend(current)
            ? config.skipReason || "not_eligible"
            : "";
  if (reason) return { sent: false, reason };

  try {
    const claim = await db.query(
      `
      UPDATE orders
      SET ${config.column} = COALESCE(${config.column}, NOW()),
          updated_at = NOW()
      WHERE id = $1
        AND ${config.column} IS NULL
      RETURNING *
      `,
      [current.id]
    );
    const claimed = claim.rows[0] || null;
    if (!claimed) return { sent: false, reason: "already_sent" };

    // The delivery message carries the review ask as a single CTA button — one message, at the
    // one moment the customer has the product in their hands. Evolution forbids mixing a CTA with
    // reply buttons, so this is the whole message; if the button cannot render, sendCtaUrlMessage
    // falls back to text and the customer still gets told their parcel arrived.
    const reviewUrl = type === "delivered" ? getGoogleReviewUrl() : "";
    // Split the rendered template on its first blank line: the headline becomes the CTA header,
    // the remainder the body. Templates are editable, so this reads them rather than hardcoding.
    const [deliveredFirstLine, ...deliveredRest] = String(message).split(/\n\s*\n/);
    const deliveredRemainder = deliveredRest.join("\n\n").trim();
    // A template can render down to a single line — {{customer_name}} on the headline drops that
    // whole line for a nameless customer. Splitting then would put the only line in the header and
    // leave the body empty, so a one-line message keeps its text and takes a fixed header instead.
    const deliveredHeadline = deliveredRemainder ? deliveredFirstLine.trim() : "تم التسليم";
    const deliveredBody = deliveredRemainder || String(message).trim();

    /*
     * Shipment notifications go through the outbound queue too.
     *
     * They are transactional — the customer is waiting on this parcel — so they carry the long
     * expiry and the generous retry budget, unlike the receipt and the review ask. The claim
     * above already happened, so the queue's idempotency key is the second of two guards rather
     * than the only one.
     */
    const queued = await queueWhatsappAutomation({
      tenantId: claimed.tenant_id || order?.tenant_id || 0,
      automationType: type,
      customerId: claimed?.customer_id || null,
      orderId: claimed.id,
      invoiceNumber: invoiceNumber(claimed),
      recipientPhone: phone,
      send: reviewUrl
        ? { kind: "cta_url", title: deliveredHeadline, footer: "M1 Store", displayText: "⭐ قيّمنا على جوجل", url: reviewUrl, fallbackText: message }
        : { kind: "text" },
      values: await shipmentTemplateValues(claimed),
      fallbackBody: reviewUrl ? deliveredBody : message,
      onSent: {
        transcript: {
          session_id: `whatsapp:${phone}`,
          source: `whatsapp_${type}`,
          customer_name: claimed?.customer_name || "",
          message,
        },
      },
      directSend: null,
    });
    if (queued.queued || queued.duplicate) {
      console.info(`${config.log}-queued`, { orderId: claimed.id, queueId: queued.id || null, duplicate: Boolean(queued.duplicate) });
      return { sent: false, queued: true, duplicate: Boolean(queued.duplicate), queueId: queued.id || null, order: claimed };
    }

    let result;
    if (reviewUrl) {
      try {
        result = await sendCtaUrlMessage({
          phone,
          // Evolution always renders the title — blank prints "**", absent prints "*undefined*".
          // The delivery template opens with its own headline, so that line becomes the header
          // and the body carries the rest; the news stays first and nothing is said twice.
          title: deliveredHeadline,
          text: deliveredBody,
          footer: "M1 Store",
          displayText: "⭐ قيّمنا على جوجل",
          url: reviewUrl,
          fallbackText: message,
        });
      } catch (ctaError) {
        console.warn("[whatsapp:delivered-review-cta-unavailable]", {
          orderId: claimed?.id || null,
          message: ctaError?.message || String(ctaError),
          code: ctaError?.code || "",
        });
        result = await sendTextMessage({ phone, message });
      }
    } else {
      result = await sendTextMessage({ phone, message });
    }
    try {
      const transcriptMessage = await appendWhatsappOutboundSupportReply({
        tenantId: claimed.tenant_id || order?.tenant_id || null,
        sessionId: `whatsapp:${phone}`,
        message,
        messageType: "text",
        senderType: "system",
        source: `whatsapp_${type}`,
        channel: "whatsapp",
        deliveryStatus: "sent",
        deliveryError: "",
        externalMessageId: extractWhatsAppMessageId(result),
        providerMessageId: extractWhatsAppMessageId(result),
        whatsappInstance: result?.instanceName || result?.instance || "",
        remoteJid: `whatsapp:${phone}`,
        resolvedReplyJid: `whatsapp:${phone}`,
        resolvedPhone: phone,
        preserveExactMessage: true,
        upsertSession: true,
        sessionStatus: "ai_active",
        sessionSource: "whatsapp",
        sessionChannel: "whatsapp",
        sessionCustomerName: claimed?.customer_name || "",
        sourcePath: `whatsapp_${type}`,
        insertSource: `whatsapp_${type}`,
        confidence: 1,
        detectedIntent: `whatsapp_${type}`,
      });
      if (transcriptMessage && (claimed.tenant_id || order?.tenant_id)) {
        const tenantRoomId = claimed.tenant_id || order?.tenant_id;
        emitToRooms([`tenant:${tenantRoomId}`], "ai_inbox:message", {
          tenant_id: tenantRoomId,
          session_id: `whatsapp:${phone}`,
          message: transcriptMessage,
          at: new Date().toISOString(),
        });
        emitToRooms([`tenant:${tenantRoomId}`], "ai_inbox:refresh", {
          tenant_id: tenantRoomId,
          session_id: `whatsapp:${phone}`,
          at: new Date().toISOString(),
        });
      }
    } catch (persistError) {
      console.warn("[whatsapp:shipment-transcript-save-failed]", {
        type,
        order_id: claimed?.id || null,
        phoneSuffix: phone.slice(-4),
        message: persistError?.message || String(persistError),
      });
    }
    console.info(config.log, {
      orderId: claimed.id,
      invoiceNumber: invoiceNumber(claimed),
      provider: providerName(claimed),
      phoneSuffix: phone.slice(-4),
    });
    return { sent: true, order: claimed, result };
  } catch (error) {
    console.error("[whatsapp:shipment-error]", {
      type,
      order_id: current?.id || null,
      invoice_number: current ? invoiceNumber(current) : "",
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
    });
    throw error;
  }
};

export const sendShipmentCreated = (order = {}) => sendShippingNotification(order, "shipment_created");
export const sendShipmentShipped = (order = {}) => sendShippingNotification(order, "shipped");
export const sendShipmentOutForDelivery = (order = {}) => sendShippingNotification(order, "out_for_delivery");
export const sendShipmentDelivered = (order = {}) => sendShippingNotification(order, "delivered");

export const sendShipmentNotificationForStatus = (order = {}, status = "") => {
  const normalized = text(status || order.shipment_status || order.shipping_status).toLowerCase().replace(/[\s-]+/g, "_");
  if (["shipment_created", "created"].includes(normalized)) return sendShipmentCreated(order);
  if (["shipped", "in_transit", "picked_up", "picked"].includes(normalized)) return sendShipmentShipped(order);
  if (normalized === "out_for_delivery") return sendShipmentOutForDelivery(order);
  if (normalized === "delivered") return sendShipmentDelivered(order);
  return Promise.resolve({ sent: false, reason: "status_not_notifiable" });
};

export default {
  sendShipmentCreated,
  sendShipmentShipped,
  sendShipmentOutForDelivery,
  sendShipmentDelivered,
  sendShipmentNotificationForStatus,
};
