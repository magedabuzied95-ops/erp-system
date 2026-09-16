// HTTPS client for the Selling Partner API (EU endpoint; Amazon.eg).
// - access token from the LWA client, sent only in the x-amz-access-token header
// - per-operation token buckets + exponential backoff with jitter on 429 / 5xx / network
// - Retry-After honoured when Amazon sends it (it is not guaranteed)
// - one token refresh on 401
// - errors are AmazonApiError with a redacted, bounded message; bodies are never logged

import { gunzipSync } from "node:zlib";

import { amazonEndpoint, amazonUserAgent } from "./amazonConfig.js";
import { AMAZON_ERROR_CATEGORY, AmazonApiError, categoryForStatus, redactAmazonText } from "./amazonErrors.js";
import { createAmazonLwaClient } from "./amazonLwaClient.js";
import { createAmazonRateLimiter } from "./amazonRateLimiter.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = { rate_limited: 6, upstream: 4, network: 3 };
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 120_000;

const buildQuery = (query = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
};

const retryAfterMs = (response) => {
  const header = response?.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};

const firstAmazonError = (payload) => {
  const error = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  return error ? { code: String(error.code || ""), message: String(error.message || "") } : null;
};

export const createAmazonSpApiClient = ({
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  now = () => Date.now(),
  lwa = null,
  limiter = null,
  endpoint = amazonEndpoint,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const lwaClient = lwa || createAmazonLwaClient({ fetchImpl, now });
  const rateLimiter = limiter || createAmazonRateLimiter({ now, sleep });
  const stats = { lastSuccessAt: null, lastErrorAt: null, lastError: null, lastOperation: null };

  const backoff = (attempt, hintMs) => {
    const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
    const jittered = exponential / 2 + random() * (exponential / 2);
    return Math.min(MAX_BACKOFF_MS, Math.max(hintMs ?? 0, jittered));
  };

  const fetchWithTimeout = async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const request = async ({ operation, method = "GET", path, query = {}, body = undefined }) => {
    let attempt = 0;
    let refreshedAfter401 = false;
    while (true) {
      attempt += 1;
      try {
        await rateLimiter.acquire(operation);
      } catch (limitError) {
        throw new AmazonApiError(limitError.message, { category: AMAZON_ERROR_CATEGORY.RATE_LIMITED, operation, retryable: true });
      }
      const accessToken = await lwaClient.getAccessToken();
      let response;
      try {
        response = await fetchWithTimeout(`${endpoint()}${path}${buildQuery(query)}`, {
          method,
          headers: {
            "x-amz-access-token": accessToken,
            "x-amz-date": new Date(now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""),
            "user-agent": amazonUserAgent(),
            accept: "application/json",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (networkError) {
        const timedOut = networkError?.name === "AbortError";
        if (attempt < MAX_ATTEMPTS.network) {
          await sleep(backoff(attempt));
          continue;
        }
        const error = new AmazonApiError(timedOut ? `${operation} timed out` : `${operation} network error: ${networkError?.message || networkError}`, {
          category: AMAZON_ERROR_CATEGORY.NETWORK,
          operation,
          retryable: true,
        });
        stats.lastErrorAt = new Date(now()).toISOString();
        stats.lastError = error.toSafeJSON();
        throw error;
      }

      const requestId = response.headers?.get?.("x-amzn-requestid") || response.headers?.get?.("x-amzn-request-id") || "";
      let payload = null;
      const raw = await response.text().catch(() => "");
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
      }

      if (response.ok) {
        stats.lastSuccessAt = new Date(now()).toISOString();
        stats.lastOperation = operation;
        return payload ?? {};
      }

      const status = response.status;
      if (status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        lwaClient.invalidate();
        continue;
      }
      if (status === 429) {
        rateLimiter.drain(operation);
        if (attempt < MAX_ATTEMPTS.rate_limited) {
          await sleep(backoff(attempt, retryAfterMs(response)));
          continue;
        }
      } else if (status >= 500 && attempt < MAX_ATTEMPTS.upstream) {
        await sleep(backoff(attempt, retryAfterMs(response)));
        continue;
      }

      const amazonError = firstAmazonError(payload);
      const error = new AmazonApiError(
        amazonError ? `${operation} failed: ${amazonError.code} ${amazonError.message}` : `${operation} failed with HTTP ${status}`,
        {
          category: categoryForStatus(status),
          status,
          code: amazonError?.code || `HTTP_${status}`,
          operation,
          retryable: status === 429 || status >= 500,
          requestId,
        }
      );
      stats.lastErrorAt = new Date(now()).toISOString();
      stats.lastError = error.toSafeJSON();
      throw error;
    }
  };

  // Report documents are served from a pre-signed S3 URL: no Amazon auth header may be sent,
  // and the URL itself is a credential, so it is never logged or stored.
  const downloadReportDocument = async ({ url, compressionAlgorithm }) => {
    if (!/^https:\/\//i.test(String(url || ""))) {
      throw new AmazonApiError("report document URL is not HTTPS", { category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST, operation: "downloadReportDocument" });
    }
    let response;
    try {
      response = await fetchWithTimeout(url, { method: "GET", headers: { "user-agent": amazonUserAgent() } });
    } catch (networkError) {
      throw new AmazonApiError(`report download failed: ${redactAmazonText(networkError?.message || networkError)}`, {
        category: AMAZON_ERROR_CATEGORY.NETWORK,
        operation: "downloadReportDocument",
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new AmazonApiError(`report download failed with HTTP ${response.status}`, {
        category: categoryForStatus(response.status),
        status: response.status,
        operation: "downloadReportDocument",
      });
    }
    let buffer = Buffer.from(await response.arrayBuffer());
    if (String(compressionAlgorithm || "").toUpperCase() === "GZIP") buffer = gunzipSync(buffer);
    const contentType = response.headers?.get?.("content-type") || "";
    const charset = (contentType.match(/charset=([^;]+)/i)?.[1] || "utf-8").trim().toLowerCase();
    try {
      return new TextDecoder(charset === "cp1252" ? "windows-1252" : charset).decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  };

  return {
    request,
    downloadReportDocument,
    lwa: lwaClient,
    limiter: rateLimiter,
    status: () => ({ ...stats, token: lwaClient.status() }),
  };
};

// One shared client for the process.
let sharedClient = null;
export const getAmazonSpApiClient = () => {
  if (!sharedClient) sharedClient = createAmazonSpApiClient();
  return sharedClient;
};
export const setAmazonSpApiClientForTests = (client) => {
  sharedClient = client;
};
