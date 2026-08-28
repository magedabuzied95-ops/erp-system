// TikTok Business — runtime capability detection.
//
// THE RULE THIS MODULE ENFORCES
// -----------------------------
// The portal saying "Get Account Comment: approved" is a statement about the
// APP. It says nothing about THIS tenant's connection, whose token can be
// absent, expired, revoked, or scoped narrower than the app's ceiling (the
// account holder chooses what to grant on the consent screen). So capability is
// never copied from a constant and never assumed from approval — it is computed
// from, in order:
//
//   1. a connection row existing            -> else NOT_CONNECTED
//   2. a refreshable, unexpired token       -> else TOKEN_EXPIRED
//   3. the required scope in the live grant -> else MISSING_PERMISSION
//   4. a read-only API probe succeeding     -> else API_ERROR
//   -> only then AVAILABLE
//
// The probe result is cached briefly per tenant; everything before it is cheap
// DB state and computed fresh on every call.
//
// MESSAGING IS DELIBERATELY DIFFERENT
// -----------------------------------
// Business Messaging is NOT detected here and can never come out of this module
// as available. Even if a messaging scope somehow appeared in the grant, the
// feature is gated behind its own application + Data Security review that has
// not happened. describeMessagingCapability() reports the waiting state and
// asserts the scopes are absent — that assertion existing is the point.

import db from "../database/db.js";
import {
  describeTikTokBusinessFailure,
  fetchTikTokBusinessTokenInfo,
} from "./tiktokBusinessApiClient.js";
import {
  TIKTOK_BUSINESS_COMMENT_READ_SCOPES,
  TIKTOK_BUSINESS_COMMENT_REPLY_SCOPES,
  TIKTOK_BUSINESS_MESSAGING_SCOPES,
  tiktokBusinessAppId,
  tiktokBusinessCommentsEnabled,
  tiktokBusinessEnabled,
} from "./tiktokBusinessConfigService.js";
import {
  TIKTOK_BUSINESS_CONNECTION_STATUS,
  getTikTokBusinessConnectionRow,
  getValidTikTokBusinessAccessToken,
  parseGrantedScopes,
  refreshTokenExpired,
} from "./tiktokBusinessOAuthService.js";

const text = (value = "") => String(value ?? "").trim();

// The meaningful states the UI renders. Ordered from "nothing exists" to
// "verified working"; every state names what to do next.
export const TIKTOK_BUSINESS_CAPABILITY = Object.freeze({
  DISABLED: "DISABLED",                       // env flag off — feature dormant
  NOT_CONFIGURED: "NOT_CONFIGURED",           // env flag on but credentials missing
  NOT_CONNECTED: "NOT_CONNECTED",             // no account has authorized yet
  TOKEN_EXPIRED: "TOKEN_EXPIRED",             // reconnect required
  MISSING_PERMISSION: "MISSING_PERMISSION",   // connected, but scope not granted
  API_ERROR: "API_ERROR",                     // scope present, live probe failed
  AVAILABLE: "AVAILABLE",                     // verified against the live API
});

// Live-probe cache. Capability is read by status endpoints on page load; probing
// TikTok on every render would burn quota for no information (a token does not
// gain or lose scopes second to second).
const PROBE_TTL_MS = Math.max(30_000, Number(process.env.TIKTOK_BUSINESS_CAPABILITY_PROBE_TTL_MS || 5 * 60 * 1000));
const probeCache = new Map(); // tenantId -> { at, result }

export const invalidateTikTokBusinessCapabilityCache = (tenantId) => {
  if (tenantId === undefined) probeCache.clear();
  else probeCache.delete(Number(tenantId));
};

const hasAllScopes = (granted, required) => required.every((scope) => granted.includes(scope));

// Verifies the token against TikTok with the cheapest authenticated read there
// is: token_info. It costs one request, proves the token is alive, and returns
// the authoritative scope list in the same round trip.
const probeLiveToken = async ({ tenantId, client }) => {
  const cached = probeCache.get(Number(tenantId));
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.result;

  let result;
  try {
    const { accessToken, businessId } = await getValidTikTokBusinessAccessToken({ tenantId, client });
    const info = await fetchTikTokBusinessTokenInfo({ appId: tiktokBusinessAppId(), accessToken });
    result = {
      ok: true,
      scopes: parseGrantedScopes(info?.scope),
      business_id: text(info?.creator_id) || businessId,
      failure: null,
    };
  } catch (error) {
    result = {
      ok: false,
      scopes: [],
      business_id: "",
      failure: describeTikTokBusinessFailure(error),
      error_code: text(error?.code),
    };
  }

  probeCache.set(Number(tenantId), { at: Date.now(), result });
  return result;
};

// ---------------------------------------------------------------------------
// Comments capability
// ---------------------------------------------------------------------------

const state = (statusValue, extra = {}) => ({ status: statusValue, available: statusValue === TIKTOK_BUSINESS_CAPABILITY.AVAILABLE, ...extra });

