// "ربط الحساب" — Facebook Login for the Ads module.
//
//   start     → a state row + the Facebook dialog URL
//   callback  → (public) code → short token → long-lived token; ad accounts + pages
//               are parked on the state row, then the browser goes back to
//               /meta-ads/connect?state=… to pick what to connect
//   pending   → the parked lists (never the tokens)
//   complete  → upsert meta_ads_accounts, drop the state, sync in the background
//
// One Meta app serves every tenant: the tenant is carried by the state row only.

import crypto from "crypto";

import db from "../../../database/db.js";
import { getPublicAppUrl, getPublicBackendUrl } from "../../../utils/publicUrl.js";
import {
  META_ADS_GRAPH_VERSION,
  META_ADS_OAUTH_SCOPES,
  MetaAdsGraphError,
  decryptSecret,
  encryptSecret,
  graphGet,
  graphGetAll,
  metaAppConfig,
  normalizeAdAccountId,
} from "../metaAdsGraph.js";
import { getAccountContext, httpError, listAccounts, syncAll, syncAudiences, syncLeadForms } from "../metaAdsCore.js";
import { TOKEN_INVALID_RE, clip, log, text, warn } from "./integrationsCommon.js";
import { subscribeAccountWebhooks, subscribePageLeadgen } from "./webhooks.js";

const STATE_TTL_MINUTES = 30;
const CONNECT_PATH = "/meta-ads/connect";

const trimSlash = (value) => text(value).replace(/\/+$/g, "");

// Same origin rules the messaging integration uses (metaIntegrationService
// redirectUriFor / frontendOriginFor), pointed at our own callback.
const requestOrigin = (req) => (req ? trimSlash(`${req.protocol || "http"}://${req.get("host")}`) : "");

export const adsRedirectUri = (req = null) => {
  const configured = text(process.env.META_ADS_REDIRECT_URI);
  if (configured) return configured;
  const base = trimSlash(getPublicAppUrl() || getPublicBackendUrl() || requestOrigin(req));
  return `${base}/api/meta-ads-public/oauth/callback`;
};

export const frontendOrigin = (req = null) => {
  const configured = text(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL);
  if (configured) return trimSlash(configured);
  const origin = text(req?.get?.("origin"));
  if (origin) return trimSlash(origin);
  const referer = text(req?.get?.("referer"));
  if (referer) {
    try {
      const parsed = new URL(referer);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return "";
    }
  }
  return "";
};

export const connectSetupStatus = (req) => {
  const { appId, appSecret } = metaAppConfig();
  const backend = trimSlash(getPublicBackendUrl() || getPublicAppUrl() || requestOrigin(req));
  return {
    app_configured: Boolean(appId && appSecret),
    login_for_business: Boolean(text(process.env.META_ADS_CONFIG_ID)),
    redirect_uri: adsRedirectUri(req),
    webhook_url: `${backend}/api/meta-ads-public/webhook`,
    verify_token_set: Boolean(text(process.env.META_ADS_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN)),
    scopes: META_ADS_OAUTH_SCOPES,
    graph_version: META_ADS_GRAPH_VERSION,
  };
};

export const startOAuth = async (req, tenantId) => {
  const { appId, appSecret } = metaAppConfig();
  if (!appId || !appSecret) throw httpError(500, "Facebook login is not configured on the server (META_APP_ID / META_APP_SECRET).", "META_ADS_APP_NOT_CONFIGURED");
  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = adsRedirectUri(req);
  const returnTo = `${frontendOrigin(req)}${CONNECT_PATH}`;
  await db.query(`DELETE FROM meta_ads_oauth_states WHERE created_at < NOW() - INTERVAL '1 day'`);
  await db.query(
    `INSERT INTO meta_ads_oauth_states (state, tenant_id, user_id, return_to, redirect_uri) VALUES ($1,$2,$3,$4,$5)`,
    [state, tenantId, Number(req.user?.id) || null, returnTo, redirectUri],
  );
  const target = new URL(`https://www.facebook.com/${META_ADS_GRAPH_VERSION}/dialog/oauth`);
  target.searchParams.set("client_id", appId);
  target.searchParams.set("redirect_uri", redirectUri);
  target.searchParams.set("state", state);
  target.searchParams.set("response_type", "code");
  const configId = text(process.env.META_ADS_CONFIG_ID);
  if (configId) {
    // Facebook Login for Business: the configuration carries the permissions.
    target.searchParams.set("config_id", configId);
    target.searchParams.set("override_default_response_type", "true");
  } else {
    target.searchParams.set("scope", META_ADS_OAUTH_SCOPES.join(","));
    target.searchParams.set("auth_type", "rerequest");
  }
  return { auth_url: target.toString(), redirect_uri: redirectUri };
};

