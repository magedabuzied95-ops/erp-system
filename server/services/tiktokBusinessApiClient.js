// TikTok API for Business — HTTP client for the organic "TikTok Accounts" surface.
//
// SEPARATE FROM tiktokApiClient.js BY DESIGN
// -----------------------------------------
// tiktokApiClient.js talks to open.tiktokapis.com (Login Kit + Content Posting)
// with a Bearer header and a client_key/client_secret pair. This module talks to
// business-api.tiktok.com with an `Access-Token` header and an app_id/app_secret
// pair. Nothing is shared: not the host, not the credentials, not the auth
// header, not the error envelope.
//
// ENDPOINT PROVENANCE
// -------------------
// Every path below was read from TikTok's own documentation on 2026-08-28 via
// the portal's machine-readable docs API, then confirmed to be routed by an
// unauthenticated probe (a routed path answers `code: 40104 access_token is
// empty`; an unregistered one answers `code: 40006 no schema found`). These are
// no longer guesses, so there is no `verified: false` quarantine here.
//
// THE ONE TRAP WORTH RESTATING
// ----------------------------
// /open_api/v1.3/comment/* (no `business/` prefix) is the ADS comment API, keyed
// by advertiser_id/ad_id/identity_id — a different product for Spark Ads. The
// organic endpoints all carry the `business/` prefix and are keyed by
// business_id. Never substitute one for the other.

import {
  TIKTOK_BUSINESS_API_BASE,
  TIKTOK_BUSINESS_API_VERSION,
} from "./tiktokBusinessConfigService.js";

const text = (value = "") => String(value ?? "").trim();

const DEFAULT_TIMEOUT_MS = Math.max(5_000, Number(process.env.TIKTOK_BUSINESS_HTTP_TIMEOUT_MS || 20_000));

const apiRoot = () => `${TIKTOK_BUSINESS_API_BASE}/open_api/${TIKTOK_BUSINESS_API_VERSION}`;

// Paths only — the host is resolved at call time so tests can point the base at
// a local stub without rewriting every constant.
export const TIKTOK_BUSINESS_PATHS = Object.freeze({
  // OAuth — the organic TikTok-account flow, not the advertiser flow.
  TOKEN: "/tt_user/oauth2/token/",
  REFRESH_TOKEN: "/tt_user/oauth2/refresh_token/",
  REVOKE: "/tt_user/oauth2/revoke/",
  TOKEN_INFO: "/tt_user/token_info/get/",
  // Accounts API.
  ACCOUNT_GET: "/business/get/",
  VIDEO_LIST: "/business/video/list/",
  COMMENT_LIST: "/business/comment/list/",
  COMMENT_REPLY_LIST: "/business/comment/reply/list/",
  COMMENT_REPLY_CREATE: "/business/comment/reply/create/",
  WEBHOOK_UPDATE: "/business/webhook/update/",
  WEBHOOK_GET: "/business/webhook/get/",
});

export const TIKTOK_BUSINESS_AUTHORIZE_BASE = "https://www.tiktok.com/v2/auth/authorize";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TikTokBusinessApiError extends Error {
  constructor(message, { code = "TIKTOK_BUSINESS_API_ERROR", status = 502, logId = "", retryable = false, tiktokCode = null } = {}) {
    super(message);
    this.name = "TikTokBusinessApiError";
    this.code = code;
    this.status = status;
    this.logId = logId;
    this.retryable = retryable;
    // TikTok's numeric code, preserved so callers can branch on the wire value
    // rather than string-matching a human message.
    this.tiktokCode = tiktokCode;
  }
}

// TikTok Business return codes. Sourced from the Appendix - Return Codes page.
// Only the ones we actually branch on are named; everything else falls through
// to the generic classification below.
export const TIKTOK_BUSINESS_CODES = Object.freeze({
  OK: 0,
  // Auth / token family.
  ACCESS_TOKEN_EMPTY: 40104,
  ACCESS_TOKEN_INVALID: 40105,
  PERMISSION_DENIED: 40002,
  NO_SCHEMA_FOUND: 40006,
  APP_NOT_AUTHORIZED: 40100,
  RATE_LIMIT: 50002,
});

// Codes that mean "this connection is dead — ask the user to reconnect" rather
// than "retry later". A refresh cannot rescue any of these.
const REAUTH_CODES = new Set([40001, 40100, 40104, 40105, 40110]);
const REAUTH_MESSAGE = /access[_ ]token|not authorized|authorization|auth_code|refresh[_ ]token/i;

// Codes that are worth retrying with backoff.
const RETRYABLE_CODES = new Set([50000, 50002, 51000]);

