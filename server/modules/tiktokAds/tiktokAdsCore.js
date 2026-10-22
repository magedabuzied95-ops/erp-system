// Shared plumbing for TikTok Ads: config gate, tenant scoping, account context (with
// its decrypted advertiser token), OAuth connect, and the pull-sync from TikTok into
// our tables. TikTok wins: every sync overwrites the rows it returns.

import crypto from "crypto";

import db from "../../database/db.js";
import { getTenantId } from "../../utils/requestScope.js";
import { getPublicBackendUrl } from "../../utils/publicUrl.js";
import {
  tiktokBusinessAppId,
  tiktokBusinessAppSecret,
  tiktokBusinessEnabled,
} from "../../services/tiktokBusinessConfigService.js";
import {
  decryptTikTokBusinessSecret,
  describeTikTokBusinessEncryptionKey,
  encryptTikTokBusinessSecret,
} from "../../services/tiktokBusinessCryptoService.js";
import {
  AD_FIELDS,
  ADGROUP_FIELDS,
  CAMPAIGN_FIELDS,
  REPORT_MAX_DAYS,
  TIKTOK_ADS_PATHS,
  TIKTOK_ADS_SCOPES,
  TIKTOK_ADS_SCOPE_LABELS,
  TikTokAdsApiError,
  exchangeAuthCode,
  fetchAdvertiserInfo,
  fetchDailyReport,
  listAuthorizedAdvertisers,
  redactTikTokAds,
  revokeToken,
  tiktokAdsGetAll,
  topLevelScopes,
} from "./tiktokAdsApi.js";

export const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
export const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nullableNum = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const httpError = (status, message, code = undefined) => Object.assign(new Error(message), { status, code });

export const tenantOf = (req) => {
  const tenantId = getTenantId(req);
  if (!tenantId) throw httpError(400, "Tenant context missing");
  return tenantId;
};

// { success: true, ...data } or a safe error body. TikTok's own message is kept so the
// screen can say exactly what TikTok refused.
export const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, ...(data || {}) });
  } catch (error) {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    const body = { success: false, message: error?.message || "Request failed", code: error?.code || undefined };
    if (error instanceof TikTokAdsApiError) {
      body.code = `TIKTOK_ADS_${error.kind.toUpperCase()}`;
      body.tiktok = { code: error.tiktokCode, kind: error.kind, request_id: error.requestId };
    }
    if (status >= 500) console.warn("[tiktok-ads] request failed", { path: req.originalUrl, status, message: body.message });
    if (!res.headersSent) res.status(status).json(body);
  }
};

// ------------------------------------------------------------------ config

// The app's registered "Advertiser redirect URL". TikTok compares it byte for byte with
// the redirect_uri inside the authorization URL, so it is the one already registered:
// the TikTok Business callback, which hands states starting with "tta_" to this module.
export const tiktokAdsRedirectUri = () =>
  text(process.env.TIKTOK_ADS_REDIRECT_URI) ||
  `${text(getPublicBackendUrl()).replace(/\/+$/, "") || "https://api.m1store-egy.com"}/api/tiktok-business/oauth/callback`;

export const TIKTOK_ADS_STATE_PREFIX = "tta_";
export const isTikTokAdsState = (state) => text(state).startsWith(TIKTOK_ADS_STATE_PREFIX);

// Copied from My Apps > Basic Information > "Advertiser authorization URL" when set;
// otherwise built in the same shape (portal/auth?app_id&state&redirect_uri).
export const buildAuthorizeUrl = (state) => {
  const configured = text(process.env.TIKTOK_ADS_AUTHORIZE_URL);
  const url = new URL(configured || "https://business-api.tiktok.com/portal/auth");
  if (!configured) {
    url.searchParams.set("app_id", tiktokBusinessAppId());
    url.searchParams.set("redirect_uri", tiktokAdsRedirectUri());
  }
  url.searchParams.set("state", state);
  return url.toString();
};

export const describeTikTokAdsSetup = () => {
  const key = describeTikTokBusinessEncryptionKey();
  const problems = [];
  if (!tiktokBusinessEnabled()) problems.push("TIKTOK_BUSINESS_ENABLED");
  if (!tiktokBusinessAppId() || !tiktokBusinessAppSecret()) problems.push("TIKTOK_BUSINESS_APP_ID/SECRET");
  if (!key.ok) problems.push(key.code || "TIKTOK_BUSINESS_ENCRYPTION_KEY");
  return { ready: problems.length === 0, problems, redirect_uri: tiktokAdsRedirectUri() };
};

