// Login with Amazon: exchanges the stored refresh token for a 1-hour access token.
// The access token is kept in memory only (never in the DB, logs or responses),
// refreshed 5 minutes before expiry, and concurrent callers share one refresh.

import { amazonLwaTokenUrl, readAmazonCredentials, amazonUserAgent } from "./amazonConfig.js";
import { AMAZON_ERROR_CATEGORY, AmazonApiError, redactAmazonText } from "./amazonErrors.js";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

export const createAmazonLwaClient = ({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  credentials = readAmazonCredentials,
  tokenUrl = amazonLwaTokenUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  let cached = null; // { token, expiresAt }
  let inFlight = null;
  let lastRefreshAt = null;

  const requestToken = async () => {
    const { refreshToken, clientId, clientSecret } = credentials();
    if (!refreshToken || !clientId || !clientSecret) {
      throw new AmazonApiError("Amazon SP-API credentials are not configured", { category: AMAZON_ERROR_CATEGORY.NOT_CONFIGURED, operation: "lwaToken" });
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(tokenUrl(), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": amazonUserAgent() },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      throw new AmazonApiError(timedOut ? "LWA token request timed out" : `LWA token request failed: ${error?.message || error}`, {
        category: AMAZON_ERROR_CATEGORY.NETWORK,
        operation: "lwaToken",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok || !payload?.access_token) {
      // LWA returns { error, error_description }; only the error code is kept.
      const code = redactAmazonText(payload?.error || `http_${response.status}`, 60);
      const authFailure = response.status === 400 || response.status === 401;
      throw new AmazonApiError(`LWA refused the token request (${code})`, {
        category: authFailure ? AMAZON_ERROR_CATEGORY.AUTHENTICATION : response.status >= 500 ? AMAZON_ERROR_CATEGORY.UPSTREAM : AMAZON_ERROR_CATEGORY.INTERNAL,
        status: response.status,
        code,
        operation: "lwaToken",
        retryable: response.status >= 500,
      });
    }
    const lifetimeSeconds = Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600;
    cached = { token: payload.access_token, expiresAt: now() + lifetimeSeconds * 1000 };
    lastRefreshAt = new Date(now()).toISOString();
    return cached.token;
  };

  return {
    async getAccessToken() {
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.token;
      if (!inFlight) {
        inFlight = requestToken().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    invalidate() {
      cached = null;
    },
    // Status without the token itself.
    status() {
      return {
        has_cached_token: Boolean(cached),
        token_expires_at: cached ? new Date(cached.expiresAt).toISOString() : null,
        last_refresh_at: lastRefreshAt,
      };
    },
  };
};