export const isTikTokBusinessReauthError = (error) => {
  if (!error) return false;
  if (error.code === "TIKTOK_BUSINESS_REAUTH_REQUIRED") return true;
  const wire = Number(error.tiktokCode);
  if (Number.isFinite(wire) && REAUTH_CODES.has(wire)) return true;
  return false;
};

export const isTikTokBusinessRateLimited = (error) => {
  const wire = Number(error?.tiktokCode);
  return (Number.isFinite(wire) && wire === TIKTOK_BUSINESS_CODES.RATE_LIMIT) || Number(error?.status) === 429;
};

// Nothing that looks like a credential may reach a log line or a stored error.
// TikTok Business access tokens have no fixed prefix, so this redacts on shape
// (long opaque runs) as well as on the known key names.
export const redactTikTokBusinessError = (value = "") =>
  text(value?.message || value)
    .replace(/("?(?:access_token|refresh_token|client_secret|app_secret|auth_code|secret)"?\s*[:=]\s*"?)[^"'\s,}]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .slice(0, 500);

// Everything safe to persist and log about a failure. Never tokens, never the
// app secret, never the raw request body.
export const describeTikTokBusinessFailure = (error) => ({
  error_code: text(error?.code),
  tiktok_code: Number.isFinite(Number(error?.tiktokCode)) ? Number(error.tiktokCode) : null,
  http_status: Number(error?.status) || null,
  message: redactTikTokBusinessError(error),
  log_id: text(error?.logId),
  retryable: Boolean(error?.retryable),
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const parseBody = async (response) => {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { __raw: body.slice(0, 500) };
  }
};

// TikTok Business answers HTTP 200 with an in-body `code` that is 0 on success.
// HTTP status alone is not a success signal, so it is normalised here once
// instead of at every call site — the same lesson tiktokApiClient.js learned.
const assertOk = (payload, response) => {
  const wire = Number(payload?.code);
  if (Number.isFinite(wire) && wire === TIKTOK_BUSINESS_CODES.OK) return payload?.data ?? {};

  const message = text(payload?.message) || `TikTok Business request failed (HTTP ${response.status})`;
  const reauth = (Number.isFinite(wire) && REAUTH_CODES.has(wire)) || REAUTH_MESSAGE.test(message);
  // TikTok reports rate limiting in-body (code 50002) under an HTTP 200, so the
  // wire code — not the transport status — is the authority for backoff.
  const rateLimited = (Number.isFinite(wire) && wire === TIKTOK_BUSINESS_CODES.RATE_LIMIT) || response.status === 429;
  const retryable = (Number.isFinite(wire) && RETRYABLE_CODES.has(wire)) || response.status >= 500 || rateLimited;

  throw new TikTokBusinessApiError(redactTikTokBusinessError(message), {
    code: reauth ? "TIKTOK_BUSINESS_REAUTH_REQUIRED" : "TIKTOK_BUSINESS_API_ERROR",
    // A TikTok validation rejection is not a broken gateway. Answering 502 for
    // it surfaces in the browser as an opaque NetworkError and hides the real
    // reason, so map it to a status the client can actually render.
    status: reauth ? 409 : rateLimited ? 429 : retryable ? 503 : 422,
    logId: text(payload?.request_id) || text(response.headers?.get?.("x-tt-logid")),
    retryable,
    tiktokCode: Number.isFinite(wire) ? wire : null,
  });
};

const withTimeout = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new TikTokBusinessApiError("TikTok Business request timed out", {
        code: "TIKTOK_BUSINESS_TIMEOUT",
        status: 503,
        retryable: true,
      });
    }
    throw new TikTokBusinessApiError(redactTikTokBusinessError(error), {
      code: "TIKTOK_BUSINESS_NETWORK_ERROR",
      status: 503,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
};

// TikTok expects array-valued query params as a JSON literal, e.g.
// fields=["item_id","create_time"] — not repeated keys and not a bare CSV.
// Getting this wrong is answered with an unhelpful "param error", so the
// encoding lives here rather than at each call site.
const encodeQuery = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      search.set(key, JSON.stringify(value.map((item) => text(item))));
    } else if (typeof value === "boolean") {
      search.set(key, value ? "true" : "false");
    } else {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
};

// GET against the Accounts API. `accessToken` is passed per call and never
// cached in module scope — a stale token outliving a refresh is how the
// publishing integration would have broken.
export const tiktokBusinessGet = async (path, { accessToken, params = {} } = {}) => {
  const url = `${apiRoot()}${path}${encodeQuery(params)}`;
  const response = await withTimeout(url, {
    method: "GET",
    headers: {
      "Access-Token": text(accessToken),
      Accept: "application/json",
    },
  });
  return assertOk(await parseBody(response), response);
};

// POST against the Accounts API.
export const tiktokBusinessPost = async (path, { accessToken = "", body = {} } = {}) => {
  const url = `${apiRoot()}${path}`;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  // The OAuth endpoints authenticate with client_id/client_secret in the body
  // and must NOT carry an Access-Token header.
  if (text(accessToken)) headers["Access-Token"] = text(accessToken);

  const response = await withTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return assertOk(await parseBody(response), response);
};

// ---------------------------------------------------------------------------
// Webhook content parsing
// ---------------------------------------------------------------------------

// The comment.update webhook wraps its fields as a JSON STRING in `content`,
// and TikTok emits the ids as unquoted JSON numbers — e.g.
// "comment_id":7247303576418566913 — which exceeds Number.MAX_SAFE_INTEGER, so
// a plain JSON.parse silently corrupts the id (…6913 becomes …7000). A mangled
// id breaks webhook dedupe AND makes the targeted comment_ids sync fetch
// nothing. The ids are therefore extracted from the raw string as strings; the
// small fields fall back to JSON.parse.
const WEBHOOK_ID_FIELDS = ["comment_id", "video_id", "parent_comment_id", "timestamp"];

export const parseTikTokBusinessWebhookContent = (content) => {
  if (content && typeof content === "object") return content;
  const raw = text(content);
  if (!raw) return {};

  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  for (const field of WEBHOOK_ID_FIELDS) {
    // Matches both "comment_id":724…913 and "comment_id":"724…913".
    const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"?(\\d+)"?`));
    if (match) parsed[field] = match[1];
    else if (parsed[field] !== undefined && parsed[field] !== null) parsed[field] = String(parsed[field]);
  }
  return parsed;
};

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// Builds the TikTok-account-holder authorization URL.
//
// The base URL is app-specific and is copied verbatim out of the developer
// portal (My Apps > App Detail > Basic Information > "TikTok account holder
// authorization URL"), because it already carries the app's client_key and its
// approved scope list. We only append `state` for CSRF, so we never have to
// guess the scope parameter's name or its accepted values — guessing there
// makes TikTok reject the whole authorization request.
export const buildTikTokBusinessAuthorizeUrl = ({ authorizeUrl = "", state = "", forceConsent = false } = {}) => {
  const base = text(authorizeUrl);
  if (!base) {
    throw new TikTokBusinessApiError("TikTok Business authorize URL is not configured", {
      code: "TIKTOK_BUSINESS_AUTHORIZE_URL_MISSING",
      status: 503,
    });
  }

  let url = null;
  try {
    url = new URL(base);
  } catch {
    throw new TikTokBusinessApiError("TikTok Business authorize URL is not a valid URL", {
      code: "TIKTOK_BUSINESS_AUTHORIZE_URL_INVALID",
      status: 503,
    });
  }

  if (text(state)) url.searchParams.set("state", text(state));
  // Without this, a user who has already authorized is redirected straight back
  // without seeing the consent screen — which silently re-grants the OLD scope
  // set after we widen the requested scopes.
  if (forceConsent) url.searchParams.set("disable_auto_auth", "1");
  return url.toString();
};

export const exchangeTikTokBusinessAuthCode = async ({ appId, appSecret, authCode, redirectUri } = {}) =>
  tiktokBusinessPost(TIKTOK_BUSINESS_PATHS.TOKEN, {
    body: {
      client_id: text(appId),
      client_secret: text(appSecret),
      grant_type: "authorization_code",
      auth_code: text(authCode),
      redirect_uri: text(redirectUri),
    },
  });

export const refreshTikTokBusinessAccessToken = async ({ appId, appSecret, refreshToken } = {}) =>
  tiktokBusinessPost(TIKTOK_BUSINESS_PATHS.REFRESH_TOKEN, {
    body: {
      client_id: text(appId),
      client_secret: text(appSecret),
      grant_type: "refresh_token",
      refresh_token: text(refreshToken),
    },
  });

// The capability oracle. Returns { app_id, scope, creator_id } — `creator_id` is
// the value TikTok's docs tell us to pass as `business_id` on every Accounts API
// request, and `scope` is the live grant list. Runtime capability detection is
// built on this rather than on what the portal claims.
export const fetchTikTokBusinessTokenInfo = async ({ appId, accessToken } = {}) =>
  tiktokBusinessPost(TIKTOK_BUSINESS_PATHS.TOKEN_INFO, {
    body: { app_id: text(appId), access_token: text(accessToken) },
  });

export const revokeTikTokBusinessAccessToken = async ({ appId, appSecret, accessToken } = {}) =>
  tiktokBusinessPost(TIKTOK_BUSINESS_PATHS.REVOKE, {
    body: {
      client_id: text(appId),
      client_secret: text(appSecret),
      access_token: text(accessToken),
    },
  });

// ---------------------------------------------------------------------------
// Accounts API reads
// ---------------------------------------------------------------------------

export const TIKTOK_BUSINESS_PROFILE_FIELDS = Object.freeze([
  "display_name",
  "profile_image",
  "username",
  "profile_deep_link",
  "is_verified",
  "followers_count",
  "videos_count",
]);

export const fetchTikTokBusinessAccount = async ({ accessToken, businessId, fields = TIKTOK_BUSINESS_PROFILE_FIELDS } = {}) =>
  tiktokBusinessGet(TIKTOK_BUSINESS_PATHS.ACCOUNT_GET, {
    accessToken,
    params: { business_id: text(businessId), fields: [...fields] },
  });

// `fields` must contain item_id or TikTok errors — documented explicitly, and
// enforced here so a caller cannot trip it by trimming the list.
export const TIKTOK_BUSINESS_VIDEO_FIELDS = Object.freeze([
  "item_id",
  "create_time",
  "thumbnail_url",
  "share_url",
  "caption",
  "comments",
  "likes",
]);

export const fetchTikTokBusinessVideos = async ({
  accessToken,
  businessId,
  fields = TIKTOK_BUSINESS_VIDEO_FIELDS,
  cursor,
  maxCount = 20,
} = {}) => {
  const requested = [...new Set(["item_id", ...fields.map((item) => text(item)).filter(Boolean)])];
  return tiktokBusinessGet(TIKTOK_BUSINESS_PATHS.VIDEO_LIST, {
    accessToken,
    params: {
      business_id: text(businessId),
      fields: requested,
      // Documented maximum is 20; sending more is rejected outright.
      max_count: Math.min(20, Math.max(1, Number(maxCount) || 20)),
      cursor,
    },
  });
};

export const fetchTikTokBusinessComments = async ({
  accessToken,
  businessId,
  videoId,
  cursor,
  maxCount = 30,
  status = "ALL",
  includeReplies = true,
  commentIds,
} = {}) =>
  tiktokBusinessGet(TIKTOK_BUSINESS_PATHS.COMMENT_LIST, {
    accessToken,
    params: {
      business_id: text(businessId),
      video_id: text(videoId),
      // Documented range is 1..30.
      max_count: Math.min(30, Math.max(1, Number(maxCount) || 30)),
      status,
      include_replies: includeReplies,
      sort_field: "create_time",
      sort_order: "desc",
      cursor,
      comment_ids: Array.isArray(commentIds) && commentIds.length ? commentIds.slice(0, 30) : undefined,
    },
  });

export const fetchTikTokBusinessCommentReplies = async ({
  accessToken,
  businessId,
  videoId,
  commentId,
  cursor,
  maxCount = 30,
  status = "ALL",
} = {}) =>
  tiktokBusinessGet(TIKTOK_BUSINESS_PATHS.COMMENT_REPLY_LIST, {
    accessToken,
    params: {
      business_id: text(businessId),
      video_id: text(videoId),
      comment_id: text(commentId),
      max_count: Math.min(30, Math.max(1, Number(maxCount) || 30)),
      status,
      cursor,
    },
  });

// ---------------------------------------------------------------------------
// Accounts API writes
// ---------------------------------------------------------------------------

// The only write this integration performs. Documented limit is 1,200 UTF-8
// characters; the caller is rejected locally rather than burning a request that
// TikTok will refuse.
export const TIKTOK_BUSINESS_REPLY_MAX_CHARS = 1200;

export const createTikTokBusinessCommentReply = async ({ accessToken, businessId, videoId, commentId, text: replyText } = {}) => {
  const body = text(replyText);
  if (!body) {
    throw new TikTokBusinessApiError("Reply text is required", { code: "TIKTOK_BUSINESS_REPLY_EMPTY", status: 400 });
  }
  if ([...body].length > TIKTOK_BUSINESS_REPLY_MAX_CHARS) {
    throw new TikTokBusinessApiError(
      `Reply exceeds TikTok's ${TIKTOK_BUSINESS_REPLY_MAX_CHARS}-character limit`,
      { code: "TIKTOK_BUSINESS_REPLY_TOO_LONG", status: 400 }
    );
  }
  return tiktokBusinessPost(TIKTOK_BUSINESS_PATHS.COMMENT_REPLY_CREATE, {
    accessToken,
    body: {
      business_id: text(businessId),
      video_id: text(videoId),
      comment_id: text(commentId),
      text: body,
    },
  });
};
