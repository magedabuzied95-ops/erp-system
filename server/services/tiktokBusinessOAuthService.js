// TikTok API for Business — OAuth + token lifecycle for the organic
// "TikTok Accounts" surface.
//
// RELATIONSHIP TO tiktokOAuthService.js
// -------------------------------------
// That module owns the Login Kit / Content Posting connection and is live in
// production. This one is its Business-API counterpart. They share a shape
// (one connection per tenant, encrypted tokens, single-flight refresh under a
// DB lock) because the same hazards apply, but they share no state: different
// tables, different env vars, different encryption namespace (tk:v1 vs tkb:v1).
// Nothing here reads TIKTOK_CLIENT_KEY/SECRET or the tiktok_integration_configs
// table, and a test asserts that.
//
// THE LIFECYCLE HAZARDS, RESTATED FOR THIS SURFACE
// ------------------------------------------------
//   * access_token lives 24h  -> refresh-before-use, never a nightly cron.
//   * refresh_token ROTATES on every refresh -> dropping the rotated value kills
//     the connection at the next refresh. It is persisted in the same statement
//     that clears the lock, so a crash between the two cannot lose it.
//   * refresh_token expires after 365 days and cannot be renewed -> the
//     reconnect_required state is reachable in normal operation.
//   * auth_code lives 10 minutes and is single-use -> the callback must be
//     idempotent about a replayed state token rather than retrying the exchange.

import crypto from "node:crypto";

import db from "../database/db.js";
import {
  TikTokBusinessApiError,
  buildTikTokBusinessAuthorizeUrl,
  describeTikTokBusinessFailure,
  exchangeTikTokBusinessAuthCode,
  fetchTikTokBusinessAccount,
  fetchTikTokBusinessTokenInfo,
  isTikTokBusinessReauthError,
  redactTikTokBusinessError,
  refreshTikTokBusinessAccessToken,
  revokeTikTokBusinessAccessToken,
} from "./tiktokBusinessApiClient.js";
import {
  assertTikTokBusinessReady,
  tiktokBusinessAppId,
  tiktokBusinessAppSecret,
  tiktokBusinessAuthorizeUrl,
  tiktokBusinessRedirectUri,
} from "./tiktokBusinessConfigService.js";
import {
  decryptTikTokBusinessSecret,
  encryptTikTokBusinessSecret,
  tryDecryptTikTokBusinessSecret,
} from "./tiktokBusinessCryptoService.js";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// auth_code is valid for 10 minutes, so the state row must outlive it slightly
// but not much — a stale state token is a replay surface.
const OAUTH_STATE_TTL_MS = 12 * 60 * 1000;
// Refresh this far ahead of expiry so an in-flight comment sync never races the
// 24h boundary halfway through a paginated pull.
const REFRESH_SKEW_MS = 15 * 60 * 1000;
// If a refresh lock is older than this the holder is assumed dead.
const REFRESH_LOCK_TTL_MS = 2 * 60 * 1000;

export const TIKTOK_BUSINESS_CONNECTION_STATUS = Object.freeze({
  NOT_CONNECTED: "not_connected",
  CONNECTED: "connected",
  RECONNECT_REQUIRED: "reconnect_required",
  ERROR: "error",
});

