import db from "../../database/db.js";
import { sendSmtpMail } from "../staffTaskEmailNotificationService.js";
import { getSiteSettings } from "../siteSettingsService.js";
import { absoluteAssetUrl, storefrontUrl, text } from "./helpers.js";
import { renderAdminOrderNotification, renderCustomerOrderConfirmation } from "./templates.js";

const CUSTOMER_TEMPLATE = "customer_order_confirmation";
const ADMIN_TEMPLATE = "admin_order_notification";
const MAX_ATTEMPTS = Math.max(1, Number(process.env.ORDER_EMAIL_MAX_ATTEMPTS || 5));
const BATCH_SIZE = Math.min(Math.max(Number(process.env.ORDER_EMAIL_BATCH_SIZE || 10), 1), 50);
let processing = false;

const safeError = (error) => String(error?.code || error?.message || "Email delivery failed")
  .replace(/[\r\n]+/g, " ")
  .replace(/(password|token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
  .slice(0, 1000);

const adminRecipients = () => String(
  process.env.ORDER_NOTIFICATION_EMAILS
  || process.env.ORDER_NOTIFICATION_EMAIL
  || process.env.ADMIN_EMAIL
  || process.env.SMTP_USER
  || process.env.MAIL_FROM
  || ""
)
  .split(/[;,]/)
  .map((value) => value.trim().toLowerCase())
  .filter((value, index, list) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && list.indexOf(value) === index);

export const ensureTransactionalEmailSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS transactional_email_outbox (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      template_key VARCHAR(80) NOT NULL,
      recipient_type VARCHAR(30) NOT NULL,
      dedupe_key VARCHAR(180) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TIMESTAMP NULL,
      sent_at TIMESTAMP NULL,
      last_error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT transactional_email_outbox_recipient_type_check CHECK (recipient_type IN ('admin','customer')),
      CONSTRAINT transactional_email_outbox_status_check CHECK (status IN ('pending','processing','retry','sent','failed')),
      CONSTRAINT transactional_email_outbox_dedupe_key_unique UNIQUE (dedupe_key)
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_transactional_email_outbox_ready ON transactional_email_outbox (status, next_attempt_at, id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_transactional_email_outbox_order ON transactional_email_outbox (order_id, template_key)`);
};

export const enqueueOrderCreatedEmails = async (client, { tenantId, orderId, customerEmail = "" } = {}) => {
  const safeTenantId = Number(tenantId || 0);
  const safeOrderId = Number(orderId || 0);
  if (!safeTenantId || !safeOrderId) throw new Error("ORDER_EMAIL_OUTBOX_CONTEXT_REQUIRED");
  const records = [
    { template: ADMIN_TEMPLATE, type: "admin" },
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(customerEmail).toLowerCase())
      ? [{ template: CUSTOMER_TEMPLATE, type: "customer" }]
      : []),
  ];
  for (const record of records) {
    await client.query(`
      INSERT INTO transactional_email_outbox (tenant_id, order_id, template_key, recipient_type, dedupe_key)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (dedupe_key) DO NOTHING
    `, [safeTenantId, safeOrderId, record.template, record.type, `order:${safeOrderId}:${record.template}:${record.type}`]);
  }
  return { queued: records.length };
};

const loadOrderEmailData = async (job) => {
  const [orderResult, itemsResult, previousResult, site] = await Promise.all([
    db.query(`
      SELECT o.*, c.email AS customer_email
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
      WHERE o.id = $1 AND o.tenant_id = $2
      LIMIT 1
    `, [job.order_id, job.tenant_id]),
    db.query(`SELECT * FROM order_items WHERE order_id = $1 AND tenant_id = $2 ORDER BY id ASC`, [job.order_id, job.tenant_id]),
    db.query(`
      SELECT COUNT(*)::int AS count FROM orders
      WHERE customer_id = (SELECT customer_id FROM orders WHERE id = $1)
        AND tenant_id = $2 AND id <> $1 AND deleted_at IS NULL
        AND LOWER(COALESCE(status, '')) NOT IN ('cancelled','canceled')
    `, [job.order_id, job.tenant_id]),
    getSiteSettings({ tenantId: job.tenant_id }).catch(() => ({})),
  ]);
  const order = orderResult.rows[0];
  if (!order) throw new Error("ORDER_EMAIL_ORDER_NOT_FOUND");
  const items = itemsResult.rows.map((item) => ({
    ...item,
    image_url: absoluteAssetUrl(item.variant_image || item.product_image || item.image_url || ""),
    color: item.color || item.color_name || "",
    size: item.size || item.variant_name || "",
  }));
  const appUrl = storefrontUrl();
  const token = text(order.public_token || order.invoice_number || order.id);
  const number = text(order.public_order_number || order.invoice_number || order.id);
  const configuredLogo = absoluteAssetUrl(site?.company_logo_url || "");
  const fallbackLogo = appUrl ? `${appUrl}/branding/m-one-logo-white-fixed.png?v=20260716` : "";
  return {
    order,
    items,
    previousOrdersCount: Number(previousResult.rows[0]?.count || 0),
    brand: {
      logoUrl: configuredLogo || fallbackLogo,
      supportEmail: text(process.env.SUPPORT_EMAIL || "support@m1store-egy.com"),
      socialLinks: [
        { label: "Facebook", url: text(process.env.STORE_FACEBOOK_URL) },
        { label: "Instagram", url: text(process.env.STORE_INSTAGRAM_URL) },
        { label: "TikTok", url: text(process.env.STORE_TIKTOK_URL) },
      ],
    },
    links: {
      invoice: appUrl && token ? `${appUrl}/invoice/${encodeURIComponent(token)}` : "",
      track: appUrl && number ? `${appUrl}/track?order_number=${encodeURIComponent(number)}` : "",
      erpOrder: appUrl ? `${appUrl}/orders/${encodeURIComponent(String(order.id))}` : "",
    },
  };
};

const claimNextJobs = async () => {
  const result = await db.query(`
    WITH ready AS (
      SELECT id FROM transactional_email_outbox
      WHERE (status IN ('pending','retry') AND next_attempt_at <= NOW())
         OR (status = 'processing' AND locked_at < NOW() - INTERVAL '10 minutes')
      ORDER BY id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE transactional_email_outbox q
    SET status = 'processing', locked_at = NOW(), updated_at = NOW()
    FROM ready WHERE q.id = ready.id
    RETURNING q.*
  `, [BATCH_SIZE]);
  return result.rows;
};

const deliverJob = async (job) => {
  const data = await loadOrderEmailData(job);
  const isCustomer = job.recipient_type === "customer";
  const recipients = isCustomer
    ? [text(data.order.customer_email).toLowerCase()].filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    : adminRecipients();
  if (!recipients.length) throw new Error(isCustomer ? "CUSTOMER_EMAIL_MISSING" : "ORDER_NOTIFICATION_EMAIL_NOT_CONFIGURED");
  const message = isCustomer ? renderCustomerOrderConfirmation(data) : renderAdminOrderNotification(data);
  for (const recipient of recipients) {
    await sendSmtpMail({ to: recipient, subject: message.subject, text: message.text, html: message.html });
  }
  return { recipients: recipients.length };
};

export const processTransactionalEmailOutbox = async () => {
  if (processing || String(process.env.ORDER_EMAILS_ENABLED || "true").toLowerCase() === "false") return { skipped: true };
  processing = true;
  const results = [];
  try {
    const jobs = await claimNextJobs();
    for (const job of jobs) {
      try {
        const delivery = await deliverJob(job);
        await db.query(`UPDATE transactional_email_outbox SET status='sent', attempts=attempts+1, sent_at=NOW(), locked_at=NULL, last_error=NULL, updated_at=NOW() WHERE id=$1`, [job.id]);
        console.log("[order-email] sent", { outboxId: job.id, orderId: job.order_id, template: job.template_key, recipients: delivery.recipients });
        results.push({ id: job.id, status: "sent" });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const message = safeError(error);
        await db.query(`
          UPDATE transactional_email_outbox
          SET status=$2, attempts=$3::integer,
              next_attempt_at=NOW() + (LEAST(60, POWER(2, $3::integer)::integer) * INTERVAL '1 minute'),
              locked_at=NULL, last_error=$4, updated_at=NOW()
          WHERE id=$1
        `, [job.id, failed ? "failed" : "retry", attempts, message]);
        console.warn("[order-email] delivery failed", { outboxId: job.id, orderId: job.order_id, template: job.template_key, attempts, terminal: failed, error: message });
        results.push({ id: job.id, status: failed ? "failed" : "retry" });
      }
    }
    return { processed: results };
  } finally {
    processing = false;
  }
};

export const transactionalEmailStatus = async () => {
  const result = await db.query(`SELECT status, COUNT(*)::int AS count FROM transactional_email_outbox GROUP BY status`);
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count || 0)]));
};