const loadState = async (state, { tenantId = null } = {}) => {
  const value = text(state);
  if (!/^[a-f0-9]{48}$/.test(value)) return null;
  const { rows } = await db.query(
    `SELECT *, created_at > NOW() - ($2::int * INTERVAL '1 minute') AS fresh FROM meta_ads_oauth_states WHERE state = $1`,
    [value, STATE_TTL_MINUTES],
  );
  const row = rows[0];
  if (!row) return null;
  if (tenantId !== null && String(row.tenant_id) !== String(tenantId)) return null;
  return row;
};

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";

const fetchPages = async (token) => {
  try {
    return await graphGetAll("/me/accounts", token, { fields: `${PAGE_FIELDS},whatsapp_number` }, { limit: 500 });
  } catch (error) {
    // whatsapp_number is not readable on every page/app; the rest of the list still is.
    if (error instanceof MetaAdsGraphError && Number(error.code) === 100) return graphGetAll("/me/accounts", token, { fields: PAGE_FIELDS }, { limit: 500 });
    throw error;
  }
};

const redirectWith = (res, base, params) => {
  const target = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value) target.searchParams.set(key, value);
  return res.redirect(302, target.toString());
};

const fallbackReturn = (req) => `${frontendOrigin(req) || trimSlash(getPublicAppUrl()) || requestOrigin(req)}${CONNECT_PATH}`;

