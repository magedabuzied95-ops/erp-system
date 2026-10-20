import { api } from "../../../shared/api/api";

// Shared helpers for every Meta Ads screen. Each sub-area (manager/, records/,
// connect/) builds its own endpoint wrappers on top of `metaAdsRequest`.

export const META_ADS_BASE = "/meta-ads";

export const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

// 403/404/409/503 are expected states (no permission, no account, not connected,
// schema not ready) that pages render as notices, so they are not console errors.
export const quiet = { suppressErrorStatuses: [400, 403, 404, 409, 422, 503] };

export const metaAdsRequest = {
  get: (path, params) => api.get(`${META_ADS_BASE}${path}${query(params)}`, quiet),
  post: (path, body = {}) => api.post(`${META_ADS_BASE}${path}`, body, quiet),
  put: (path, body = {}) => api.put(`${META_ADS_BASE}${path}`, body, quiet),
  patch: (path, body = {}) => api.patch(`${META_ADS_BASE}${path}`, body, quiet),
  delete: (path) => api.delete(`${META_ADS_BASE}${path}`, quiet),
};

export const isNotConnectedError = (error) => String(error?.responseBody?.code || "") === "META_ADS_NOT_CONNECTED";
export const isNoAccountError = (error) => String(error?.responseBody?.code || "") === "META_ADS_NO_ACCOUNT";
export const isNotReadyError = (error) => error?.status === 503;
export const isForbiddenError = (error) => error?.status === 403;

// The message Meta itself returned (error_user_msg), when the failure came from Graph.
export const metaErrorMessage = (error) => {
  const meta = error?.responseBody?.meta;
  if (meta?.message) return meta.title ? `${meta.title}: ${meta.message}` : meta.message;
  return error?.responseBody?.message || error?.message || "";
};

const ACCOUNT_KEY = "metaAds.selectedAccountId";

export const readSelectedAccountId = () => {
  try {
    return window.localStorage.getItem(ACCOUNT_KEY) || "";
  } catch {
    return "";
  }
};

export const writeSelectedAccountId = (id) => {
  try {
    window.localStorage.setItem(ACCOUNT_KEY, String(id || ""));
  } catch {
    // Private mode: the selection just won't survive a reload.
  }
};
