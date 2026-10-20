/*
 * WhatsApp template analytics (inbox top bar → WhatsApp → Template Analytics, and the
 * Analytics block of one template).
 *
 * Meta is the source; we cache what it says per day so the page opens without a Graph call:
 *  - wa_template_analytics_daily — one row per template per day from
 *      GET /{waba_id}/template_analytics?granularity=DAILY&metric_types=[SENT,DELIVERED,READ,CLICKED,COST]
 *    (≤ 10 template ids per call). The WABA must have template insights switched on
 *    (POST /{waba_id}?is_enabled_for_insights=true) — "Enable analytics" on the page does that.
 *  - wa_account_activity_daily — one row per number per day: sent / delivered from the WABA's
 *    `analytics` field (granularity DAY, filtered to the number) and marketing / utility /
 *    authentication volumes from `pricing_analytics` (granularity DAILY). Whole number, not per
 *    template — Meta does not break it down further at this level.
 *  - wa_analytics_sync_state — last sync per WABA and the last Meta error, so the "Couldn't
 *    update statistics" banner survives a reload.
 *
 * Days are Cairo calendar days (the app's one clock): a Meta bucket's `start` is converted with
 * Africa/Cairo, never with toISOString.
 */

import db from "../../../database/db.js";
import { cloudConfig, graphRequest } from "../../../services/whatsappCloudProvider.js";
import { integrationAccessToken, listIntegrations } from "../../../services/whatsappEmbeddedSignupService.js";
import { ensureWhatsappTemplateSchema } from "../../../services/whatsappTemplateStudioService.js";

const SHOP_TIMEZONE = "Africa/Cairo";
const TEMPLATE_IDS_PER_CALL = 10;
const WINDOW_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const GRAPH_TIMEOUT_MS = 25000;

const text = (value = "") => String(value ?? "").trim();
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value, digits = 4) => Math.round(num(value) * 10 ** digits) / 10 ** digits;
const httpError = (message, status = 400, code = "WA_ANALYTICS_INVALID", details = null) =>
  Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
const tenantOf = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw httpError("A valid tenant id is required");
  return Math.trunc(parsed);
};

/* ------------------------------------------------------------------ schema */