export class TikTokBusinessOAuthError extends Error {
  constructor(message, code = "TIKTOK_BUSINESS_OAUTH_ERROR", status = 500) {
    super(message);
    this.name = "TikTokBusinessOAuthError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

// The migration file 2026-08-15-add-tiktok-business-integration.sql was written
// but deliberately never wired to a bootstrap, so these tables have never
// existed in production. This is that wiring. It is idempotent (every statement
// is IF NOT EXISTS) and it creates nothing that overlaps an existing table, so
// running it on a database that already has the Meta/TikTok-publishing schema is
// a no-op for those.
export const ensureTikTokBusinessSchema = async (client = db) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_business_connections (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      business_id TEXT NOT NULL DEFAULT '',
      advertiser_id TEXT NOT NULL DEFAULT '',
      tiktok_account_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      access_token_encrypted TEXT NOT NULL DEFAULT '',
      refresh_token_encrypted TEXT NOT NULL DEFAULT '',
      access_token_expires_at TIMESTAMPTZ NULL,
      refresh_token_expires_at TIMESTAMPTZ NULL,
      granted_scopes TEXT NOT NULL DEFAULT '',
      capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'not_connected',
      last_error TEXT NOT NULL DEFAULT '',
      last_sync_at TIMESTAMPTZ NULL,
      last_refresh_at TIMESTAMPTZ NULL,
      refresh_lock_token TEXT NOT NULL DEFAULT '',
      refresh_lock_at TIMESTAMPTZ NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      connected_by_user_id BIGINT NULL,
      connected_at TIMESTAMPTZ NULL,
      disconnected_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id)
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_tiktok_business_connections_business_id
     ON tiktok_business_connections (business_id) WHERE business_id <> ''`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_business_oauth_states (
      id BIGSERIAL PRIMARY KEY,
      state_token TEXT NOT NULL,
      tenant_id BIGINT NOT NULL,
      user_id BIGINT NULL,
      redirect_kind TEXT NOT NULL DEFAULT 'tt_user',
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (state_token)
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_tiktok_business_oauth_states_expiry
     ON tiktok_business_oauth_states (expires_at)`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_business_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL,
      tenant_id BIGINT NULL,
      business_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMPTZ NULL,
      UNIQUE (event_key)
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_tiktok_business_webhook_events_pending
     ON tiktok_business_webhook_events (status, received_at) WHERE status = 'pending'`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_business_comment_map (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      business_id TEXT NOT NULL DEFAULT '',
      tiktok_video_id TEXT NOT NULL,
      tiktok_comment_id TEXT NOT NULL,
      tiktok_parent_comment_id TEXT NOT NULL DEFAULT '',
      tiktok_author_id TEXT NOT NULL DEFAULT '',
      conversation_id BIGINT NULL,
      message_id BIGINT NULL,
      is_hidden BOOLEAN NULL,
      is_pinned BOOLEAN NULL,
      is_liked_by_owner BOOLEAN NULL,
      like_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      is_own_reply BOOLEAN NOT NULL DEFAULT FALSE,
      idempotency_key TEXT NOT NULL,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      comment_created_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, idempotency_key)
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_tiktok_business_comment_map_video
     ON tiktok_business_comment_map (tenant_id, tiktok_video_id)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_tiktok_business_comment_map_parent
     ON tiktok_business_comment_map (tenant_id, tiktok_parent_comment_id)
     WHERE tiktok_parent_comment_id <> ''`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_business_sync_cursors (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      resource TEXT NOT NULL,
      resource_key TEXT NOT NULL DEFAULT '',
      cursor TEXT NOT NULL DEFAULT '',
      has_more BOOLEAN NOT NULL DEFAULT FALSE,
      last_synced_at TIMESTAMPTZ NULL,
      last_error TEXT NOT NULL DEFAULT '',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, resource, resource_key)
    )
  `);

  // Reply idempotency. A duplicate submit from a double-click, a retry, or two
  // operators on the same comment must not post the reply twice — and TikTok
  // has no idempotency key of its own, so we own that guarantee here.
  await client.query(`
    CREATE TABLE IF NOT EXISTS tiktok_business_reply_log (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      business_id TEXT NOT NULL DEFAULT '',
      tiktok_video_id TEXT NOT NULL,
      tiktok_comment_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_reply_id TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_by_user_id BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, request_key)
    )
  `);

  return true;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const getTikTokBusinessConnectionRow = async ({ tenantId, client = db } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) return null;
  const { rows } = await client.query(
    `SELECT * FROM tiktok_business_connections WHERE tenant_id = $1::bigint LIMIT 1`,
    [safeTenantId]
  );
  return rows[0] || null;
};

export const getTikTokBusinessConnectionByBusinessId = async ({ businessId, client = db } = {}) => {
  const key = text(businessId);
  if (!key) return null;
  const { rows } = await client.query(
    `SELECT * FROM tiktok_business_connections WHERE business_id = $1::text AND business_id <> '' LIMIT 1`,
    [key]
  );
  return rows[0] || null;
};

export const parseGrantedScopes = (value = "") =>
  text(value)
    .split(/[,\s]+/)
    .map((item) => text(item))
    .filter(Boolean);

// ---------------------------------------------------------------------------
// Authorization start
// ---------------------------------------------------------------------------

export const createTikTokBusinessOAuthState = async ({ tenantId, userId = null, forceConsent = true, client = db } = {}) => {
  assertTikTokBusinessReady("tiktok_business_oauth");

  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) throw new TikTokBusinessOAuthError("Tenant is required", "TIKTOK_BUSINESS_TENANT_REQUIRED", 400);

  const stateToken = crypto.randomBytes(32).toString("hex");
  await client.query(
    `INSERT INTO tiktok_business_oauth_states (state_token, tenant_id, user_id, redirect_kind, expires_at)
     VALUES ($1::text, $2::bigint, $3::bigint, 'tt_user', NOW() + ($4::bigint || ' milliseconds')::interval)`,
    [stateToken, safeTenantId, numberOrNull(userId), OAUTH_STATE_TTL_MS]
  );

  return {
    state: stateToken,
    expires_in_ms: OAUTH_STATE_TTL_MS,
    // forceConsent defaults on: without it a previously-authorized user is
    // bounced straight back with their OLD grant, which silently re-establishes
    // a connection missing any newly-added scope.
    authorize_url: buildTikTokBusinessAuthorizeUrl({
      authorizeUrl: tiktokBusinessAuthorizeUrl(),
      state: stateToken,
      forceConsent,
    }),
  };
};

const consumeOAuthState = async ({ state, client = db } = {}) => {
  const token = text(state);
  if (!token) throw new TikTokBusinessOAuthError("Missing state", "TIKTOK_BUSINESS_STATE_MISSING", 400);

  // Single UPDATE ... RETURNING so two concurrent callbacks cannot both win.
  // A replayed state hits zero rows here rather than reaching the exchange.
  const { rows } = await client.query(
    `UPDATE tiktok_business_oauth_states
     SET status = 'consumed', consumed_at = NOW()
     WHERE state_token = $1::text
       AND status = 'pending'
       AND expires_at > NOW()
     RETURNING *`,
    [token]
  );
  if (!rows.length) {
    throw new TikTokBusinessOAuthError(
      "TikTok authorization state is invalid, already used, or expired",
      "TIKTOK_BUSINESS_STATE_INVALID",
      400
    );
  }
  return rows[0];
};

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

const expiresAtFrom = (seconds) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000);
};

const upsertConnection = async ({
  tenantId,
  userId,
  businessId,
  tokenPayload,
  scopes,
  profile = {},
  client = db,
}) => {
  const { rows } = await client.query(
    `INSERT INTO tiktok_business_connections (
       tenant_id, business_id, tiktok_account_id, display_name, username, avatar_url,
       access_token_encrypted, refresh_token_encrypted,
       access_token_expires_at, refresh_token_expires_at,
       granted_scopes, status, last_error, last_sync_at,
       connected_by_user_id, connected_at, disconnected_at, updated_at
     ) VALUES (
       $1::bigint, $2::text, $2::text, $3::text, $4::text, $5::text,
       $6::text, $7::text,
       $8::timestamp, $9::timestamp,
       $10::text, $11::text, '', NOW(),
       $12::bigint, NOW(), NULL, NOW()
     )
     ON CONFLICT (tenant_id) DO UPDATE SET
       business_id = EXCLUDED.business_id,
       tiktok_account_id = EXCLUDED.tiktok_account_id,
       display_name = EXCLUDED.display_name,
       username = EXCLUDED.username,
       avatar_url = EXCLUDED.avatar_url,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
       granted_scopes = EXCLUDED.granted_scopes,
       status = EXCLUDED.status,
       last_error = '',
       last_sync_at = NOW(),
       connected_by_user_id = EXCLUDED.connected_by_user_id,
       connected_at = NOW(),
       disconnected_at = NULL,
       -- A reconnect must clear any stale lock, otherwise the first refresh
       -- after reconnecting waits out the full lock TTL for a dead holder.
       refresh_lock_token = '',
       refresh_lock_at = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      numberOrNull(tenantId),
      text(businessId),
      text(profile?.display_name),
      text(profile?.username),
      text(profile?.profile_image),
      encryptTikTokBusinessSecret(text(tokenPayload?.access_token)),
      encryptTikTokBusinessSecret(text(tokenPayload?.refresh_token)),
      expiresAtFrom(tokenPayload?.expires_in),
      expiresAtFrom(tokenPayload?.refresh_token_expires_in),
      scopes.join(","),
      TIKTOK_BUSINESS_CONNECTION_STATUS.CONNECTED,
      numberOrNull(userId),
    ]
  );
  return rows[0];
};

