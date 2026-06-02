import db from "../database/db.js";
import { normalizeEgyptPhone, sendTextMessage } from "./whatsappGatewayService.js";

const text = (value, fallback = "") => String(value ?? fallback).trim();

const providerName = (order = {}) => {
  const value = text(order.shipping_provider || order.shipping_provider_id || order.provider || "شركة الشحن");
  const normalized = value.toLowerCase();
  if (normalized === "bosta") return "Bosta";
  if (normalized === "in_store_delivery") return "In Store Delivery";
  return value || "شركة الشحن";
};

const invoiceNumber = (order = {}) => text(order.invoice_number || order.public_order_number || order.display_order_number || order.order_number || order.id, "-");
const phoneForOrder = (order = {}) => normalizeEgyptPhone(order.customer_phone || order.phone || order.whatsapp || order.mobile);

let schemaReadyPromise = null;

export const ensureWhatsappShippingSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise || clientOrPool !== db) {
    const run = async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_shipment_created_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_shipped_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_out_for_delivery_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_delivered_sent_at TIMESTAMP NULL`);
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

const buildShipmentCreatedMessage = (order = {}) => `تم إنشاء شحنة طلبك

رقم الطلب:
${invoiceNumber(order)}

شركة الشحن:
${providerName(order)}

سنقوم بإرسال تحديثات الشحنة تلقائياً.`;

const buildShipmentShippedMessage = (order = {}) => `تم شحن طلبك

رقم الطلب:
${invoiceNumber(order)}

شركة الشحن:
${providerName(order)}

رابط التتبع:
${text(order.tracking_url || order.trackingUrl)}`;

const buildShipmentOutForDeliveryMessage = (order = {}) => `المندوب خارج للتسليم

رقم الطلب:
${invoiceNumber(order)}

نتمنى أن تكون متاحاً لاستلام الطلب.`;

const buildShipmentDeliveredMessage = () => `✅ تم تسليم طلبك بنجاح

شكراً لاختيارك M1 Store 

نتمنى أن تكون راضياً عن تجربتك`;

const NOTIFICATIONS = {
  shipment_created: {
    column: "whatsapp_shipment_created_sent_at",
    log: "[whatsapp:shipment-created]",
    buildMessage: buildShipmentCreatedMessage,
    shouldSend: (order) => Boolean(text(order.shipment_id || order.shipping_provider_delivery_id || order.tracking_number)),
    skipReason: "missing_shipment_id",
  },
  shipped: {
    column: "whatsapp_shipped_sent_at",
    log: "[whatsapp:shipment-shipped]",
    buildMessage: buildShipmentShippedMessage,
  },
  out_for_delivery: {
    column: "whatsapp_out_for_delivery_sent_at",
    log: "[whatsapp:shipment-out-for-delivery]",
    buildMessage: buildShipmentOutForDeliveryMessage,
  },
  delivered: {
    column: "whatsapp_delivered_sent_at",
    log: "[whatsapp:shipment-delivered]",
    buildMessage: buildShipmentDeliveredMessage,
  },
};

const sendShippingNotification = async (order = {}, type) => {
  await ensureWhatsappShippingSchema();
  const config = NOTIFICATIONS[type];
  if (!config) return { sent: false, reason: "unsupported_notification" };
  const current = await loadOrder(order);
  const phone = phoneForOrder(current);
  const reason = !current?.id
    ? "order_missing"
    : !phone
      ? "missing_phone"
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

    const message = config.buildMessage(claimed);
    const result = await sendTextMessage({ phone, message });
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
