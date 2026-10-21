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
 * The caps are the owner's, set in the inbox (WhatsApp → "مين يبعت إيه", default 50 a day /
 * 500 a month). WHATSAPP_TEMPLATE_DAILY_CAP / WHATSAPP_TEMPLATE_MONTHLY_CAP, when set on the
 * server, are a CEILING the screen cannot raise. "0" means no template may be sent at all.
 * Counted per Cairo day / month.
 */

import db from "../../database/db.js";
import { loadWhatsappSendRoutes } from "../../services/whatsappQueue/config.js";

const text = (value = "") => String(value ?? "").trim();
const envCeiling = (name) => {
  const raw = text(process.env[name]);
  if (raw === "") return Infinity;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : Infinity;
};
export const templateCaps = async () => {
  const config = await loadWhatsappSendRoutes();
  return {
    daily: Math.min(config.template_daily_cap, envCeiling("WHATSAPP_TEMPLATE_DAILY_CAP")),
    monthly: Math.min(config.template_monthly_cap, envCeiling("WHATSAPP_TEMPLATE_MONTHLY_CAP")),
  };
};

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
    WHERE sent_at > NOW() - INTERVAL '40 days' AND category <> '${SERVICE_CATEGORY}'
  `);
  const row = result.rows[0] || {};
  const caps = await templateCaps();
  const service = await serviceReplyState({ fresh: true }).catch(() => null);
  return {
    today: Number(row.today || 0),
    month: Number(row.month || 0),
    month_marketing: Number(row.month_marketing || 0),
    month_utility: Number(row.month_utility || 0),
    daily_cap: caps.daily,
    monthly_cap: caps.monthly,
    service_month: service ? service.month : null,
    service_limit: service ? service.limit : null,
    service_over_limit: service ? service.mode : null,
  };
};

/*
 * Free-form messages from the official number (replies inside the 24h window, the sales flow,
 * chatbot flows…). Since 2026-10-01 Meta gives each number 1,000 free a month and bills every one
 * after that — and many customers write without buying. The owner never crosses that line by
 * accident (2026-10-21):
 *
 *   - past `service_reply_monthly_limit` (default 1000) the replies to customers move to Evolution
 *     on their own ("evolution"), or are held for a person ("block");
 *   - and whatever path still tries the official number after the limit is refused BEFORE Graph
 *     (assertServiceReplyBudget), so nothing past the free allowance is ever sent by mistake.
 *
 * Counted in the same ledger as category SERVICE, per Cairo month, across our official numbers
 * (Meta counts per number, so this is the cautious side).
 */
const SERVICE_CATEGORY = "SERVICE";
let serviceCache = { at: 0, value: null };
export const serviceReplyState = async ({ fresh = false } = {}) => {
  if (!fresh && serviceCache.value && Date.now() - serviceCache.at < 60 * 1000) return serviceCache.value;
  await ensureSchema();
  const [result, config] = await Promise.all([
    db.query(`
      SELECT COUNT(*) AS month FROM whatsapp_paid_template_sends
       WHERE category = '${SERVICE_CATEGORY}' AND sent_at > NOW() - INTERVAL '40 days'
         AND date_trunc('month', sent_at AT TIME ZONE 'Africa/Cairo') = date_trunc('month', NOW() AT TIME ZONE 'Africa/Cairo')
    `),
    loadWhatsappSendRoutes(),
  ]);
  const value = {
    month: Number(result.rows[0]?.month || 0),
    limit: Math.min(config.service_reply_monthly_limit, envCeiling("WHATSAPP_SERVICE_REPLY_MONTHLY_LIMIT")),
    mode: config.service_reply_over_limit,
  };
  serviceCache = { at: Date.now(), value };
  return value;
};

/* True once this month's free-form messages reached the limit. Unreadable counts as reached. */
export const serviceReplyLimitReached = async () => {
  try {
    const state = await serviceReplyState();
    return state.month >= state.limit;
  } catch {
    return true;
  }
};

export const assertServiceReplyBudget = async () => {
  if (!(await serviceReplyLimitReached())) return;
  const state = serviceCache.value || {};
  console.warn("[whatsapp:service-reply-limit-reached]", state);
  throw Object.assign(
    new Error(`Official-number free replies used up this month (${state.month ?? "?"}/${state.limit ?? "?"}); the message was not sent through Meta`),
    { code: "WHATSAPP_SERVICE_REPLY_LIMIT", status: 429 }
  );
};

/*
 * Where a reply to a customer goes once the allowance is used up. Only a Cloud number is ever
 * affected: { instance } unchanged below the limit; past it, Evolution (switched) or nothing
 * (blocked) as the owner chose. WHATSAPP_TRANSACTIONAL_EVOLUTION_INSTANCE names the Evolution
 * instance (empty = the gateway default).
 */
export const officialReplyRoute = async (instance = "") => {
  const current = text(instance);
  if (!current.toLowerCase().startsWith("cloud:") || !(await serviceReplyLimitReached())) {
    return { instance: current, switched: false, blocked: false };
  }
  if ((serviceCache.value?.mode || "evolution") === "block") {
    console.warn("[whatsapp:service-reply-held]", { instance: current, ...(serviceCache.value || {}) });
    return { instance: current, switched: false, blocked: true };
  }
  console.info("[whatsapp:service-reply-moved-to-evolution]", { from: current, ...(serviceCache.value || {}) });
  return { instance: text(process.env.WHATSAPP_TRANSACTIONAL_EVOLUTION_INSTANCE), switched: true, blocked: false };
};

export const recordServiceReply = async ({ tenantId = null, phone = "", source = "", messageId = "" } = {}) => {
  try {
    await ensureSchema();
    await db.query(
      `INSERT INTO whatsapp_paid_template_sends (tenant_id, template_name, category, recipient_suffix, source, message_id)
       VALUES ($1, '', '${SERVICE_CATEGORY}', $2, $3, $4)`,
      [Number(tenantId) || null, text(phone).replace(/\D/g, "").slice(-4), text(source).slice(0, 80), text(messageId).slice(0, 200)]
    );
    if (serviceCache.value) serviceCache.value = { ...serviceCache.value, month: serviceCache.value.month + 1 };
  } catch (error) {
    console.warn("[whatsapp:service-ledger-failed]", { message: error?.message || String(error) });
  }
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