export const handleTikTokBusinessOAuthCallback = async ({ code, state, error, errorDescription, client = db } = {}) => {
  assertTikTokBusinessReady("tiktok_business_oauth");

  // TikTok reported a failure on its side — record it against the state row so
  // the UI can explain the denial, and never attempt an exchange.
  if (text(error)) {
    const message = redactTikTokBusinessError(text(errorDescription) || text(error));
    await client.query(
      `UPDATE tiktok_business_oauth_states SET status = 'failed', error_message = $2::text, consumed_at = NOW()
       WHERE state_token = $1::text AND status = 'pending'`,
      [text(state), message]
    );
    throw new TikTokBusinessOAuthError(`TikTok authorization failed: ${message}`, "TIKTOK_BUSINESS_AUTH_DENIED", 400);
  }

  const stateRow = await consumeOAuthState({ state, client });
  const authCode = text(code);
  if (!authCode) {
    throw new TikTokBusinessOAuthError("TikTok did not return an authorization code", "TIKTOK_BUSINESS_CODE_MISSING", 400);
  }

  const tokenPayload = await exchangeTikTokBusinessAuthCode({
    appId: tiktokBusinessAppId(),
    appSecret: tiktokBusinessAppSecret(),
    authCode,
    redirectUri: tiktokBusinessRedirectUri(),
  });

  const accessToken = text(tokenPayload?.access_token);
  if (!accessToken) {
    throw new TikTokBusinessOAuthError("TikTok returned no access token", "TIKTOK_BUSINESS_TOKEN_MISSING", 502);
  }

  // token_info is authoritative for both the live scope list and the
  // business_id. open_id from the token response is documented as the same
  // value, but reading it back from token_info means we store what TikTok
  // currently reports rather than what it reported at grant time.
  let scopes = parseGrantedScopes(tokenPayload?.scope);
  let businessId = text(tokenPayload?.open_id);
  try {
    const info = await fetchTikTokBusinessTokenInfo({ appId: tiktokBusinessAppId(), accessToken });
    const inspected = parseGrantedScopes(info?.scope);
    if (inspected.length) scopes = inspected;
    if (text(info?.creator_id)) businessId = text(info.creator_id);
  } catch (inspectError) {
    // Non-fatal: the token itself is valid, and the connection is more useful
    // stored than discarded. Capability detection re-inspects on every read.
    console.warn("[tiktok-business] token_info inspection failed", describeTikTokBusinessFailure(inspectError));
  }

  if (!businessId) {
    throw new TikTokBusinessOAuthError(
      "TikTok returned no business/account identifier",
      "TIKTOK_BUSINESS_ID_MISSING",
      502
    );
  }

  // Best-effort profile enrichment. A missing profile must not fail the
  // connection — display name is cosmetic, the token is not.
  let profile = {};
  try {
    profile = await fetchTikTokBusinessAccount({ accessToken, businessId });
  } catch (profileError) {
    console.warn("[tiktok-business] profile fetch failed", describeTikTokBusinessFailure(profileError));
  }

  const row = await upsertConnection({
    tenantId: stateRow.tenant_id,
    userId: stateRow.user_id,
    businessId,
    tokenPayload,
    scopes,
    profile,
    client,
  });

  return { row, tenantId: Number(stateRow.tenant_id), scopes, businessId };
};

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export const tokenNeedsRefresh = (row, { now = Date.now(), skewMs = REFRESH_SKEW_MS } = {}) => {
  if (!row) return false;
  if (!text(row.access_token_encrypted)) return true;
  if (!row.access_token_expires_at) return true;
  return new Date(row.access_token_expires_at).getTime() - skewMs <= now;
};

