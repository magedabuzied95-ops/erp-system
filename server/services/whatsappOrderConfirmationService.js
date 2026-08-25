import { createHmac, randomBytes } from "node:crypto";

import db from "../database/db.js";
import {
  AI_AGENT_CHANNELS,
  logChannelEvent,
  upsertChannelConversationMapping,
} from "./aiChannelAdapterService.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";
import { adjustVariantStock } from "./inventoryService.js";
import { normalizeEgyptPhone, sendTextMessage, sendOrderConfirmationInteractiveMessage } from "./whatsappGatewayService.js";
import { buildInvoiceReceiptWhatsappMessage, buildOrderTrackingUrl, buildPublicInvoiceUrl, buildWhatsappTextDebug, resolvePublicAppUrl } from "../utils/whatsapp.js";
import { normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { getSetting } from "./settingsService.js";
import { emitToRooms } from "../utils/socket.js";
import { appendWhatsappOutboundSupportReply, appendManualAiSupportReply, markAiSupportConversationEscalated } from "./aiSupportLogService.js";
import { buildCodOrderConfirmationMessage, buildOrderConfirmedMessage } from "../utils/orderConfirmationMessage.js";

const CONFIRM_WORDS = new Set(["1", "تأكيد", "تاكيد", "confirm", "yes", "تمام"]);
const CANCEL_WORDS = new Set(["2", "إلغاء", "الغاء", "cancel", "no"]);
const STOREFRONT_SOURCES = new Set(["storefront", "website", "web"]);
const PAYMENT_REVIEW_METHODS = new Set(["instapay", "vodafone_cash", "bank_transfer", "shipping_confirmation", "transfer"]);
const PAYMENT_REVIEW_STATUSES = new Set(["partially_paid", "awaiting_payment_review", "shipping_paid"]);
const ORDER_CONFIRMATION_CODE_LENGTH = 7;
const ORDER_CONFIRMATION_TOKEN_TTL_MINUTES = Number(process.env.ORDER_CONFIRMATION_TOKEN_TTL_MINUTES || 72 * 60);
const ORDER_CONFIRMATION_FALLBACK_TEXT = buildCodOrderConfirmationMessage({ withActions: true });
const ORDER_CONFIRMATION_PROTECTED_STATUSES = new Set(["shipped", "out_for_delivery", "delivered", "completed", "shipment_created", "ready_to_ship"]);
const ORDER_CONFIRMATION_SINGLE_USE_ACTIONS = new Set(["confirm", "edit", "cancel"]);
const ORDER_CONFIRMATION_ACTION_META = {
  confirm: {
    action: "customer_confirmed_order",
    label: "تم التأكيد من العميل",
    success: "تم التأكيد من العميل",
  },
  edit: {
    action: "customer_requested_edit",
    label: "العميل طلب تعديل",
    success: "العميل طلب تعديل",
  },
  cancel: {
    action: "customer_cancelled_order",
    label: "ألغاه العميل",
    success: "ألغاه العميل",
  },
};

const text = (value, fallback = "") => String(value ?? fallback).trim();
const whatsappButtonSignalValues = (message = {}) => {
  const interactiveResponse = message.interactiveResponse || message.interactive_response || {};
  const listResponseMessage = message.listResponseMessage || message.list_response_message || {};
  const listSingleSelectReply = listResponseMessage.singleSelectReply || listResponseMessage.single_select_reply || {};
  const interactiveButtonReply = message.interactive?.button_reply || message.interactive?.buttonReply || {};
  const button = message.button || {};
  return [
    message.buttonId,
    message.selectedButtonId,
    message.selectedRowId,
    message.selected_row_id,
    message.selected_button_id,
    interactiveResponse.buttonId,
    interactiveResponse.selectedButtonId,
    interactiveResponse.selectedRowId,
    interactiveResponse.selected_button_id,
    interactiveResponse.id,
    interactiveResponse.button_id,
    listResponseMessage.selectedRowId,
    listResponseMessage.selected_row_id,
    listSingleSelectReply.selectedRowId,
    listSingleSelectReply.selected_row_id,
    interactiveButtonReply.id,
    interactiveButtonReply.title,
    button.payload,
    button.buttonId,
    button.selectedButtonId,
    button.id,
    button.text,
  ].filter(Boolean);
};
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value) => number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const json = (value) => JSON.stringify(value === undefined ? null : value);
const extractWhatsAppMessageId = (result = {}) => text(result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || result?.id || "");
const isOrderConfirmationTimeoutError = (error = {}) =>
  String(error?.message || error?.code || "").toLowerCase().includes("timeout") ||
  String(error?.message || error?.code || "").toLowerCase().includes("timed out");
