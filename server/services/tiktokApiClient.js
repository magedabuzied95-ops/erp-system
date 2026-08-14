// Thin, official-endpoints-only HTTP client for TikTok.
//
// Every path here is from developers.tiktok.com. No scraping, no unofficial or
// reverse-engineered endpoints. TikTok answers 200 with an in-body `error.code`
// of "ok" on success, so HTTP status alone is not a success signal — that is
// normalised here once instead of at every call site.

import { TIKTOK_API_BASE, TIKTOK_AUTH_BASE, tiktokClientKey, tiktokClientSecret } from "./tiktokConfigService.js";

const text = (value = "") => String(value ?? "").trim();
const DEFAULT_TIMEOUT_MS = Math.max(5_000, Number(process.env.TIKTOK_HTTP_TIMEOUT_MS || 20_000));

export const TIKTOK_ENDPOINTS = Object.freeze({
  AUTHORIZE: `${TIKTOK_AUTH_BASE}/v2/auth/authorize/`,
  TOKEN: `${TIKTOK_API_BASE}/v2/oauth/token/`,
  REVOKE: `${TIKTOK_API_BASE}/v2/oauth/revoke/`,
  USER_INFO: `${TIKTOK_API_BASE}/v2/user/info/`,
  CREATOR_INFO: `${TIKTOK_API_BASE}/v2/post/publish/creator_info/query/`,
  VIDEO_INIT: `${TIKTOK_API_BASE}/v2/post/publish/video/init/`,
  INBOX_VIDEO_INIT: `${TIKTOK_API_BASE}/v2/post/publish/inbox/video/init/`,
  PUBLISH_STATUS: `${TIKTOK_API_BASE}/v2/post/publish/status/fetch/`,
});

export class TikTokApiError extends Error {
  constructor(message, { code = "TIKTOK_API_ERROR", status = 502, logId = "", retryable = false } = {}) {
    super(message);
    this.name = "TikTokApiError";
    this.code = code;
    this.status = status;
    this.logId = logId;
    this.retryable = retryable;
  }
}

// TikTok error codes that mean "the connection is dead, ask the user to
// reconnect" as opposed to "transient, retry later".
const REAUTH_ERROR_CODES = new Set([
  "access_token_invalid",
  "refresh_token_invalid",
  "scope_not_authorized",
  "scope_permission_missed",
  "invalid_grant",
]);

const RETRYABLE_ERROR_CODES = new Set(["rate_limit_exceeded", "internal_error", "server_error"]);

export const isTikTokReauthError = (error) => REAUTH_ERROR_CODES.has(text(error?.code).toLowerCase());

// TikTok tokens and codes must never reach a log line. Anything that looks like
// a credential is redacted before an error message is stored or printed.
export const redactTikTokError = (value = "") =>
  text(value?.message || value)
    .replace(/(act\.|clt\.)[A-Za-z0-9!*._-]+/g, "[tiktok-token]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .slice(0, 500);

const parseBody = async (response) => {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { __raw: body.slice(0, 500) };
  }
};

const withTimeout = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new TikTokApiError("TikTok request timed out", { code: "timeout", retryable: true });
    }
    throw new TikTokApiError(redactTikTokError(error), { code: "network_error", retryable: true });
  } finally {
    clearTimeout(timer);
  }
};

// The OAuth endpoints are form-encoded and report failures as a top-level
// `error` + `error_description`. The v2 API endpoints are JSON and report
// failures under `error.code`/`error.message` with `error.code === "ok"` on
// success. Both shapes are funnelled into TikTokApiError here.
const assertOAuthOk = (payload, response) => {
  const errorCode = text(payload?.error);
  if (!errorCode && response.ok) return payload;
  throw new TikTokApiError(redactTikTokError(payload?.error_description || `TikTok OAuth failed (${response.status})`), {
    code: errorCode || `http_${response.status}`,
    status: response.status === 429 ? 429 : 502,
    logId: text(payload?.log_id),
    retryable: response.status === 429 || response.status >= 500,
  });
};

const assertApiOk = (payload, response) => {
  const errorCode = text(payload?.error?.code).toLowerCase();
  if ((!errorCode || errorCode === "ok") && response.ok) return payload;
  throw new TikTokApiError(redactTikTokError(payload?.error?.message || `TikTok API failed (${response.status})`), {
    code: errorCode || `http_${response.status}`,
    status: response.status === 429 ? 429 : 502,
    logId: text(payload?.error?.log_id),
    retryable: RETRYABLE_ERROR_CODES.has(errorCode) || response.status === 429 || response.status >= 500,
  });
};

const postForm = async (url, fields) => {
  const body = new URLSearchParams();
  Object.entries(fields).forEach(([key, value]) => {
    if (text(value)) body.append(key, text(value));
  });
  const response = await withTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: body.toString(),
  });
  return assertOAuthOk(await parseBody(response), response);
};