export const refreshTokenExpired = (row, { now = Date.now() } = {}) => {
  if (!row?.refresh_token_expires_at) return false;
  return new Date(row.refresh_token_expires_at).getTime() <= now;
};

const markConnectionUnhealthy = async ({ tenantId, status, error, client = db }) => {
  await client.query(
    `UPDATE tiktok_business_connections
     SET status = $2::text, last_error = $3::text, refresh_lock_token = '', refresh_lock_at = NULL, updated_at = NOW()
     WHERE tenant_id = $1::bigint`,
    [numberOrNull(tenantId), text(status), redactTikTokBusinessError(error)]
  );
};

// Claims the refresh lock, or returns null if another worker holds a live one.
// The TTL clause is what stops a crashed holder from wedging the connection.
const acquireRefreshLock = async ({ tenantId, client = db }) => {
  const lockToken = crypto.randomBytes(16).toString("hex");
  const { rows } = await client.query(
    `UPDATE tiktok_business_connections
     SET refresh_lock_token = $2::text, refresh_lock_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1::bigint
       AND (refresh_lock_token = '' OR refresh_lock_at < NOW() - ($3::bigint || ' milliseconds')::interval)
     RETURNING *`,
    [numberOrNull(tenantId), lockToken, REFRESH_LOCK_TTL_MS]
  );
  return rows.length ? { row: rows[0], lockToken } : null;
};