// The full ladder, with a live probe. `probe: false` stops after the stored-
// scope check — used by hot paths that must not spend an HTTP request.
export const detectTikTokBusinessCommentsCapability = async ({ tenantId, probe = true, client = db } = {}) => {
  if (!tiktokBusinessEnabled() || !tiktokBusinessCommentsEnabled()) {
    return state(TIKTOK_BUSINESS_CAPABILITY.DISABLED, {
      reason: "TikTok Business comments are disabled by configuration (TIKTOK_BUSINESS_ENABLED / TIKTOK_BUSINESS_COMMENTS_ENABLED).",
    });
  }

  const row = await getTikTokBusinessConnectionRow({ tenantId, client });
  if (!row || row.status === TIKTOK_BUSINESS_CONNECTION_STATUS.NOT_CONNECTED || !text(row.access_token_encrypted)) {
    return state(TIKTOK_BUSINESS_CAPABILITY.NOT_CONNECTED, {
      reason: "No TikTok Business account has been connected for this tenant.",
    });
  }

  if (row.status === TIKTOK_BUSINESS_CONNECTION_STATUS.RECONNECT_REQUIRED || refreshTokenExpired(row)) {
    return state(TIKTOK_BUSINESS_CAPABILITY.TOKEN_EXPIRED, {
      reason: "The TikTok Business connection has expired or was revoked; reconnect is required.",
      last_error: text(row.last_error),
    });
  }

  // Stored scopes first: they were written from token_info at connect/refresh
  // time. If the required scope is not even in the stored grant, no probe can
  // change the answer.
  const storedScopes = parseGrantedScopes(row.granted_scopes);
  const readGranted = hasAllScopes(storedScopes, [...TIKTOK_BUSINESS_COMMENT_READ_SCOPES]);
  const replyGranted = hasAllScopes(storedScopes, [...TIKTOK_BUSINESS_COMMENT_REPLY_SCOPES]);

  if (!readGranted) {
    return state(TIKTOK_BUSINESS_CAPABILITY.MISSING_PERMISSION, {
      reason: "The authorized TikTok account did not grant the comment read permission (comment.list).",
      missing_scopes: TIKTOK_BUSINESS_COMMENT_READ_SCOPES.filter((scope) => !storedScopes.includes(scope)),
      granted_scopes: storedScopes,
    });
  }

  if (!probe) {
    return state(TIKTOK_BUSINESS_CAPABILITY.AVAILABLE, {
      verified: "stored_scopes_only",
      can_reply: replyGranted,
      granted_scopes: storedScopes,
    });
  }

  const live = await probeLiveToken({ tenantId, client });
  if (!live.ok) {
    const reconnect = text(live.error_code).includes("RECONNECT") || text(live.error_code).includes("NOT_CONNECTED");
    return state(reconnect ? TIKTOK_BUSINESS_CAPABILITY.TOKEN_EXPIRED : TIKTOK_BUSINESS_CAPABILITY.API_ERROR, {
      reason: reconnect
        ? "The TikTok Business token could not be refreshed; reconnect is required."
        : "TikTok's API rejected the capability check.",
      failure: live.failure,
    });
  }

  // The live scope list wins over the stored one — a user can revoke individual
  // permissions from inside TikTok without us seeing a webhook for it.
  const liveRead = hasAllScopes(live.scopes, [...TIKTOK_BUSINESS_COMMENT_READ_SCOPES]);
  const liveReply = hasAllScopes(live.scopes, [...TIKTOK_BUSINESS_COMMENT_REPLY_SCOPES]);
  if (!liveRead) {
    return state(TIKTOK_BUSINESS_CAPABILITY.MISSING_PERMISSION, {
      reason: "TikTok reports the comment read permission (comment.list) is not granted on the live token.",
      missing_scopes: TIKTOK_BUSINESS_COMMENT_READ_SCOPES.filter((scope) => !live.scopes.includes(scope)),
      granted_scopes: live.scopes,
    });
  }

  return state(TIKTOK_BUSINESS_CAPABILITY.AVAILABLE, {
    verified: "live_token_info",
    can_reply: liveReply,
    granted_scopes: live.scopes,
    business_id: live.business_id,
  });
};

// ---------------------------------------------------------------------------
// Messaging capability — permanently waiting, by design
// ---------------------------------------------------------------------------

export const TIKTOK_BUSINESS_MESSAGING_STATUS = "WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION";

export const describeTikTokBusinessMessagingCapabilityState = async ({ tenantId, client = db } = {}) => {
  // Reported for transparency: whether any messaging scope has appeared in the
  // stored grant. Even a true here does NOT enable messaging — the feature
  // requires its own application and review, which have not happened.
  let grantedMessagingScopes = [];
  const row = await getTikTokBusinessConnectionRow({ tenantId, client }).catch(() => null);
  if (row) {
    const stored = parseGrantedScopes(row.granted_scopes);
    grantedMessagingScopes = TIKTOK_BUSINESS_MESSAGING_SCOPES.filter((scope) => stored.includes(scope));
  }

  return {
    status: TIKTOK_BUSINESS_MESSAGING_STATUS,
    available: false,
    polling_enabled: false,
    webhook_registered: false,
    reason:
      "TikTok Business Messaging requires its own permission application and a Data Security & Privacy review, separate from the Account Comment approval. Neither has been completed.",
    blocked_by: "tiktok_business_messaging_permission",
    // Surfaced so an unexpected messaging grant is visible instead of silently
    // ignored — but visibility is all it gets.
    messaging_scopes_present: grantedMessagingScopes,
  };
};