let schemaReady = null;
export const ensureWaAnalyticsSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS wa_template_analytics_daily (
        id BIGSERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        waba_id VARCHAR(64) NOT NULL DEFAULT '',
        template_id VARCHAR(64) NOT NULL,
        day DATE NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0,
        read INTEGER NOT NULL DEFAULT 0,
        clicked JSONB NOT NULL DEFAULT '[]'::jsonb,
        clicks_total INTEGER NOT NULL DEFAULT 0,
        cost NUMERIC(14, 6) NOT NULL DEFAULT 0,
        cost_per_delivered NUMERIC(14, 6) NOT NULL DEFAULT 0,
        cost_per_url_click NUMERIC(14, 6) NOT NULL DEFAULT 0,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wa_template_analytics_daily UNIQUE (tenant_id, waba_id, template_id, day)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_wa_template_analytics_daily_lookup ON wa_template_analytics_daily (tenant_id, day)`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS wa_account_activity_daily (
        id BIGSERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        waba_id VARCHAR(64) NOT NULL DEFAULT '',
        phone_number_id VARCHAR(64) NOT NULL DEFAULT '',
        day DATE NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0,
        marketing INTEGER NOT NULL DEFAULT 0,
        utility INTEGER NOT NULL DEFAULT 0,
        authentication INTEGER NOT NULL DEFAULT 0,
        cost NUMERIC(14, 6) NOT NULL DEFAULT 0,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wa_account_activity_daily UNIQUE (tenant_id, waba_id, phone_number_id, day)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_wa_account_activity_daily_lookup ON wa_account_activity_daily (tenant_id, day)`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS wa_analytics_sync_state (
        tenant_id INTEGER NOT NULL,
        waba_id VARCHAR(64) NOT NULL,
        last_synced_at TIMESTAMPTZ,
        last_error TEXT NOT NULL DEFAULT '',
        last_error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_error_at TIMESTAMPTZ,
        analytics_disabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, waba_id)
      )
    `);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

/* ------------------------------------------------------------------ dates (Cairo days) */

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
export const cairoDayOf = (moment) => dayFormatter.format(moment instanceof Date ? moment : new Date(moment));

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && !Number.isNaN(Date.parse(`${text(value)}T00:00:00Z`));
const addDays = (day, delta) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10); // noon UTC: the calendar date never shifts
};
export const daysBetween = (from, to) => {
  const out = [];
  for (let day = from; day <= to && out.length <= MAX_RANGE_DAYS; day = addDays(day, 1)) out.push(day);
  return out;
};

/** Default: the last 30 days up to today (Cairo). Swapped / oversized ranges are corrected. */
export const normalizeRange = ({ from, to } = {}, now = new Date()) => {
  const today = cairoDayOf(now);
  let end = isDay(to) ? text(to) : today;
  let start = isDay(from) ? text(from) : addDays(end, -30);
  if (start > end) [start, end] = [end, start];
  if (daysBetween(start, end).length > MAX_RANGE_DAYS) start = addDays(end, -(MAX_RANGE_DAYS - 1));
  return { from: start, to: end };
};

// Unix seconds bracketing a Cairo day range, with a day of slack on each side: Meta buckets by
// the WABA's own timezone, which may begin before Cairo midnight.
const unixRange = (from, to, now = Date.now()) => {
  const start = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86400;
  const end = Math.min(Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000) + 86400, Math.floor(now / 1000));
  return { start, end: Math.max(end, start + 3600) };
};

const windows = (from, to, size = WINDOW_DAYS) => {
  const out = [];
  for (let start = from; start <= to; start = addDays(start, size)) {
    const end = addDays(start, size - 1);
    out.push({ from: start, to: end < to ? end : to });
  }
  return out;
};

const pointDay = (point) => {
  const start = point?.start ?? point?.time_start ?? point?.date;
  if (start === undefined || start === null || start === "") return "";
  const seconds = Number(start);
  if (Number.isFinite(seconds) && seconds > 0) return cairoDayOf(new Date(seconds * 1000));
  const parsed = Date.parse(String(start));
  return Number.isFinite(parsed) ? cairoDayOf(new Date(parsed)) : "";
};

/* ------------------------------------------------------------------ accounts + credentials */

/**
 * Every number the tenant can analyse: connected Embedded Signup numbers (their own token) and
 * the env pair as fallback. Tokens stay on the server — `publicAccount` strips them.
 */
export const listAnalyticsAccounts = async (tenantId) => {
  const env = cloudConfig();
  const rows = await listIntegrations({ tenantId: tenantOf(tenantId) }).catch(() => []);
  const accounts = [];
  for (const row of rows) {
    if (row.status !== "connected" || !text(row.phone_number_id) || !text(row.waba_id)) continue;
    if (accounts.some((item) => item.phone_number_id === text(row.phone_number_id))) continue;
    accounts.push({
      phone_number_id: text(row.phone_number_id),
      waba_id: text(row.waba_id),
      display_phone_number: text(row.display_phone_number),
      verified_name: text(row.verified_name),
      accessToken: row.access_token_encrypted ? text(integrationAccessToken(row)) : "",
      source: "embedded_signup",
    });
  }
  if (env.phoneNumberId && env.businessAccountId && !accounts.some((item) => item.phone_number_id === env.phoneNumberId)) {
    accounts.push({
      phone_number_id: env.phoneNumberId,
      waba_id: env.businessAccountId,
      display_phone_number: "",
      verified_name: "",
      accessToken: env.accessToken,
      source: "env",
    });
  }
  // A number without its own token borrows the env token when it is the env WABA.
  for (const account of accounts) {
    if (!account.accessToken && env.accessToken && account.waba_id === env.businessAccountId) account.accessToken = env.accessToken;
  }
  return accounts;
};

const publicAccount = (account) => ({
  id: account.phone_number_id,
  phone_number_id: account.phone_number_id,
  waba_id: account.waba_id,
  display_phone_number: account.display_phone_number,
  verified_name: account.verified_name,
  label: account.verified_name || account.display_phone_number || account.phone_number_id,
  source: account.source,
});

const credentialsForWaba = (accounts, wabaId) => {
  const account = accounts.find((item) => item.waba_id === wabaId && item.accessToken);
  if (!account) throw httpError("No access token is available for this WhatsApp account", 409, "WHATSAPP_CLOUD_NOT_CONNECTED");
  return { accessToken: account.accessToken, wabaId, graphVersion: cloudConfig().graphVersion };
};

const pickAccounts = (accounts, accountId = "") => {
  const wanted = text(accountId);
  if (!wanted) return accounts;
  const match = accounts.filter((item) => item.phone_number_id === wanted || item.waba_id === wanted);
  if (!match.length) throw httpError("WhatsApp account not found", 404, "WA_ANALYTICS_ACCOUNT_NOT_FOUND");
  return match;
};

/* ------------------------------------------------------------------ Meta → rows (pure, exported for tests) */

const extractPoints = (payload = {}, field = "") => {
  const node = field ? payload?.[field] ?? payload : payload;
  const data = Array.isArray(node?.data) ? node.data : Array.isArray(node?.data_points) ? [node] : Array.isArray(node) ? node : [];
  return data.flatMap((entry) => (Array.isArray(entry?.data_points) ? entry.data_points : [entry])).filter((point) => point && typeof point === "object");
};

const costValue = (costs, type) => {
  const list = Array.isArray(costs) ? costs : [];
  const hit = list.find((item) => text(item?.type).toLowerCase() === type);
  return num(hit?.value);
};

/** template_analytics data points → { template_id, day, sent, delivered, read, clicked[], clicks_total, cost, … } */
export const parseTemplateAnalytics = (payload = {}) => {
  const rows = new Map();
  for (const point of extractPoints(payload)) {
    const templateId = text(point.template_id);
    const day = pointDay(point);
    if (!templateId || !day) continue;
    const key = `${templateId}|${day}`;
    const row = rows.get(key) || {
      template_id: templateId,
      day,
      sent: 0,
      delivered: 0,
      read: 0,
      clicked: [],
      clicks_total: 0,
      cost: 0,
      cost_per_delivered: 0,
      cost_per_url_click: 0,
    };
    row.sent += Math.max(0, Math.round(num(point.sent)));
    row.delivered += Math.max(0, Math.round(num(point.delivered)));
    row.read += Math.max(0, Math.round(num(point.read)));
    for (const click of Array.isArray(point.clicked) ? point.clicked : []) {
      const entry = {
        type: text(click?.type).toLowerCase() || "button",
        button_content: text(click?.button_content),
        count: Math.max(0, Math.round(num(click?.count))),
      };
      const existing = row.clicked.find((item) => item.type === entry.type && item.button_content === entry.button_content);
      if (existing) existing.count += entry.count;
      else row.clicked.push(entry);
      row.clicks_total += entry.count;
    }
    row.cost += costValue(point.cost, "amount_spent");
    row.cost_per_delivered = costValue(point.cost, "cost_per_delivered") || row.cost_per_delivered;
    row.cost_per_url_click = costValue(point.cost, "cost_per_url_button_click") || row.cost_per_url_click;
    rows.set(key, row);
  }
  return [...rows.values()];
};

/** WABA `analytics` (DAY) points → Map(day → { sent, delivered }) */
export const parseAccountAnalytics = (payload = {}) => {
  const days = new Map();
  for (const point of extractPoints(payload?.analytics ?? payload)) {
    const day = pointDay(point);
    if (!day) continue;
    const row = days.get(day) || { sent: 0, delivered: 0 };
    row.sent += Math.max(0, Math.round(num(point.sent)));
    row.delivered += Math.max(0, Math.round(num(point.delivered)));
    days.set(day, row);
  }
  return days;
};

/** `pricing_analytics` (DAILY, by PRICING_CATEGORY) points → Map(day → { marketing, utility, authentication, cost }) */
export const parsePricingAnalytics = (payload = {}) => {
  const days = new Map();
  for (const point of extractPoints(payload, "pricing_analytics")) {
    const day = pointDay(point);
    if (!day) continue;
    const row = days.get(day) || { marketing: 0, utility: 0, authentication: 0, cost: 0 };
    const category = text(point.pricing_category).toUpperCase();
    const volume = Math.max(0, Math.round(num(point.volume)));
    if (category.startsWith("MARKETING")) row.marketing += volume;
    else if (category === "UTILITY") row.utility += volume;
    else if (category.startsWith("AUTHENTICATION")) row.authentication += volume;
    row.cost += num(point.cost);
    days.set(day, row);
  }
  return days;
};

// Meta's wording when template insights are off for the WABA varies by version; match broadly.
export const isAnalyticsDisabledError = (error) => {
  const message = `${text(error?.message)} ${text(error?.details?.graph_type)}`.toLowerCase();
  return /is_enabled_for_insights|insights? (?:is |are )?not enabled|not enabled for (?:template )?(?:insights|analytics)|template analytics (?:is )?(?:not|disabled)|enable (?:template )?(?:insights|analytics)/.test(message);
};

const errorEntry = (step, error) => ({
  step,
  message: text(error?.message) || "Unknown error",
  code: text(error?.code),
  status: Number(error?.status) || 0,
  graph_code: error?.details?.graph_code ?? null,
  graph_subcode: error?.details?.graph_subcode ?? null,
  fbtrace_id: text(error?.details?.fbtrace_id),
});

/* ------------------------------------------------------------------ Meta calls */

const graphGet = (credentials, path) =>
  graphRequest({ path: `/${credentials.graphVersion}/${path}`, method: "GET", accessToken: credentials.accessToken, timeoutMs: GRAPH_TIMEOUT_MS });

const fieldsArg = (field, args) =>
  `${field}.${Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && !value.length))
    .map(([key, value]) => `${key}(${Array.isArray(value) ? JSON.stringify(value) : value})`)
    .join(".")}`;

const fetchTemplateAnalytics = async (credentials, templateIds, range) => {
  const all = [];
  for (let index = 0; index < templateIds.length; index += TEMPLATE_IDS_PER_CALL) {
    const ids = templateIds.slice(index, index + TEMPLATE_IDS_PER_CALL);
    for (const window of windows(range.from, range.to)) {
      const { start, end } = unixRange(window.from, window.to);
      const params = new URLSearchParams({
        start: String(start),
        end: String(end),
        granularity: "DAILY",
        metric_types: JSON.stringify(["SENT", "DELIVERED", "READ", "CLICKED", "COST"]),
        template_ids: JSON.stringify(ids),
        limit: "1000",
      });
      let path = `${encodeURIComponent(credentials.wabaId)}/template_analytics?${params.toString()}`;
      for (let page = 0; page < 10 && path; page += 1) {
        const payload = await graphGet(credentials, path);
        all.push(...parseTemplateAnalytics(payload));
        const next = text(payload?.paging?.next);
        path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "") : "";
      }
    }
  }
  // Windows overlap by the day of slack — keep one row per template per day (the larger read).
  const merged = new Map();
  for (const row of all) {
    const key = `${row.template_id}|${row.day}`;
    const current = merged.get(key);
    if (!current || row.sent + row.delivered + row.read + row.clicks_total >= current.sent + current.delivered + current.read + current.clicks_total) merged.set(key, row);
  }
  return [...merged.values()].filter((row) => row.day >= range.from && row.day <= range.to);
};

const fetchAccountActivity = async (credentials, account, range) => {
  const { start, end } = unixRange(range.from, range.to);
  const phone = text(account.display_phone_number).replace(/\D/g, "");
  const phones = phone ? [phone] : undefined;
  const errors = [];
  let activity = new Map();
  let pricing = new Map();
  try {
    const payload = await graphGet(
      credentials,
      `${encodeURIComponent(credentials.wabaId)}?fields=${encodeURIComponent(fieldsArg("analytics", { start, end, granularity: "DAY", phone_numbers: phones }))}`
    );
    activity = parseAccountAnalytics(payload);
  } catch (error) {
    errors.push(errorEntry("account_analytics", error));
  }
  try {
    const payload = await graphGet(
      credentials,
      `${encodeURIComponent(credentials.wabaId)}?fields=${encodeURIComponent(
        fieldsArg("pricing_analytics", {
          start,
          end,
          granularity: "DAILY",
          phone_numbers: phones,
          metric_types: ["VOLUME", "COST"],
          dimensions: ["PRICING_CATEGORY"],
        })
      )}`
    );
    pricing = parsePricingAnalytics(payload);
  } catch (error) {
    errors.push(errorEntry("pricing_analytics", error));
  }
  const days = new Set([...activity.keys(), ...pricing.keys()]);
  const rows = [...days]
    .filter((day) => day >= range.from && day <= range.to)
    .map((day) => ({ day, ...{ sent: 0, delivered: 0 }, ...activity.get(day), ...{ marketing: 0, utility: 0, authentication: 0, cost: 0 }, ...pricing.get(day) }));
  return { rows, errors };
};

/* ------------------------------------------------------------------ storage */

const saveTemplateRows = async (tenantId, wabaId, rows) => {
  for (const row of rows) {
    await db.query(
      `INSERT INTO wa_template_analytics_daily
         (tenant_id, waba_id, template_id, day, sent, delivered, read, clicked, clicks_total, cost, cost_per_delivered, cost_per_url_click, synced_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, NOW())
       ON CONFLICT (tenant_id, waba_id, template_id, day) DO UPDATE
         SET sent = EXCLUDED.sent, delivered = EXCLUDED.delivered, read = EXCLUDED.read, clicked = EXCLUDED.clicked,
             clicks_total = EXCLUDED.clicks_total, cost = EXCLUDED.cost, cost_per_delivered = EXCLUDED.cost_per_delivered,
             cost_per_url_click = EXCLUDED.cost_per_url_click, synced_at = NOW()`,
      [tenantId, wabaId, row.template_id, row.day, row.sent, row.delivered, row.read, JSON.stringify(row.clicked || []), row.clicks_total, round(row.cost, 6), round(row.cost_per_delivered, 6), round(row.cost_per_url_click, 6)]
    );
  }
};

const saveActivityRows = async (tenantId, wabaId, phoneNumberId, rows) => {
  for (const row of rows) {
    await db.query(
      `INSERT INTO wa_account_activity_daily
         (tenant_id, waba_id, phone_number_id, day, sent, delivered, marketing, utility, authentication, cost, synced_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (tenant_id, waba_id, phone_number_id, day) DO UPDATE
         SET sent = EXCLUDED.sent, delivered = EXCLUDED.delivered, marketing = EXCLUDED.marketing, utility = EXCLUDED.utility,
             authentication = EXCLUDED.authentication, cost = EXCLUDED.cost, synced_at = NOW()`,
      [tenantId, wabaId, phoneNumberId, row.day, row.sent, row.delivered, row.marketing, row.utility, row.authentication, round(row.cost, 6)]
    );
  }
};

const saveSyncState = async (tenantId, wabaId, { errors = [], analyticsDisabled = false } = {}) => {
  const first = errors[0];
  await db.query(
    `INSERT INTO wa_analytics_sync_state (tenant_id, waba_id, last_synced_at, last_error, last_error_details, last_error_at, analytics_disabled, updated_at)
     VALUES ($1, $2, NOW(), $3, $4::jsonb, CASE WHEN $3::text <> '' THEN NOW() ELSE NULL END, $5, NOW())
     ON CONFLICT (tenant_id, waba_id) DO UPDATE
       SET last_synced_at = NOW(), last_error = EXCLUDED.last_error, last_error_details = EXCLUDED.last_error_details,
           last_error_at = EXCLUDED.last_error_at, analytics_disabled = EXCLUDED.analytics_disabled, updated_at = NOW()`,
    [tenantId, wabaId, first ? first.message.slice(0, 1000) : "", JSON.stringify(errors.slice(0, 10)), analyticsDisabled === true]
  );
};

/* ------------------------------------------------------------------ templates + campaigns (local) */

const templatesForTenant = async (tenantId) => {
  await ensureWhatsappTemplateSchema();
  const result = await db.query(
    `SELECT id, name, language, category, status, meta_template_id, waba_id, buttons
       FROM whatsapp_message_templates
      WHERE tenant_id = $1
      ORDER BY name, language`,
    [tenantId]
  );
  return result.rows;
};

const campaignsForTenant = async (tenantId) => {
  try {
    const result = await db.query(
      `SELECT id, name, template_id FROM marketing_broadcasts
        WHERE tenant_id = $1 AND template_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 300`,
      [tenantId]
    );
    return result.rows.map((row) => ({ id: String(row.id), name: text(row.name) || `#${row.id}`, template_id: row.template_id ? String(row.template_id) : "" }));
  } catch {
    return []; // the broadcasts table may not exist yet on a fresh tenant
  }
};

