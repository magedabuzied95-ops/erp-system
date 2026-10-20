/*
 * WhatsApp usage & cost (inbox top bar → WhatsApp → Usage & cost).
 *
 * One row per month per WhatsApp Business Account: how many messages Meta counted, how many
 * were free, how many were billed, by pricing category, and what it cost. Meta is the
 * authority on the money, so the numbers come from the WABA's analytics edge and are cached in
 * whatsapp_usage_months by "Sync"; the page reads the cache, never Meta, on every open.
 *
 * Meta sources, newest first:
 *  - pricing_analytics (per-message pricing, July 2025 on): data_points carry start, end,
 *    volume, cost, pricing_category (SERVICE / MARKETING / UTILITY / AUTHENTICATION / …) and
 *    pricing_type (REGULAR / FREE_CUSTOMER_SERVICE / FREE_ENTRY_POINT).
 *  - conversation_analytics (the older per-conversation model) is the fallback when the
 *    account or the API version does not answer pricing_analytics: data_points carry
 *    conversation, cost, conversation_category and conversation_type (REGULAR / FREE_TIER /
 *    FREE_ENTRY_POINT).
 *
 * Our own outbound WhatsApp messages (ai_support_messages) are counted per month as well, so the
 * page says something useful before Meta is connected — labelled a local count, not a bill.
 *
 * Budget alert: a monthly budget in USD and a warning percentage (default 80). The current
 * month's Meta cost is compared against it on every read.
 */

import db from "../database/db.js";
import { graphRequest } from "./whatsappCloudProvider.js";
import { resolveTemplateCredentials } from "./whatsappTemplateStudioService.js";

const SHOP_TIMEZONE = "Africa/Cairo";
const SYNC_MONTHS = 12;
const DEFAULT_ALERT_PERCENT = 80;

const text = (value = "") => String(value ?? "").trim();
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value, digits = 4) => Math.round(num(value) * 10 ** digits) / 10 ** digits;
const httpError = (message, status = 400, code = "WHATSAPP_USAGE_INVALID") => Object.assign(new Error(message), { status, code });
const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return Math.trunc(parsed);
};

/* ------------------------------------------------------------------ schema */

let schemaReady = null;
export const ensureWhatsappUsageSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_usage_months (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        month DATE NOT NULL,
        waba_id VARCHAR(64) NOT NULL DEFAULT '',
        service_messages INTEGER NOT NULL DEFAULT 0,
        free_used INTEGER NOT NULL DEFAULT 0,
        passed_free_limit_at DATE NULL,
        paid_service INTEGER NOT NULL DEFAULT 0,
        marketing INTEGER NOT NULL DEFAULT 0,
        utility INTEGER NOT NULL DEFAULT 0,
        authentication INTEGER NOT NULL DEFAULT 0,
        total_messages INTEGER NOT NULL DEFAULT 0,
        cost_usd NUMERIC(14,4) NOT NULL DEFAULT 0,
        is_closed BOOLEAN NOT NULL DEFAULT FALSE,
        source VARCHAR(32) NOT NULL DEFAULT '',
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_whatsapp_usage_month UNIQUE (tenant_id, month, waba_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_usage_settings (
        tenant_id INTEGER PRIMARY KEY,
        monthly_budget_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
        alert_percent INTEGER NOT NULL DEFAULT ${DEFAULT_ALERT_PERCENT},
        last_sync_at TIMESTAMPTZ NULL,
        last_sync_error TEXT NOT NULL DEFAULT '',
        last_sync_source VARCHAR(32) NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

/* ------------------------------------------------------------------ months */

// "YYYY-MM-01" of a date in the shop's clock.
export const monthKeyOf = (date = new Date(), timeZone = SHOP_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}-01`;
};

const dayKeyOf = (date, timeZone = SHOP_TIMEZONE) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// The last `count` month keys, oldest first, ending with the current one.
export const recentMonthKeys = (count = SYNC_MONTHS, now = new Date()) => {
  const [year, month] = monthKeyOf(now).split("-").map(Number);
  const keys = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`);
  }
  return keys;
};

