// TikTok Marketing API (business-api.tiktok.com/open_api/v1.3) — the ADVERTISER surface.
//
// Same TikTok for Business app as server/services/tiktokBusiness* (app_id / app_secret,
// tkb:v1 token envelope), but a different authorization: the advertiser OAuth
// (auth_code -> /oauth2/access_token/) instead of the TikTok-account tt_user flow.
// Its token is keyed by advertiser_id and never expires; it dies only on revoke.
// Never send the publishing app's (open.tiktokapis.com, client_key) token here.
//
// Every path, parameter and field name below was read from TikTok's own docs on
// 2026-10-22 (doc ids in the comments) and the GET paths were probed (40104 = routed).

import { TIKTOK_BUSINESS_API_BASE, TIKTOK_BUSINESS_API_VERSION } from "../../services/tiktokBusinessConfigService.js";

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

const TIMEOUT_MS = Math.max(5_000, Number(process.env.TIKTOK_ADS_HTTP_TIMEOUT_MS || 30_000));

export const TIKTOK_ADS_PATHS = Object.freeze({
  TOKEN: "/oauth2/access_token/", // POST {app_id, secret, auth_code} — doc 1739965703387137
  REVOKE: "/oauth2/revoke_token/", // POST {app_id, secret, access_token} — doc 1739965949088770
  ADVERTISERS: "/oauth2/advertiser/get/", // GET ?app_id&secret — doc 1738455508553729
  ADVERTISER_INFO: "/advertiser/info/", // GET ?advertiser_ids=[..] — doc 1739593083610113
  CAMPAIGNS: "/campaign/get/", // doc 1739315828649986 (Ads Management)
  ADGROUPS: "/adgroup/get/", // doc 1739314558673922 (Ads Management)
  ADS: "/ad/get/", // doc 1735735588640770 (Ads Management)
  REPORT: "/report/integrated/get/", // doc 1740302848100353 (Reporting)
});

// First-level permission scopes (doc 1753986142651394). A token's `scope` list
// carries ids from all three levels; the first digit of a 1-3 digit id is its
// first-level parent (200 "Read Campaigns" -> 20 "Campaign" -> 2 "Ads Management").
export const TIKTOK_ADS_SCOPES = Object.freeze({
  AD_ACCOUNT: 1,
  ADS_MANAGEMENT: 2,
  AUDIENCE: 3,
  REPORTING: 4,
  MEASUREMENT: 5,
  CREATIVE: 6,
  APP: 7,
  PIXEL: 8,
  CATALOG: 9,
});
export const TIKTOK_ADS_SCOPE_LABELS = Object.freeze({
  1: "Ad Account Management",
  2: "Ads Management",
  3: "Audience Management",
  4: "Reporting",
  5: "Measurement",
  6: "Creative Management",
  7: "App Management",
  8: "Pixel Management",
  9: "DPA Catalog Management",
});

export const topLevelScopes = (scopes = []) => {
  const out = new Set();
  for (const raw of Array.isArray(scopes) ? scopes : []) {
    const id = text(raw);
    if (/^[1-9]\d{0,2}$/.test(id)) out.add(Number(id[0]));
  }
  return [...out].sort((a, b) => a - b);
};

export class TikTokAdsApiError extends Error {
  constructor(message, { status = 502, tiktokCode = null, requestId = "", kind = "api" } = {}) {
    super(message);
    this.name = "TikTokAdsApiError";
    this.status = status;
    this.tiktokCode = tiktokCode;
    this.requestId = requestId;
    // "reauth" | "permission" | "rate_limit" | "api" | "network"
    this.kind = kind;
  }
}

// Return codes we branch on (Appendix: return codes). 40100 is TOO MANY REQUESTS on the
// Marketing API (5-minute cool-down), not an auth failure.
const REAUTH_CODES = new Set([40104, 40105, 40106, 40107]);
const PERMISSION_CODES = new Set([40001, 40003]);
const RATE_CODES = new Set([40100, 50002]);
const PERMISSION_MESSAGE = /permission|scope|not authori[sz]ed|no access|unauthori[sz]ed/i;