const parseList = (value) =>
  (Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((item) => text(item))
    .filter(Boolean);

/* ------------------------------------------------------------------ sync */

/**
 * Pull Meta's numbers for the range into the cache. Never throws for a Meta failure: errors are
 * returned (and remembered) so the page can show "Couldn't update statistics" with details.
 */
export const syncAnalytics = async ({ tenantId, account = "", from, to, templateId = "" } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWaAnalyticsSchema();
  const range = normalizeRange({ from, to });
  const everyAccount = await listAnalyticsAccounts(tenant);
  const accounts = pickAccounts(everyAccount, account);
  if (!accounts.length) {
    throw httpError("No official WhatsApp account is connected. Connect one from WhatsApp → Connect account first.", 409, "WHATSAPP_CLOUD_NOT_CONNECTED");
  }
  const templates = await templatesForTenant(tenant);
  const onlyTemplate = text(templateId);
  const wabas = [...new Set(accounts.map((item) => item.waba_id))];
  const allWabas = new Set(everyAccount.map((item) => item.waba_id));
  const summary = { range, wabas: [], errors: [], analytics_disabled: false, template_rows: 0, activity_rows: 0 };

  for (const wabaId of wabas) {
    const errors = [];
    let analyticsDisabled = false;
    let credentials;
    try {
      credentials = credentialsForWaba(accounts, wabaId);
    } catch (error) {
      errors.push(errorEntry("credentials", error));
    }
    if (credentials) {
      // Templates of this WABA; rows with no WABA recorded belong to the only WABA there is.
      const ids = templates
        .filter((row) => text(row.meta_template_id) && (text(row.waba_id) === wabaId || (!text(row.waba_id) && allWabas.size <= 1)))
        .filter((row) => !onlyTemplate || String(row.id) === onlyTemplate || text(row.meta_template_id) === onlyTemplate)
        .map((row) => text(row.meta_template_id));
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length) {
        try {
          const rows = await fetchTemplateAnalytics(credentials, uniqueIds, range);
          await saveTemplateRows(tenant, wabaId, rows);
          summary.template_rows += rows.length;
        } catch (error) {
          analyticsDisabled = isAnalyticsDisabledError(error);
          errors.push(errorEntry("template_analytics", error));
        }
      }
      if (!onlyTemplate) {
        for (const item of accounts.filter((row) => row.waba_id === wabaId)) {
          const { rows, errors: activityErrors } = await fetchAccountActivity(credentials, item, range);
          await saveActivityRows(tenant, wabaId, item.phone_number_id, rows);
          summary.activity_rows += rows.length;
          errors.push(...activityErrors);
        }
      }
    }
    await saveSyncState(tenant, wabaId, { errors, analyticsDisabled }).catch(() => {});
    summary.wabas.push({ waba_id: wabaId, ok: !errors.length, analytics_disabled: analyticsDisabled });
    summary.errors.push(...errors.map((item) => ({ ...item, waba_id: wabaId })));
    summary.analytics_disabled ||= analyticsDisabled;
  }
  return summary;
};

