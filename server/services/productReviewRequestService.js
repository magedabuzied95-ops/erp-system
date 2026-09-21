/*
 * Product review request — "رأيك في طلبك؟" a few days after delivery.
 *
 * One WhatsApp message per delivered order, with a single button to that order's review link
 * (/review/:code). The delivery message itself already asks for a Google (shop) review at the
 * moment the parcel arrives; this one waits `delay_days` so the customer has worn what they
 * bought, and asks about the products.
 *
 * Guard rails, because this messages every delivered customer:
 * - OFF by default (storefront.product_review_request.enabled).
 * - A window, not a backlog: only orders delivered between delay_days and delay_days + WINDOW
 *   days ago. Switching it on never reaches back to last year's orders.
 * - Send-once is a claim row in product_review_requests (INSERT ... ON CONFLICT DO NOTHING)
 *   taken before the send, the same claim-before-send shape as the price-drop alert: a crash
 *   between the two loses one message rather than sending two. The queue's idempotency key on
 *   the order is the second guard.
 * - Nothing when there is nothing left to review: a fully returned order, or one whose products
 *   were all reviewed already (from the account page, say), is claimed and skipped.
 * - Quiet hours (23:00-10:00 Cairo) hold the message until morning, through the outbound queue,
 *   whose engagement rules expire it the same day if the session is down.
 */

import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { ensureProductReviewsSchema, issueReviewLink, listReviewableItems } from "./productReviewsService.js";
import { quietHoursSendAt } from "./storefrontPriceDropAlertService.js";
import { queueWhatsappAutomation } from "./whatsappQueue/index.js";
import { normalizeWhatsappSessionId } from "../utils/whatsappIdentity.js";
import { PRODUCT_REVIEW_BUTTON_TEXT, PRODUCT_REVIEW_REQUEST_TITLE } from "../utils/whatsappCtaTranscript.js";

export const REVIEW_REQUEST_AUTOMATION_TYPE = "product_review_request";
export const REVIEW_REQUEST_SETTING_KEYS = Object.freeze({
  enabled: "storefront.product_review_request.enabled",
  delayDays: "storefront.product_review_request.delay_days",
});
export const REVIEW_REQUEST_WINDOW_DAYS = 7;
export const REVIEW_REQUEST_ORDERS_PER_TICK = 30;

const text = (value = "") => String(value ?? "").trim();
const bool = (value, fallback = false) => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
};

let schemaReady = null;
export const ensureReviewRequestSchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await ensureProductReviewsSchema(client);
    // Its own table, not a column on orders: DDL on the hottest table in the shop is what boot
    // must never do, and this row is only ever read by this tick.
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_review_requests (
        tenant_id BIGINT NOT NULL,
        order_id BIGINT NOT NULL,
        status TEXT NOT NULL DEFAULT 'claimed',
        detail TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, order_id)
      )
    `);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

export const loadReviewRequestConfig = async () => {
  const [enabled, delayDays] = await Promise.all([
    getSetting(REVIEW_REQUEST_SETTING_KEYS.enabled, false).catch(() => false),
    getSetting(REVIEW_REQUEST_SETTING_KEYS.delayDays, 3).catch(() => 3),
  ]);
  const days = Number(delayDays);
  return {
    enabled: bool(enabled, false),
    delay_days: Number.isFinite(days) ? Math.min(30, Math.max(0, Math.round(days))) : 3,
  };
};

/*
 * The message, as pure data so it can be tested without a gateway. One product is named; more
 * than one is counted, because a list of five shoe names in a WhatsApp bubble is not a sentence.
 */
export const buildReviewRequestMessage = ({ customerName = "", productNames = [], url = "" } = {}) => {
  const firstName = text(customerName).split(/\s+/).filter(Boolean)[0] || "";
  const names = (Array.isArray(productNames) ? productNames : []).map(text).filter(Boolean);
  const greeting = firstName ? `أهلاً يا ${firstName} 👋` : "أهلاً بيك 👋";
  const subject = names.length === 1
    ? `إن شاء الله يكون ${names[0]} عجبك.`
    : names.length > 1
      ? `إن شاء الله تكون المنتجات (${names.length}) عجبتك.`
      : "إن شاء الله طلبك يكون عجبك.";
  const body = `${greeting}\n${subject}\nقولنا رأيك في دقيقة — تقييمك بيساعد غيرك يختار صح.`;
  return {
    title: PRODUCT_REVIEW_REQUEST_TITLE,
    body,
    buttonText: PRODUCT_REVIEW_BUTTON_TEXT,
    url,
    fallbackText: `${body}\n\n${url}`,
  };
};

const setRequestStatus = (tenantId, orderId, status, detail = "") =>
  db.query(
    `UPDATE product_review_requests SET status = $3, detail = NULLIF($4, ''), updated_at = NOW()
     WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId, status, text(detail).slice(0, 300)]
  ).catch(() => {});