// A data point belongs to the month its middle falls in. Meta's buckets start at midnight in the
// account's timezone (Cairo 00:00 is 22:00 UTC the day before), so the bucket's start alone can
// land in the previous month; its midpoint never does.
const pointMoment = (point = {}) => {
  const start = num(point.start);
  const end = num(point.end);
  if (start && end > start) return new Date(((start + end) / 2) * 1000);
  if (start) return new Date((start + 12 * 3600) * 1000);
  return null;
};

const emptyMonth = (month, wabaId = "") => ({
  month,
  waba_id: wabaId,
  service_messages: 0,
  free_used: 0,
  passed_free_limit_at: null,
  paid_service: 0,
  marketing: 0,
  utility: 0,
  authentication: 0,
  total_messages: 0,
  cost_usd: 0,
});

// Meta answers { <field>: { data: [ { data_points: [...] } ] } }; older versions put the points
// straight under data. Both are accepted.
export const extractDataPoints = (payload = {}, field = "pricing_analytics") => {
  const node = payload?.[field] ?? payload;
  const data = Array.isArray(node?.data) ? node.data : Array.isArray(node) ? node : [];
  return data.flatMap((entry) => (Array.isArray(entry?.data_points) ? entry.data_points : [entry])).filter((point) => point && typeof point === "object");
};

/*
 * Pure: Meta data points → one row per month. `model` is "pricing" (pricing_analytics) or
 * "conversation" (conversation_analytics). `paidServiceDays` (optional) are daily points of
 * billed service traffic; the first day with any is when the month passed its free allowance.
 */
export const aggregateUsagePoints = ({ points = [], model = "pricing", wabaId = "", paidServiceDays = [], timeZone = SHOP_TIMEZONE } = {}) => {
  const months = new Map();
  const rowFor = (moment) => {
    const key = monthKeyOf(moment, timeZone);
    if (!months.has(key)) months.set(key, emptyMonth(key, wabaId));
    return months.get(key);
  };

  for (const point of points) {
    const moment = pointMoment(point);
    if (!moment) continue;
    const row = rowFor(moment);
    const volume = Math.max(0, Math.round(num(model === "conversation" ? point.conversation : point.volume)));
    const category = text(model === "conversation" ? point.conversation_category : point.pricing_category).toUpperCase();
    const type = text(model === "conversation" ? point.conversation_type : point.pricing_type).toUpperCase();
    const free = type.startsWith("FREE");

    row.total_messages += volume;
    row.cost_usd += num(point.cost);
    if (free) row.free_used += volume;
    if (category === "SERVICE") {
      row.service_messages += volume;
      if (!free) row.paid_service += volume;
    } else if (category.startsWith("MARKETING")) row.marketing += volume;
    else if (category.startsWith("UTILITY")) row.utility += volume;
    else if (category.startsWith("AUTHENTICATION")) row.authentication += volume;
  }

  for (const point of paidServiceDays) {
    if (num(model === "conversation" ? point.conversation : point.volume) <= 0) continue;
    const moment = pointMoment(point);
    if (!moment) continue;
    const row = rowFor(moment);
    const day = dayKeyOf(moment, timeZone);
    if (!row.passed_free_limit_at || day < row.passed_free_limit_at) row.passed_free_limit_at = day;
  }

  return [...months.values()]
    .map((row) => ({ ...row, cost_usd: round(row.cost_usd) }))
    .sort((a, b) => a.month.localeCompare(b.month));
};

/* ------------------------------------------------------------------ Meta */

