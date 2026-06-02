import db from "../database/db.js";
import {
  AI_AGENT_CHANNELS,
  logChannelEvent,
  upsertChannelConversationMapping,
} from "./aiChannelAdapterService.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";
import { normalizeEgyptPhone, sendTextMessage } from "./whatsappGatewayService.js";
import { buildInvoiceReceiptWhatsappMessage, buildPublicInvoiceUrl } from "../utils/whatsapp.js";
import { getSetting } from "./settingsService.js";

const CONFIRM_WORDS = new Set(["1", "تأكيد", "تاكيد", "confirm", "yes", "تمام"]);
const CANCEL_WORDS = new Set(["2", "إلغاء", "الغاء", "cancel", "no"]);
const STOREFRONT_SOURCES = new Set(["storefront", "website", "web"]);
const PAYMENT_REVIEW_METHODS = new Set(["instapay", "vodafone_cash", "bank_transfer", "shipping_confirmation", "transfer"]);
const PAYMENT_REVIEW_STATUSES = new Set(["partially_paid", "awaiting_payment_review", "shipping_paid"]);

const text = (value, fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value) => number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const json = (value) => JSON.stringify(value === undefined ? null : value);

let schemaReadyPromise = null;

export const ensureWhatsappOrderConfirmationSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise || clientOrPool !== db) {
    const run = async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_confirmed_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_cancelled_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_payment_review_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS whatsapp_invoice_sent_at TIMESTAMP NULL`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_confirmation_phone ON orders (customer_phone, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_whatsapp_confirmation_pending ON orders (tenant_id, status, created_at DESC)`);
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

const buildConfirmationMessage = (order = {}, items = []) => `أهلاً يا ${firstName(order.customer_name)}

طلبك من M1 Store جاهز للتأكيد ✅

رقم الطلب: #${orderNumber(order)}

${productSummary(items)}

الإجمالي: ${money(order.total_amount ?? order.total_price ?? order.total)} جنيه

1️⃣ تأكيد الطلب
2️⃣ إلغاء الطلب

يمكنك أيضًا كتابة أي استفسار وسنرد عليك.`;

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
    SELECT *
    FROM order_items
    WHERE order_id = $1
    ORDER BY id ASC
    `,
    [orderId]
  );
  return result.rows;
};

const loadOrderById = async (orderId) => {
  const result = await db.query(`SELECT * FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
  return result.rows[0] || null;
};

