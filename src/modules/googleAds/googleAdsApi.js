import { api } from "../../shared/api/api";

// Endpoints of /api/google-ads. 400/403/409/429/502/503 are expected states (bad input,
// no permission, not connected, Google throttling, not configured) the pages show themselves.
const BASE = "/google-ads";
const quiet = { suppressErrorStatuses: [400, 403, 409, 429, 502, 503] };

export const googleAdsApi = {
  setup: () => api.get(`${BASE}/setup`, quiet),
  accounts: () => api.get(`${BASE}/accounts`, quiet),
  startOAuth: () => api.post(`${BASE}/oauth/start`, {}, quiet),
  disconnect: () => api.post(`${BASE}/disconnect`, {}, quiet),
  get: (account, path) => api.get(`${BASE}/accounts/${account}${path}`, quiet),
  post: (account, path, body) => api.post(`${BASE}/accounts/${account}${path}`, body, quiet),
};

export const errorMessage = (error) => error?.responseBody?.message || error?.message || "";

const ACCOUNT_KEY = "googleAds.selectedAccountId";
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

// Google reports state as ENABLED / PAUSED / REMOVED (plus a few rarer ones).
export const statusTone = (status) => {
  if (status === "ENABLED") return "success";
  if (status === "REMOVED") return "danger";
  if (status === "PAUSED") return "neutral";
  return "info";
};