const fieldsQuery = (field, args) =>
  `${field}.${Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}(${Array.isArray(value) ? JSON.stringify(value) : value})`)
    .join(".")}`;

const graphGet = (credentials, field, args) =>
  graphRequest({
    path: `/${credentials.graphVersion}/${encodeURIComponent(credentials.wabaId)}?fields=${encodeURIComponent(fieldsQuery(field, args))}`,
    method: "GET",
    accessToken: credentials.accessToken,
    timeoutMs: 25000,
  });

const rangeFor = (monthKeys, now = new Date()) => {
  const [year, month] = monthKeys[0].split("-").map(Number);
  // A day of slack on the start: Meta's month bucket begins at midnight in the account's
  // timezone, which may sit before UTC midnight.
  const start = Math.floor(Date.UTC(year, month - 1, 1) / 1000) - 86400;
  const end = Math.floor(now.getTime() / 1000);
  return { start, end };
};

export const fetchMetaUsage = async (credentials, { months = SYNC_MONTHS, now = new Date() } = {}) => {
  const monthKeys = recentMonthKeys(months, now);
  const { start, end } = rangeFor(monthKeys, now);

  // Per-message pricing first.
  try {
    const payload = await graphGet(credentials, "pricing_analytics", {
      start,
      end,
      granularity: "MONTHLY",
      metric_types: ["COST", "VOLUME"],
      dimensions: ["PRICING_CATEGORY", "PRICING_TYPE"],
    });
    const points = extractDataPoints(payload, "pricing_analytics");
    // Best effort: the day billed service messages began, per month.
    let paidServiceDays = [];
    try {
      const daily = await graphGet(credentials, "pricing_analytics", {
        start,
        end,
        granularity: "DAILY",
        metric_types: ["VOLUME"],
        pricing_categories: ["SERVICE"],
        pricing_types: ["REGULAR"],
        dimensions: ["PRICING_CATEGORY", "PRICING_TYPE"],
      });
      paidServiceDays = extractDataPoints(daily, "pricing_analytics");
    } catch {
      paidServiceDays = [];
    }
    return { model: "pricing", source: "meta_pricing_analytics", points, paidServiceDays, monthKeys, fallbackReason: "" };
  } catch (pricingError) {
    // Older model: conversation analytics.
    try {
      const payload = await graphGet(credentials, "conversation_analytics", {
        start,
        end,
        granularity: "MONTHLY",
        metric_types: ["COST", "CONVERSATION"],
        dimensions: ["CONVERSATION_CATEGORY", "CONVERSATION_TYPE"],
      });
      return {
        model: "conversation",
        source: "meta_conversation_analytics",
        points: extractDataPoints(payload, "conversation_analytics"),
        paidServiceDays: [],
        monthKeys,
        fallbackReason: text(pricingError?.message),
      };
    } catch {
      throw pricingError;
    }
  }
};

/* ------------------------------------------------------------------ local count */

export const localOutboundByMonth = async ({ tenantId, months = SYNC_MONTHS }) => {
  const result = await db.query(
    `SELECT to_char(date_trunc('month', m.created_at AT TIME ZONE '${SHOP_TIMEZONE}'), 'YYYY-MM-DD') AS month,
            COUNT(*)::int AS outbound,
            COUNT(*) FILTER (WHERE m.sender_type = 'ai')::int AS from_ai,
            COUNT(*) FILTER (WHERE m.sender_type <> 'ai')::int AS from_team
       FROM ai_support_messages m
       LEFT JOIN ai_support_sessions s ON s.id = m.session_ref_id
      WHERE m.tenant_id = $1
        AND (m.channel ILIKE 'whatsapp%' OR s.channel ILIKE 'whatsapp%')
        AND COALESCE(m.sender_type, '') NOT IN ('customer', 'note', '')
        AND COALESCE(m.message_type, '') <> 'internal_note'
        AND COALESCE(m.delivery_status, '') NOT IN ('failed', 'internal_note')
        AND m.created_at >= date_trunc('month', NOW() AT TIME ZONE '${SHOP_TIMEZONE}') AT TIME ZONE '${SHOP_TIMEZONE}' - make_interval(months => $2::int)
      GROUP BY 1
      ORDER BY 1`,
    [tenantOf(tenantId), Math.max(0, Math.trunc(num(months)) - 1)]
  );
  return result.rows.map((row) => ({ month: row.month, outbound: num(row.outbound), from_ai: num(row.from_ai), from_team: num(row.from_team) }));
};

/* ------------------------------------------------------------------ settings */

const publicSettings = (row) => ({
  monthly_budget_usd: round(row?.monthly_budget_usd, 2),
  alert_percent: row ? Math.trunc(num(row.alert_percent)) : DEFAULT_ALERT_PERCENT,
  last_sync_at: row?.last_sync_at || null,
  last_sync_error: text(row?.last_sync_error),
  last_sync_source: text(row?.last_sync_source),
});

const readSettings = async (tenantId) => {
  const result = await db.query(`SELECT * FROM whatsapp_usage_settings WHERE tenant_id = $1`, [tenantId]);
  return publicSettings(result.rows[0]);
};

export const updateUsageAlerts = async ({ tenantId, monthlyBudgetUsd, alertPercent }) => {
  await ensureWhatsappUsageSchema();
  const tenant = tenantOf(tenantId);
  const budget = Number(monthlyBudgetUsd);
  const percent = Number(alertPercent);
  if (!Number.isFinite(budget) || budget < 0 || budget > 10_000_000) throw httpError("The monthly budget must be a number of dollars, 0 or more");
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw httpError("The alert percentage must be between 1 and 100");
  await db.query(
    `INSERT INTO whatsapp_usage_settings (tenant_id, monthly_budget_usd, alert_percent, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET monthly_budget_usd = EXCLUDED.monthly_budget_usd,
                                           alert_percent = EXCLUDED.alert_percent,
                                           updated_at = NOW()`,
    [tenant, round(budget, 2), Math.trunc(percent)]
  );
  return readSettings(tenant);
};

// Pure: where this month's spend sits against the budget.
export const alertStateFor = ({ spentUsd = 0, budgetUsd = 0, alertPercent = DEFAULT_ALERT_PERCENT } = {}) => {
  const budget = num(budgetUsd);
  const spent = round(spentUsd);
  if (budget <= 0) return { level: "none", spent_usd: spent, budget_usd: 0, percent_used: null, alert_percent: alertPercent };
  const percentUsed = round((spent / budget) * 100, 1);
  const level = percentUsed >= 100 ? "over" : percentUsed >= num(alertPercent) ? "warning" : "ok";
  return { level, spent_usd: spent, budget_usd: round(budget, 2), percent_used: percentUsed, alert_percent: alertPercent };
};

/* ------------------------------------------------------------------ read + sync */

const publicMonth = (row, currentMonth) => ({
  month: row.month,
  waba_id: text(row.waba_id),
  service_messages: num(row.service_messages),
  free_used: num(row.free_used),
  passed_free_limit_at: row.passed_free_limit_at || null,
  paid_service: num(row.paid_service),
  marketing: num(row.marketing),
  utility: num(row.utility),
  authentication: num(row.authentication),
  total_messages: num(row.total_messages),
  cost_usd: round(row.cost_usd),
  is_closed: row.month < currentMonth,
  source: text(row.source),
  synced_at: row.synced_at || null,
});

export const getUsageOverview = async ({ tenantId, now = new Date() }) => {
  await ensureWhatsappUsageSchema();
  const tenant = tenantOf(tenantId);
  const currentMonth = monthKeyOf(now);

  const [monthsResult, settings, local, connection] = await Promise.all([
    db.query(
      `SELECT to_char(month, 'YYYY-MM-DD') AS month, waba_id, service_messages, free_used,
              to_char(passed_free_limit_at, 'YYYY-MM-DD') AS passed_free_limit_at, paid_service, marketing,
              utility, authentication, total_messages, cost_usd, source, synced_at
         FROM whatsapp_usage_months
        WHERE tenant_id = $1
        ORDER BY month DESC, waba_id`,
      [tenant]
    ),
    readSettings(tenant),
    localOutboundByMonth({ tenantId: tenant }).catch(() => []),
    resolveTemplateCredentials(tenant)
      .then((credentials) => ({ connected: true, waba_id: credentials.wabaId, source: credentials.source, error: "", code: "" }))
      .catch((error) => ({ connected: false, waba_id: "", source: "", error: text(error?.message), code: text(error?.code) })),
  ]);

  const months = monthsResult.rows.map((row) => publicMonth(row, currentMonth));
  const current = months.filter((row) => row.month === currentMonth);
  const currentSpend = current.reduce((sum, row) => sum + row.cost_usd, 0);
  const currentLocal = local.find((row) => row.month === currentMonth) || { month: currentMonth, outbound: 0, from_ai: 0, from_team: 0 };

  return {
    current_month: currentMonth,
    connection,
    source: months.length ? months[0].source || "meta" : "local",
    months,
    local_months: local,
    current: {
      month: currentMonth,
      messages: current.reduce((sum, row) => sum + row.total_messages, 0),
      cost_usd: round(currentSpend),
      local_outbound: currentLocal.outbound,
      has_meta_data: current.length > 0,
    },
    alerts: settings,
    alert_state: alertStateFor({ spentUsd: currentSpend, budgetUsd: settings.monthly_budget_usd, alertPercent: settings.alert_percent }),
  };
};

export const syncUsageFromMeta = async ({ tenantId, months = SYNC_MONTHS, now = new Date() }) => {
  await ensureWhatsappUsageSchema();
  const tenant = tenantOf(tenantId);
  const credentials = await resolveTemplateCredentials(tenant);
  let fetched;
  try {
    fetched = await fetchMetaUsage(credentials, { months, now });
  } catch (error) {
    await db.query(
      `INSERT INTO whatsapp_usage_settings (tenant_id, last_sync_error, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET last_sync_error = EXCLUDED.last_sync_error, updated_at = NOW()`,
      [tenant, text(error?.message).slice(0, 2000) || "Meta did not answer"]
    ).catch(() => {});
    throw error;
  }

  const currentMonth = monthKeyOf(now);
  const aggregated = aggregateUsagePoints({ points: fetched.points, model: fetched.model, wabaId: credentials.wabaId, paidServiceDays: fetched.paidServiceDays });
  const byMonth = new Map(aggregated.map((row) => [row.month, row]));
  // Every month of the window gets a row, so a quiet month reads 0 rather than "not synced".
  const rows = fetched.monthKeys.map((key) => byMonth.get(key) || emptyMonth(key, credentials.wabaId));

  for (const row of rows) {
    // One placeholder per value — never the same $n twice with different inferred types.
    await db.query(
      `INSERT INTO whatsapp_usage_months
         (tenant_id, month, waba_id, service_messages, free_used, passed_free_limit_at, paid_service, marketing,
          utility, authentication, total_messages, cost_usd, is_closed, source, synced_at)
       VALUES ($1, $2::date, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       ON CONFLICT (tenant_id, month, waba_id) DO UPDATE SET
         service_messages = EXCLUDED.service_messages,
         free_used = EXCLUDED.free_used,
         passed_free_limit_at = EXCLUDED.passed_free_limit_at,
         paid_service = EXCLUDED.paid_service,
         marketing = EXCLUDED.marketing,
         utility = EXCLUDED.utility,
         authentication = EXCLUDED.authentication,
         total_messages = EXCLUDED.total_messages,
         cost_usd = EXCLUDED.cost_usd,
         is_closed = EXCLUDED.is_closed,
         source = EXCLUDED.source,
         synced_at = NOW()`,
      [
        tenant,
        row.month,
        credentials.wabaId,
        row.service_messages,
        row.free_used,
        row.passed_free_limit_at,
        row.paid_service,
        row.marketing,
        row.utility,
        row.authentication,
        row.total_messages,
        row.cost_usd,
        row.month < currentMonth,
        fetched.source,
      ]
    );
  }

  await db.query(
    `INSERT INTO whatsapp_usage_settings (tenant_id, last_sync_at, last_sync_error, last_sync_source, updated_at)
     VALUES ($1, NOW(), '', $2, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET last_sync_at = NOW(), last_sync_error = '',
                                           last_sync_source = EXCLUDED.last_sync_source, updated_at = NOW()`,
    [tenant, fetched.source]
  );

  return {
    months: rows.length,
    points: fetched.points.length,
    source: fetched.source,
    waba_id: credentials.wabaId,
    fallback_reason: fetched.fallbackReason,
  };
};

export default {
  ensureWhatsappUsageSchema,
  aggregateUsagePoints,
  extractDataPoints,
  alertStateFor,
  monthKeyOf,
  recentMonthKeys,
  fetchMetaUsage,
  localOutboundByMonth,
  getUsageOverview,
  syncUsageFromMeta,
  updateUsageAlerts,
};