/** POST /{waba_id}?is_enabled_for_insights=true for the chosen account (or every WABA). */
export const enableTemplateInsights = async ({ tenantId, account = "" } = {}) => {
  const tenant = tenantOf(tenantId);
  await ensureWaAnalyticsSchema();
  const accounts = pickAccounts(await listAnalyticsAccounts(tenant), account);
  if (!accounts.length) throw httpError("No official WhatsApp account is connected", 409, "WHATSAPP_CLOUD_NOT_CONNECTED");
  const results = [];
  for (const wabaId of [...new Set(accounts.map((item) => item.waba_id))]) {
    const credentials = credentialsForWaba(accounts, wabaId);
    await graphRequest({
      path: `/${credentials.graphVersion}/${encodeURIComponent(wabaId)}?is_enabled_for_insights=true`,
      method: "POST",
      accessToken: credentials.accessToken,
      timeoutMs: GRAPH_TIMEOUT_MS,
    });
    await db.query(
      `UPDATE wa_analytics_sync_state SET analytics_disabled = FALSE, updated_at = NOW() WHERE tenant_id = $1 AND waba_id = $2`,
      [tenant, wabaId]
    );
    results.push({ waba_id: wabaId, enabled: true });
  }
  return { results };
};

/* ------------------------------------------------------------------ read model */