// GET /api/meta-ads-public/oauth/callback?code&state
export const handleOAuthCallback = async (req, res) => {
  const stateRow = await loadState(req.query?.state).catch(() => null);
  const returnTo = text(stateRow?.return_to) || fallbackReturn(req);
  try {
    if (!stateRow) throw new Error("This connection link has expired. Start again from \"Continue with Facebook\".");
    if (!stateRow.fresh) throw new Error("The connection took longer than 30 minutes. Start again.");
    const fbError = text(req.query?.error_description || req.query?.error_message || req.query?.error);
    if (fbError) throw new Error(fbError);
    const code = text(req.query?.code);
    if (!code) throw new Error("Facebook did not return an authorization code.");
    const { appId, appSecret } = metaAppConfig();
    const redirectUri = text(stateRow.redirect_uri) || adsRedirectUri(req);
    const short = await graphGet("/oauth/access_token", "", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
    const shortToken = text(short?.access_token);
    if (!shortToken) throw new Error("Facebook did not return an access token.");
    let token = shortToken;
    let expiresIn = Number(short?.expires_in) || 0;
    try {
      const long = await graphGet("/oauth/access_token", "", {
        grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken,
      });
      if (text(long?.access_token)) {
        token = text(long.access_token);
        expiresIn = Number(long.expires_in) || 0;
      }
    } catch (error) {
      warn("oauth-long-lived", error);
    }
    const me = await graphGet("/me", token, { fields: "id,name" }).catch(() => ({}));
    const adAccounts = await graphGetAll("/me/adaccounts", token, {
      fields: "id,account_id,name,currency,timezone_name,account_status,business{id,name}",
    }, { limit: 500 });
    const pages = await fetchPages(token);
    const pending = {
      ad_accounts: adAccounts.map((row) => ({
        id: normalizeAdAccountId(row.id || row.account_id),
        account_id: text(row.account_id),
        name: text(row.name),
        currency: text(row.currency),
        timezone_name: text(row.timezone_name),
        account_status: Number(row.account_status) || null,
        business_id: text(row.business?.id) || null,
        business_name: text(row.business?.name) || null,
      })),
      pages: pages.map((page) => ({
        id: text(page.id),
        name: text(page.name),
        token_enc: encryptSecret(page.access_token),
        instagram_id: text(page.instagram_business_account?.id) || null,
        instagram_username: text(page.instagram_business_account?.username) || null,
        whatsapp_number: text(page.whatsapp_number) || null,
      })),
    };
    await db.query(
      `UPDATE meta_ads_oauth_states SET user_token_encrypted = $2, token_expires_at = $3, pending_accounts = $4::jsonb,
         meta_user_id = $5, meta_user_name = $6 WHERE state = $1`,
      [
        stateRow.state, encryptSecret(token), expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
        JSON.stringify(pending), text(me?.id) || null, text(me?.name) || null,
      ],
    );
    log("oauth-callback", { tenant_id: stateRow.tenant_id, ad_accounts: pending.ad_accounts.length, pages: pending.pages.length });
    return redirectWith(res, returnTo, { state: stateRow.state });
  } catch (error) {
    warn("oauth-callback", error);
    return redirectWith(res, returnTo, { error: clip(error?.userMessage || error?.message || "Facebook connection failed", 300) });
  }
};

const pendingOf = (row) => {
  const value = row?.pending_accounts;
  return value && typeof value === "object" && !Array.isArray(value) ? value : { ad_accounts: [], pages: [] };
};

export const getPending = async (tenantId, state) => {
  const row = await loadState(state, { tenantId });
  if (!row || !row.fresh) throw httpError(410, "This connection has expired. Start again from \"Continue with Facebook\".", "META_ADS_STATE_EXPIRED");
  if (!row.user_token_encrypted) throw httpError(409, "Facebook has not finished the login yet.", "META_ADS_STATE_PENDING");
  const pending = pendingOf(row);
  const connected = new Set((await listAccounts(tenantId)).filter((account) => account.has_token).map((account) => account.ad_account_id));
  return {
    meta_user: { id: row.meta_user_id, name: row.meta_user_name },
    ad_accounts: (pending.ad_accounts || []).map((account) => ({ ...account, connected: connected.has(account.id) })),
    pages: (pending.pages || []).map(({ token_enc: _drop, ...page }) => page),
  };
};

const statusFor = (accountStatus) => {
  if (accountStatus === 1) return "active";
  if (accountStatus === 2) return "disabled";
  if (accountStatus === 3) return "unsettled";
  return "active";
};

// Sync everything a new connection needs. Each step on its own: one failing
// (e.g. a page without leads permission) must not stop the others.
export const syncAfterConnect = async (tenantId, accountIds) => {
  for (const accountId of accountIds) {
    let ctx;
    try {
      ctx = await getAccountContext(tenantId, accountId);
    } catch (error) {
      warn("connect-sync", error, { tenant_id: tenantId, account_id: accountId });
      continue;
    }
    const steps = [
      ["syncAll", () => syncAll(ctx)],
      ["syncAudiences", () => syncAudiences(ctx)],
      ["syncLeadForms", () => syncLeadForms(ctx)],
      ["subscribePageLeadgen", () => subscribePageLeadgen(ctx)],
      ["subscribeAccountWebhooks", () => subscribeAccountWebhooks(ctx)],
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (error) {
        warn(`connect-${name}`, error, { tenant_id: tenantId, account_id: accountId });
        if (TOKEN_INVALID_RE.test(text(error?.message))) break;
      }
    }
  }
};

export const completeOAuth = async (req, tenantId, body = {}) => {
  const row = await loadState(body.state, { tenantId });
  if (!row || !row.fresh) throw httpError(410, "This connection has expired. Start again from \"Continue with Facebook\".", "META_ADS_STATE_EXPIRED");
  if (!row.user_token_encrypted) throw httpError(409, "Facebook has not finished the login yet.", "META_ADS_STATE_PENDING");
  const pending = pendingOf(row);
  const adById = new Map((pending.ad_accounts || []).map((account) => [account.id, account]));
  const pageById = new Map((pending.pages || []).map((page) => [page.id, page]));
  const chosen = (Array.isArray(body.accounts) ? body.accounts : [])
    .map((item) => ({ ad: adById.get(normalizeAdAccountId(item?.ad_account_id)), page: pageById.get(text(item?.page_id)) || null }))
    .filter((item) => item.ad);
  if (!chosen.length) throw httpError(400, "Choose at least one ad account.");
  const userToken = decryptSecret(row.user_token_encrypted);
  if (!userToken) throw httpError(409, "The Facebook token could not be read. Start again.");
  const connectedBy = Number(req.user?.id) || row.user_id || null;
  const ids = [];
  for (const { ad, page } of chosen) {
    const pageToken = page ? decryptSecret(page.token_enc) : "";
    const { rows } = await db.query(
      `INSERT INTO meta_ads_accounts (tenant_id, ad_account_id, name, currency, timezone, status, account_status, business_id, business_name,
         user_access_token_encrypted, token_expires_at, connected_by, meta_user_id, meta_user_name,
         page_id, page_name, page_access_token_encrypted, instagram_user_id, instagram_username, whatsapp_phone_number,
         last_sync_error, updated_at)
       VALUES ($1,$2,$3,COALESCE(NULLIF($4,''),'USD'),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NULL,NOW())
       ON CONFLICT (tenant_id, ad_account_id) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name,''), meta_ads_accounts.name), currency = EXCLUDED.currency,
         timezone = COALESCE(NULLIF(EXCLUDED.timezone,''), meta_ads_accounts.timezone), status = EXCLUDED.status,
         account_status = EXCLUDED.account_status, business_id = COALESCE(EXCLUDED.business_id, meta_ads_accounts.business_id),
         business_name = COALESCE(EXCLUDED.business_name, meta_ads_accounts.business_name),
         user_access_token_encrypted = EXCLUDED.user_access_token_encrypted, token_expires_at = EXCLUDED.token_expires_at,
         connected_by = EXCLUDED.connected_by, meta_user_id = EXCLUDED.meta_user_id, meta_user_name = EXCLUDED.meta_user_name,
         page_id = EXCLUDED.page_id, page_name = EXCLUDED.page_name, page_access_token_encrypted = EXCLUDED.page_access_token_encrypted,
         instagram_user_id = EXCLUDED.instagram_user_id, instagram_username = EXCLUDED.instagram_username,
         whatsapp_phone_number = COALESCE(EXCLUDED.whatsapp_phone_number, meta_ads_accounts.whatsapp_phone_number),
         last_sync_error = NULL, updated_at = NOW()
       RETURNING id`,
      [
        tenantId, ad.id, ad.name, ad.currency, ad.timezone_name, statusFor(ad.account_status), ad.account_status, ad.business_id, ad.business_name,
        row.user_token_encrypted, row.token_expires_at, connectedBy, row.meta_user_id, row.meta_user_name,
        page?.id || null, page?.name || null, pageToken ? encryptSecret(pageToken) : null, page?.instagram_id || null,
        page?.instagram_username || null, page?.whatsapp_number || null,
      ],
    );
    ids.push(rows[0].id);
  }
  await db.query(`DELETE FROM meta_ads_oauth_states WHERE state = $1`, [row.state]);
  log("oauth-complete", { tenant_id: tenantId, accounts: ids.length });
  setImmediate(() => {
    void syncAfterConnect(tenantId, ids).catch((error) => warn("connect-sync", error, { tenant_id: tenantId }));
  });
  const accounts = (await listAccounts(tenantId)).filter((account) => ids.includes(account.id));
  return { accounts };
};

export const listConnectedAccounts = async (tenantId) => {
  const accounts = await listAccounts(tenantId);
  const now = Date.now();
  return accounts.map((account) => {
    const expired = account.token_expires_at ? new Date(account.token_expires_at).getTime() <= now : false;
    let tokenStatus = "missing";
    if (account.has_token) tokenStatus = expired || TOKEN_INVALID_RE.test(text(account.last_sync_error)) ? "invalid" : "valid";
    return { ...account, token_status: tokenStatus };
  });
};

export const disconnectAccount = async (tenantId, accountId) => {
  const { rows } = await db.query(
    `UPDATE meta_ads_accounts SET user_access_token_encrypted = NULL, page_access_token_encrypted = NULL, token_expires_at = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, Number(accountId) || 0],
  );
  if (!rows[0]) throw httpError(404, "Ad account not found");
  log("disconnect", { tenant_id: tenantId, account_id: rows[0].id });
  return { disconnected: true, id: rows[0].id };
};
