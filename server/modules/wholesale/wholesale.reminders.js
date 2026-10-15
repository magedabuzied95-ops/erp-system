import db from "../../database/db.js";
import { dateKeyInAppTimeZone, zonedParts } from "../../utils/appTimezone.js";
import { queueWhatsappAutomation } from "../../services/whatsappQueue/index.js";
import { sendTextMessage } from "../../services/whatsappGatewayService.js";
import { listChannelAccounts } from "../../services/channelAccountsService.js";
import { ensureWholesaleSchema } from "./wholesale.schema.js";
import { isWholesaleMode } from "./wholesaleMode.js";
import { buildWholesaleStatement } from "./wholesale.statement.js";
import { getStatementLink } from "./wholesale.payments.js";

// The weekly balance reminder. Each credit customer has their own Cairo day + hour (set in
// Customer 360 in the AI Inbox). It leaves ONLY from the WhatsApp line chosen for wholesale
// reminders — never the default line, which on this server could be the retail number.

export const REMINDER_AUTOMATION_TYPE = "wholesale_balance_reminder";

const text = (value) => String(value ?? "").trim();
const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: "WHOLESALE_REMINDER_INVALID" });
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const clampInt = (value, min, max, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const money = (value) => round(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

const DEFAULTS = Object.freeze({ enabled: false, weekday: 6, hour: 11, min_balance: 1000, skip_paid_days: 7 });

const shapeSettings = (row) => ({
  enabled: row ? row.reminder_enabled === true : DEFAULTS.enabled,
  weekday: row ? Number(row.reminder_weekday) : DEFAULTS.weekday,
  hour: row ? Number(row.reminder_hour) : DEFAULTS.hour,
  min_balance: row ? Number(row.reminder_min_balance) : DEFAULTS.min_balance,
  skip_paid_days: row ? Number(row.reminder_skip_paid_days) : DEFAULTS.skip_paid_days,
  last_sent_at: row?.reminder_last_sent_at || null,
});

/** The shop-wide line reminders leave from ("" = not chosen yet, nothing is sent). */
export const getReminderLine = async ({ tenantId }) => {
  await ensureWholesaleSchema();
  const { rows: [row] } = await db.query("SELECT reminder_instance FROM wholesale_settings WHERE tenant_id = $1", [tenantId]);
  return text(row?.reminder_instance);
};

export const getReminderLineOptions = async ({ tenantId }) => {
  const instance = await getReminderLine({ tenantId });
  let accounts = [];
  try {
    accounts = await listChannelAccounts({ tenantId, platform: "whatsapp" });
  } catch {
    accounts = [];
  }
  return {
    instance,
    lines: accounts.map((account) => ({
      instance: text(account.external_account_id),
      name: text(account.display_name) || text(account.external_account_id),
      provider: text(account.provider),
      is_default: account.is_default === true,
    })).filter((line) => line.instance),
  };
};

export const setReminderLine = async ({ tenantId, instance }) => {
  await ensureWholesaleSchema();
  const value = text(instance).slice(0, 160);
  await db.query(
    `INSERT INTO wholesale_settings (tenant_id, reminder_instance, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET reminder_instance = EXCLUDED.reminder_instance, updated_at = NOW()`,
    [tenantId, value]
  );
  return getReminderLineOptions({ tenantId });
};

export const getCustomerReminder = async ({ tenantId, customerId }) => {
  await ensureWholesaleSchema();
  const id = idOf(customerId);
  if (!id) throw fail("العميل مش موجود", 404);
  const { rows: [row] } = await db.query(
    `SELECT reminder_enabled, reminder_weekday, reminder_hour, reminder_min_balance, reminder_skip_paid_days, reminder_last_sent_at
       FROM wholesale_customer_terms WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, id]
  );
  const { rows: log } = await db.query(
    `SELECT balance, status, detail, created_at FROM wholesale_reminder_log
      WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 8`,
    [tenantId, id]
  );
  return { customer_id: id, settings: shapeSettings(row), line: await getReminderLine({ tenantId }), log };
};

export const saveCustomerReminder = async ({ tenantId, customerId, settings = {} }) => {
  await ensureWholesaleSchema();
  const id = idOf(customerId);
  const { rows: [customer] } = await db.query("SELECT id FROM customers WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
  if (!customer) throw fail("العميل مش موجود", 404);
  const minBalance = Number(settings.min_balance);
  if (!Number.isFinite(minBalance) || minBalance < 0) throw fail("أقل رصيد لازم يكون رقم موجب");
  await db.query(
    `INSERT INTO wholesale_customer_terms
       (tenant_id, customer_id, reminder_enabled, reminder_weekday, reminder_hour, reminder_min_balance, reminder_skip_paid_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (tenant_id, customer_id) DO UPDATE
       SET reminder_enabled = EXCLUDED.reminder_enabled, reminder_weekday = EXCLUDED.reminder_weekday,
           reminder_hour = EXCLUDED.reminder_hour, reminder_min_balance = EXCLUDED.reminder_min_balance,
           reminder_skip_paid_days = EXCLUDED.reminder_skip_paid_days, updated_at = NOW()`,
    [
      tenantId,
      id,
      settings.enabled === true,
      clampInt(settings.weekday, 0, 6, DEFAULTS.weekday),
      clampInt(settings.hour, 0, 23, DEFAULTS.hour),
      round(minBalance),
      clampInt(settings.skip_paid_days, 0, 60, DEFAULTS.skip_paid_days),
    ]
  );
  return getCustomerReminder({ tenantId, customerId: id });
};

export const reminderMessage = ({ name, balance, url }) => [
  `أهلاً ${text(name) || "بيك"} 👋`,
  `رصيد حسابك عندنا: ${money(balance)} ج.م`,
  "تقدر تشوف كشف الحساب كامل وتبعت صورة التحويل من اللينك ده:",
  url,
  "شكراً لتعاملك معانا 🙏",
].join("\n");

/** Is today (Cairo) this customer's reminder slot? Hour is "at or after" so a restart can't skip it. */
export const isReminderSlot = (settings, now = new Date()) => {
  const parts = zonedParts(now);
  if (!parts || !settings?.enabled) return false;
  return parts.weekday === Number(settings.weekday) && parts.hour >= Number(settings.hour);
};

const writeLog = (tenantId, customerId, balance, status, detail = "") =>
  db.query(
    "INSERT INTO wholesale_reminder_log (tenant_id, customer_id, balance, status, detail) VALUES ($1, $2, $3, $4, $5)",
    [tenantId, customerId, round(balance), status, text(detail).slice(0, 500)]
  );

const deliver = async ({ tenantId, customer, balance, instance, suffix }) => {
  const { url } = await getStatementLink({ tenantId, customerId: customer.id });
  const body = reminderMessage({ name: customer.name, balance, url });
  const phone = text(customer.phone);
  const result = await queueWhatsappAutomation({
    tenantId,
    automationType: REMINDER_AUTOMATION_TYPE,
    customerId: customer.id,
    recipientPhone: phone,
    instance,
    send: { kind: "text" },
    values: { name: customer.name, balance: money(balance), link: url },
    fallbackBody: body,
    idempotencySuffix: suffix,
    directSend: () => sendTextMessage({ phone, message: body, instance }),
  });
  if (result?.queued === false && result?.direct !== true && !result?.duplicate) {
    throw new Error(result?.reason || "not queued");
  }
  return body;
};

/** One customer, checked against every rule. force=true is "send now" from Customer 360. */
const remindCustomer = async ({ tenantId, row, instance, force = false, now = new Date() }) => {
  const customer = { id: Number(row.customer_id), name: row.name, phone: row.phone };
  if (!text(customer.phone)) {
    await writeLog(tenantId, customer.id, 0, "skipped", "no phone");
    return { status: "skipped", reason: "no_phone" };
  }
  const { balance } = await buildWholesaleStatement({ tenantId, customerId: customer.id });
  if (!force) {
    if (round(balance) <= 0 || round(balance) < Number(row.reminder_min_balance || 0)) {
      await writeLog(tenantId, customer.id, balance, "skipped", "balance below the minimum");
      return { status: "skipped", reason: "low_balance", balance };
    }
    const skipDays = Number(row.reminder_skip_paid_days || 0);
    if (skipDays > 0) {
      const { rows: [paid] } = await db.query(
        `SELECT 1 FROM customer_payments
          WHERE tenant_id = $1 AND customer_id = $2 AND COALESCE(payment_date, created_at) >= $3::timestamptz - make_interval(days => $4::int)
          LIMIT 1`,
        [tenantId, customer.id, now.toISOString(), skipDays]
      );
      if (paid) {
        await writeLog(tenantId, customer.id, balance, "skipped", `paid in the last ${skipDays} days`);
        return { status: "skipped", reason: "paid_recently", balance };
      }
    }
  }
  try {
    const body = await deliver({
      tenantId,
      customer,
      balance,
      instance,
      suffix: force ? `manual:${customer.id}:${Date.now()}` : `weekly:${customer.id}:${dateKeyInAppTimeZone(now)}`,
    });
    await db.query(
      "UPDATE wholesale_customer_terms SET reminder_last_sent_at = NOW() WHERE tenant_id = $1 AND customer_id = $2",
      [tenantId, customer.id]
    );
    await writeLog(tenantId, customer.id, balance, "sent", force ? "manual" : "weekly");
    return { status: "sent", balance, message: body };
  } catch (error) {
    await writeLog(tenantId, customer.id, balance, "failed", `${force ? "manual: " : ""}${error?.message || String(error)}`);
    return { status: "failed", reason: error?.message || String(error), balance };
  }
};

/** "Send now" from Customer 360: ignores the day, hour and balance rules, still needs the line. */
export const sendCustomerReminderNow = async ({ tenantId, customerId }) => {
  await ensureWholesaleSchema();
  const id = idOf(customerId);
  const instance = await getReminderLine({ tenantId });
  if (!instance) throw fail("اختار خط الواتساب اللي التذكير يطلع منه الأول", 409);
  const { rows: [row] } = await db.query(
    `SELECT c.id AS customer_id, c.name, c.phone, t.reminder_min_balance, t.reminder_skip_paid_days
       FROM customers c LEFT JOIN wholesale_customer_terms t ON t.tenant_id = c.tenant_id AND t.customer_id = c.id
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, id]
  );
  if (!row) throw fail("العميل مش موجود", 404);
  const result = await remindCustomer({ tenantId, row, instance, force: true });
  if (result.status !== "sent") throw fail(result.reason === "no_phone" ? "العميل ملوش رقم موبايل" : `ماتبعتش: ${result.reason}`, 502);
  return result;
};

/** The worker tick: every enabled customer whose Cairo slot is now and who wasn't handled today. */
export const runWholesaleReminderTick = async ({ now = new Date() } = {}) => {
  if (!isWholesaleMode()) return { checked: 0, sent: 0 };
  await ensureWholesaleSchema();
  const parts = zonedParts(now);
  const { rows } = await db.query(
    `SELECT t.tenant_id, t.customer_id, t.reminder_weekday, t.reminder_hour, t.reminder_min_balance, t.reminder_skip_paid_days,
            c.name, c.phone, COALESCE(s.reminder_instance, '') AS instance
       FROM wholesale_customer_terms t
       JOIN customers c ON c.tenant_id = t.tenant_id AND c.id = t.customer_id
       LEFT JOIN wholesale_settings s ON s.tenant_id = t.tenant_id
      WHERE t.reminder_enabled = TRUE AND t.reminder_weekday = $1 AND t.reminder_hour <= $2
        AND NOT EXISTS (
          SELECT 1 FROM wholesale_reminder_log l
           WHERE l.tenant_id = t.tenant_id AND l.customer_id = t.customer_id
             AND l.detail NOT LIKE 'manual%' AND l.created_at >= NOW() - INTERVAL '20 hours'
        )`,
    [parts.weekday, parts.hour]
  );
  let sent = 0;
  for (const row of rows) {
    const tenantId = Number(row.tenant_id);
    if (!text(row.instance)) {
      await writeLog(tenantId, Number(row.customer_id), 0, "skipped", "no WhatsApp line chosen for reminders");
      continue;
    }
    try {
      const result = await remindCustomer({ tenantId, row, instance: text(row.instance), now });
      if (result.status === "sent") sent += 1;
    } catch (error) {
      console.error("[wholesale] reminder failed", { customerId: row.customer_id, message: error?.message || String(error) });
    }
  }
  return { checked: rows.length, sent };
};