const safeDiv = (a, b) => (num(b) > 0 ? num(a) / num(b) : null);
const pct = (a, b) => {
  const value = safeDiv(a, b);
  return value === null ? null : round(value * 100, 1);
};

/** Pure: daily template rows → KPIs, trend, button clicks and cost. Exported for tests. */
export const summarizeTemplateRows = (rows = [], days = []) => {
  const totals = { sent: 0, delivered: 0, read: 0, clicks: 0, cost: 0, url_clicks: 0 };
  const byDay = new Map(days.map((day) => [day, { date: day, sent: 0, delivered: 0, read: 0, clicks: 0 }]));
  const buttons = new Map();
  let uniqueKnown = false;
  let uniqueClicks = 0;
  for (const row of rows) {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : cairoDayOf(row.day);
    totals.sent += num(row.sent);
    totals.delivered += num(row.delivered);
    totals.read += num(row.read);
    totals.clicks += num(row.clicks_total);
    totals.cost += num(row.cost);
    const bucket = byDay.get(day) || { date: day, sent: 0, delivered: 0, read: 0, clicks: 0 };
    bucket.sent += num(row.sent);
    bucket.delivered += num(row.delivered);
    bucket.read += num(row.read);
    bucket.clicks += num(row.clicks_total);
    byDay.set(day, bucket);
    for (const click of Array.isArray(row.clicked) ? row.clicked : []) {
      const key = `${click.type}|${click.button_content}`;
      const entry = buttons.get(key) || { type: text(click.type), button_content: text(click.button_content), count: 0 };
      entry.count += num(click.count);
      buttons.set(key, entry);
      if (text(click.type).includes("url")) totals.url_clicks += num(click.count);
      if (click.unique_count !== undefined) {
        uniqueKnown = true;
        uniqueClicks += num(click.unique_count);
      }
    }
  }
  return {
    kpis: {
      sent: totals.sent,
      delivered: totals.delivered,
      read: totals.read,
      clicks: totals.clicks,
      unique_clicks: uniqueKnown ? uniqueClicks : null,
      delivery_rate: pct(totals.delivered, totals.sent),
      read_rate: pct(totals.read, totals.sent),
      read_of_delivered: pct(totals.read, totals.delivered),
      ctr: pct(totals.clicks, totals.delivered),
    },
    trend: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    buttons: [...buttons.values()].sort((a, b) => b.count - a.count),
    cost: {
      amount_spent: round(totals.cost, 4),
      cost_per_delivered: totals.delivered ? round(totals.cost / totals.delivered, 4) : 0,
      cost_per_url_click: totals.url_clicks ? round(totals.cost / totals.url_clicks, 4) : 0,
      url_clicks: totals.url_clicks,
    },
  };
};