const orderConfirmationDbLogMeta = ({ queryName = "", orderId = null, tokenCode = "", action = "", rowCount = null } = {}) => ({
  query_name: queryName,
  order_id: orderId ?? null,
  token_code: tokenCode || "",
  action: action || "",
  row_count: rowCount,
});
const timedOrderConfirmationQuery = async ({ client, queryName, sql, params = [], orderId = null, tokenCode = "", action = "" }) => {
  const startedAt = Date.now();
  console.info("[order-confirmation-db-start]", orderConfirmationDbLogMeta({ queryName, orderId, tokenCode, action }));
  try {
    const result = await client.query(sql, params);
    console.info("[order-confirmation-db-success]", {
      ...orderConfirmationDbLogMeta({ queryName, orderId, tokenCode, action, rowCount: result?.rowCount ?? null }),
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    if (isOrderConfirmationTimeoutError(error)) {
      console.warn("[order-confirmation-db-timeout]", {
        ...orderConfirmationDbLogMeta({ queryName, orderId, tokenCode, action }),
        duration_ms: Date.now() - startedAt,
        error_message: error?.message || String(error),
      });
    }
    throw error;
  }
};

let schemaReadyPromise = null;

export const ensureWhatsappOrderConfirmationSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise || clientOrPool !== db) {
    const run = async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmed_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_cancelled_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_payment_review_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_invoice_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS timeline JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_confirmation_phone ON orders (customer_phone, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_confirmation_pending ON orders (tenant_id, status, created_at DESC)`);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS order_confirmation_codes (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          action VARCHAR(20) NOT NULL DEFAULT 'entry',
          code VARCHAR(16) NOT NULL UNIQUE,
          code_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP NULL,
          used_action TEXT NULL,
          used_order_status TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, order_id, action)
        )
      `);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_confirmation_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_confirmation_codes ADD COLUMN IF NOT EXISTS used_action TEXT NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS order_confirmation_codes ADD COLUMN IF NOT EXISTS used_order_status TEXT NULL`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_order_confirmation_codes_lookup ON order_confirmation_codes (tenant_id, order_id, action, expires_at DESC)`);
    };
    if (clientOrPool !== db) return run();
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const ensureAiForwardingSchema = async () => {
  await ensureAiSalesAgentSchema().catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_support_sessions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      session_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web_chat',
      channel TEXT NOT NULL DEFAULT 'web_chat',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_avatar_url TEXT NOT NULL DEFAULT '',
      last_message TEXT NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL DEFAULT 'ai_active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, session_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_support_messages (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      session_id TEXT NOT NULL,
      message_text TEXT NOT NULL DEFAULT '',
      customer_message TEXT NOT NULL DEFAULT '',
      ai_answer TEXT NOT NULL DEFAULT '',
      confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
      needs_human_support BOOLEAN NOT NULL DEFAULT FALSE,
      sources_used JSONB NOT NULL DEFAULT '[]'::jsonb,
      suggested_products JSONB NOT NULL DEFAULT '[]'::jsonb,
      visual_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      detected_intent TEXT NOT NULL DEFAULT '',
      fallback_reason TEXT NOT NULL DEFAULT '',
      sender_type VARCHAR(40) NOT NULL DEFAULT 'customer',
      channel TEXT NOT NULL DEFAULT 'web_chat',
      customer_name TEXT NOT NULL DEFAULT '',
      last_message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web_chat'`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS customer_avatar_url TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'ai_active'`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS customer_message TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS message_text TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS ai_answer TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS needs_human_support BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS sources_used JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS suggested_products JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS visual_attachments JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS detected_intent TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS fallback_reason TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(40) NOT NULL DEFAULT 'customer'`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web_chat'`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE IF EXISTS ai_support_messages ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
};

const normalizedReply = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[!?.،。]/g, "")
    .trim();

const sourceOf = (order = {}) => text(order.source || order.channel).toLowerCase();
const isStorefrontPendingOrder = (order = {}) =>
  STOREFRONT_SOURCES.has(sourceOf(order)) && text(order.status).toLowerCase() === "pending_confirmation";
const isCodPayment = (order = {}) => {
  const values = [order.payment_method, order.payment_status, order.payment_type].map((value) => text(value).toLowerCase());
  return values.some((value) => ["cod", "cash_on_delivery", "cash on delivery"].includes(value));
};
const isShippingProofOrder = (order = {}) => {
  const values = [order.payment_method, order.payment_status, order.payment_type, order.transfer_proof_status].map((value) => text(value).toLowerCase());
  return values.some((value) => ["shipping_confirmation", "partially_paid", "awaiting_verification", "pending_transfer", "transfer_pending"].includes(value));
};
const hasPaymentProof = (order = {}) =>
  [
    order.shipping_payment_screenshot,
    order.payment_proof_url,
    order.shipping_proof_url,
    order.proof_image_url,
    order.payment_screenshot_url,
    order.shipping_payment_reference,
  ].some((value) => Boolean(text(value)));
const isPaymentReviewOrder = (order = {}) => {
  const methods = [order.payment_method, order.payment_type, order.shipping_payment_method].map((value) => text(value).toLowerCase());
  const statuses = [order.payment_status, order.transfer_proof_status].map((value) => text(value).toLowerCase());
  return methods.some((value) => PAYMENT_REVIEW_METHODS.has(value)) ||
    statuses.some((value) => PAYMENT_REVIEW_STATUSES.has(value)) ||
    hasPaymentProof(order);
};

const firstName = (name = "") => text(name, "عميلنا").split(/\s+/).filter(Boolean)[0] || "عميلنا";
const orderNumber = (order = {}) => text(order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id, "-").replace(/^#/, "");

const productSummary = (items = []) => {
  const lines = items
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => {
      const name = text(item.product_name || item.name || item.title, "منتج");
      const variant = text(item.variant_name || [item.color, item.size].filter(Boolean).join(" / "));
      const quantity = Math.max(1, number(item.quantity || item.qty, 1));
      return `- ${name}${variant ? ` (${variant})` : ""} x${quantity}`;
    });
  return lines.length ? lines.join("\n") : "- منتجات الطلب";
};

const buildConfirmationMessage = (order = {}, items = []) => buildCodOrderConfirmationMessage({
  customerName: firstName(order.customer_name),
  confirmationLink: order.confirmation_link || order.confirmation_url || "",
});

const remainingAmount = (order = {}) => {
  const total = number(order.total_amount ?? order.total_price ?? order.total);
  const paid = number(order.paid_amount ?? order.amount_paid ?? order.total_paid);
  if (number(order.cod_amount) > 0) return number(order.cod_amount);
  return Math.max(0, total - paid);
};

const buildPaymentReviewMessage = (order = {}, items = []) => `أهلاً يا ${firstName(order.customer_name)}

استلمنا طلبك من M1 Store ✅

رقم الطلب: #${orderNumber(order)}

${productSummary(items)}

تم استلام إثبات التحويل/تأكيد الشحن، وطلبك الآن قيد المراجعة.

الإجمالي: ${money(order.total_amount ?? order.total_price ?? order.total)} جنيه
المدفوع: ${money(order.paid_amount ?? order.amount_paid ?? order.total_paid)} جنيه
المتبقي عند الاستلام: ${money(remainingAmount(order))} جنيه

هنراجع الطلب ونأكد معاك قبل الشحن.`;

const loadOrderItems = async (orderId) => {
  const result = await db.query(
    `
    SELECT
      oi.*,
      COALESCE(
        NULLIF(oi.image_url, ''),
        NULLIF(oi.product_image, ''),
        NULLIF(oi.variant_image, ''),
        NULLIF(pv.image_url, ''),
        NULLIF(pv.image, ''),
        NULLIF(pv.photo_url, ''),
        NULLIF(pv.thumbnail_url, ''),
        NULLIF(p.image_url, ''),
        NULLIF(p.image, ''),
        NULLIF(p.photo_url, ''),
        NULLIF(p.thumbnail_url, ''),
        ''
      ) AS resolved_image_url,
      COALESCE(NULLIF(oi.product_name, ''), NULLIF(p.name, ''), 'منتج') AS resolved_product_name,
      COALESCE(NULLIF(oi.variant_name, ''), NULLIF(CONCAT_WS(' / ', pv.color, pv.size), ''), '') AS resolved_variant_name
    FROM order_items oi
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    LEFT JOIN products p ON p.id = COALESCE(oi.product_id, pv.product_id)
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
    `,
    [orderId]
  );
  return result.rows;
};

const loadOrderShippingDetails = async (orderId) => {
  if (!orderId) return null;
  const result = await db.query(
    `
    SELECT
      o.id,
      o.governorate,
      o.city_area,
      o.customer_address,
      o.shipping_address_line,
      o.street_address,
      o.building_number,
      o.floor_number,
      o.apartment_number,
      o.landmark,
      o.delivery_notes,
      o.order_notes,
      o.notes,
      o.city_id,
      o.area_id,
      o.zone_id,
      o.district_id,
      o.shipping_city_id,
      o.shipping_zone_id,
      o.shipping_district_id,
      COALESCE(sc.name_ar, sc.name_en, '') AS shipping_city_name,
      COALESCE(sz.name_ar, sz.name_en, '') AS shipping_zone_name,
      COALESCE(sd.name_ar, sd.name_en, '') AS shipping_district_name
    FROM orders o
    LEFT JOIN shipping_cities sc
      ON sc.id::text = o.shipping_city_id OR sc.provider_city_id = o.shipping_city_id OR sc.id::text = o.city_id
    LEFT JOIN shipping_zones sz
      ON sz.id::text = o.shipping_zone_id OR sz.provider_zone_id = o.shipping_zone_id OR sz.id::text = o.zone_id
    LEFT JOIN shipping_districts sd
      ON sd.id::text = o.shipping_district_id OR sd.provider_district_id = o.shipping_district_id OR sd.id::text = o.area_id OR sd.id::text = o.district_id
    WHERE o.id = $1
    LIMIT 1
    `,
    [orderId]
  );
  return result.rows[0] || null;
};

const normalizeConfirmationOrder = (order = null, shippingDetails = null) => {
  if (!order) return order;
  const shipping = shippingDetails && typeof shippingDetails === "object" ? shippingDetails : {};
  const governorate = text(order.governorate || shipping.governorate || "");
  const city = text(order.city || shipping.shipping_city_name || order.city_area || "");
  const center = text(order.center || shipping.shipping_zone_name || order.city_area || "");
  const area = text(order.area || shipping.shipping_district_name || order.city_area || "");
  const street = text(order.street || order.street_address || shipping.street_address || order.shipping_address_line || order.customer_address || "");
  const buildingNumber = text(order.building_number || shipping.building_number || "");
  const floor = text(order.floor || order.floor_number || shipping.floor_number || "");
  const apartment = text(order.apartment || order.apartment_number || shipping.apartment_number || "");
  return {
    ...order,
    governorate,
    city,
    center,
    area,
    street,
    building_number: buildingNumber,
    floor,
    apartment,
    customer_address: text(order.customer_address || order.shipping_address_line || order.street_address || ""),
  };
};

const attachOrderConfirmationItems = async (order = null) => {
  if (!order?.id) return order;
  const items = await loadOrderItems(order.id).catch(() => []);
  const shippingDetails = await loadOrderShippingDetails(order.id).catch(() => null);
  return {
    ...normalizeConfirmationOrder(order, shippingDetails),
    items,
  };
};

const loadOrderById = async (orderId, trace = {}) => {
  const result = await timedOrderConfirmationQuery({
    client: db,
    queryName: "orders_lookup_by_id",
    sql: `
    SELECT
      o.*,
      COALESCE(sc.name_ar, sc.name_en, '') AS shipping_city_name,
      COALESCE(sz.name_ar, sz.name_en, '') AS shipping_zone_name,
      COALESCE(sd.name_ar, sd.name_en, '') AS shipping_district_name
    FROM orders o
    LEFT JOIN shipping_cities sc
      ON sc.id::text = o.shipping_city_id OR sc.provider_city_id = o.shipping_city_id OR sc.id::text = o.city_id
    LEFT JOIN shipping_zones sz
      ON sz.id::text = o.shipping_zone_id OR sz.provider_zone_id = o.shipping_zone_id OR sz.id::text = o.zone_id
    LEFT JOIN shipping_districts sd
      ON sd.id::text = o.shipping_district_id OR sd.provider_district_id = o.shipping_district_id OR sd.id::text = o.area_id OR sd.id::text = o.district_id
    WHERE o.id = $1
    LIMIT 1
    `,
    params: [orderId],
    orderId,
    tokenCode: trace?.tokenCode || "",
    action: trace?.action || "",
  });
  return attachOrderConfirmationItems(result.rows[0] || null);
};

// The invoice receipt message is a number and a link. Going through loadOrderById to
// build it also loaded the order's items with their product-image fallback chain
// (1647ms in production) and the shipping address block (895ms) - 2.5s of a 9.5s
// resend, and not one field of either reaches the message. The guards below read only
// columns of `orders`, so read only `orders`.
const loadOrderForInvoiceSend = async (orderId) => {
  const result = await timedOrderConfirmationQuery({
    client: db,
    queryName: "orders_lookup_for_invoice_send",
    sql: `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
    params: [orderId],
    orderId,
    action: "invoice_send",
  });
  return result.rows[0] || null;
};

const loadLatestOrderByPhone = async (phone) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone) return null;
  const result = await db.query(
    `
    SELECT
      o.*,
      COALESCE(sc.name_ar, sc.name_en, '') AS shipping_city_name,
      COALESCE(sz.name_ar, sz.name_en, '') AS shipping_zone_name,
      COALESCE(sd.name_ar, sd.name_en, '') AS shipping_district_name
    FROM orders o
    LEFT JOIN shipping_cities sc
      ON sc.id::text = o.shipping_city_id OR sc.provider_city_id = o.shipping_city_id OR sc.id::text = o.city_id
    LEFT JOIN shipping_zones sz
      ON sz.id::text = o.shipping_zone_id OR sz.provider_zone_id = o.shipping_zone_id OR sz.id::text = o.zone_id
    LEFT JOIN shipping_districts sd
      ON sd.id::text = o.shipping_district_id OR sd.provider_district_id = o.shipping_district_id OR sd.id::text = o.area_id OR sd.id::text = o.district_id
    WHERE LOWER(COALESCE(o.source, o.channel, '')) = ANY($2::text[])
      AND (
        regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') = $1
        OR regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') = regexp_replace($1, '^20', '0')
      )
    ORDER BY
      o.created_at DESC,
      o.id DESC
    LIMIT 1
    `,
    [normalizedPhone, [...STOREFRONT_SOURCES]]
  ).catch(() => ({ rows: [] }));
  return attachOrderConfirmationItems(result.rows[0] || null);
};

const loadOrderItemsForUpdate = async (client, orderId, trace = {}) => {
  const result = await timedOrderConfirmationQuery({
    client,
    queryName: "order_items_for_update",
    sql: `
    SELECT *
    FROM order_items
    WHERE order_id = $1
    ORDER BY id ASC
    FOR UPDATE
    `,
    params: [orderId],
    orderId,
    tokenCode: trace?.tokenCode || "",
    action: trace?.action || "",
  });
  return result.rows || [];
};