const inFlightRefreshes = new Map();

const performRefresh = async ({ tenantId, client = db }) => {
  const lock = await acquireRefreshLock({ tenantId, client });
  if (!lock) {
    // Another worker holds it. Re-read rather than refresh: whoever holds the
    // lock will have rotated the refresh token, and refreshing with the value
    // we already read would invalidate theirs.
    return { row: await getTikTokBusinessConnectionRow({ tenantId, client }), refreshed: false, reason: "locked_by_other" };
  }

  const { row } = lock;
  const stored = tryDecryptTikTokBusinessSecret(row.refresh_token_encrypted, {
    tenant_id: tenantId,
    field: "refresh_token",
  });
  if (!stored.value) {
    await markConnectionUnhealthy({
      tenantId,
      status: TIKTOK_BUSINESS_CONNECTION_STATUS.RECONNECT_REQUIRED,
      error: "refresh_token_unavailable",
      client,
    });
    throw new TikTokBusinessOAuthError(
      "TikTok Business refresh token is unavailable; reconnect required",
      "TIKTOK_BUSINESS_RECONNECT_REQUIRED",
      409
    );
  }

  try {
    const payload = await refreshTikTokBusinessAccessToken({
      appId: tiktokBusinessAppId(),
      appSecret: tiktokBusinessAppSecret(),
      refreshToken: stored.value,
    });

    const accessToken = text(payload?.access_token);
    if (!accessToken) {
      throw new TikTokBusinessOAuthError("TikTok refresh returned no access token", "TIKTOK_BUSINESS_TOKEN_MISSING", 502);
    }

    // Rotation. TikTok issues a NEW refresh token on every refresh; falling back
    // to the previous one when absent is safe, dropping the new one is fatal.
    const rotatedRefreshToken = text(payload?.refresh_token) || stored.value;

    const updated = await client.query(
      `UPDATE tiktok_business_connections
       SET access_token_encrypted = $2::text,
           refresh_token_encrypted = $3::text,
           access_token_expires_at = $4::timestamp,
           refresh_token_expires_at = COALESCE($5::timestamp, refresh_token_expires_at),
           granted_scopes = COALESCE(NULLIF($6::text, ''), granted_scopes),
           status = $7::text,
           last_error = '',
           last_refresh_at = NOW(),
           refresh_lock_token = '',
           refresh_lock_at = NULL,
           updated_at = NOW()
       WHERE tenant_id = $1::bigint
         AND refresh_lock_token = $8::text
       RETURNING *`,
      [
        numberOrNull(tenantId),
        encryptTikTokBusinessSecret(accessToken),
        encryptTikTokBusinessSecret(rotatedRefreshToken),
        expiresAtFrom(payload?.expires_in),
        expiresAtFrom(payload?.refresh_token_expires_in),
        parseGrantedScopes(payload?.scope).join(","),
        TIKTOK_BUSINESS_CONNECTION_STATUS.CONNECTED,
        lock.lockToken,
      ]
    );

    if (!updated.rowCount) {
      // Our lock was stolen by the TTL path while the HTTP call was in flight.
      // The other holder's tokens are authoritative and ours are already
      // rotated out, so re-read instead of overwriting.
      return { row: await getTikTokBusinessConnectionRow({ tenantId, client }), refreshed: false, reason: "lock_lost" };
    }
    return { row: updated.rows[0], refreshed: true };
  } catch (error) {
    const reauth = isTikTokBusinessReauthError(error) || error?.code === "TIKTOK_BUSINESS_RECONNECT_REQUIRED";
    await markConnectionUnhealthy({
      tenantId,
      status: reauth ? TIKTOK_BUSINESS_CONNECTION_STATUS.RECONNECT_REQUIRED : TIKTOK_BUSINESS_CONNECTION_STATUS.ERROR,
      error,
      client,
    });
    throw error;
  }
};