export const classifyTikTokAdsFailure = (code, message = "") => {
  const wire = Number(code);
  if (REAUTH_CODES.has(wire)) return "reauth";
  if (RATE_CODES.has(wire)) return "rate_limit";
  if (PERMISSION_CODES.has(wire) || PERMISSION_MESSAGE.test(text(message))) return "permission";
  return "api";
};

export const redactTikTokAds = (value = "") =>
  text(value?.message ?? value)
    .replace(/("?(?:access_token|secret|auth_code|app_secret)"?\s*[:=]\s*"?)[^"'\s,}&]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9]{40,}\b/g, "[redacted]")
    .slice(0, 500);

// TikTok ids are 19-digit integers (> 2^53). Most come back as strings, but a bare
// number would be silently rounded by JSON.parse, so every *_id / *_ids value is
// quoted before parsing.
export const parseLosslessJson = (body = "") => {
  const quoted = String(body)
    .replace(/("[A-Za-z_]*_id"\s*:\s*)(-?\d{16,})/g, '$1"$2"')
    .replace(/("[A-Za-z_]*_ids"\s*:\s*\[)([^\]]*)\]/g, (_, head, list) => `${head}${list.replace(/(^|,)\s*(-?\d{16,})\s*(?=,|$)/g, '$1"$2"')}]`);
  return JSON.parse(quoted);
};

const apiRoot = () => `${TIKTOK_BUSINESS_API_BASE}/open_api/${TIKTOK_BUSINESS_API_VERSION}`;

// Array/object query values are sent as JSON literals (fields=["a","b"]), as TikTok expects.
export const encodeQuery = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) || typeof value === "object") search.set(key, JSON.stringify(value));
    else search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
};

