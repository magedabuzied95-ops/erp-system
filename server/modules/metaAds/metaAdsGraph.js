// Marketing API client for the Meta Ads module.
//
// Every call goes through graphRequest() so version, error shape and paging are the
// same everywhere. Tokens are encrypted at rest with the same AES-GCM format the rest
// of the ERP uses for Meta secrets ("enc:v1:iv:tag:data"), so a value written by
// metaIntegrationService decrypts here too.

import crypto from "crypto";

export const META_ADS_GRAPH_VERSION = process.env.META_ADS_GRAPH_VERSION || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}`;

// Everything the Ads module asks Facebook for at connect time. Each one is needed
// by a screen: ads_* for the manager, leads_retrieval for lead forms, pages_* for
// the identity picker / page insights / lead webhooks, business_management to list
// ad accounts owned by a Business.
export const META_ADS_OAUTH_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "pages_manage_metadata",
  "read_insights",
];

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

const secretKey = () =>
  crypto.createHash("sha256").update(text(process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "SECRET_KEY")).digest();

export const encryptSecret = (value = "") => {
  const plain = text(value);
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
};

export const decryptSecret = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (!raw.startsWith("enc:v1:")) return raw;
  try {
    const [, , ivRaw, tagRaw, dataRaw] = raw.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivRaw, "base64"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
};

export const maskSecret = (value = "") => {
  const plain = text(value);
  if (!plain) return "";
  return plain.length <= 8 ? "••••" : `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
};

export const metaAppConfig = () => ({
  appId: text(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID),
  appSecret: text(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
});

// appsecret_proof is required when "Require App Secret" is on in the app settings
// and is harmless otherwise.
const appSecretProof = (token) => {
  const { appSecret } = metaAppConfig();
  if (!appSecret || !token) return "";
  return crypto.createHmac("sha256", appSecret).update(token).digest("hex");
};

export class MetaAdsGraphError extends Error {
  constructor(message, { status = 502, code = null, subcode = null, type = "", fbtraceId = "", userTitle = "", userMessage = "", payload = null } = {}) {
    super(message);
    this.name = "MetaAdsGraphError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.type = type;
    this.fbtraceId = fbtraceId;
    this.userTitle = userTitle;
    this.userMessage = userMessage;
    this.payload = payload;
  }

  // Token expired / revoked / missing permission: the account must reconnect.
  get needsReconnect() {
    return this.code === 190 || this.code === 102 || this.code === 10 || (this.code >= 200 && this.code < 300);
  }

  get isRateLimited() {
    return [4, 17, 32, 613, 80000, 80003, 80004, 80014].includes(Number(this.code));
  }
}

const encodeParam = (value) => (value !== null && typeof value === "object" ? JSON.stringify(value) : String(value));

const buildError = (status, payload) => {
  const err = payload?.error || {};
  const message = text(err.error_user_msg || err.message) || `Meta request failed (${status})`;
  return new MetaAdsGraphError(message, {
    status: status >= 400 && status < 600 ? status : 502,
    code: err.code ?? null,
    subcode: err.error_subcode ?? null,
    type: text(err.type),
    fbtraceId: text(err.fbtrace_id),
    userTitle: text(err.error_user_title),
    userMessage: text(err.error_user_msg),
    payload,
  });
};

/**
 * graphRequest({ method, path, token, params, body, form })
 *  - path: "/act_123/campaigns" (leading slash) or a full https URL (paging.next)
 *  - params: query string for GET/DELETE; for POST they are sent form-encoded
 *  - form: a FormData (multipart upload); overrides params for POST
 */
export const graphRequest = async ({ method = "GET", path, token = "", params = {}, form = null, timeoutMs = 60000 }) => {
  const isAbsolute = /^https?:\/\//i.test(path);
  const url = new URL(isAbsolute ? path : `${GRAPH_BASE}${path}`);
  const verb = method.toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const proof = appSecretProof(token);
  try {
    let init = { method: verb, signal: controller.signal };
    if (verb === "GET" || verb === "DELETE") {
      for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, encodeParam(value));
      }
      if (token && !isAbsolute) url.searchParams.set("access_token", token);
      if (proof && !isAbsolute) url.searchParams.set("appsecret_proof", proof);
    } else if (form) {
      if (token) form.append("access_token", token);
      if (proof) form.append("appsecret_proof", proof);
      init = { ...init, body: form };
    } else {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === "") continue;
        body.set(key, encodeParam(value));
      }
      if (token) body.set("access_token", token);
      if (proof) body.set("appsecret_proof", proof);
      init = { ...init, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } };
    }
    const response = await fetch(url, init);
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }
    if (!response.ok || payload?.error) throw buildError(response.status, payload);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new MetaAdsGraphError("Meta request timed out", { status: 504 });
    if (error instanceof MetaAdsGraphError) throw error;
    throw new MetaAdsGraphError(error?.message || "Meta request failed", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};

export const graphGet = (path, token, params = {}) => graphRequest({ method: "GET", path, token, params });
export const graphPost = (path, token, params = {}) => graphRequest({ method: "POST", path, token, params });
export const graphDelete = (path, token, params = {}) => graphRequest({ method: "DELETE", path, token, params });

// Follows paging.next until `limit` rows or no more pages.
export const graphGetAll = async (path, token, params = {}, { limit = 2000 } = {}) => {
  const rows = [];
  let page = await graphGet(path, token, { limit: 200, ...params });
  for (;;) {
    for (const row of page?.data || []) {
      rows.push(row);
      if (rows.length >= limit) return rows;
    }
    const next = page?.paging?.next;
    if (!next) return rows;
    page = await graphRequest({ method: "GET", path: next, token });
  }
};

export const normalizeAdAccountId = (value) => {
  const raw = text(value).replace(/^act_/i, "");
  return raw ? `act_${raw}` : "";
};

// Meta money fields are integers in the account's minor unit (cents). A handful of
// currencies have no minor unit; Meta documents them with offset 1.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "COP", "CRC", "HUF", "ISK", "IDR", "PYG", "TWD", "VND"]);
export const currencyOffset = (currency = "USD") => (ZERO_DECIMAL.has(String(currency).toUpperCase()) ? 1 : 100);
export const toMinorUnits = (amount, currency) => {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * currencyOffset(currency));
};
export const fromMinorUnits = (amount, currency) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return value / currencyOffset(currency);
};
