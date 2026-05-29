export const APP_NAME = "ERP System";

const trimTrailingSlash = (value = "") =>
  String(value || "").trim().replace(/\/+$/, "");

const browserOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "";

const LOCAL_API_ORIGIN = "http://localhost:8000";

const envValue = (key) =>
  trimTrailingSlash(import.meta.env[key]);

const normalizeApiBaseUrl = (value) => {
  const base = trimTrailingSlash(value);
  if (!base) return `${LOCAL_API_ORIGIN}/api`;
  const normalized = base.replace(/(?:\/api)+$/i, "/api");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const API_BASE_URL_ENV =
  envValue("VITE_API_BASE_URL");

const API_ORIGIN_ENV =
  envValue("VITE_API_URL");

export const API_BASE_URL = normalizeApiBaseUrl(API_BASE_URL_ENV || API_ORIGIN_ENV);

export const API_ORIGIN = (() => {
  try {
    return new URL(API_ORIGIN_ENV || API_BASE_URL, browserOrigin()).origin;
  } catch {
    return LOCAL_API_ORIGIN;
  }
})();

export const SOCKET_URL = API_ORIGIN_ENV || LOCAL_API_ORIGIN;