const syncStateFor = async (tenant, wabaIds) => {
  if (!wabaIds.length) return { last_synced_at: null, error: null, analytics_disabled: false };
  const result = await db.query(
    `SELECT * FROM wa_analytics_sync_state WHERE tenant_id = $1 AND waba_id = ANY($2::text[]) ORDER BY updated_at DESC`,
    [tenant, wabaIds]
  );
  const rows = result.rows;
  const failing = rows.find((row) => text(row.last_error));
  const synced = rows.map((row) => row.last_synced_at).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
  return {
    last_synced_at: synced[0] || null,
    analytics_disabled: rows.some((row) => row.analytics_disabled === true),
    error: failing
      ? { message: failing.last_error, details: Array.isArray(failing.last_error_details) ? failing.last_error_details : [], at: failing.last_error_at, waba_id: failing.waba_id }
      : null,
  };
};

const scope = async ({ tenantId, account = "", campaigns = "" }) => {
  const tenant = tenantOf(tenantId);
  await ensureWaAnalyticsSchema();
  const allAccounts = await listAnalyticsAccounts(tenant);
  const accounts = text(account) ? pickAccounts(allAccounts, account) : allAccounts;
  const wabaIds = [...new Set(accounts.map((item) => item.waba_id))];
  const templates = await templatesForTenant(tenant);
  const campaignList = await campaignsForTenant(tenant);
  const chosen = parseList(campaigns);
  let localTemplateIds = null;
  if (chosen.length) {
    localTemplateIds = new Set(campaignList.filter((item) => chosen.includes(item.id)).map((item) => item.template_id).filter(Boolean));
  }
  return { tenant, allAccounts, accounts, wabaIds, templates, campaignList, localTemplateIds };
};