export const refreshTikTokBusinessTokenIfNeeded = async ({ tenantId, force = false, client = db } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) throw new TikTokBusinessOAuthError("Tenant is required", "TIKTOK_BUSINESS_TENANT_REQUIRED", 400);

  const row = await getTikTokBusinessConnectionRow({ tenantId: safeTenantId, client });
  if (!row) {
    throw new TikTokBusinessOAuthError(
      "TikTok Business is not connected for this tenant",
      "TIKTOK_BUSINESS_NOT_CONNECTED",
      409
    );
  }
  if (!force && !tokenNeedsRefresh(row)) return { row, refreshed: false, reason: "still_valid" };

  if (refreshTokenExpired(row)) {
    await markConnectionUnhealthy({
      tenantId: safeTenantId,
      status: TIKTOK_BUSINESS_CONNECTION_STATUS.RECONNECT_REQUIRED,
      error: "refresh_token_expired",
      client,
    });
    throw new TikTokBusinessOAuthError(
      "TikTok Business refresh token has expired; reconnect required",
      "TIKTOK_BUSINESS_RECONNECT_REQUIRED",
      409
    );
  }

  // Process-local single flight on top of the DB lock: the DB lock protects
  // across workers, this collapses the stampede within one.
  const key = `tenant:${safeTenantId}`;
  if (inFlightRefreshes.has(key)) return inFlightRefreshes.get(key);
  const promise = performRefresh({ tenantId: safeTenantId, client }).finally(() => inFlightRefreshes.delete(key));
  inFlightRefreshes.set(key, promise);
  return promise;
};