export const sendOrderConfirmation = async (order = {}) => {
  await ensureWhatsappOrderConfirmationSchema();
  const current = order?.id ? await loadOrderById(order.id) : order;
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
  const items = Array.isArray(order.items) && order.items.length ? order.items : await loadOrderItems(current.id);
  const message = buildConfirmationMessage(current, items);
  const result = await sendTextMessage({ phone, message });
  await db.query(
    `
    UPDATE orders
    SET whatsapp_confirmation_sent_at = COALESCE(whatsapp_confirmation_sent_at, NOW()),
        updated_at = NOW()
    WHERE id = $1
    `,
    [current.id]
  );
  console.info("[whatsapp:order-confirmation-sent]", {
    orderId: current.id,
    orderNumber: orderNumber(current),
    phoneSuffix: phone.slice(-4),
  });
  return { sent: true, order: current, result };
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
    await db.query(
      `
      UPDATE orders
      SET whatsapp_payment_review_sent_at = COALESCE(whatsapp_payment_review_sent_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
      `,
      [current.id]
    );
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
  const current = order?.id ? await loadOrderById(order.id) : order;
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
  const posAutoSendEnabled = isPosInvoice
    ? options.autoSendEnabled !== undefined
      ? options.autoSendEnabled !== false
      : await getSetting("pos.auto_send_pos_invoice_whatsapp", true).catch(() => true)
    : true;
  const status = text(current?.status).toLowerCase();
  const reason = !current?.id
    ? "order_missing"
    : isPosInvoice && !posAutoSendEnabled
      ? "setting_disabled"
      : isPosInvoice && ["cancelled", "canceled"].includes(status)
        ? "cancelled_order"
        : isPosInvoice
          ? source !== "pos"
            ? "not_pos_order"
            : current.whatsapp_invoice_sent_at
              ? "already_sent"
              : !phone
                ? "missing_phone"
                : !invoiceNumber
                  ? "missing_invoice_number"
                  : !invoiceUrl
                    ? "missing_invoice_url"
                    : ""
          : !STOREFRONT_SOURCES.has(source)
            ? "not_storefront_order"
            : current.whatsapp_invoice_sent_at
              ? "already_sent"
              : !phone
                ? "missing_phone"
                : !invoiceNumber
                  ? "missing_invoice_number"
                  : !invoiceUrl
                    ? "missing_invoice_url"
                    : "";
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
    const result = await sendTextMessage({ phone, message });
    await db.query(
      `
      UPDATE orders
      SET whatsapp_invoice_sent_at = COALESCE(whatsapp_invoice_sent_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
      `,
      [current.id]
    );
    console.info(logTags.sent, {
      orderId: current.id,
      orderNumber: orderNumber(current),
      invoiceNumber,
      invoiceUrl,
      phoneSuffix: phone.slice(-4),
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
    SELECT *
    FROM orders
    WHERE LOWER(COALESCE(status, '')) = 'pending_confirmation'
      AND LOWER(COALESCE(source, channel, '')) = ANY($2::text[])
      AND whatsapp_confirmed_at IS NULL
      AND whatsapp_cancelled_at IS NULL
      AND (
        regexp_replace(COALESCE(customer_phone, ''), '\\D', '', 'g') = $1
        OR regexp_replace(COALESCE(customer_phone, ''), '\\D', '', 'g') = regexp_replace($1, '^20', '0')
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [normalizedPhone, [...STOREFRONT_SOURCES]]
  );
  return result.rows[0] || null;
};

export const markOrderConfirmed = async (orderId) => {
  await ensureWhatsappOrderConfirmationSchema();
  const result = await db.query(
    `
    UPDATE orders
    SET status = 'confirmed',
        whatsapp_confirmed_at = COALESCE(whatsapp_confirmed_at, NOW()),
        whatsapp_cancelled_at = NULL,
        updated_at = NOW()
    WHERE id = $1
      AND LOWER(COALESCE(status, '')) = 'pending_confirmation'
    RETURNING *
    `,
    [orderId]
  );
  const order = result.rows[0] || null;
  if (order) console.info("[whatsapp:order-confirmed]", { orderId: order.id, orderNumber: orderNumber(order) });
  return order;
};

export const markOrderCancelled = async (orderId) => {
  await ensureWhatsappOrderConfirmationSchema();
  const result = await db.query(
    `
    UPDATE orders
    SET status = 'cancelled',
        whatsapp_cancelled_at = COALESCE(whatsapp_cancelled_at, NOW()),
        whatsapp_confirmed_at = NULL,
        updated_at = NOW()
    WHERE id = $1
      AND LOWER(COALESCE(status, '')) = 'pending_confirmation'
    RETURNING *
    `,
    [orderId]
  );
  const order = result.rows[0] || null;
  if (order) console.info("[whatsapp:order-cancelled]", { orderId: order.id, orderNumber: orderNumber(order) });
  return order;
};

const tenantIdForMessage = (message = {}, order = null) => number(message.tenant_id || message.tenantId || order?.tenant_id || process.env.WHATSAPP_TENANT_ID || 1, 1);

const forwardToAiInbox = async ({ message = {}, order = null } = {}) => {
  const phone = normalizeEgyptPhone(message.phone || message.from || message.sender || "");
  const body = text(message.text || message.message_text || message.body);
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
      last_message: body,
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
    [tenantId, conversationId, text(order?.customer_name), body]
  );
  if (!sessionUpdate.rowCount) {
    await db.query(
      `
      INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, last_message, status, updated_at)
      VALUES ($1, $2, 'whatsapp', 'whatsapp', $3, $4, 'ai_active', NOW())
      `,
      [tenantId, conversationId, text(order?.customer_name), body]
    );
  }
  await db.query(
    `
    INSERT INTO ai_support_messages (
      tenant_id, session_id, message_text, customer_message, ai_answer, confidence, needs_human_support,
      sources_used, suggested_products, visual_attachments, suggested_actions, detected_intent, fallback_reason,
      sender_type, channel, customer_name, last_message
    )
    VALUES ($1, $2, $3, $3, '', 0, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'whatsapp_customer_reply', 'whatsapp_order_confirmation_other_reply', 'customer', 'whatsapp', $4, $3)
    `,
    [tenantId, conversationId, body, text(order?.customer_name)]
  );
  await logChannelEvent({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    direction: "inbound",
    externalCustomerId: phone,
    conversationId,
    messagePreview: body,
    status: "forwarded_to_ai",
    metadata: { source: "evolution_api", order_id: order?.id || null },
  }).catch(() => {});
  console.info("[whatsapp:order-forwarded-to-ai]", {
    tenantId,
    conversationId,
    phoneSuffix: phone.slice(-4),
    orderId: order?.id || null,
  });
  return { forwarded: true, conversation_id: conversationId };
};

export const processConfirmationReply = async (message = {}) => {
  const phone = normalizeEgyptPhone(message.phone || message.from || message.sender || "");
  const body = text(message.text || message.message_text || message.body);
  const reply = normalizedReply(body);
  const order = await findPendingOrderByPhone(phone);
  if (order && CONFIRM_WORDS.has(reply)) {
    const confirmed = await markOrderConfirmed(order.id);
    return { action: "confirmed", order: confirmed };
  }
  if (order && CANCEL_WORDS.has(reply)) {
    const cancelled = await markOrderCancelled(order.id);
    return { action: "cancelled", order: cancelled };
  }
  const forwarded = await forwardToAiInbox({ message: { ...message, phone, text: body }, order });
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