const loadTemplateRows = async ({ tenant, wabaIds, metaIds, range, allWabas }) => {
  if (!metaIds.length) return [];
  const result = await db.query(
    `SELECT waba_id, template_id, to_char(day, 'YYYY-MM-DD') AS day, sent, delivered, read, clicked, clicks_total, cost
       FROM wa_template_analytics_daily
      WHERE tenant_id = $1 AND day BETWEEN $2::date AND $3::date
        AND template_id = ANY($4::text[])
        AND ($5::boolean OR waba_id = ANY($6::text[]))
      ORDER BY day`,
    [tenant, range.from, range.to, metaIds, allWabas, wabaIds]
  );
  return result.rows;
};

/**
 * The page: account activity, KPIs / trend / button clicks / cost over the chosen templates, and
 * the per-template comparison. `templateId` narrows everything to one template (the editor tab).
 */
export const getTemplateAnalytics = async ({ tenantId, account = "", campaigns = "", from, to, templateId = "" } = {}) => {
  const context = await scope({ tenantId, account, campaigns });
  const { tenant, allAccounts, accounts, wabaIds, templates, campaignList, localTemplateIds } = context;
  const range = normalizeRange({ from, to });
  const days = daysBetween(range.from, range.to);
  const allWabas = !text(account);

  let chosen = templates.filter((row) => text(row.meta_template_id));
  if (!allWabas) chosen = chosen.filter((row) => wabaIds.includes(text(row.waba_id)) || (!text(row.waba_id) && new Set(allAccounts.map((item) => item.waba_id)).size <= 1));
  if (localTemplateIds) chosen = chosen.filter((row) => localTemplateIds.has(String(row.id)));
  if (text(templateId)) chosen = templates.filter((row) => String(row.id) === text(templateId) || text(row.meta_template_id) === text(templateId));

  const metaIds = [...new Set(chosen.map((row) => text(row.meta_template_id)).filter(Boolean))];
  const rows = await loadTemplateRows({ tenant, wabaIds, metaIds, range, allWabas: allWabas || Boolean(text(templateId)) });
  const summary = summarizeTemplateRows(rows, days);

  const byTemplate = new Map();
  for (const row of rows) {
    const entry = byTemplate.get(row.template_id) || { sent: 0, delivered: 0, read: 0, clicks: 0, cost: 0 };
    entry.sent += num(row.sent);
    entry.delivered += num(row.delivered);
    entry.read += num(row.read);
    entry.clicks += num(row.clicks_total);
    entry.cost += num(row.cost);
    byTemplate.set(row.template_id, entry);
  }
  const comparison = chosen
    .filter((row) => text(row.meta_template_id))
    .map((row) => {
      const stats = byTemplate.get(text(row.meta_template_id)) || { sent: 0, delivered: 0, read: 0, clicks: 0, cost: 0 };
      return {
        id: row.id,
        meta_template_id: text(row.meta_template_id),
        name: row.name,
        language: row.language,
        category: row.category,
        status: row.status,
        ...stats,
        cost: round(stats.cost, 4),
        delivery_rate: pct(stats.delivered, stats.sent),
        read_rate: pct(stats.read, stats.delivered),
        ctr: pct(stats.clicks, stats.delivered),
      };
    })
    .sort((a, b) => b.sent - a.sent || String(a.name).localeCompare(String(b.name)));

  let activity = null;
  if (!text(templateId)) {
    const phoneIds = accounts.map((item) => item.phone_number_id);
    const result = phoneIds.length
      ? await db.query(
          `SELECT phone_number_id, to_char(day, 'YYYY-MM-DD') AS day, sent, delivered, marketing, utility, authentication
             FROM wa_account_activity_daily
            WHERE tenant_id = $1 AND day BETWEEN $2::date AND $3::date AND phone_number_id = ANY($4::text[])
            ORDER BY day DESC, phone_number_id`,
          [tenant, range.from, range.to, phoneIds]
        )
      : { rows: [] };
    const label = new Map(allAccounts.map((item) => [item.phone_number_id, publicAccount(item).label]));
    const daily = result.rows.map((row) => ({
      date: row.day,
      phone_number_id: row.phone_number_id,
      account_label: label.get(row.phone_number_id) || row.phone_number_id,
      sent: num(row.sent),
      delivered: num(row.delivered),
      marketing: num(row.marketing),
      utility: num(row.utility),
      authentication: num(row.authentication),
    }));
    activity = {
      totals: daily.reduce(
        (acc, row) => ({
          sent: acc.sent + row.sent,
          delivered: acc.delivered + row.delivered,
          marketing: acc.marketing + row.marketing,
          utility: acc.utility + row.utility,
          authentication: acc.authentication + row.authentication,
        }),
        { sent: 0, delivered: 0, marketing: 0, utility: 0, authentication: 0 }
      ),
      daily,
    };
  }

  const relevantWabas = text(templateId)
    ? [...new Set(chosen.map((row) => text(row.waba_id)).filter(Boolean))].concat(chosen.some((row) => !text(row.waba_id)) ? wabaIds : [])
    : wabaIds;
  const template = text(templateId) ? chosen[0] || null : null;
  return {
    range,
    accounts: allAccounts.map(publicAccount),
    campaigns: campaignList.map(({ id, name, template_id }) => ({ id, name, template_id })),
    connected: allAccounts.length > 0,
    sync: await syncStateFor(tenant, [...new Set(relevantWabas)]),
    ...summary,
    comparison,
    activity,
    template: template
      ? { id: template.id, name: template.name, language: template.language, category: template.category, status: template.status, meta_template_id: text(template.meta_template_id) }
      : null,
  };
};

