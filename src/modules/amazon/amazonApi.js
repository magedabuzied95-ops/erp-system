import { api } from "../../shared/api/api";

const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

// Amazon endpoints answer 403 MFA_REQUIRED_FOR_AMAZON when the signed-in account has no
// authenticator app; pages show a dedicated notice for it instead of a generic error.
const quiet = { suppressErrorStatuses: [403, 409, 503] };

export const amazonApi = {
  status: () => api.get("/amazon/status", quiet),
  dashboard: () => api.get("/amazon/dashboard", quiet),
  orders: (params) => api.get(`/amazon/orders${query(params)}`, quiet),
  listings: (params) => api.get(`/amazon/listings${query(params)}`, quiet),
  inventory: (params) => api.get(`/amazon/inventory${query(params)}`, quiet),
  pricing: (params) => api.get(`/amazon/pricing${query(params)}`, quiet),
  products: (params) => api.get(`/amazon/products${query(params)}`, quiet),
  skuMappings: (params) => api.get(`/amazon/sku-mappings${query(params)}`, quiet),
  syncRuns: (params) => api.get(`/amazon/sync-runs${query(params)}`, quiet),
  searchVariants: (q) => api.get(`/amazon/m1-variants${query({ q })}`, quiet),
  testConnection: () => api.post("/amazon/connection/test", {}, quiet),
  startSync: (job) => api.post(`/amazon/sync/${job}`, {}, quiet),
  saveSellerId: (sellerId) => api.put("/amazon/settings/seller-id", { seller_id: sellerId }, quiet),
  refreshSuggestions: () => api.post("/amazon/sku-mappings/refresh-suggestions", {}, quiet),
  acceptExactSuggestions: () => api.post("/amazon/sku-mappings/accept-exact", {}, quiet),
  mapSku: (id, variantId) => api.put(`/amazon/sku-mappings/${id}`, { variant_id: variantId }, quiet),
  unmapSku: (id) => api.delete(`/amazon/sku-mappings/${id}`, quiet),
  projectPending: () => api.post("/amazon/orders/project-pending", {}, quiet),
};

export const isMfaRequiredError = (error) =>
  error?.status === 403 && String(error?.responseBody?.code || "") === "MFA_REQUIRED_FOR_AMAZON";
export const isForbiddenError = (error) => error?.status === 403;

export const formatMoney = (value, currency = "EGP", locale = "en-EG") => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency || "EGP"}`;
};

export const formatDateTime = (value, locale = "en-EG") => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
};

export const ORDER_STATUS_TONES = {
  PENDING: "warning",
  PENDING_AVAILABILITY: "warning",
  UNSHIPPED: "info",
  PARTIALLY_SHIPPED: "info",
  SHIPPED: "success",
  CANCELLED: "neutral",
  UNFULFILLABLE: "danger",
};

export const MAPPING_STATUS_TONES = {
  mapped: "success",
  unmapped: "warning",
  conflict: "danger",
  missing_m1_sku: "danger",
};

export const RUN_STATUS_TONES = {
  succeeded: "success",
  partial: "warning",
  failed: "danger",
  running: "info",
};