const assertReady = () => {
  const setup = describeTikTokAdsSetup();
  if (!setup.ready) throw httpError(503, `TikTok Ads is not configured on the server: ${setup.problems.join(", ")}`, "TIKTOK_ADS_NOT_CONFIGURED");
};

// ------------------------------------------------------------------ accounts

const ACCOUNT_PUBLIC_COLUMNS = `id, tenant_id, advertiser_id, name, status, role, currency, timezone, balance, company,
  country, owner_bc_id, scopes, connected_at, structure_state, report_state, last_synced_at, last_sync_error,
  created_at, updated_at, (access_token_encrypted IS NOT NULL AND access_token_encrypted <> '') AS has_token`;

// The two capabilities phase 2 needs, read from the scopes the advertiser granted.
// An empty scope list means "unknown" (TikTok did not say), so nothing is assumed missing.
export const capabilitiesOf = (scopes = []) => {
  const granted = topLevelScopes(scopes);
  const has = (id) => granted.length === 0 || granted.includes(id);
  return {
    granted: granted.map((id) => TIKTOK_ADS_SCOPE_LABELS[id] || String(id)),
    ads_management: has(TIKTOK_ADS_SCOPES.ADS_MANAGEMENT),
    reporting: has(TIKTOK_ADS_SCOPES.REPORTING),
  };
};

const publicAccount = (row) => ({ ...row, capabilities: capabilitiesOf(row.scopes) });

export const listAccounts = async (tenantId) => {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_PUBLIC_COLUMNS} FROM tiktok_ads_accounts WHERE tenant_id = $1 ORDER BY name, id`,
    [tenantId],
  );
  return rows.map(publicAccount);
};

export const getAccountContext = async (tenantId, accountId) => {
  const { rows } = await db.query(
    `SELECT id, tenant_id, advertiser_id, name, timezone, currency, scopes, access_token_encrypted
       FROM tiktok_ads_accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, Number(accountId)],
  );
  const row = rows[0];
  if (!row) throw httpError(404, "TikTok ad account not found", "TIKTOK_ADS_NO_ACCOUNT");
  if (!row.access_token_encrypted) throw httpError(409, "This ad account is disconnected — connect it again.", "TIKTOK_ADS_NOT_CONNECTED");
  const { access_token_encrypted: encrypted, ...account } = row;
  return { ...account, token: decryptTikTokBusinessSecret(encrypted) };
};

// ------------------------------------------------------------------ OAuth

const STATE_TTL_MINUTES = 30;