const postJson = async (url, { accessToken, payload = {} } = {}) => {
  const response = await withTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${text(accessToken)}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
  return assertApiOk(await parseBody(response), response);
};

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export const buildTikTokAuthorizeUrl = ({ clientKey, redirectUri, scopes = [], state } = {}) => {
  const url = new URL(TIKTOK_ENDPOINTS.AUTHORIZE);
  url.searchParams.set("client_key", text(clientKey));
  url.searchParams.set("response_type", "code");
  // TikTok expects a comma-separated scope string, not the OAuth-standard space.
  url.searchParams.set("scope", scopes.map((scope) => text(scope)).filter(Boolean).join(","));
  url.searchParams.set("redirect_uri", text(redirectUri));
  url.searchParams.set("state", text(state));
  return url.toString();
};

export const exchangeTikTokAuthorizationCode = async ({ code, redirectUri } = {}) =>
  postForm(TIKTOK_ENDPOINTS.TOKEN, {
    client_key: tiktokClientKey(),
    client_secret: tiktokClientSecret(),
    // TikTok sends the code URL-encoded in the callback; Express has already
    // decoded req.query, and TikTok requires the decoded form here.
    code: text(code),
    grant_type: "authorization_code",
    redirect_uri: text(redirectUri),
  });

export const refreshTikTokAccessToken = async ({ refreshToken } = {}) =>
  postForm(TIKTOK_ENDPOINTS.TOKEN, {
    client_key: tiktokClientKey(),
    client_secret: tiktokClientSecret(),
    grant_type: "refresh_token",
    refresh_token: text(refreshToken),
  });

export const revokeTikTokAccessToken = async ({ accessToken } = {}) =>
  postForm(TIKTOK_ENDPOINTS.REVOKE, {
    client_key: tiktokClientKey(),
    client_secret: tiktokClientSecret(),
    token: text(accessToken),
  });

// ---------------------------------------------------------------------------
// Display / profile
// ---------------------------------------------------------------------------

export const fetchTikTokUserInfo = async ({ accessToken, fields = ["open_id", "union_id", "avatar_url", "display_name", "username"] } = {}) => {
  const url = new URL(TIKTOK_ENDPOINTS.USER_INFO);
  url.searchParams.set("fields", fields.join(","));
  const response = await withTimeout(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${text(accessToken)}` },
  });
  const payload = assertApiOk(await parseBody(response), response);
  return payload?.data?.user || {};
};

// ---------------------------------------------------------------------------
// Content Posting
// ---------------------------------------------------------------------------

// Must be called before every publish: TikTok requires the UI to show the
// creator's *current* privacy options, and rejects a post whose settings
// contradict them (e.g. a private account cannot post PUBLIC_TO_EVERYONE).
export const queryTikTokCreatorInfo = async ({ accessToken } = {}) => {
  const payload = await postJson(TIKTOK_ENDPOINTS.CREATOR_INFO, { accessToken, payload: {} });
  return payload?.data || {};
};

export const initTikTokDirectPost = async ({ accessToken, postInfo, sourceInfo } = {}) => {
  const payload = await postJson(TIKTOK_ENDPOINTS.VIDEO_INIT, {
    accessToken,
    payload: { post_info: postInfo, source_info: sourceInfo },
  });
  return payload?.data || {};
};

// Draft / "inbox" upload: the video lands in the creator's TikTok app for them
// to finish and post. Requires video.upload, and takes no post_info — captions
// and privacy are chosen by the user inside TikTok, not by us.
export const initTikTokDraftUpload = async ({ accessToken, sourceInfo } = {}) => {
  const payload = await postJson(TIKTOK_ENDPOINTS.INBOX_VIDEO_INIT, {
    accessToken,
    payload: { source_info: sourceInfo },
  });
  return payload?.data || {};
};

export const fetchTikTokPublishStatus = async ({ accessToken, publishId } = {}) => {
  const payload = await postJson(TIKTOK_ENDPOINTS.PUBLISH_STATUS, {
    accessToken,
    payload: { publish_id: text(publishId) },
  });
  return payload?.data || {};
};

// FILE_UPLOAD transfer. TikTok returns a pre-signed upload_url; the bytes go
// straight there with a Content-Range, never through a TikTok API host.
// PULL_FROM_URL is deliberately not implemented: it would require domain
// verification and would expose an SSRF surface for no gain.
export const uploadTikTokVideoChunk = async ({ uploadUrl, buffer, start, end, total, mimeType = "video/mp4" } = {}) => {
  const response = await withTimeout(text(uploadUrl), {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(buffer.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
    body: buffer,
  });
  if (!response.ok) {
    throw new TikTokApiError(`TikTok upload failed (${response.status})`, {
      code: `upload_http_${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return { uploaded: true, status: response.status };
};
