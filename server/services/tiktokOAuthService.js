// TikTok OAuth v2 + token lifecycle.
//
// Connection model: one TikTok creator per tenant (UNIQUE (tenant_id)), matching
// how meta_integration_configs scopes a Page per tenant.
//
// The lifecycle is materially harsher than Meta's and the code is shaped by it:
//   * access_token lives 24h (Meta: ~60 days) -> refresh-before-use, not a
//     nightly cron.
//   * refresh_token ROTATES on every refresh -> if the new one is not persisted
//     the connection is dead at the next refresh. Persist happens in the same
//     statement that clears the lock.
//   * refresh_token itself expires after 365 days and cannot be renewed
//     -> reconnect_required is a real, reachable state, not a theoretical one.

import crypto from "node:crypto";

import db from "../database/db.js";
import {
  TikTokApiError,
  exchangeTikTokAuthorizationCode,
  fetchTikTokUserInfo,
  isTikTokReauthError,
  redactTikTokError,
  refreshTikTokAccessToken,
  revokeTikTokAccessToken,
  buildTikTokAuthorizeUrl,
} from "./tiktokApiClient.js";
import {
  assertTikTokConfig,
  tiktokClientKey,
  tiktokRedirectUri,
  tiktokRequestedScopes,
} from "./tiktokConfigService.js";
import { decryptTikTokSecret, encryptTikTokSecret, tryDecryptTikTokSecret } from "./tiktokCryptoService.js";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
// Refresh this far ahead of expiry so an in-flight publish never races the
// 24h boundary mid-upload.
const REFRESH_SKEW_MS = 15 * 60 * 1000;
const REFRESH_LOCK_TTL_MS = 2 * 60 * 1000;

export const TIKTOK_CONNECTION_STATUS = Object.freeze({
  NOT_CONNECTED: "not_connected",
  CONNECTED: "connected",
  RECONNECT_REQUIRED: "reconnect_required",
  ERROR: "error",
});

export class TikTokOAuthError extends Error {
  constructor(message, code = "TIKTOK_OAUTH_ERROR", status = 400) {
    super(message);
    this.name = "TikTokOAuthError";
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let schemaReadyPromise = null;

export const ensureTikTokIntegrationSchema = async (client = db) => {
  if (!schemaReadyPromise || client !== db) {
    const operation = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tiktok_integration_configs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          open_id TEXT NOT NULL DEFAULT '',
          union_id TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          username TEXT NOT NULL DEFAULT '',
          avatar_url TEXT NOT NULL DEFAULT '',
          access_token_encrypted TEXT NOT NULL DEFAULT '',
          refresh_token_encrypted TEXT NOT NULL DEFAULT '',
          access_token_expires_at TIMESTAMP NULL,
          refresh_token_expires_at TIMESTAMP NULL,
          granted_scopes TEXT NOT NULL DEFAULT '',
          capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'not_connected',
          last_error TEXT NOT NULL DEFAULT '',
          last_sync_at TIMESTAMP NULL,
          last_refresh_at TIMESTAMP NULL,
          refresh_lock_token TEXT NOT NULL DEFAULT '',
          refresh_lock_at TIMESTAMP NULL,
          connected_by_user_id BIGINT NULL,
          connected_at TIMESTAMP NULL,
          disconnected_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tiktok_configs_open_id ON tiktok_integration_configs (open_id) WHERE open_id <> ''`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          user_id BIGINT NULL,
          state_token TEXT NOT NULL UNIQUE,
          redirect_uri TEXT NOT NULL DEFAULT '',
          requested_scopes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'started',
          error_message TEXT NOT NULL DEFAULT '',
          expires_at TIMESTAMP NOT NULL,
          consumed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tiktok_oauth_states_tenant_created ON tiktok_oauth_states (tenant_id, created_at DESC)`);
      return true;
    })();
    if (client === db) schemaReadyPromise = operation.catch((error) => { schemaReadyPromise = null; throw error; });
    return operation;
  }
  return schemaReadyPromise;
};

// ---------------------------------------------------------------------------
// OAuth state (CSRF + replay protection)
// ---------------------------------------------------------------------------