export const startOAuth = async ({ tenantId, userId, returnTo }) => {
  assertReady();
  const state = `${TIKTOK_ADS_STATE_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
  await db.query(`DELETE FROM tiktok_ads_oauth_states WHERE created_at < NOW() - INTERVAL '1 day'`);
  await db.query(
    `INSERT INTO tiktok_ads_oauth_states (state, tenant_id, user_id, return_to) VALUES ($1, $2, $3, $4)`,
    [state, tenantId, userId || null, text(returnTo)],
  );
  return { auth_url: buildAuthorizeUrl(state), redirect_uri: tiktokAdsRedirectUri() };
};

// Single use: the UPDATE … RETURNING claims the state, so a replayed callback finds nothing.
const claimState = async (state) => {
  if (!/^tta_[a-f0-9]{48}$/.test(text(state))) return null;
  const { rows } = await db.query(
    `UPDATE tiktok_ads_oauth_states SET used_at = NOW()
      WHERE state = $1 AND used_at IS NULL AND created_at > NOW() - ($2::int * INTERVAL '1 minute')
      RETURNING tenant_id, user_id, return_to`,
    [text(state), STATE_TTL_MINUTES],
  );
  return rows[0] || null;
};

export const peekReturnTo = async (state) => {
  if (!isTikTokAdsState(state)) return "";
  const { rows } = await db.query(`SELECT return_to FROM tiktok_ads_oauth_states WHERE state = $1`, [text(state)]);
  return text(rows[0]?.return_to);
};

const upsertAccountInfo = async (tenantId, info, extra = {}) => {
  const values = [
    tenantId,
    text(info.advertiser_id),
    text(info.name),
    text(info.status) || null,
    text(info.role) || null,
    text(info.currency) || "USD",
    text(info.timezone || info.display_timezone),
    nullableNum(info.balance),
    text(info.company) || null,
    text(info.country) || null,
    text(info.owner_bc_id) || null,
    JSON.stringify(info),
  ];
  const tokenSql = extra.tokenEncrypted ? ", access_token_encrypted = $13, scopes = $14::jsonb, connected_by = $15, connected_at = NOW()" : "";
  const params = extra.tokenEncrypted ? [...values, extra.tokenEncrypted, JSON.stringify(extra.scopes || []), extra.userId || null] : values;
  const { rows } = await db.query(
    `INSERT INTO tiktok_ads_accounts (tenant_id, advertiser_id, name, status, role, currency, timezone, balance, company, country, owner_bc_id, raw
       ${extra.tokenEncrypted ? ", access_token_encrypted, scopes, connected_by, connected_at" : ""})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb${extra.tokenEncrypted ? ",$13,$14::jsonb,$15,NOW()" : ""})
     ON CONFLICT (tenant_id, advertiser_id) DO UPDATE SET
       name = EXCLUDED.name, status = EXCLUDED.status, role = EXCLUDED.role, currency = EXCLUDED.currency,
       timezone = EXCLUDED.timezone, balance = EXCLUDED.balance, company = EXCLUDED.company, country = EXCLUDED.country,
       owner_bc_id = EXCLUDED.owner_bc_id, raw = EXCLUDED.raw, updated_at = NOW()${tokenSql}
     RETURNING id`,
    params,
  );
  return rows[0].id;
};

export const completeOAuth = async ({ state, authCode }) => {
  assertReady();
  const claimed = await claimState(state);
  if (!claimed) throw httpError(400, "This TikTok login link expired or was already used — start again.", "TIKTOK_ADS_STATE_INVALID");
  if (!text(authCode)) throw httpError(400, "TikTok did not return an authorization code.", "TIKTOK_ADS_NO_CODE");
  const appId = tiktokBusinessAppId();
  const appSecret = tiktokBusinessAppSecret();
  const token = await exchangeAuthCode({ appId, appSecret, authCode: text(authCode) });
  const accessToken = text(token?.access_token);
  if (!accessToken) throw httpError(502, "TikTok returned no access token.", "TIKTOK_ADS_NO_TOKEN");
  const scopes = Array.isArray(token?.scope) ? token.scope.map(text) : [];
  let advertiserIds = Array.isArray(token?.advertiser_ids) ? token.advertiser_ids.map(text).filter(Boolean) : [];
  if (!advertiserIds.length) {
    advertiserIds = (await listAuthorizedAdvertisers({ appId, appSecret, accessToken })).map((row) => text(row.advertiser_id)).filter(Boolean);
  }
  if (!advertiserIds.length) throw httpError(409, "No TikTok ad account was shared during the login.", "TIKTOK_ADS_NO_ADVERTISER");
  const infos = await fetchAdvertiserInfo({ accessToken, advertiserIds });
  const byId = new Map(infos.map((info) => [text(info.advertiser_id), info]));
  const tokenEncrypted = encryptTikTokBusinessSecret(accessToken);
  const accountIds = [];
  for (const advertiserId of advertiserIds) {
    const info = byId.get(advertiserId) || { advertiser_id: advertiserId };
    accountIds.push(await upsertAccountInfo(claimed.tenant_id, info, { tokenEncrypted, scopes, userId: claimed.user_id }));
  }
  return { tenantId: claimed.tenant_id, returnTo: claimed.return_to, accountIds, scopes };
};

export const disconnectAccount = async (tenantId, accountId) => {
  const ctx = await getAccountContext(tenantId, accountId);
  // Other advertisers authorised in the same login share this token; revoke only when it is the last one.
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM tiktok_ads_accounts WHERE tenant_id = $1 AND id <> $2 AND access_token_encrypted IS NOT NULL`,
    [tenantId, ctx.id],
  );
  if (!rows[0]?.n) {
    await revokeToken({ appId: tiktokBusinessAppId(), appSecret: tiktokBusinessAppSecret(), accessToken: ctx.token }).catch((error) =>
      console.warn("[tiktok-ads] revoke failed", { message: redactTikTokAds(error) }),
    );
  }
  await db.query(`UPDATE tiktok_ads_accounts SET access_token_encrypted = NULL, updated_at = NOW() WHERE id = $1`, [ctx.id]);
  return { disconnected: true };
};

// ------------------------------------------------------------------ sync