const request = async (method, path, { accessToken = "", params = {}, body = null } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = { Accept: "application/json" };
  if (text(accessToken)) headers["Access-Token"] = text(accessToken);
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(`${apiRoot()}${path}${method === "GET" ? encodeQuery(params) : ""}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new TikTokAdsApiError(error?.name === "AbortError" ? "TikTok did not answer in time" : redactTikTokAds(error), { status: 503, kind: "network" });
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? parseLosslessJson(raw) : {};
  } catch {
    throw new TikTokAdsApiError(`TikTok answered HTTP ${response.status} with a non-JSON body`, { status: 502 });
  }
  const code = Number(payload?.code);
  if (code === 0) return payload.data ?? {};
  const message = redactTikTokAds(payload?.message || `TikTok request failed (HTTP ${response.status})`);
  const kind = response.status === 429 ? "rate_limit" : classifyTikTokAdsFailure(code, message);
  throw new TikTokAdsApiError(message, {
    status: kind === "reauth" ? 409 : kind === "permission" ? 403 : kind === "rate_limit" ? 429 : 422,
    tiktokCode: Number.isFinite(code) ? code : null,
    requestId: text(payload?.request_id),
    kind,
  });
};

export const tiktokAdsGet = (path, options) => request("GET", path, options);
export const tiktokAdsPost = (path, options) => request("POST", path, options);

// Walks page/page_size until page_info says there is no more (page_size max 1000).
export const tiktokAdsGetAll = async (path, { accessToken, params = {}, pageSize = 1000, maxPages = 50 } = {}) => {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await tiktokAdsGet(path, { accessToken, params: { ...params, page, page_size: pageSize } });
    rows.push(...(Array.isArray(data?.list) ? data.list : []));
    const totalPage = Number(data?.page_info?.total_page) || 1;
    if (page >= totalPage) break;
  }
  return rows;
};

// ------------------------------------------------------------------ OAuth

export const exchangeAuthCode = ({ appId, appSecret, authCode }) =>
  tiktokAdsPost(TIKTOK_ADS_PATHS.TOKEN, { body: { app_id: appId, secret: appSecret, auth_code: authCode } });

export const revokeToken = ({ appId, appSecret, accessToken }) =>
  tiktokAdsPost(TIKTOK_ADS_PATHS.REVOKE, { body: { app_id: appId, secret: appSecret, access_token: accessToken } });

export const listAuthorizedAdvertisers = async ({ appId, appSecret, accessToken }) => {
  const data = await tiktokAdsGet(TIKTOK_ADS_PATHS.ADVERTISERS, { accessToken, params: { app_id: appId, secret: appSecret } });
  return Array.isArray(data?.list) ? data.list : [];
};

export const ADVERTISER_INFO_FIELDS = Object.freeze([
  "advertiser_id", "name", "status", "role", "currency", "timezone", "display_timezone",
  "balance", "company", "country", "owner_bc_id", "rejection_reason", "create_time",
]);

export const fetchAdvertiserInfo = async ({ accessToken, advertiserIds }) => {
  const data = await tiktokAdsGet(TIKTOK_ADS_PATHS.ADVERTISER_INFO, {
    accessToken,
    params: { advertiser_ids: advertiserIds.map(text), fields: ADVERTISER_INFO_FIELDS },
  });
  return Array.isArray(data?.list) ? data.list : [];
};

// ------------------------------------------------------------------ structure

export const CAMPAIGN_FIELDS = Object.freeze([
  "campaign_id", "campaign_name", "objective_type", "operation_status", "secondary_status",
  "budget", "budget_mode", "budget_optimize_on", "campaign_product_source", "catalog_enabled",
  "create_time", "modify_time",
]);
export const ADGROUP_FIELDS = Object.freeze([
  "adgroup_id", "adgroup_name", "campaign_id", "operation_status", "secondary_status",
  "budget", "budget_mode", "schedule_type", "schedule_start_time", "schedule_end_time",
  "optimization_goal", "optimization_event", "bid_type", "billing_event", "promotion_type",
  "shopping_ads_type", "product_source", "catalog_id", "pixel_id", "placement_type",
  "create_time", "modify_time",
]);
export const AD_FIELDS = Object.freeze([
  "ad_id", "ad_name", "adgroup_id", "campaign_id", "operation_status", "secondary_status",
  "ad_format", "ad_text", "call_to_action", "landing_page_url", "video_id", "image_ids",
  "catalog_id", "product_set_id", "identity_type", "display_name", "create_time", "modify_time",
]);

// ------------------------------------------------------------------ reports

// Metric names from the metrics doc (1751443967255553). Website purchase value is
// `total_complete_payment_rate` (sic); `total_purchase_value` is the APP metric.
export const REPORT_METRICS = Object.freeze([
  "spend", "impressions", "clicks", "reach", "conversion",
  "complete_payment", "total_complete_payment_rate",
  "web_event_add_to_cart", "initiate_checkout",
]);

export const DATA_LEVEL = Object.freeze({ campaign: "AUCTION_CAMPAIGN", adgroup: "AUCTION_ADGROUP", ad: "AUCTION_AD" });
export const ID_DIMENSION = Object.freeze({ campaign: "campaign_id", adgroup: "adgroup_id", ad: "ad_id" });

// One ID dimension + stat_time_day; with a day dimension the range may not exceed 30 days.
export const REPORT_MAX_DAYS = 30;

export const fetchDailyReport = ({ accessToken, advertiserId, level, startDate, endDate }) =>
  tiktokAdsGetAll(TIKTOK_ADS_PATHS.REPORT, {
    accessToken,
    params: {
      advertiser_id: text(advertiserId),
      report_type: "BASIC",
      data_level: DATA_LEVEL[level],
      dimensions: [ID_DIMENSION[level], "stat_time_day"],
      metrics: [...REPORT_METRICS],
      start_date: startDate,
      end_date: endDate,
    },
  });