export const createTikTokOAuthState = async ({ tenantId, userId = null, client = db } = {}) => {
  assertTikTokConfig();
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) throw new TikTokOAuthError("Tenant is required to start TikTok authorization", "TIKTOK_TENANT_REQUIRED", 400);
  await ensureTikTokIntegrationSchema(client);

  // 32 bytes of CSPRNG. The state is the only thing binding the callback to this
  // tenant/user, so it must be unguessable, not merely unique.
  const stateToken = crypto.randomBytes(32).toString("base64url");
  const scopes = tiktokRequestedScopes();
  const redirectUri = tiktokRedirectUri();

  await client.query(
    `INSERT INTO tiktok_oauth_states (tenant_id, user_id, state_token, redirect_uri, requested_scopes, expires_at)
     VALUES ($1::bigint, $2::bigint, $3::text, $4::text, $5::text, NOW() + ($6::int * INTERVAL '1 millisecond'))`,
    [safeTenantId, numberOrNull(userId), stateToken, redirectUri, scopes.join(","), OAUTH_STATE_TTL_MS]
  );

  return {
    state: stateToken,
    authorize_url: buildTikTokAuthorizeUrl({ clientKey: tiktokClientKey(), redirectUri, scopes, state: stateToken }),
    expires_in_ms: OAUTH_STATE_TTL_MS,
  };
};

// Single-use consumption. The UPDATE ... WHERE status = 'started' is the whole
// replay defence: a second callback with the same state matches zero rows.
const consumeTikTokOAuthState = async ({ state, client = db } = {}) => {
  const stateToken = text(state);
  if (!stateToken) throw new TikTokOAuthError("Missing OAuth state", "TIKTOK_STATE_MISSING", 400);
  const result = await client.query(
    `UPDATE tiktok_oauth_states
     SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
     WHERE state_token = $1::text
       AND status = 'started'
       AND expires_at > NOW()
     RETURNING *`,
    [stateToken]
  );
  const row = result.rows[0];
  if (!row) {
    // Deliberately one message for unknown/expired/replayed: distinguishing them
    // would tell an attacker whether a state token ever existed.
    throw new TikTokOAuthError("TikTok authorization state is invalid or has expired", "TIKTOK_STATE_INVALID", 400);
  }
  return row;
};

const markTikTokOAuthStateFailed = async ({ state, reason, client = db } = {}) => {
  await client.query(
    `UPDATE tiktok_oauth_states
     SET status = 'failed', error_message = $2::text, updated_at = NOW()
     WHERE state_token = $1::text`,
    [text(state), redactTikTokError(reason)]
  ).catch(() => {});
};

// ---------------------------------------------------------------------------
// Connection record
// ---------------------------------------------------------------------------

const expiresAtFrom = (seconds) => {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(Date.now() + parsed * 1000);
};

export const getTikTokConfigRow = async ({ tenantId, client = db } = {}) => {
  await ensureTikTokIntegrationSchema(client);
  const result = await client.query(
    `SELECT * FROM tiktok_integration_configs WHERE tenant_id = $1::bigint LIMIT 1`,
    [numberOrNull(tenantId)]
  );
  return result.rows[0] || null;
};