// TikTok times are UTC "YYYY-MM-DD HH:MM:SS".
export const tiktokTime = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

// The advertiser's calendar day (reports are in the account's time zone).
export const localDate = (timezone, date = new Date()) => {
  const format = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  try {
    return format(text(timezone) || "Africa/Cairo");
  } catch {
    return format("Africa/Cairo");
  }
};

const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// [start, end] split into closed ranges of at most REPORT_MAX_DAYS days (the day-dimension cap).
export const dateChunks = (endDate, days) => {
  const chunks = [];
  let end = endDate;
  let remaining = Math.max(1, days);
  while (remaining > 0) {
    const span = Math.min(REPORT_MAX_DAYS, remaining);
    chunks.push({ start: addDays(end, -(span - 1)), end });
    end = addDays(end, -span);
    remaining -= span;
  }
  return chunks;
};

const markState = (accountId, column, value, error = null) =>
  db.query(
    `UPDATE tiktok_ads_accounts SET ${column} = $2, last_sync_error = $3, last_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [accountId, value, error],
  );

// A missing permission is a state to show ("waiting for TikTok"), not a failure to retry.
const isPermissionError = (error) => error instanceof TikTokAdsApiError && error.kind === "permission";

const LEVEL_SOURCES = {
  campaign: { path: TIKTOK_ADS_PATHS.CAMPAIGNS, fields: CAMPAIGN_FIELDS, table: "tiktok_ads_campaigns", idKey: "campaign_id" },
  adgroup: { path: TIKTOK_ADS_PATHS.ADGROUPS, fields: ADGROUP_FIELDS, table: "tiktok_ads_adgroups", idKey: "adgroup_id" },
  ad: { path: TIKTOK_ADS_PATHS.ADS, fields: AD_FIELDS, table: "tiktok_ads_ads", idKey: "ad_id" },
};

const levelColumns = (level, row) => {
  const common = {
    name: text(row.campaign_name ?? row.adgroup_name ?? row.ad_name),
    operation_status: text(row.operation_status) || null,
    secondary_status: text(row.secondary_status) || null,
    budget: nullableNum(row.budget),
    budget_mode: text(row.budget_mode) || null,
    tiktok_created_at: tiktokTime(row.create_time),
    tiktok_updated_at: tiktokTime(row.modify_time),
  };
  if (level === "campaign") return { ...common, objective_type: text(row.objective_type) || null };
  if (level === "adgroup") {
    return { ...common, campaign_id: text(row.campaign_id) || null, optimization_goal: text(row.optimization_goal) || null, schedule_end_time: tiktokTime(row.schedule_end_time) };
  }
  return { ...common, adgroup_id: text(row.adgroup_id) || null, campaign_id: text(row.campaign_id) || null, ad_format: text(row.ad_format) || null, ad_text: text(row.ad_text) || null, budget: null, budget_mode: null };
};

const upsertObjects = async (ctx, level, rows) => {
  const { table, idKey } = LEVEL_SOURCES[level];
  for (const row of rows) {
    const objectId = text(row[idKey]);
    if (!objectId) continue;
    const columns = levelColumns(level, row);
    const names = Object.keys(columns);
    const params = [ctx.tenant_id, ctx.id, objectId, ...Object.values(columns), JSON.stringify(row)];
    await db.query(
      `INSERT INTO ${table} (tenant_id, account_id, ${idKey}, ${names.join(", ")}, raw, synced_at)
       VALUES ($1, $2, $3, ${names.map((_, index) => `$${index + 4}`).join(", ")}, $${names.length + 4}::jsonb, NOW())
       ON CONFLICT (account_id, ${idKey}) DO UPDATE SET
         ${names.map((name) => `${name} = EXCLUDED.${name}`).join(", ")}, raw = EXCLUDED.raw, synced_at = NOW()`,
      params,
    );
  }
  return rows.length;
};

export const syncAccountInfo = async (ctx) => {
  const [info] = await fetchAdvertiserInfo({ accessToken: ctx.token, advertiserIds: [ctx.advertiser_id] });
  if (info) await upsertAccountInfo(ctx.tenant_id, info);
  return info || null;
};

export const syncStructure = async (ctx) => {
  if (!capabilitiesOf(ctx.scopes).ads_management) {
    await markState(ctx.id, "structure_state", "missing_permission");
    return { state: "missing_permission" };
  }
  try {
    const counts = {};
    for (const level of ["campaign", "adgroup", "ad"]) {
      const { path, fields } = LEVEL_SOURCES[level];
      // Deleted objects are not returned by default; nothing more to filter.
      const rows = await tiktokAdsGetAll(path, { accessToken: ctx.token, params: { advertiser_id: ctx.advertiser_id, fields: [...fields] } });
      counts[level] = await upsertObjects(ctx, level, rows);
    }
    await markState(ctx.id, "structure_state", "ok");
    return { state: "ok", counts };
  } catch (error) {
    if (isPermissionError(error)) {
      await markState(ctx.id, "structure_state", "missing_permission", error.message);
      return { state: "missing_permission" };
    }
    await markState(ctx.id, "structure_state", "error", redactTikTokAds(error));
    throw error;
  }
};

// Report row -> insight columns. Every metric arrives as a string.
export const insightFromReportRow = (row = {}) => {
  const metrics = row.metrics || {};
  return {
    spend: num(metrics.spend),
    impressions: Math.round(num(metrics.impressions)),
    clicks: Math.round(num(metrics.clicks)),
    reach: Math.round(num(metrics.reach)),
    conversions: num(metrics.conversion),
    purchases: num(metrics.complete_payment),
    purchase_value: num(metrics.total_complete_payment_rate),
    add_to_cart: num(metrics.web_event_add_to_cart),
    initiate_checkout: num(metrics.initiate_checkout),
  };
};

const INSIGHT_COLUMNS = ["spend", "impressions", "clicks", "reach", "conversions", "purchases", "purchase_value", "add_to_cart", "initiate_checkout"];

const upsertInsights = async (ctx, level, rows, idKey) => {
  let written = 0;
  for (const row of rows) {
    const objectId = text(row?.dimensions?.[idKey]);
    const statDate = text(row?.dimensions?.stat_time_day).slice(0, 10);
    if (!objectId || !/^\d{4}-\d{2}-\d{2}$/.test(statDate)) continue;
    const values = insightFromReportRow(row);
    await db.query(
      `INSERT INTO tiktok_ads_insights (tenant_id, account_id, level, object_id, stat_date, ${INSIGHT_COLUMNS.join(", ")}, synced_at)
       VALUES ($1, $2, $3, $4, $5::date, ${INSIGHT_COLUMNS.map((_, index) => `$${index + 6}`).join(", ")}, NOW())
       ON CONFLICT (account_id, level, object_id, stat_date) DO UPDATE SET
         ${INSIGHT_COLUMNS.map((name) => `${name} = EXCLUDED.${name}`).join(", ")}, synced_at = NOW()`,
      [ctx.tenant_id, ctx.id, level, objectId, statDate, ...INSIGHT_COLUMNS.map((name) => values[name])],
    );
    written += 1;
  }
  return written;
};

export const syncInsights = async (ctx, { days = 3 } = {}) => {
  if (!capabilitiesOf(ctx.scopes).reporting) {
    await markState(ctx.id, "report_state", "missing_permission");
    return { state: "missing_permission" };
  }
  try {
    const today = localDate(ctx.timezone);
    const counts = { campaign: 0, adgroup: 0, ad: 0 };
    for (const level of ["campaign", "adgroup", "ad"]) {
      const idKey = LEVEL_SOURCES[level].idKey;
      for (const chunk of dateChunks(today, days)) {
        const rows = await fetchDailyReport({ accessToken: ctx.token, advertiserId: ctx.advertiser_id, level, startDate: chunk.start, endDate: chunk.end });
        counts[level] += await upsertInsights(ctx, level, rows, idKey);
      }
    }
    await markState(ctx.id, "report_state", "ok");
    return { state: "ok", counts };
  } catch (error) {
    if (isPermissionError(error)) {
      await markState(ctx.id, "report_state", "missing_permission", error.message);
      return { state: "missing_permission" };
    }
    await markState(ctx.id, "report_state", "error", redactTikTokAds(error));
    throw error;
  }
};

export const syncAll = async (ctx, { days = 3 } = {}) => {
  const info = await syncAccountInfo(ctx);
  const structure = await syncStructure(ctx);
  const insights = await syncInsights(ctx, { days });
  return { account: Boolean(info), structure, insights };
};

export const connectedAccountContexts = async () => {
  const { rows } = await db.query(`SELECT tenant_id, id FROM tiktok_ads_accounts WHERE access_token_encrypted IS NOT NULL ORDER BY id`);
  return rows;
};