/* Orders delivered inside the window that have never been claimed. */
export const findDueOrders = async ({ delayDays, limit = REVIEW_REQUEST_ORDERS_PER_TICK, client = db } = {}) => {
  const { rows } = await client.query(
    `
    SELECT o.id AS order_id, o.tenant_id, o.customer_id, o.customer_phone, o.customer_name, delivery.delivered_at
    FROM orders o
    JOIN LATERAL (
      SELECT MAX(se.created_at) AS delivered_at
      FROM shipping_events se
      WHERE se.order_id = o.id AND LOWER(se.status) = 'delivered'
    ) delivery ON TRUE
    LEFT JOIN product_review_requests rr ON rr.tenant_id = o.tenant_id AND rr.order_id = o.id
    WHERE delivery.delivered_at IS NOT NULL
      AND delivery.delivered_at <= NOW() - make_interval(days => $1::int)
      AND delivery.delivered_at > NOW() - make_interval(days => $1::int + $2::int)
      AND COALESCE(o.customer_phone, '') <> ''
      AND rr.order_id IS NULL
    ORDER BY delivery.delivered_at ASC
    LIMIT $3
    `,
    [delayDays, REVIEW_REQUEST_WINDOW_DAYS, limit]
  );
  return rows;
};

const claimOrder = async ({ tenantId, orderId, client = db }) => {
  const { rowCount } = await client.query(
    `INSERT INTO product_review_requests (tenant_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [tenantId, orderId]
  );
  return rowCount === 1;
};

export const requestReviewForOrder = async (order = {}, { queue = queueWhatsappAutomation, client = db } = {}) => {
  const tenantId = Number(order.tenant_id) || 1;
  const orderId = Number(order.order_id || order.id);
  if (!(await claimOrder({ tenantId, orderId, client }))) return { sent: false, reason: "already_claimed" };

  const items = await listReviewableItems(tenantId, { phone: order.customer_phone, orderId, client });
  if (!items.length) {
    await setRequestStatus(tenantId, orderId, "skipped", "nothing_to_review");
    return { sent: false, reason: "nothing_to_review" };
  }

  const link = await issueReviewLink({ tenantId, orderId, client });
  const message = buildReviewRequestMessage({
    customerName: order.customer_name,
    productNames: items.map((item) => item.product_name),
    url: link.url,
  });
  const phone = text(order.customer_phone);
  const queued = await queue({
    tenantId,
    automationType: REVIEW_REQUEST_AUTOMATION_TYPE,
    customerId: order.customer_id || null,
    orderId,
    recipientPhone: phone,
    send: {
      kind: "cta_url",
      title: message.title,
      footer: "M1 Store",
      displayText: message.buttonText,
      url: message.url,
      fallbackText: message.fallbackText,
    },
    values: {
      customer_name: text(order.customer_name),
      order_number: text(items[0]?.order_number),
      product_name: text(items[0]?.product_name),
      review_url: message.url,
      store_name: "M1 Store",
    },
    fallbackBody: message.body,
    scheduledAt: quietHoursSendAt(),
    onSent: {
      transcript: {
        session_id: normalizeWhatsappSessionId(phone),
        source: "whatsapp_product_review_request",
        customer_name: text(order.customer_name),
        // What the phone shows: the header over the body, and the link as the button under it
        // (the worker reads the button back off `send`). A send that fell back to text logs
        // fallbackText instead, link and all.
        message: `${message.title}\n\n${message.body}`,
      },
    },
    directSend: async () => {
      const { sendCtaUrlMessage } = await import("./whatsappGatewayService.js");
      return sendCtaUrlMessage({
        phone,
        title: message.title,
        text: message.body,
        footer: "M1 Store",
        displayText: message.buttonText,
        url: message.url,
        fallbackText: message.fallbackText,
      });
    },
  }).catch((error) => ({ queued: false, error: error?.message || String(error) }));

  const ok = Boolean(queued?.queued || queued?.duplicate || queued?.direct);
  await setRequestStatus(tenantId, orderId, ok ? "queued" : "failed", ok ? "" : queued?.error || queued?.reason || "");
  return { sent: ok, queued, items: items.length };
};

export const runProductReviewRequestTick = async () => {
  const config = await loadReviewRequestConfig();
  if (!config.enabled) return { requested: 0, reason: "disabled" };
  await ensureReviewRequestSchema();
  const orders = await findDueOrders({ delayDays: config.delay_days });
  let requested = 0;
  for (const order of orders) {
    const result = await requestReviewForOrder(order).catch((error) => {
      console.warn("[review-request] order failed", { order_id: order.order_id, message: error?.message || String(error) });
      return { sent: false };
    });
    if (result.sent) {
      requested += 1;
      console.info("[review-request] queued", {
        order_id: order.order_id,
        items: result.items,
        phoneSuffix: text(order.customer_phone).slice(-4),
      });
    }
  }
  return { requested, due: orders.length };
};