const persistTikTokConnection = async ({ tenantId, userId, tokenPayload, profile, grantedScopes, client = db } = {}) => {
  const accessToken = text(tokenPayload?.access_token);
  const refreshToken = text(tokenPayload?.refresh_token);
  if (!accessToken) throw new TikTokOAuthError("TikTok did not return an access token", "TIKTOK_TOKEN_MISSING", 502);

  const result = await client.query(
    `INSERT INTO tiktok_integration_configs (
       tenant_id, open_id, union_id, display_name, username, avatar_url,
       access_token_encrypted, refresh_token_encrypted,
       access_token_expires_at, refresh_token_expires_at,
       granted_scopes, status, last_error, last_sync_at, last_refresh_at,
       refresh_lock_token, refresh_lock_at, connected_by_user_id, connected_at, disconnected_at
     ) VALUES (
       $1::bigint, $2::text, $3::text, $4::text, $5::text, $6::text,
       $7::text, $8::text,
       $9::timestamp, $10::timestamp,
       $11::text, $12::text, '', NOW(), NOW(),
       '', NULL, $13::bigint, NOW(), NULL
     )
     ON CONFLICT (tenant_id) DO UPDATE SET
       open_id = EXCLUDED.open_id,
       union_id = EXCLUDED.union_id,
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
       last_refresh_at = NOW(),
       refresh_lock_token = '',
       refresh_lock_at = NULL,
       connected_by_user_id = EXCLUDED.connected_by_user_id,
       connected_at = NOW(),
       disconnected_at = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      numberOrNull(tenantId),
      text(profile?.open_id) || text(tokenPayload?.open_id),
      text(profile?.union_id),
      text(profile?.display_name),
      text(profile?.username),
      text(profile?.avatar_url),
      encryptTikTokSecret(accessToken),
      refreshToken ? encryptTikTokSecret(refreshToken) : "",
      expiresAtFrom(tokenPayload?.expires_in),
      expiresAtFrom(tokenPayload?.refresh_expires_in),
      text(grantedScopes),
      TIKTOK_CONNECTION_STATUS.CONNECTED,
      numberOrNull(userId),
    ]
  );
  return result.rows[0];
};

const markTikTokConnectionUnhealthy = async ({ tenantId, status, error, client = db } = {}) => {
  await client.query(
    `UPDATE tiktok_integration_configs
     SET status = $2::text, last_error = $3::text, refresh_lock_token = '', refresh_lock_at = NULL, updated_at = NOW()
     WHERE tenant_id = $1::bigint`,
    [numberOrNull(tenantId), text(status), redactTikTokError(error)]
  ).catch(() => {});
};

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

export const handleTikTokOAuthCallback = async ({ code, state, error, errorDescription, client = db } = {}) => {
  assertTikTokConfig();
  await ensureTikTokIntegrationSchema(client);

  // The user pressed "Cancel" on TikTok's consent screen. Consume the state so
  // it cannot be reused, and report a clean outcome rather than an exception.
  if (text(error)) {
    await markTikTokOAuthStateFailed({ state, reason: errorDescription || error, client });
    return {
      connected: false,
      denied: true,
      code: text(error),
      message: text(errorDescription) || "TikTok authorization was declined",
    };
  }

  const stateRow = await consumeTikTokOAuthState({ state, client });

  if (!text(code)) {
    await markTikTokOAuthStateFailed({ state, reason: "missing_code", client });
    throw new TikTokOAuthError("TikTok did not return an authorization code", "TIKTOK_CODE_MISSING", 400);
  }

  try {
    const tokenPayload = await exchangeTikTokAuthorizationCode({
      code,
      // Echo the redirect_uri recorded when the flow started: TikTok requires it
      // to be byte-identical to the one used for the authorize request, and the
      // env value could have been changed mid-flight.
      redirectUri: text(stateRow.redirect_uri) || tiktokRedirectUri(),
    });

    const accessToken = text(tokenPayload?.access_token);
    // Profile is best-effort: a connection with no display name is still a
    // working connection, and failing here would strand a valid token.
    const profile = await fetchTikTokUserInfo({ accessToken }).catch(() => ({}));

    const row = await persistTikTokConnection({
      tenantId: stateRow.tenant_id,
      userId: stateRow.user_id,
      tokenPayload,
      profile: { ...profile, open_id: profile?.open_id || tokenPayload?.open_id },
      grantedScopes: text(tokenPayload?.scope) || text(stateRow.requested_scopes),
      client,
    });

    return { connected: true, denied: false, tenant_id: stateRow.tenant_id, account: describeTikTokAccount(row) };
  } catch (error) {
    await markTikTokOAuthStateFailed({ state, reason: error, client });
    await markTikTokConnectionUnhealthy({
      tenantId: stateRow.tenant_id,
      status: TIKTOK_CONNECTION_STATUS.ERROR,
      error,
      client,
    });
    throw error instanceof TikTokApiError || error instanceof TikTokOAuthError
      ? error
      : new TikTokOAuthError(redactTikTokError(error), "TIKTOK_CALLBACK_FAILED", 502);
  }
};

// ---------------------------------------------------------------------------
// Token refresh (rotating, single-flight)
// ---------------------------------------------------------------------------

// Collapses concurrent refreshes inside one process. The DB lock below handles
// the multi-process case; this avoids N pointless round-trips in the common one.
const inFlightRefreshes = new Map();

const acquireRefreshLock = async ({ tenantId, client = db } = {}) => {
  const lockToken = crypto.randomBytes(16).toString("hex");
  const result = await client.query(
    `UPDATE tiktok_integration_configs
     SET refresh_lock_token = $2::text, refresh_lock_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1::bigint
       AND (refresh_lock_at IS NULL OR refresh_lock_at < NOW() - ($3::int * INTERVAL '1 millisecond'))
     RETURNING *`,
    [numberOrNull(tenantId), lockToken, REFRESH_LOCK_TTL_MS]
  );
  return result.rowCount ? { lockToken, row: result.rows[0] } : null;
};

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

const performTikTokRefresh = async ({ tenantId, client = db } = {}) => {
  const lock = await acquireRefreshLock({ tenantId, client });
  if (!lock) {
    // Another worker holds the lock. Re-read rather than refresh: whoever holds
    // it will have rotated the refresh token, and refreshing with the token we
    // already read would invalidate theirs.
    const row = await getTikTokConfigRow({ tenantId, client });
    return { row, refreshed: false, reason: "locked_by_other" };
  }

  const { row } = lock;
  const stored = tryDecryptTikTokSecret(row.refresh_token_encrypted, { tenant_id: tenantId, field: "refresh_token" });
  if (!stored.value) {
    await markTikTokConnectionUnhealthy({
      tenantId,
      status: TIKTOK_CONNECTION_STATUS.RECONNECT_REQUIRED,
      error: "refresh_token_unavailable",
      client,
    });
    throw new TikTokOAuthError("TikTok refresh token is unavailable; reconnect required", "TIKTOK_RECONNECT_REQUIRED", 409);
  }

  try {
    const payload = await refreshTikTokAccessToken({ refreshToken: stored.value });
    const accessToken = text(payload?.access_token);
    if (!accessToken) throw new TikTokOAuthError("TikTok refresh returned no access token", "TIKTOK_TOKEN_MISSING", 502);

    // Rotation: TikTok issues a NEW refresh token on every refresh. Falling back
    // to the previous one when absent is safe; dropping the new one is fatal.
    const rotatedRefreshToken = text(payload?.refresh_token) || stored.value;

    const updated = await client.query(
      `UPDATE tiktok_integration_configs
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
        encryptTikTokSecret(accessToken),
        encryptTikTokSecret(rotatedRefreshToken),
        expiresAtFrom(payload?.expires_in),
        expiresAtFrom(payload?.refresh_expires_in),
        text(payload?.scope),
        TIKTOK_CONNECTION_STATUS.CONNECTED,
        lock.lockToken,
      ]
    );

    if (!updated.rowCount) {
      // Our lock was stolen by the TTL path while the HTTP call was in flight.
      // The other holder's tokens are authoritative; ours are already rotated
      // out. Re-read instead of overwriting.
      return { row: await getTikTokConfigRow({ tenantId, client }), refreshed: false, reason: "lock_lost" };
    }
    return { row: updated.rows[0], refreshed: true };
  } catch (error) {
    const reauth = isTikTokReauthError(error);
    await markTikTokConnectionUnhealthy({
      tenantId,
      status: reauth ? TIKTOK_CONNECTION_STATUS.RECONNECT_REQUIRED : TIKTOK_CONNECTION_STATUS.ERROR,
      error,
      client,
    });
    throw error;
  }
};