const appendOrderTimelineEvent = async (client, { orderId, action, status = "", note = "", source = "", actor = "", label = "" } = {}, trace = {}) => {
  const result = await timedOrderConfirmationQuery({
    client,
    queryName: "orders_timeline_append",
    sql: `
    UPDATE orders
    SET timeline = COALESCE(timeline, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'action', $2::text,
        'status', $3::text,
        'note', $4::text,
        'source', $5::text,
        'actor', $6::text,
        'label', $7::text,
        'at', NOW()
      )
    ),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    params: [orderId, text(action), text(status), text(note), text(source), text(actor), text(label)],
    orderId,
    tokenCode: trace?.tokenCode || "",
    action: trace?.action || "",
  });
  return result.rows[0] || null;
};

const restoreOrderInventory = async (client, { order, items = [], actorUserId = null, reason = "Customer cancelled order via WhatsApp", tokenCode = "" } = {}) => {
  if (!order?.id) return [];
  if (order.inventory_rollback_done || order.stock_reverted_at || order.stock_restored_at) {
    return [];
  }
  const restored = [];
  for (const item of items) {
    const quantity = Math.max(0, Number(item.quantity || item.qty || 0));
    if (!quantity) continue;
    const variantId = item.variant_id || item.variantId || null;
    const productId = item.product_id || item.productId || null;
    if (!variantId) continue;
    const result = await adjustVariantStock(client, {
      tenantId: order.tenant_id || order.tenantId || null,
      variantId,
      productId,
      quantityChange: quantity,
      movementType: "ORDER_CANCEL_RESTORE",
      referenceType: "order",
      referenceId: order.id,
      reason,
      notes: `WhatsApp order cancellation for ${order.public_order_number || order.invoice_number || order.id}`,
      createdBy: actorUserId,
      tokenCode,
    });
    restored.push(result);
  }
  return restored;
};

const buildOrderActionLogMessage = ({ action = "", order = {} } = {}) => {
  const orderRef = order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id;
  if (action === "customer_confirmed_order") return `تم التأكيد من العميل ${orderRef}`;
  if (action === "customer_requested_edit") return `العميل طلب تعديل ${orderRef}`;
  if (action === "customer_cancelled_order") return `ألغاه العميل ${orderRef}`;
  if (action === "confirmed") return `تم تأكيد الطلب ${orderRef}`;
  if (action === "edit_requested") return `العميل طلب تعديل الطلب ${orderRef}`;
  if (action === "cancelled_by_customer") return `تم إلغاء الطلب ${orderRef} بواسطة العميل`;
  if (action === "cancel_reason_saved") return `تم حفظ سبب إلغاء الطلب ${orderRef}`;
  return `تحديث الطلب ${orderRef}`;
};

// applyConfirmationAction refuses by silently returning the order UNCHANGED, so the only honest
// way to know whether a customer's tap took effect is to look at the status it left behind.
// Trusting the call is what let INV-659 be told "we received your edit request" while nothing
// anywhere recorded it.
export const ORDER_ACTION_EXPECTED_STATUS = {
  confirm: "confirmed",
  edit: "edit_requested",
  cancel: "cancelled_by_customer",
};

export const orderActionRefusalReason = ({ action = "", resultingStatus = "" } = {}) => {
  const expected = ORDER_ACTION_EXPECTED_STATUS[String(action).toLowerCase()];
  if (!expected) return "unknown_action";
  return String(resultingStatus || "").trim().toLowerCase() === expected ? "" : "status_not_applicable";
};

const isOrderConfirmationProtectedStatus = (status = "") => {
  const raw = text(status).toLowerCase();
  return ORDER_CONFIRMATION_PROTECTED_STATUSES.has(raw);
};

const loadConfirmationOrder = async ({ orderId = "", phone = "" } = {}) => {
  const normalizedOrderId = Number(orderId);
  if (Number.isFinite(normalizedOrderId) && normalizedOrderId > 0) {
    const order = await loadOrderById(normalizedOrderId);
    if (order) return order;
  }
  const pending = await findPendingOrderByPhone(phone);
  if (pending) return pending;
  return loadLatestOrderByPhone(phone);
};

const orderConfirmationSecret = () =>
  text(
    process.env.ORDER_CONFIRMATION_LINK_SECRET ||
      process.env.WHATSAPP_ORDER_CONFIRMATION_SECRET ||
      process.env.JWT_SECRET ||
      process.env.APP_SECRET ||
      process.env.SECRET_KEY ||
      process.env.SESSION_SECRET,
    ""
  ) || "order-confirmation-local-secret";

const hashOrderConfirmationCode = (code = "") => createHmac("sha256", orderConfirmationSecret()).update(text(code)).digest("hex");
const generateOrderConfirmationCode = () => randomBytes(8).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, ORDER_CONFIRMATION_CODE_LENGTH).padEnd(ORDER_CONFIRMATION_CODE_LENGTH, "A");
const buildOrderConfirmationPublicUrl = (code = "") => {
  const safeCode = text(code);
  if (!safeCode) return "";
  const baseUrl = text(resolvePublicAppUrl() || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/c/${encodeURIComponent(safeCode)}` : `/c/${encodeURIComponent(safeCode)}`;
};
// Two shapes of the same message. The buttons carry the actions, so the interactive body has no
// link in it; the text fallback has no buttons, so it keeps the secure link as the way to act.
const buildOrderConfirmationLinksMessage = ({ order = null, customerName = "", publicUrl = "", withLink = false, withActions = false } = {}) =>
  buildCodOrderConfirmationMessage({
    customerName: firstName(customerName),
    confirmationLink: withLink ? publicUrl : "",
    order,
    items: order?.items || [],
    invoiceUrl: order ? buildPublicInvoiceUrl(orderNumber(order)) : "",
    withActions,
  });

const storeOrderConfirmationCode = async (client, { tenantId, orderId, action, expiresAt, code }) => {
  const codeHash = hashOrderConfirmationCode(code);
  await client.query(
    `
    INSERT INTO order_confirmation_codes (
      tenant_id,
      order_id,
      action,
      code,
      code_hash,
      expires_at,
      used_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, order_id, action)
    DO UPDATE SET
      code = EXCLUDED.code,
      code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      used_at = NULL,
      updated_at = NOW()
    `,
    [tenantId, orderId, action, code, codeHash, expiresAt]
  );
  return { code, codeHash, expiresAt };
};

const issueOrderConfirmationCode = async ({ tenantId, orderId }) => {
  const expiresAt = new Date(Date.now() + ORDER_CONFIRMATION_TOKEN_TTL_MINUTES * 60_000);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const confirm = await storeOrderConfirmationCode(client, { tenantId, orderId, action: "entry", expiresAt, code: generateOrderConfirmationCode() });
    await client.query("COMMIT");
    return confirm;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const orderConfirmationActionLabel = (action = "") => {
  if (action === "confirm") return "تم تأكيد الطلب";
  if (action === "edit") return "تم طلب تعديل الطلب وسيتواصل معك أحد أفراد الفريق";
  if (action === "cancel") return "تم إلغاء الطلب";
  return "تم تحديث الطلب";
};

export const sendOrderConfirmation = async (order = {}) => {
  await ensureWhatsappOrderConfirmationSchema();
  const current = order?.id ? await loadOrderById(order.id) : order;
  const messageTenantId = tenantIdForMessage(current, current);
  const phone = normalizeEgyptPhone(current?.customer_phone || current?.phone || current?.whatsapp || current?.mobile);
  const reason = !current?.id
    ? "order_missing"
    : !STOREFRONT_SOURCES.has(sourceOf(current))
      ? "not_storefront_order"
      : !isCodPayment(current)
        ? "not_cod_order"
        : isShippingProofOrder(current)
          ? "shipping_proof_order_excluded"
          : text(current.status).toLowerCase() !== "pending_confirmation"
            ? "not_pending_confirmation"
            : current.whatsapp_confirmation_sent_at
              ? "already_sent"
              : !phone
                ? "missing_phone"
                : "";
  const shouldSend = !reason;
  console.info("[whatsapp:order-confirmation-check]", {
    order_id: current?.id || null,
    order_number: current ? orderNumber(current) : "",
    channel: current?.channel || "",
    source: current?.source || "",
    payment_method: current?.payment_method || "",
    payment_status: current?.payment_status || "",
    status: current?.status || "",
    customer_phone: current?.customer_phone || current?.phone || "",
    should_send: shouldSend,
    ...(shouldSend ? {} : { reason }),
  });
  if (!shouldSend) return { sent: false, reason };
  let message = "";
  const orderRef = orderNumber(current);
  let result = null;
  let deliveryMode = "link";
  console.info("[buttons-step-1-enter]", {
    file: "server/services/whatsappOrderConfirmationService.js",
    function: "sendOrderConfirmation",
    order_id: current.id,
    phoneSuffix: phone.slice(-4),
  });
  try {
    const confirmCode = await issueOrderConfirmationCode({
      tenantId: messageTenantId,
      orderId: current.id,
    });
    const confirmUrl = buildOrderConfirmationPublicUrl(confirmCode.code);
    message = buildOrderConfirmationLinksMessage({
      order: current,
      customerName: current.customer_name,
      publicUrl: confirmUrl,
    });
    if (!confirmUrl) {
      console.warn("[whatsapp:order-confirmation-link-build-warning]", {
        order_id: current.id,
        order_number: orderRef,
        phoneSuffix: phone.slice(-4),
        has_confirm_url: Boolean(confirmUrl),
      });
    }
    // Buttons render since Evolution 2.4.0 (see docs/decisions/whatsapp-interactive-buttons-evolution.md).
    // The message body keeps the secure link, so a client that fails to render the buttons still has a path.
    try {
      result = await sendOrderConfirmationInteractiveMessage({
        phone,
        title: "تأكيد الطلب",
        text: message,
        footer: "M1 Store",
        orderId: current.id,
      });
      deliveryMode = text(result?.delivery_mode) || "interactive_buttons";
    } catch (buttonsError) {
      console.warn("[whatsapp:order-confirmation-buttons-unavailable]", {
        orderId: current.id,
        orderNumber: orderRef,
        phoneSuffix: phone.slice(-4),
        message: buttonsError?.message || String(buttonsError),
        code: buttonsError?.code || "",
      });
      // No buttons rendered, so the customer needs the link back as the way to act.
      message = buildOrderConfirmationLinksMessage({
        order: current,
        customerName: current.customer_name,
        publicUrl: confirmUrl,
        withLink: true,
        withActions: true,
      });
      deliveryMode = "link_text";
      result = await sendTextMessage({ phone, message });
    }
  } catch (error) {
    deliveryMode = "fallback_text";
    message = ORDER_CONFIRMATION_FALLBACK_TEXT;
    console.warn("[whatsapp:order-confirmation-buttons-fallback]", {
      orderId: current?.id || null,
      orderNumber: orderRef,
      phoneSuffix: phone.slice(-4),
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
      attempted_delivery_mode: "secure_links",
      fallback_delivery_mode: "text_1_2_3",
    });
    result = await sendTextMessage({ phone, message });
  }
  await db.query(
    `
    UPDATE orders
    SET whatsapp_confirmation_sent_at = COALESCE(whatsapp_confirmation_sent_at, NOW()),
        updated_at = NOW()
    WHERE id = $1
    `,
    [current.id]
  );
  try {
    const transcriptMessage = await appendWhatsappOutboundSupportReply({
      tenantId: messageTenantId,
      sessionId: `whatsapp:${phone}`,
      message,
      messageType: "text",
      senderType: "system",
      source: "whatsapp_order_confirmation",
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
      sessionCustomerName: current?.customer_name || "",
      sourcePath: "whatsapp_order_confirmation",
      insertSource: "whatsapp_order_confirmation",
      confidence: 1,
      detectedIntent: "whatsapp_order_confirmation",
    });
    if (transcriptMessage && messageTenantId) {
      const tenantRoom = `tenant:${messageTenantId}`;
      emitToRooms([tenantRoom], "ai_inbox:message", {
        tenant_id: messageTenantId,
        session_id: `whatsapp:${phone}`,
        message: transcriptMessage,
        at: new Date().toISOString(),
      });
      emitToRooms([tenantRoom], "ai_inbox:refresh", {
        tenant_id: messageTenantId,
        session_id: `whatsapp:${phone}`,
        at: new Date().toISOString(),
      });
    }
  } catch (persistError) {
    console.warn("[whatsapp:order-confirmation-transcript-save-failed]", {
      orderId: current.id,
      orderNumber: orderNumber(current),
      phoneSuffix: phone.slice(-4),
      message: persistError?.message || String(persistError),
    });
  }
  console.info("[whatsapp:order-confirmation-sent]", {
    orderId: current.id,
    orderNumber: orderRef,
    phoneSuffix: phone.slice(-4),
    deliveryMode,
  });
  return { sent: true, order: current, result, delivery_mode: deliveryMode, used_buttons: deliveryMode.startsWith("interactive") };
};

export const sendPaymentReviewNotification = async (order = {}) => {
  await ensureWhatsappOrderConfirmationSchema();
  const current = order?.id ? await loadOrderById(order.id) : order;
  const phone = normalizeEgyptPhone(current?.customer_phone || current?.phone || current?.whatsapp || current?.mobile);
  const reason = !current?.id
    ? "order_missing"
    : !STOREFRONT_SOURCES.has(sourceOf(current))
      ? "not_storefront_order"
      : isCodPayment(current)
        ? "cod_order_uses_confirmation_flow"
        : !isPaymentReviewOrder(current)
          ? "not_payment_review_order"
          : current.whatsapp_payment_review_sent_at
            ? "already_sent"
            : !phone
              ? "missing_phone"
              : "";
  const shouldSend = !reason;
  const checkPayload = {
    order_id: current?.id || null,
    order_number: current ? orderNumber(current) : "",
    channel: current?.channel || "",
    source: current?.source || "",
    payment_method: current?.payment_method || "",
    payment_status: current?.payment_status || "",
    status: current?.status || "",
    customer_phone: current?.customer_phone || current?.phone || "",
    should_send: shouldSend,
    ...(shouldSend ? {} : { reason }),
  };
  console.info("[whatsapp:payment-review-check]", checkPayload);
  if (!shouldSend) {
    console.info("[whatsapp:payment-review-skipped]", checkPayload);
    return { sent: false, reason };
  }
  try {
    const items = Array.isArray(order.items) && order.items.length ? order.items : await loadOrderItems(current.id);
    const message = buildPaymentReviewMessage(current, items);
    const result = await sendTextMessage({ phone, message });
    const messageTenantId = tenantIdForMessage(current, current);
    await db.query(
      `
      UPDATE orders
      SET whatsapp_payment_review_sent_at = COALESCE(whatsapp_payment_review_sent_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
      `,
      [current.id]
    );
    try {
      const transcriptMessage = await appendWhatsappOutboundSupportReply({
        tenantId: messageTenantId,
        sessionId: `whatsapp:${phone}`,
        message,
        messageType: "text",
        senderType: "system",
        source: "whatsapp_payment_review",
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
        sessionCustomerName: current?.customer_name || "",
        sourcePath: "whatsapp_payment_review",
        insertSource: "whatsapp_payment_review",
        confidence: 1,
        detectedIntent: "whatsapp_payment_review",
      });
      if (transcriptMessage && messageTenantId) {
        const tenantRoom = `tenant:${messageTenantId}`;
        emitToRooms([tenantRoom], "ai_inbox:message", {
          tenant_id: messageTenantId,
          session_id: `whatsapp:${phone}`,
          message: transcriptMessage,
          at: new Date().toISOString(),
        });
        emitToRooms([tenantRoom], "ai_inbox:refresh", {
          tenant_id: messageTenantId,
          session_id: `whatsapp:${phone}`,
          at: new Date().toISOString(),
        });
      }
    } catch (persistError) {
      console.warn("[whatsapp:payment-review-transcript-save-failed]", {
        order_id: current?.id || null,
        order_number: current ? orderNumber(current) : "",
        message: persistError?.message || String(persistError),
      });
    }
    console.info("[whatsapp:payment-review-sent]", {
      orderId: current.id,
      orderNumber: orderNumber(current),
      phoneSuffix: phone.slice(-4),
    });
    return { sent: true, order: current, result };
  } catch (error) {
    console.error("[whatsapp:payment-review-error]", {
      order_id: current?.id || null,
      order_number: current ? orderNumber(current) : "",
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
    });
    throw error;
  }
};

export const sendInvoiceWhatsapp = async (order = {}, options = {}) => {
  await ensureWhatsappOrderConfirmationSchema();
  const current = order?.id ? await loadOrderForInvoiceSend(order.id) : order;
  const messageTenantId = tenantIdForMessage(current, current);
  const phone = normalizeEgyptPhone(current?.customer_phone || current?.phone || current?.whatsapp || current?.mobile);
  const invoiceNumber = text(current?.invoice_number);
  const invoiceUrl = invoiceNumber ? buildPublicInvoiceUrl(invoiceNumber) : "";
  const mode = text(options.mode || options.context).toLowerCase();
  const source = sourceOf(current);
  const isPosInvoice = mode === "pos" || source === "pos";
  const logTags = isPosInvoice
    ? {
        check: "[whatsapp:pos-invoice-check]",
        sent: "[whatsapp:pos-invoice-sent]",
        skipped: "[whatsapp:pos-invoice-skipped]",
        error: "[whatsapp:pos-invoice-error]",
      }
    : {
        check: "[whatsapp:invoice-check]",
        sent: "[whatsapp:invoice-sent]",
        skipped: "[whatsapp:invoice-skipped]",
        error: "[whatsapp:invoice-error]",
      };
  // A manual resend is a human asking for this receipt to go out again, so it clears the
  // guards that exist only to keep the automatic send from firing twice, from firing on
  // the wrong kind of order, or from firing while the shop has auto-send switched off.
  // What it cannot clear is a message we are unable to build - no phone, no invoice
  // number, no link - or an invoice that no longer stands.
  const isManualResend = options.force === true;
  const posAutoSendEnabled = !isPosInvoice || isManualResend
    ? true
    : options.autoSendEnabled !== undefined
      ? options.autoSendEnabled !== false
      : await getSetting("pos.auto_send_pos_invoice_whatsapp", true).catch(() => true);
  const status = text(current?.status).toLowerCase();
  const missingPieceReason = !phone
    ? "missing_phone"
    : !invoiceNumber
      ? "missing_invoice_number"
      : !invoiceUrl
        ? "missing_invoice_url"
        : "";
  const reason = !current?.id
    ? "order_missing"
    : isManualResend
      ? ["cancelled", "canceled"].includes(status)
        ? "cancelled_order"
        : missingPieceReason
      : isPosInvoice && !posAutoSendEnabled
        ? "setting_disabled"
        : isPosInvoice && ["cancelled", "canceled"].includes(status)
          ? "cancelled_order"
          : isPosInvoice
            ? source !== "pos"
              ? "not_pos_order"
              : current.whatsapp_invoice_sent_at
                ? "already_sent"
                : missingPieceReason
            : !STOREFRONT_SOURCES.has(source)
              ? "not_storefront_order"
              : isCodPayment(current) && status === "pending_confirmation"
                ? "cod_pending_confirmation"
                : current.whatsapp_invoice_sent_at
                  ? "already_sent"
                  : missingPieceReason;
  const shouldSend = !reason;
  const checkPayload = {
    order_id: current?.id || null,
    order_number: current ? orderNumber(current) : "",
    invoice_number: invoiceNumber,
    channel: current?.channel || "",
    source: current?.source || "",
    status: current?.status || "",
    auto_send_pos_invoice_whatsapp: isPosInvoice ? Boolean(posAutoSendEnabled) : undefined,
    customer_phone: current?.customer_phone || current?.phone || "",
    manual_resend: isManualResend,
    should_send: shouldSend,
    ...(shouldSend ? {} : { reason }),
  };
  console.info(logTags.check, checkPayload);
  if (!shouldSend) {
    console.info(logTags.skipped, checkPayload);
    return { sent: false, reason };
  }

  try {
    const message = buildInvoiceReceiptWhatsappMessage({ invoiceNumber, invoiceUrl });
    const messageDebug = buildWhatsappTextDebug(message, 300);
    console.info("[whatsapp:invoice-message-preview]", {
      order_id: current.id,
      invoice_number: invoiceNumber,
      mode: isPosInvoice ? "pos" : "storefront",
      source: current?.source || "",
      channel: current?.channel || "",
      message_length: Array.from(message).length,
      hasEmojis: messageDebug.hasEmojis,
      codePoints: messageDebug.codePoints,
      exactFirst300Chars: messageDebug.firstChars,
    });
    const result = await sendTextMessage({ phone, message });
    console.info(logTags.sent, {
      orderId: current.id,
      orderNumber: orderNumber(current),
      invoiceNumber,
      invoiceUrl,
      manual_resend: isManualResend,
      phoneSuffix: phone.slice(-4),
    });
    // From here down the customer already has the message and everything left is
    // bookkeeping. Holding the caller for it cost 3s of a 9.5s resend - a cashier
    // watching a spinner for a send that had already landed - and an error in it used
    // to be thrown as if the send itself had failed. Record it behind the return.
    const recordDelivery = async () => {
      await db.query(
        `
        UPDATE orders
        SET whatsapp_invoice_sent_at = COALESCE(whatsapp_invoice_sent_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
        `,
        [current.id]
      );
      const transcriptMessage = await appendWhatsappOutboundSupportReply({
        tenantId: messageTenantId,
        sessionId: `whatsapp:${phone}`,
        message,
        messageType: "text",
        senderType: "system",
        source: isPosInvoice ? "whatsapp_pos_invoice" : "whatsapp_invoice",
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
        sessionCustomerName: current?.customer_name || "",
        sourcePath: isPosInvoice ? "whatsapp_pos_invoice" : "whatsapp_invoice",
        insertSource: isPosInvoice ? "whatsapp_pos_invoice" : "whatsapp_invoice",
        confidence: 1,
        detectedIntent: isPosInvoice ? "whatsapp_pos_invoice" : "whatsapp_invoice",
      });
      if (transcriptMessage && messageTenantId) {
        const tenantRoom = `tenant:${messageTenantId}`;
        emitToRooms([tenantRoom], "ai_inbox:message", {
          tenant_id: messageTenantId,
          session_id: `whatsapp:${phone}`,
          message: transcriptMessage,
          at: new Date().toISOString(),
        });
        emitToRooms([tenantRoom], "ai_inbox:refresh", {
          tenant_id: messageTenantId,
          session_id: `whatsapp:${phone}`,
          at: new Date().toISOString(),
        });
      }
    };
    void recordDelivery().catch((persistError) => {
      console.warn("[whatsapp:invoice-transcript-save-failed]", {
        order_id: current?.id || null,
        invoice_number: invoiceNumber,
        message: persistError?.message || String(persistError),
      });
    });
    return { sent: true, order: current, result, invoiceUrl };
  } catch (error) {
    console.error(logTags.error, {
      order_id: current?.id || null,
      order_number: current ? orderNumber(current) : "",
      invoice_number: invoiceNumber,
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
    });
    throw error;
  }
};

export const findPendingOrderByPhone = async (phone) => {
  await ensureWhatsappOrderConfirmationSchema();
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone) return null;
  const result = await db.query(
    `
    SELECT
      o.*,
      COALESCE(sc.name_ar, sc.name_en, '') AS shipping_city_name,
      COALESCE(sz.name_ar, sz.name_en, '') AS shipping_zone_name,
      COALESCE(sd.name_ar, sd.name_en, '') AS shipping_district_name
    FROM orders o
    LEFT JOIN shipping_cities sc
      ON sc.id::text = o.shipping_city_id OR sc.provider_city_id = o.shipping_city_id OR sc.id::text = o.city_id
    LEFT JOIN shipping_zones sz
      ON sz.id::text = o.shipping_zone_id OR sz.provider_zone_id = o.shipping_zone_id OR sz.id::text = o.zone_id
    LEFT JOIN shipping_districts sd
      ON sd.id::text = o.shipping_district_id OR sd.provider_district_id = o.shipping_district_id OR sd.id::text = o.area_id OR sd.id::text = o.district_id
    WHERE LOWER(COALESCE(o.status, '')) = 'pending_confirmation'
      AND LOWER(COALESCE(o.source, o.channel, '')) = ANY($2::text[])
      AND o.whatsapp_confirmed_at IS NULL
      AND o.whatsapp_cancelled_at IS NULL
      AND (
        regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') = $1
        OR regexp_replace(COALESCE(o.customer_phone, ''), '\\D', '', 'g') = regexp_replace($1, '^20', '0')
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 1
    `,
    [normalizedPhone, [...STOREFRONT_SOURCES]]
  );
  return result.rows[0] || null;
};

export const markOrderConfirmed = async (orderId) => {
  const order = await applyConfirmationAction({ orderId, action: "confirm", source: "webhook", actorType: "system" });
  if (order) console.info("[whatsapp:order-confirmed]", { orderId: order.id, orderNumber: orderNumber(order) });
  return order;
};

export const markOrderCancelled = async (orderId) => {
  const order = await applyConfirmationAction({ orderId, action: "cancel", source: "webhook", actorType: "system" });
  if (order) console.info("[whatsapp:order-cancelled]", { orderId: order.id, orderNumber: orderNumber(order) });
  return order;
};

async function applyConfirmationAction({
  orderId = "",
  order: providedOrder = null,
  action = "",
  reason = "",
  source = "whatsapp_webhook",
  actorType = "customer",
  actorUserId = null,
  actorUserName = "",
  tokenCode = "",
  client: providedClient = null,
  manageTransaction = true,
} = {}) {
  await ensureWhatsappOrderConfirmationSchema();
  const normalizedAction = text(action).toLowerCase();
  const orderIdValue = Number(orderId || providedOrder?.id || 0);
  if (!Number.isFinite(orderIdValue) || orderIdValue <= 0) return null;

  const client = providedClient || await db.connect();
  const ownsClient = !providedClient;
  const shouldManageTransaction = ownsClient && manageTransaction !== false;
  try {
    if (shouldManageTransaction) {
      await timedOrderConfirmationQuery({
        client,
        queryName: "transaction_begin_apply_confirmation_action",
        sql: "BEGIN",
        params: [],
        orderId: orderIdValue,
        action: normalizedAction,
      });
    }
    let current = providedOrder || null;
    if (!current) {
      const currentQuery = await timedOrderConfirmationQuery({
        client,
        queryName: shouldManageTransaction ? "orders_current_for_update" : "orders_current_by_id",
        sql: shouldManageTransaction
          ? `SELECT * FROM orders WHERE id = $1 FOR UPDATE LIMIT 1`
          : `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
        params: [orderIdValue],
        orderId: orderIdValue,
        action: normalizedAction,
      });
      current = currentQuery.rows[0] || null;
    }
    if (!current) {
      if (shouldManageTransaction) {
        await timedOrderConfirmationQuery({
          client,
          queryName: "transaction_rollback_apply_confirmation_missing_order",
          sql: "ROLLBACK",
          params: [],
          orderId: orderIdValue,
          action: normalizedAction,
        });
      }
      return null;
    }

    const currentStatus = text(current.status).toLowerCase();
    const isAlreadyConfirmed = currentStatus === "confirmed" && normalizedAction === "confirm";
    const isAlreadyEdited = currentStatus === "edit_requested" && normalizedAction === "edit";
    const isAlreadyCancelled = currentStatus === "cancelled_by_customer" && normalizedAction === "cancel";
    if (isAlreadyConfirmed || isAlreadyEdited || isAlreadyCancelled) {
      if (shouldManageTransaction) {
        await timedOrderConfirmationQuery({
          client,
          queryName: "transaction_commit_apply_confirmation_noop",
          sql: "COMMIT",
          params: [],
          orderId: orderIdValue,
          action: normalizedAction,
        });
      }
      return current;
    }

    if (isOrderConfirmationProtectedStatus(currentStatus) && normalizedAction !== "cancel_reason") {
      if (shouldManageTransaction) {
        await timedOrderConfirmationQuery({
          client,
          queryName: "transaction_rollback_apply_confirmation_locked_status",
          sql: "ROLLBACK",
          params: [],
          orderId: orderIdValue,
          action: normalizedAction,
        });
      }
      const error = new Error("لا يمكن تعديل هذا الطلب من الرابط الآن، برجاء التواصل معنا");
      error.status = 409;
      error.code = "ORDER_CONFIRMATION_LINK_LOCKED";
      throw error;
    }

    let updated = null;
    if (normalizedAction === "confirm") {
      // edit_requested is allowed back: the customer asks for a change, we fix it, and the same
      // buttons are still sitting in their chat for them to confirm the corrected order.
      if (!["pending_confirmation", "confirmed", "edit_requested"].includes(currentStatus)) {
        if (shouldManageTransaction) {
          await timedOrderConfirmationQuery({
            client,
            queryName: "transaction_rollback_apply_confirmation_invalid_confirm",
            sql: "ROLLBACK",
            params: [],
            orderId: orderIdValue,
            action: normalizedAction,
          });
        }
        return current;
      }
      const result = await timedOrderConfirmationQuery({
        client,
        queryName: "orders_update_confirm",
        sql: `
        UPDATE orders
        SET status = 'confirmed',
            whatsapp_confirmed_at = COALESCE(whatsapp_confirmed_at, NOW()),
            whatsapp_cancelled_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        params: [current.id],
        orderId: current.id,
        action: normalizedAction,
      });
      updated = result.rows[0] || current;
      updated = await appendOrderTimelineEvent(client, {
        orderId: updated.id,
        action: ORDER_CONFIRMATION_ACTION_META.confirm.action,
        status: "confirmed",
        note: buildOrderActionLogMessage({ action: ORDER_CONFIRMATION_ACTION_META.confirm.action, order: updated }),
        source,
        actor: actorType === "staff" ? (actorUserName || `staff:${actorUserId || ""}`) : "customer",
        label: ORDER_CONFIRMATION_ACTION_META.confirm.label,
      }, { action: normalizedAction, tokenCode }) || updated;
    } else if (normalizedAction === "edit") {
      // A customer who confirms and THEN notices the wrong size still needs to reach us. WhatsApp
      // buttons cannot be withdrawn once sent, so a late tap is normal, not abuse. Anything past
      // dispatch is still refused above by isOrderConfirmationProtectedStatus.
      if (!["pending_confirmation", "edit_requested", "confirmed"].includes(currentStatus)) {
        if (shouldManageTransaction) {
          await timedOrderConfirmationQuery({
            client,
            queryName: "transaction_rollback_apply_confirmation_invalid_edit",
            sql: "ROLLBACK",
            params: [],
            orderId: orderIdValue,
            action: normalizedAction,
          });
        }
        return current;
      }
      const result = await timedOrderConfirmationQuery({
        client,
        queryName: "orders_update_edit_requested",
        sql: `
        UPDATE orders
        SET status = 'edit_requested',
            whatsapp_cancelled_at = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        params: [current.id],
        orderId: current.id,
        action: normalizedAction,
      });
      updated = result.rows[0] || current;
      updated = await appendOrderTimelineEvent(client, {
        orderId: updated.id,
        action: ORDER_CONFIRMATION_ACTION_META.edit.action,
        status: "edit_requested",
        note: buildOrderActionLogMessage({ action: ORDER_CONFIRMATION_ACTION_META.edit.action, order: updated }),
        source,
        actor: actorType === "staff" ? (actorUserName || `staff:${actorUserId || ""}`) : "customer",
        label: ORDER_CONFIRMATION_ACTION_META.edit.label,
      }, { action: normalizedAction, tokenCode }) || updated;
    } else if (normalizedAction === "cancel") {
      if (currentStatus === "cancelled_by_customer") {
        if (shouldManageTransaction) {
          await timedOrderConfirmationQuery({
            client,
            queryName: "transaction_commit_apply_confirmation_already_cancelled",
            sql: "COMMIT",
            params: [],
            orderId: orderIdValue,
            action: normalizedAction,
          });
        }
        return current;
      }
      const items = await loadOrderItemsForUpdate(client, current.id, { action: normalizedAction, tokenCode });
      await restoreOrderInventory(client, {
        order: current,
        items,
        actorUserId,
        reason: reason || "Customer cancelled order via WhatsApp",
        tokenCode,
      });
      const result = await timedOrderConfirmationQuery({
        client,
        queryName: "orders_update_cancelled_by_customer",
        sql: `
        UPDATE orders
        SET status = 'cancelled_by_customer',
            payment_status = 'cancelled',
            cancel_reason = CASE
              WHEN COALESCE(NULLIF(cancel_reason, ''), '') <> '' THEN cancel_reason
              WHEN COALESCE(NULLIF($2::text, ''), '') <> '' THEN $2::text
              ELSE cancel_reason
            END,
            whatsapp_cancelled_at = COALESCE(whatsapp_cancelled_at, NOW()),
            whatsapp_confirmed_at = NULL,
            stock_restored_at = COALESCE(stock_restored_at, NOW()),
            stock_reverted_at = COALESCE(stock_reverted_at, NOW()),
            inventory_rollback_done = TRUE,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        params: [current.id, text(reason)],
        orderId: current.id,
        action: normalizedAction,
      });
      updated = result.rows[0] || current;
      updated = await appendOrderTimelineEvent(client, {
        orderId: updated.id,
        action: ORDER_CONFIRMATION_ACTION_META.cancel.action,
        status: "cancelled_by_customer",
        note: buildOrderActionLogMessage({ action: ORDER_CONFIRMATION_ACTION_META.cancel.action, order: updated }),
        source,
        actor: actorType === "staff" ? (actorUserName || `staff:${actorUserId || ""}`) : "customer",
        label: ORDER_CONFIRMATION_ACTION_META.cancel.label,
      }, { action: normalizedAction, tokenCode }) || updated;
    } else if (normalizedAction === "cancel_reason") {
      const result = await timedOrderConfirmationQuery({
        client,
        queryName: "orders_update_cancel_reason",
        sql: `
        UPDATE orders
        SET cancel_reason = CASE
              WHEN COALESCE(NULLIF(cancel_reason, ''), '') <> '' THEN cancel_reason
              WHEN COALESCE(NULLIF($2::text, ''), '') <> '' THEN $2::text
              ELSE cancel_reason
            END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        params: [current.id, text(reason)],
        orderId: current.id,
        action: normalizedAction,
      });
      updated = result.rows[0] || current;
      updated = await appendOrderTimelineEvent(client, {
        orderId: updated.id,
        action: "cancel_reason",
        status: text(updated.status),
        note: buildOrderActionLogMessage({ action: "cancel_reason_saved", order: updated }),
        source,
        actor: actorType === "staff" ? (actorUserName || `staff:${actorUserId || ""}`) : "customer",
      }, { action: normalizedAction, tokenCode }) || updated;
    } else {
      if (shouldManageTransaction) {
        await timedOrderConfirmationQuery({
          client,
          queryName: "transaction_rollback_apply_confirmation_unsupported_action",
          sql: "ROLLBACK",
          params: [],
          orderId: orderIdValue,
          action: normalizedAction,
        });
      }
      return current;
    }

    if (shouldManageTransaction) {
      await timedOrderConfirmationQuery({
        client,
        queryName: "transaction_commit_apply_confirmation_action",
        sql: "COMMIT",
        params: [],
        orderId: orderIdValue,
        action: normalizedAction,
      });
    }
    return updated;
  } catch (error) {
    if (shouldManageTransaction) {
      await timedOrderConfirmationQuery({
        client,
        queryName: "transaction_rollback_apply_confirmation_error",
        sql: "ROLLBACK",
        params: [],
        orderId: orderIdValue,
        action: normalizedAction,
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}

export const consumeOrderConfirmationLink = async ({ code = "", action = "", ipAddress = "", userAgent = "", source = "public_order_confirmation_link" } = {}) => {
  const safeCode = text(code);
  if (!safeCode) {
    const error = new Error("Missing confirmation code");
    error.status = 400;
    error.code = "ORDER_CONFIRMATION_CODE_MISSING";
    throw error;
  }

  const codeHash = hashOrderConfirmationCode(safeCode);
  const client = await db.connect();
  try {
    await timedOrderConfirmationQuery({
      client,
      queryName: "transaction_begin_consume_confirmation_link",
      sql: "BEGIN",
      params: [],
      action: text(action),
      tokenCode: safeCode,
    });
    const codeResult = await timedOrderConfirmationQuery({
      client,
      queryName: "confirmation_code_lookup",
      sql: `
      SELECT *
      FROM order_confirmation_codes
      WHERE code_hash = $1
      LIMIT 1
      FOR UPDATE
      `,
      params: [codeHash],
      orderId: null,
      tokenCode: safeCode,
      action: text(action),
    });
    const codeRow = codeResult.rows[0] || null;
    if (!codeRow) {
      const error = new Error("Confirmation code not found");
      error.status = 404;
      error.code = "ORDER_CONFIRMATION_CODE_NOT_FOUND";
      throw error;
    }
    if (new Date(codeRow.expires_at).getTime() < Date.now()) {
      const error = new Error("Confirmation code expired");
      error.status = 410;
      error.code = "ORDER_CONFIRMATION_CODE_EXPIRED";
      throw error;
    }

    const orderResult = await timedOrderConfirmationQuery({
      client,
      queryName: "order_lookup_for_confirmation_code",
      sql: `
      SELECT *
      FROM orders
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      params: [codeRow.order_id],
      orderId: codeRow.order_id,
      tokenCode: safeCode,
      action: text(action),
    });
    const current = orderResult.rows[0] || null;
    if (!current) {
      const error = new Error("Order not found");
      error.status = 404;
      error.code = "ORDER_CONFIRMATION_ORDER_NOT_FOUND";
      throw error;
    }
    const currentWithItems = await attachOrderConfirmationItems(current);

    const currentStatus = text(current.status).toLowerCase();
    const linkLocked = isOrderConfirmationProtectedStatus(currentStatus);
    const lockedMessage = "لا يمكن تعديل هذا الطلب من الرابط الآن، برجاء التواصل معنا";
    const usedAction = text(codeRow.used_action || "");
    const usedOrderStatus = text(codeRow.used_order_status || currentStatus || "");

    if (codeRow.used_at) {
      await timedOrderConfirmationQuery({
        client,
        queryName: "transaction_commit_consume_confirmation_link_already_used",
        sql: "COMMIT",
        params: [],
        orderId: codeRow.order_id,
        tokenCode: safeCode,
        action: text(action),
      });
      return {
        success: true,
        action: usedAction,
        target_status: usedOrderStatus || currentStatus,
        already_applied: true,
        already_used: true,
        link_locked: linkLocked,
        order: currentWithItems,
        message: usedAction ? (ORDER_CONFIRMATION_ACTION_META[usedAction]?.success || "تم استخدام هذا الرابط بالفعل") : (linkLocked ? lockedMessage : "تم استخدام هذا الرابط بالفعل"),
        code_expires_at: codeRow.expires_at,
        used_at: codeRow.used_at || null,
        used_action: usedAction,
        used_order_status: usedOrderStatus || currentStatus,
        ip_address: ipAddress,
        user_agent: userAgent,
        code: safeCode,
      };
    }

    const requestedAction = text(action);
    if (!requestedAction) {
      await timedOrderConfirmationQuery({
        client,
        queryName: "transaction_commit_consume_confirmation_validation",
        sql: "COMMIT",
        params: [],
        orderId: codeRow.order_id,
        tokenCode: safeCode,
        action: text(action),
      });
      return {
        success: true,
        action: "",
        target_status: currentStatus,
        already_applied: false,
        already_used: false,
        link_locked: linkLocked,
        order: currentWithItems,
        message: linkLocked ? lockedMessage : "confirmation_code_valid",
        code_expires_at: codeRow.expires_at,
        used_at: codeRow.used_at || null,
        used_action: usedAction,
        used_order_status: usedOrderStatus || currentStatus,
        ip_address: ipAddress,
        user_agent: userAgent,
        code: safeCode,
      };
    }
    if (!ORDER_CONFIRMATION_SINGLE_USE_ACTIONS.has(requestedAction)) {
      const error = new Error("Unsupported confirmation action");
      error.status = 400;
      error.code = "ORDER_CONFIRMATION_ACTION_INVALID";
      throw error;
    }
    if (linkLocked) {
      const error = new Error(lockedMessage);
      error.status = 409;
      error.code = "ORDER_CONFIRMATION_LINK_LOCKED";
      throw error;
    }
    const actionConfig = {
      confirm: { expectedStatus: "confirmed", payloadAction: "confirm", message: ORDER_CONFIRMATION_ACTION_META.confirm.success },
      edit: { expectedStatus: "edit_requested", payloadAction: "edit", message: ORDER_CONFIRMATION_ACTION_META.edit.success },
      cancel: { expectedStatus: "cancelled_by_customer", payloadAction: "cancel", message: ORDER_CONFIRMATION_ACTION_META.cancel.success },
    }[requestedAction];
    const alreadyApplied = currentStatus === actionConfig.expectedStatus;
      const updated = alreadyApplied
      ? currentWithItems
      : await applyConfirmationAction({
          orderId: current.id,
          providedOrder: current,
          action: actionConfig.payloadAction,
          source,
          reason: `public_code:${actionConfig.payloadAction}`,
          actorType: "customer",
          client,
          manageTransaction: false,
          tokenCode: safeCode,
        });
    const updatedWithItems = alreadyApplied ? updated : await attachOrderConfirmationItems(updated);
    const markResult = await timedOrderConfirmationQuery({
      client,
      queryName: "confirmation_code_mark_used",
      sql: `
      UPDATE order_confirmation_codes
      SET used_at = COALESCE(used_at, NOW()),
          used_action = COALESCE(NULLIF(used_action, ''), $2::text),
          used_order_status = COALESCE(NULLIF(used_order_status, ''), $3::text),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      params: [codeRow.id, actionConfig.payloadAction, text(updatedWithItems?.status || updated?.status || current?.status || actionConfig.expectedStatus)],
      orderId: codeRow.order_id,
      tokenCode: safeCode,
      action: text(action),
    });
    await timedOrderConfirmationQuery({
      client,
      queryName: "transaction_commit_consume_confirmation_link",
      sql: "COMMIT",
      params: [],
      orderId: codeRow.order_id,
      tokenCode: safeCode,
      action: text(action),
    });
    return {
      success: true,
      action: actionConfig.payloadAction,
      target_status: actionConfig.expectedStatus,
      already_applied: alreadyApplied,
      already_used: false,
      link_locked: false,
      order: updatedWithItems,
      message: actionConfig.message,
      code_expires_at: codeRow.expires_at,
      used_at: markResult.rows[0]?.used_at || null,
      used_action: markResult.rows[0]?.used_action || requestedAction,
      used_order_status: markResult.rows[0]?.used_order_status || actionConfig.expectedStatus,
      ip_address: ipAddress,
      user_agent: userAgent,
      code: safeCode,
    };
  } catch (error) {
    await timedOrderConfirmationQuery({
      client,
      queryName: "transaction_rollback_consume_confirmation_link_error",
      sql: "ROLLBACK",
      params: [],
      tokenCode: safeCode,
      action: text(action),
    }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const tenantIdForMessage = (message = {}, order = null) => number(message.tenant_id || message.tenantId || order?.tenant_id || process.env.WHATSAPP_TENANT_ID || 1, 1);

const forwardToAiInbox = async ({ message = {}, order = null, needsFollowup = false } = {}) => {
  const phone = normalizeEgyptPhone(message.phone || message.from || message.sender || "");
  const body = text(message.normalized_for_intent || message.text || message.message_text || message.body);
  const originalBody = text(message.original_message || message.text || message.message_text || message.body);
  const intentPayload = normalizeArabicIntentPayload(originalBody);
  const productAlias = resolveProductAlias(originalBody || body);
  console.log("[arabic-intent-signals]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: originalBody,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: body,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[product-alias]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: originalBody,
    normalizedText: intentPayload.normalizedText,
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    confidence: productAlias.confidence,
  });
  const tenantId = tenantIdForMessage(message, order);
  const conversationId = text(message.external_conversation_id || message.conversation_id || (phone ? `whatsapp:${phone}` : ""));
  if (!phone || !body || !conversationId) return { forwarded: false, reason: "missing_message" };
  await ensureAiForwardingSchema();
  await upsertChannelConversationMapping({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    externalConversationId: conversationId,
    externalCustomerId: phone,
    customerName: order?.customer_name || "",
    metadata: {
      phone,
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      source: "evolution_api",
      order_id: order?.id || null,
      last_message: originalBody,
      original_message: originalBody,
      normalized_message: text(message.normalized_message || ""),
      normalized_for_intent: body,
      canonical_signals: intentPayload.canonicalSignals,
      intent_tokens: intentPayload.intentTokens,
      productAliasDetected: Boolean(productAlias.canonicalProduct),
      canonicalProduct: productAlias.canonicalProduct,
      matchedAlias: productAlias.matchedAlias,
      aliasConfidence: productAlias.confidence,
    },
    lastMessageAt: message.received_at || new Date().toISOString(),
  });
  const sessionUpdate = await db.query(
    `
    UPDATE ai_support_sessions
    SET
      source = 'whatsapp',
      channel = 'whatsapp',
      customer_name = COALESCE(NULLIF($3, ''), customer_name),
      last_message = $4,
      updated_at = NOW()
    WHERE tenant_id = $1 AND session_id = $2
    `,
    [tenantId, conversationId, text(order?.customer_name), originalBody]
  );
  if (!sessionUpdate.rowCount) {
    await db.query(
      `
      INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, last_message, status, updated_at)
      VALUES ($1, $2, 'whatsapp', 'whatsapp', $3, $4, 'ai_active', NOW())
      `,
      [tenantId, conversationId, text(order?.customer_name), originalBody]
    );
  }
  await db.query(
    `
    INSERT INTO ai_support_messages (
      tenant_id, session_id, message_text, customer_message, ai_answer, confidence, needs_human_support,
      sources_used, suggested_products, visual_attachments, suggested_actions, detected_intent, fallback_reason,
      sender_type, channel, customer_name, last_message, insert_source
    )
    VALUES ($1, $2, $3, $3, '', 0, $6, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'whatsapp_customer_reply', $7, 'customer', 'whatsapp', $4, $3, $5)
    `,
    [
      tenantId,
      conversationId,
      originalBody,
      text(order?.customer_name),
      needsFollowup ? "whatsapp_order_confirmation_needs_followup" : "whatsapp_order_confirmation",
      needsFollowup,
      needsFollowup ? "whatsapp_order_confirmation_followup" : "whatsapp_order_confirmation_other_reply",
    ]
  );
  console.info("[ai-support-insert]", {
    source: "whatsapp_order_confirmation",
    session_id: conversationId,
    channel: "whatsapp",
    needs_followup: needsFollowup,
  });
  await logChannelEvent({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    direction: "inbound",
    externalCustomerId: phone,
    conversationId,
    messagePreview: originalBody,
    status: needsFollowup ? "needs_followup" : "forwarded_to_ai",
    metadata: { source: "evolution_api", order_id: order?.id || null, needs_followup: needsFollowup },
  }).catch(() => {});
  console.info("[whatsapp:order-forwarded-to-ai]", {
    tenantId,
    conversationId,
    phoneSuffix: phone.slice(-4),
    orderId: order?.id || null,
    needsFollowup,
  });
  return { forwarded: true, conversation_id: conversationId, needs_followup: needsFollowup };
};

const processConfirmationReplyLegacy = async (message = {}) => {
  const phone = normalizeEgyptPhone(message.phone || message.from || message.sender || "");
  const originalBody = text(message.original_message || message.text || message.message_text || message.body);
  const intentPayload = normalizeArabicIntentPayload(originalBody);
  const body = text(message.normalized_for_intent || intentPayload.normalizedForIntent || message.text || message.message_text || message.body);
  const reply = normalizedReply(body);
  const replySignal = normalizedReply([originalBody, body, ...whatsappButtonSignalValues(message)].filter(Boolean).join(" "));
  const compactReplySignal = replySignal.replace(/[\uFE0F\u20E3]/g, "").trim();
  const productAlias = resolveProductAlias(originalBody || body);
  console.log("[arabic-intent-signals]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: originalBody,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: body,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[product-alias]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: originalBody,
    normalizedText: intentPayload.normalizedText,
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    confidence: productAlias.confidence,
  });
  const order = await findPendingOrderByPhone(phone);
  const hasSignal = (...names) => names.some((name) => (intentPayload.canonicalSignals || []).includes(name));
  const replyMatches = (haystack = "", ...needles) => {
    const safeHaystack = text(haystack).toLowerCase();
    return needles.some((needle) => safeHaystack.includes(text(needle).toLowerCase()));
  };
  const isConfirmShortcut = order && (
    /^1(\b|$)/.test(compactReplySignal) ||
    replyMatches(compactReplySignal, "confirm order", "confirm_order", "button confirm_order", "تأكيد الطلب")
  );
  const isPostponeShortcut = order && (
    /^2(\b|$)/.test(compactReplySignal) ||
    replyMatches(compactReplySignal, "postpone delivery", "postpone_delivery", "button postpone_delivery", "delay delivery", "تأجيل التسليم")
  );
  const isCancelShortcut = order && (
    /^3(\b|$)/.test(compactReplySignal) ||
    replyMatches(compactReplySignal, "cancel order", "cancel_order", "button cancel_order", "إلغاء الطلب")
  );
  if (isConfirmShortcut) {
    const confirmed = await markOrderConfirmed(order.id);
    return { action: "confirmed", order: confirmed };
  }
  if (isPostponeShortcut) {
    const forwarded = await forwardToAiInbox({
      message: {
        ...message,
        phone,
        text: originalBody,
        original_message: originalBody,
        normalized_for_intent: body,
        canonical_signals: intentPayload.canonicalSignals,
        intent_tokens: intentPayload.intentTokens,
      },
      order,
      needsFollowup: true,
    });
    return { action: "needs_followup", order, ...forwarded };
  }
  if (isCancelShortcut) {
    const cancelled = await markOrderCancelled(order.id);
    return { action: "cancelled", order: cancelled };
  }
  const isConfirmReply = order && (
    CONFIRM_WORDS.has(reply) ||
    hasSignal("yes", "confirm") ||
    /^1(\b|$)/.test(replySignal) ||
    replySignal.includes("confirm order") ||
    replySignal.includes("تأكيد الطلب") ||
    replySignal.includes("confirm_order") ||
    replySignal.includes("button confirm_order")
  );
  const isPostponeReply = order && (
    /^2(\b|$)/.test(replySignal) ||
    replySignal.includes("postpone delivery") ||
    replySignal.includes("delay delivery") ||
    replySignal.includes("تأجيل التسليم") ||
    replySignal.includes("postpone_delivery") ||
    replySignal.includes("button postpone_delivery")
  );
  const isCancelReply = order && (
    CANCEL_WORDS.has(reply) ||
    hasSignal("no", "reject", "cancel") ||
    /^3(\b|$)/.test(replySignal) ||
    replySignal.includes("cancel order") ||
    replySignal.includes("إلغاء الطلب") ||
    replySignal.includes("cancel_order") ||
    replySignal.includes("button cancel_order")
  );
  if (isConfirmReply) {
    const confirmed = await markOrderConfirmed(order.id);
    return { action: "confirmed", order: confirmed };
  }
  if (isPostponeReply) {
    const forwarded = await forwardToAiInbox({
      message: {
        ...message,
        phone,
        text: originalBody,
        original_message: originalBody,
        normalized_for_intent: body,
        canonical_signals: intentPayload.canonicalSignals,
        intent_tokens: intentPayload.intentTokens,
      },
      order,
      needsFollowup: true,
    });
    return { action: "needs_followup", order, ...forwarded };
  }
  if (isCancelReply) {
    const cancelled = await markOrderCancelled(order.id);
    return { action: "cancelled", order: cancelled };
  }
  if (message.inbox?.saved || message.inbox_saved) {
    return { action: "already_saved_to_ai_inbox", order, forwarded: true, conversation_id: message.inbox?.session_id || message.conversation_id || message.external_conversation_id || "" };
  }
  const forwarded = await forwardToAiInbox({ message: { ...message, phone, text: originalBody, original_message: originalBody, normalized_for_intent: body, canonical_signals: intentPayload.canonicalSignals, intent_tokens: intentPayload.intentTokens }, order });
  return { action: "forwarded_to_ai", order, ...forwarded };
};

export { applyConfirmationAction };

export const processConfirmationReply = async (message = {}) => {
  // Defense in depth: an order may only be decided by the customer. Our own outgoing prompt
  // contains every action label, so echoing it back would confirm the order it just asked about.
  if (message.fromMe === true) {
    console.info("[whatsapp:confirmation-reply-ignored-own-message]", {
      messageId: message.messageId || message.message_id || "",
      remoteJid: message.remoteJid || "",
    });
    return { action: "ignored", reason: "own_outgoing_message" };
  }
  const phone = normalizeEgyptPhone(message.phone || message.from || message.sender || "");
  const originalBody = text(message.original_message || message.text || message.message_text || message.body);
  const intentPayload = normalizeArabicIntentPayload(originalBody);
  const body = text(message.normalized_for_intent || intentPayload.normalizedForIntent || message.text || message.message_text || message.body);
  const reply = normalizedReply(body);
  const replySignal = normalizedReply([originalBody, body, ...whatsappButtonSignalValues(message)].filter(Boolean).join(" "));
  const compactReplySignal = replySignal.replace(/[\uFE0F\u20E3]/g, "").trim();
  const productAlias = resolveProductAlias(originalBody || body);
  console.log("[arabic-intent-signals]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: originalBody,
    normalizedText: intentPayload.normalizedText,
    normalizedForIntent: body,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[product-alias]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: originalBody,
    normalizedText: intentPayload.normalizedText,
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    confidence: productAlias.confidence,
  });

  const actionFromButton = (() => {
    const candidates = [
      ...whatsappButtonSignalValues(message),
      message.interactive?.button_reply?.id,
      message.button?.payload,
      message.button?.text,
      message.interactive?.button_reply?.title,
      originalBody,
      body,
    ].map((value) => text(value));
    for (const candidate of candidates) {
      const match = candidate.match(/(confirm_order|edit_order|cancel_order)(?::(\d+))?/i);
      if (match) return { action: match[1].toLowerCase().replace("_order", ""), orderId: match[2] || "" };
    }
    return null;
  })();

  const replyIs = (...needles) => needles.some((needle) => replySignal.includes(text(needle).toLowerCase()));
  const hasSignal = (...names) => names.some((name) => (intentPayload.canonicalSignals || []).includes(name));
  const order = await loadConfirmationOrder({
    orderId: actionFromButton?.orderId || "",
    phone,
  });
  const currentStatus = text(order?.status).toLowerCase();

  const isConfirmReply = Boolean(order) && (
    CONFIRM_WORDS.has(reply) ||
    hasSignal("yes", "confirm") ||
    /^1(\b|$)/.test(compactReplySignal) ||
    replyIs("confirm order", "confirm_order", "button confirm_order", "تأكيد الطلب")
  );
  const isEditReply = Boolean(order) && (
    /^2(\b|$)/.test(compactReplySignal) ||
    replyIs("edit order", "edit_order", "button edit_order", "modify order", "تعديل الطلب")
  );
  const isCancelReply = Boolean(order) && (
    CANCEL_WORDS.has(reply) ||
    hasSignal("no", "reject", "cancel") ||
    /^3(\b|$)/.test(compactReplySignal) ||
    replyIs("cancel order", "cancel_order", "button cancel_order", "إلغاء الطلب")
  );
  const isCancelledReason = Boolean(order) && text(order.status).toLowerCase() === "cancelled_by_customer" && Boolean(originalBody) && !isConfirmReply && !isEditReply && !isCancelReply;

  if (isCancelledReason) {
    const updated = await applyConfirmationAction({
      orderId: order.id,
      action: "cancel_reason",
      reason: originalBody,
      source: "whatsapp_webhook",
      actorType: "customer",
    });
    const tenantId = tenantIdForMessage(message, updated || order);
    if (tenantId && phone) {
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
        tenant_id: tenantId,
        session_id: `whatsapp:${phone}`,
        order_id: updated?.id || order.id,
        at: new Date().toISOString(),
      });
    }
    return { action: "cancel_reason_saved", order: updated };
  }

  let action = actionFromButton?.action || "";
  if (!action && isConfirmReply) action = "confirm";
  if (!action && isEditReply) action = "edit";
  if (!action && isCancelReply) action = "cancel";

  // Re-tapping a button the order already reflects is a no-op, but silence reads as a broken
  // system. Acknowledge the state the order is actually in, and never re-run the side effects.
  const alreadyInState = {
    confirm: currentStatus === "confirmed" ? `طلبك رقم ${orderNumber(order)} مؤكد بالفعل ✅ وإحنا بنجهّزه.` : "",
    edit: currentStatus === "edit_requested" ? `طلب التعديل على طلبك رقم ${orderNumber(order)} وصلنا بالفعل، والفريق بيراجعه.` : "",
    cancel: currentStatus === "cancelled_by_customer" ? `طلبك رقم ${orderNumber(order)} ملغي بالفعل.` : "",
  }[action];
  if (action && alreadyInState) {
    if (phone) await sendTextMessage({ phone, message: alreadyInState }).catch(() => {});
    return {
      action: action === "edit" ? "edit_requested" : action === "cancel" ? "cancelled_by_customer" : "confirmed",
      order,
      repeated: true,
    };
  }

  if (action) {
    // WhatsApp buttons stay tappable forever, so a tap can land on an order that has moved on.
    // Whatever we answer must be TRUE: applyConfirmationAction silently returns the unchanged
    // order when it refuses, and throws for dispatched orders. Both used to end with the customer
    // being told their request was received while nothing was recorded anywhere (INV-659).
    let updatedOrder = null;
    let refusalReason = "";
    try {
      updatedOrder = await applyConfirmationAction({
        orderId: order?.id || actionFromButton?.orderId || "",
        action,
        reason: originalBody,
        source: "whatsapp_webhook",
        actorType: "customer",
      });
    } catch (applyError) {
      if (applyError?.code !== "ORDER_CONFIRMATION_LINK_LOCKED") throw applyError;
      refusalReason = "order_dispatched";
      updatedOrder = order;
    }
    if (!updatedOrder) return { action: "ignored", order };

    if (!refusalReason) {
      refusalReason = orderActionRefusalReason({ action, resultingStatus: updatedOrder.status });
    }

    if (refusalReason) {
      console.warn("[whatsapp:order-action-refused]", {
        orderId: updatedOrder?.id || order?.id || null,
        orderNumber: orderNumber(updatedOrder),
        action,
        currentStatus: text(updatedOrder.status).toLowerCase(),
        reason: refusalReason,
        phoneSuffix: phone.slice(-4),
      });
      if (phone) {
        const refusalMessage = refusalReason === "order_dispatched"
          ? `طلبك رقم ${orderNumber(updatedOrder)} خرج للشحن بالفعل، فمش هينفع نعدّله أو نلغيه من هنا. كلّمنا وهنشوف نساعدك إزاي.`
          : `معلش، مش هينفع ننفّذ الطلب ده على طلبك رقم ${orderNumber(updatedOrder)} في حالته الحالية. كلّمنا وهنساعدك.`;
        await sendTextMessage({ phone, message: refusalMessage }).catch(() => {});
      }
      // A refusal is still a customer asking for something — put it in front of a human.
      await markAiSupportConversationEscalated({
        tenantId: tenantIdForMessage(message, updatedOrder),
        sessionId: `whatsapp:${phone}`,
        reason: `customer_${action}_refused_${refusalReason}`,
        keyword: `${action}_order`,
        actorUserId: message.user_id || message.actor_user_id || null,
        source: "whatsapp_order_confirmation",
      }).catch(() => {});
      return { action: "refused", reason: refusalReason, order: updatedOrder };
    }

    const actionMessage = action === "confirm"
      ? `✅ تأكيد الطلب ${orderNumber(updatedOrder)}`
      : action === "edit"
        ? `✏️ تعديل الطلب ${orderNumber(updatedOrder)}`
        : `❌ إلغاء الطلب ${orderNumber(updatedOrder)}`;

    await forwardToAiInbox({
      message: {
        ...message,
        phone,
        text: actionMessage,
        original_message: actionMessage,
        normalized_for_intent: actionMessage,
        canonical_signals: intentPayload.canonicalSignals,
        intent_tokens: intentPayload.intentTokens,
      },
      order: updatedOrder,
      needsFollowup: action === "edit",
    });

    if (action === "edit") {
      await markAiSupportConversationEscalated({
        tenantId: tenantIdForMessage(message, updatedOrder),
        sessionId: `whatsapp:${phone}`,
        reason: "customer_requested_edit",
        keyword: "edit_order",
        actorUserId: message.user_id || message.actor_user_id || null,
        source: "whatsapp_order_confirmation",
      }).catch(() => {});
    }

    if (phone) {
      const notificationMessage = action === "confirm"
        ? buildOrderConfirmedMessage({
            customerName: firstName(updatedOrder.customer_name),
            order: updatedOrder,
            items: updatedOrder.items || [],
            trackingUrl: buildOrderTrackingUrl(orderNumber(updatedOrder), phone),
            invoiceUrl: buildPublicInvoiceUrl(orderNumber(updatedOrder)),
          })
        : action === "edit"
          ? `وصلنا طلب التعديل على طلبك رقم ${orderNumber(updatedOrder)}. سيقوم الفريق بمراجعته الآن.`
          : `تم إلغاء طلبك رقم ${orderNumber(updatedOrder)}. نأسف لعدم إكمال الطلب.`;
      await sendTextMessage({ phone, message: notificationMessage }).catch(() => {});
    }

    const tenantId = tenantIdForMessage(message, updatedOrder);
    if (tenantId && phone) {
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
        tenant_id: tenantId,
        session_id: `whatsapp:${phone}`,
        order_id: updatedOrder.id,
        action,
        at: new Date().toISOString(),
      });
    }
    if (tenantId) {
      // The orders page only ever listened for `new_order`, so a customer confirming, editing or
      // cancelling from WhatsApp changed the row underneath a staff member who kept seeing the old
      // state until they reloaded by hand. Carry the updated order so the list can patch in place.
      emitToRooms([`tenant:${tenantId}`], "order_updated", {
        tenant_id: tenantId,
        order_id: updatedOrder.id,
        action,
        order: updatedOrder,
        at: new Date().toISOString(),
      });
    }

    return {
      action: action === "edit" ? "edit_requested" : action === "cancel" ? "cancelled_by_customer" : "confirmed",
      order: updatedOrder,
    };
  }

  if (message.inbox?.saved || message.inbox_saved) {
    return { action: "already_saved_to_ai_inbox", order, forwarded: true, conversation_id: message.inbox?.session_id || message.conversation_id || message.external_conversation_id || "" };
  }

  const forwarded = await forwardToAiInbox({ message: { ...message, phone, text: originalBody, original_message: originalBody, normalized_for_intent: body, canonical_signals: intentPayload.canonicalSignals, intent_tokens: intentPayload.intentTokens }, order });
  return { action: "forwarded_to_ai", order, ...forwarded };
};

export default {
  sendOrderConfirmation,
  sendPaymentReviewNotification,
  sendInvoiceWhatsapp,
  processConfirmationReply,
  findPendingOrderByPhone,
  markOrderConfirmed,
  markOrderCancelled,
};





