import { readAdResponse } from '../../shared/lib/workspacePreload.js';
import { api } from "../../shared/api/api";

// Endpoints of /api/tiktok-ads. 403/404/409/503 are expected states (no permission, no
// account, disconnected, not configured) that the pages render as notices.
const BASE = "/tiktok-ads";
const quiet = { suppressErrorStatuses: [400, 403, 404, 409, 422, 429, 503] };

const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const tiktokAdsApi = {
  setup: () => readAdResponse(`${BASE}/setup`, quiet),
  bootstrap: () => readAdResponse(`${BASE}/bootstrap`, quiet),
  data: (params) => readAdResponse(`${BASE}/data${query(params)}`, quiet),
  startOAuth: () => api.post(`${BASE}/oauth/start`, {}, quiet),
  sync: (accountId, days = 30) => api.post(`${BASE}/accounts/${accountId}/sync`, { days }, quiet),
  disconnect: (accountId) => api.post(`${BASE}/accounts/${accountId}/disconnect`, {}, quiet),
};

export const errorMessage = (error) => error?.responseBody?.message || error?.message || "";
export const errorCode = (error) => String(error?.responseBody?.code || "");

const ACCOUNT_KEY = "tiktokAds.selectedAccountId";
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

// Money in the ad account's own currency (TikTok bills in it, not in the shop's).
export const formatMoney = (value, currency = "USD", language = "ar") => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  try {
    return new Intl.NumberFormat(language === "ar" ? "ar-EG" : "en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
};

export const formatNumber = (value, language = "ar", digits = 0) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat(language === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: digits }).format(Number(value));
};