export const refreshTikTokTokenIfNeeded = async ({ tenantId, force = false, client = db } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  if (!safeTenantId) throw new TikTokOAuthError("Tenant is required", "TIKTOK_TENANT_REQUIRED", 400);

  const row = await getTikTokConfigRow({ tenantId: safeTenantId, client });
  if (!row) throw new TikTokOAuthError("TikTok is not connected for this tenant", "TIKTOK_NOT_CONNECTED", 409);
  if (!force && !tokenNeedsRefresh(row)) return { row, refreshed: false, reason: "still_valid" };

  if (refreshTokenExpired(row)) {
    await markTikTokConnectionUnhealthy({
      tenantId: safeTenantId,
      status: TIKTOK_CONNECTION_STATUS.RECONNECT_REQUIRED,
      error: "refresh_token_expired",
      client,
    });
    throw new TikTokOAuthError("TikTok refresh token has expired; reconnect required", "TIKTOK_RECONNECT_REQUIRED", 409);
  }

  const key = `tenant:${safeTenantId}`;
  if (inFlightRefreshes.has(key)) return inFlightRefreshes.get(key);
  const promise = performTikTokRefresh({ tenantId: safeTenantId, client }).finally(() => inFlightRefreshes.delete(key));
  inFlightRefreshes.set(key, promise);
  return promise;
};

