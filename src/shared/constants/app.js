export const APP_NAME = "ERP System";

const trimTrailingSlash = (value = "") =>
  String(value || "").trim().replace(/\/+$/, "");

const browserOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "";

const LOCAL_API_ORIGIN = "http://localhost:8000";
const PRODUCTION_API_ORIGIN = "https://api.m1store-egy.com";
const PRODUCTION_API_BASE_URL = `${PRODUCTION_API_ORIGIN}/api`;
const IS_PRODUCTION = Boolean(import.meta?.env?.PROD);
const USE_SAME_ORIGIN_API = String(import.meta?.env?.VITE_USE_SAME_ORIGIN_API || "").toLowerCase() === "true";

const defaultApiOrigin = () =>
  IS_PRODUCTION ? PRODUCTION_API_ORIGIN : LOCAL_API_ORIGIN;

const isLocalApiUrl = (value) => {
  const raw = trimTrailingSlash(value);
  if (!raw) return false;

  try {
    const url = new URL(raw, browserOrigin() || LOCAL_API_ORIGIN);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::|\/|$)/i.test(raw);
  }
};

const devEnvValue = (value) =>
  IS_PRODUCTION ? "" : trimTrailingSlash(value);

const isLocalBrowserHost = () => {
  if (typeof window === "undefined") return true;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return (
    ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
    hostname.endsWith(".127.0.0.1.nip.io")
  );
};

const normalizeApiBaseUrl = (value) => {
  const base = trimTrailingSlash(value);
  if (!base) return `${defaultApiOrigin()}/api`;
  const normalized = base.replace(/(?:\/api)+$/i, "/api");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const API_BASE_URL_ENV =
  devEnvValue(import.meta?.env?.VITE_API_BASE_URL);

const API_ORIGIN_ENV =
  devEnvValue(import.meta?.env?.VITE_API_URL);

const resolveApiBaseUrl = () => {
  if (USE_SAME_ORIGIN_API) return "/api";
  if (IS_PRODUCTION) {
    return PRODUCTION_API_BASE_URL;
  }

  // All local nip.io ERP previews run behind Vite's same-origin proxy.
  // Resolve this before reading env fallbacks, because the base .env may
  // intentionally point ordinary localhost development at port 8000.
  if (
    typeof window !== "undefined" &&
    String(window.location.hostname || "").toLowerCase().endsWith(".nip.io")
  ) {
    return "/api";
  }

  const envApiBaseUrl = API_BASE_URL_ENV || API_ORIGIN_ENV;
  if (envApiBaseUrl === "/api") {
    // Keep same-origin API paths for Vite preview hosts so the dev proxy can
    // handle CORS. Only plain localhost without a proxy needs port 8000.
    if (typeof window !== "undefined" && String(window.location.hostname || "").toLowerCase().endsWith(".nip.io")) {
      return "/api";
    }
    if (isLocalBrowserHost()) return `${LOCAL_API_ORIGIN}/api`;
  }
  return normalizeApiBaseUrl(envApiBaseUrl);
};

export const API_BASE_URL = resolveApiBaseUrl();

export const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL, browserOrigin()).origin;
  } catch {
    return defaultApiOrigin();
  }
})();

export const SOCKET_URL =
  IS_PRODUCTION || isLocalApiUrl(API_ORIGIN_ENV)
    ? API_ORIGIN
    : API_ORIGIN_ENV || API_ORIGIN;