// The single entry point every TikTok Business API caller must use. Returns a
// plaintext access token valid *now*, plus the business_id every Accounts API
// call needs. Never logs or re-persists the token.
export const getValidTikTokBusinessAccessToken = async ({ tenantId, client = db } = {}) => {
  const { row } = await refreshTikTokBusinessTokenIfNeeded({ tenantId, client });
  if (!row) {
    throw new TikTokBusinessOAuthError(
      "TikTok Business is not connected for this tenant",
      "TIKTOK_BUSINESS_NOT_CONNECTED",
      409
    );
  }
  if (row.status === TIKTOK_BUSINESS_CONNECTION_STATUS.RECONNECT_REQUIRED) {
    throw new TikTokBusinessOAuthError(
      "TikTok Business connection requires reconnect",
      "TIKTOK_BUSINESS_RECONNECT_REQUIRED",
      409
    );
  }
  const accessToken = decryptTikTokBusinessSecret(row.access_token_encrypted);
  if (!accessToken) {
    throw new TikTokBusinessOAuthError(
      "TikTok Business access token is unavailable",
      "TIKTOK_BUSINESS_TOKEN_MISSING",
      409
    );
  }
  return { accessToken, businessId: text(row.business_id), row };
};

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export const disconnectTikTokBusiness = async ({ tenantId, client = db } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const row = await getTikTokBusinessConnectionRow({ tenantId: safeTenantId, client });
  if (!row) return { disconnected: true, revoked: false, reason: "not_connected" };

  // Best-effort revoke at TikTok. A failure must not block local teardown —
  // leaving a row that claims "connected" after the user pressed Disconnect is
  // worse than an orphaned grant on TikTok's side.
  let revoked = false;
  const stored = tryDecryptTikTokBusinessSecret(row.access_token_encrypted, {
    tenant_id: safeTenantId,
    field: "access_token",
  });
  if (stored.value) {
    try {
      await revokeTikTokBusinessAccessToken({
        appId: tiktokBusinessAppId(),
        appSecret: tiktokBusinessAppSecret(),
        accessToken: stored.value,
      });
      revoked = true;
    } catch (error) {
      console.warn("[tiktok-business] revoke failed", describeTikTokBusinessFailure(error));
    }
  }

  await client.query(
    `UPDATE tiktok_business_connections
     SET access_token_encrypted = '', refresh_token_encrypted = '',
         access_token_expires_at = NULL, refresh_token_expires_at = NULL,
         status = $2::text, last_error = '', granted_scopes = '',
         capabilities = '{}'::jsonb,
         refresh_lock_token = '', refresh_lock_at = NULL,
         disconnected_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1::bigint`,
    [safeTenantId, TIKTOK_BUSINESS_CONNECTION_STATUS.NOT_CONNECTED]
  );

  return { disconnected: true, revoked };
};

// ---------------------------------------------------------------------------
// Description for API responses
// ---------------------------------------------------------------------------

// Safe to serialise to a client: identifiers, timestamps, scope names. Never
// tokens, never the app secret, never encrypted blobs.
export const describeTikTokBusinessAccount = (row) => {
  if (!row) return null;
  return {
    business_id: text(row.business_id),
    display_name: text(row.display_name),
    username: text(row.username),
    avatar_url: text(row.avatar_url),
    status: text(row.status) || TIKTOK_BUSINESS_CONNECTION_STATUS.NOT_CONNECTED,
    granted_scopes: parseGrantedScopes(row.granted_scopes),
    access_token_expires_at: row.access_token_expires_at || null,
    refresh_token_expires_at: row.refresh_token_expires_at || null,
    last_sync_at: row.last_sync_at || null,
    last_refresh_at: row.last_refresh_at || null,
    connected_at: row.connected_at || null,
    last_error: text(row.last_error),
  };
};

export const getTikTokBusinessConnectionStatus = async ({ tenantId, client = db } = {}) => {
  const row = await getTikTokBusinessConnectionRow({ tenantId, client });
  if (!row) {
    return { connected: false, status: TIKTOK_BUSINESS_CONNECTION_STATUS.NOT_CONNECTED, account: null, row: null };
  }
  const account = describeTikTokBusinessAccount(row);
  const connected =
    account.status === TIKTOK_BUSINESS_CONNECTION_STATUS.CONNECTED && Boolean(text(row.access_token_encrypted));
  return {
    connected,
    status: account.status,
    account,
    row,
    needs_refresh: tokenNeedsRefresh(row),
    reconnect_required:
      account.status === TIKTOK_BUSINESS_CONNECTION_STATUS.RECONNECT_REQUIRED || refreshTokenExpired(row),
  };
};

export { TikTokBusinessApiError };