/* ------------------------------------------------------------------ export */

const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  // A leading = + - @ would be read as a formula by a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const exportAnalyticsCsv = async ({ tenantId, account = "", campaigns = "", from, to } = {}) => {
  const context = await scope({ tenantId, account, campaigns });
  const range = normalizeRange({ from, to });
  const allWabas = !text(account);
  let chosen = context.templates.filter((row) => text(row.meta_template_id));
  if (context.localTemplateIds) chosen = chosen.filter((row) => context.localTemplateIds.has(String(row.id)));
  const names = new Map(chosen.map((row) => [text(row.meta_template_id), row]));
  const rows = await loadTemplateRows({ tenant: context.tenant, wabaIds: context.wabaIds, metaIds: [...names.keys()], range, allWabas });
  const header = ["date", "template", "language", "category", "template_id", "sent", "delivered", "read", "clicks", "delivery_rate_%", "read_rate_%", "amount_spent"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const template = names.get(row.template_id) || {};
    lines.push(
      [
        row.day,
        template.name || "",
        template.language || "",
        template.category || "",
        row.template_id,
        num(row.sent),
        num(row.delivered),
        num(row.read),
        num(row.clicks_total),
        pct(row.delivered, row.sent) ?? "",
        pct(row.read, row.sent) ?? "",
        round(row.cost, 4),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return { filename: `whatsapp-template-analytics_${range.from}_${range.to}.csv`, csv: `${String.fromCharCode(0xfeff)}${lines.join("\r\n")}\r\n` };
};

export default {
  ensureWaAnalyticsSchema,
  syncAnalytics,
  enableTemplateInsights,
  getTemplateAnalytics,
  exportAnalyticsCsv,
};
