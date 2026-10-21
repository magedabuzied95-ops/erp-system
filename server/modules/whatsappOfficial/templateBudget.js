/*
 * The brake on Meta's bill.
 *
 * Since 2026-10-01 every template Meta delivers is billed — utility ones too, even inside the 24h
 * window. The store's policy (owner, 2026-10-21): order messages leave from Evolution for free,
 * the official number sends MARKETING only, and Meta's bill must never surprise anyone. So every
 * template send, from any path (queue, campaigns, chatbot flows, public API), passes through here:
 *
 *   assertTemplateBudget() — refuses the send once today's or this month's cap is reached
 *   recordPaidTemplate()   — one ledger row per template Meta accepted
 *
 * Caps come from the environment so they can be raised without a deploy of code:
 *   WHATSAPP_TEMPLATE_DAILY_CAP   (default 50)
 *   WHATSAPP_TEMPLATE_MONTHLY_CAP (default 500)
 * "0" means no template may be sent at all. Counted per Cairo day / month.
 */

import db from "../../database/db.js";

const text = (value = "") => String(value ?? "").trim();
const cap = (name, fallback) => {
  const raw = text(process.env[name]);
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};
export const templateCaps = () => ({
  daily: cap("WHATSAPP_TEMPLATE_DAILY_CAP", 50),
  monthly: cap("WHATSAPP_TEMPLATE_MONTHLY_CAP", 500),
});

let schemaReady = null;
const ensureSchema = () => {
  schemaReady ||= db.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_paid_template_sends (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      template_name VARCHAR(512) NOT NULL DEFAULT '',
      category VARCHAR(20) NOT NULL DEFAULT '',
      recipient_suffix VARCHAR(8) NOT NULL DEFAULT '',
      source VARCHAR(80) NOT NULL DEFAULT '',
      message_id VARCHAR(200) NOT NULL DEFAULT '',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_paid_template_sends_sent_at ON whatsapp_paid_template_sends (sent_at);
  `).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

export const templateBudgetUsage = async () => {
  await ensureSchema();
  const result = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE (sent_at AT TIME ZONE 'Africa/Cairo')::date = (NOW() AT TIME ZONE 'Africa/Cairo')::date) AS today,
      COUNT(*) FILTER (WHERE date_trunc('month', sent_at AT TIME ZONE 'Africa/Cairo') = date_trunc('month', NOW() AT TIME ZONE 'Africa/Cairo')) AS month,
      COUNT(*) FILTER (WHERE category = 'MARKETING' AND date_trunc('month', sent_at AT TIME ZONE 'Africa/Cairo') = date_trunc('month', NOW() AT TIME ZONE 'Africa/Cairo')) AS month_marketing,
      COUNT(*) FILTER (WHERE category = 'UTILITY' AND date_trunc('month', sent_at AT TIME ZONE 'Africa/Cairo') = date_trunc('month', NOW() AT TIME ZONE 'Africa/Cairo')) AS month_utility
    FROM whatsapp_paid_template_sends
    WHERE sent_at > NOW() - INTERVAL '40 days'
  `);
  const row = result.rows[0] || {};
  const caps = templateCaps();
  return {
    today: Number(row.today || 0),
    month: Number(row.month || 0),
    month_marketing: Number(row.month_marketing || 0),
    month_utility: Number(row.month_utility || 0),
    daily_cap: caps.daily,
    monthly_cap: caps.monthly,
  };
};

/*
 * Throws WHATSAPP_TEMPLATE_BUDGET_REACHED when the send would go past a cap. A failure to READ
 * the ledger also refuses: when we cannot tell what was spent, we do not spend more.
 */
export const assertTemplateBudget = async ({ templateName = "" } = {}) => {
  let usage;
  try {
    usage = await templateBudgetUsage();
  } catch (error) {
    throw Object.assign(new Error(`Template budget unreadable, send refused: ${error?.message || error}`), { code: "WHATSAPP_TEMPLATE_BUDGET_UNKNOWN", status: 503 });
  }
  if (usage.today >= usage.daily_cap || usage.month >= usage.monthly_cap) {
    console.warn("[whatsapp:template-budget-reached]", { template: text(templateName), ...usage });
    throw Object.assign(
      new Error(`WhatsApp template budget reached (${usage.today}/${usage.daily_cap} today, ${usage.month}/${usage.monthly_cap} this month)`),
      { code: "WHATSAPP_TEMPLATE_BUDGET_REACHED", status: 429 }
    );
  }
  return usage;
};

export const recordPaidTemplate = async ({ tenantId = null, templateName = "", phone = "", source = "", messageId = "" } = {}) => {
  try {
    await ensureSchema();
    const category = await db.query(
      `SELECT category FROM whatsapp_message_templates WHERE name = $1 ORDER BY (status = 'APPROVED') DESC LIMIT 1`,
      [text(templateName)]
    ).then((result) => text(result.rows[0]?.category)).catch(() => "");
    await db.query(
      `INSERT INTO whatsapp_paid_template_sends (tenant_id, template_name, category, recipient_suffix, source, message_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [Number(tenantId) || null, text(templateName).slice(0, 512), category.slice(0, 20), text(phone).replace(/\D/g, "").slice(-4), text(source).slice(0, 80), text(messageId).slice(0, 200)]
    );
  } catch (error) {
    // The send already happened; a lost ledger row must not turn it into an error.
    console.warn("[whatsapp:template-ledger-failed]", { template: text(templateName), message: error?.message || String(error) });
  }
};