// The single entry point every TikTok API caller must use. Returns a plaintext
// access token that is valid *now*; never persists or logs it.
export const getValidTikTokAccessToken = async ({ tenantId, client = db } = {}) => {
  const { row } = await refreshTikTokTokenIfNeeded({ tenantId, client });
  if (!row) throw new TikTokOAuthError("TikTok is not connected for this tenant", "TIKTOK_NOT_CONNECTED", 409);
  if (row.status === TIKTOK_CONNECTION_STATUS.RECONNECT_REQUIRED) {
    throw new TikTokOAuthError("TikTok connection requires reconnect", "TIKTOK_RECONNECT_REQUIRED", 409);
  }
  const accessToken = decryptTikTokSecret(row.access_token_encrypted);
  if (!accessToken) throw new TikTokOAuthError("TikTok access token is unavailable", "TIKTOK_TOKEN_MISSING", 409);
  return { accessToken, row };
};

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export const disconnectTikTok = async ({ tenantId, client = db } = {}) => {
  const safeTenantId = numberOrNull(tenantId);
  const row = await getTikTokConfigRow({ tenantId: safeTenantId, client });
  if (!row) return { disconnected: true, revoked: false, reason: "not_connected" };

  // Best-effort revoke at TikTok. A failure here must not block local teardown,
  // otherwise a revoked-at-TikTok account stays "connected" in the ERP forever.
  let revoked = false;
  const stored = tryDecryptTikTokSecret(row.access_token_encrypted, { tenant_id: safeTenantId, field: "access_token" });
  if (stored.value) {
    try {
      await revokeTikTokAccessToken({ accessToken: stored.value });
      revoked = true;
    } catch (error) {
      console.warn("[tiktok] revoke_failed", { tenant_id: safeTenantId, message: redactTikTokError(error) });
    }
  }

  await client.query(
    `UPDATE tiktok_integration_configs
     SET access_token_encrypted = '', refresh_token_encrypted = '',
         access_token_expires_at = NULL, refresh_token_expires_at = NULL,
         status = $2::text, last_error = '', granted_scopes = '',
         refresh_lock_token = '', refresh_lock_at = NULL,
         disconnected_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1::bigint`,
    [safeTenantId, TIKTOK_CONNECTION_STATUS.NOT_CONNECTED]
  );
  return { disconnected: true, revoked };
};

// Called by the authorization.removed webhook: the user revoked us from inside
// the TikTok app, so there is nothing to revoke remotely — only local state.
export const markTikTokAuthorizationRemoved = async ({ openId, reason = "", client = db } = {}) => {
  const result = await client.query(
    `UPDATE tiktok_integration_configs
     SET access_token_encrypted = '', refresh_token_encrypted = '',
         access_token_expires_at = NULL, refresh_token_expires_at = NULL,
         status = $2::text, last_error = $3::text,
         refresh_lock_token = '', refresh_lock_at = NULL,
         disconnected_at = NOW(), updated_at = NOW()
     WHERE open_id = $1::text AND open_id <> ''
     RETURNING tenant_id`,
    [text(openId), TIKTOK_CONNECTION_STATUS.RECONNECT_REQUIRED, `authorization_removed:${text(reason)}`.slice(0, 200)]
  );
  return { updated: result.rowCount, tenant_ids: result.rows.map((row) => row.tenant_id) };
};

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

// The ONLY shape allowed to cross into an API response. No token column, in any
// form, encrypted or not, appears here.
export const describeTikTokAccount = (row) => {
  if (!row) return null;
  const scopes = text(row.granted_scopes).split(",").map((item) => text(item)).filter(Boolean);
  return {
    open_id: text(row.open_id),
    display_name: text(row.display_name),
    username: text(row.username),
    avatar_url: text(row.avatar_url),
    status: text(row.status) || TIKTOK_CONNECTION_STATUS.NOT_CONNECTED,
    granted_scopes: scopes,
    capabilities: {
      direct_post: scopes.includes("video.publish"),
      draft_upload: scopes.includes("video.upload"),
      profile: scopes.includes("user.info.basic"),
      // Comments are not obtainable through this app type at all — see
      // tiktokCommentsProvider.js. Surfaced so the UI never implies otherwise.
      comments: false,
    },
    access_token_expires_at: row.access_token_expires_at || null,
    refresh_token_expires_at: row.refresh_token_expires_at || null,
    last_sync_at: row.last_sync_at || null,
    last_refresh_at: row.last_refresh_at || null,
    connected_at: row.connected_at || null,
    last_error: text(row.last_error),
  };
};

export const getTikTokConnectionStatus = async ({ tenantId, client = db } = {}) => {
  const row = await getTikTokConfigRow({ tenantId, client });
  if (!row) return { connected: false, status: TIKTOK_CONNECTION_STATUS.NOT_CONNECTED, account: null };
  const account = describeTikTokAccount(row);
  const connected = account.status === TIKTOK_CONNECTION_STATUS.CONNECTED && Boolean(text(row.access_token_encrypted));
  return {
    connected,
    status: account.status,
    account,
    needs_refresh: tokenNeedsRefresh(row),
    reconnect_required: account.status === TIKTOK_CONNECTION_STATUS.RECONNECT_REQUIRED || refreshTokenExpired(row),
  };
};
