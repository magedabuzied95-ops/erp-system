import { api } from "../../../shared/api/api";

/**
 * Analytics v2 purchasing client. Same conventions as salesApi: a 403 is suppressed so
 * the page can render its own "not permitted" state instead of a toast, and every
 * request carries an abort signal so a superseded filter change cannot land late.
 */

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
};

const get = (path, filters, options) =>
  api.get(`/analytics/v2/purchasing/${path}${buildQuery(filters)}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });

export const fetchPurchasingSummary = (filters, options) => get("summary", filters, options);
export const fetchPurchasingBreakdown = (filters, options) => get("breakdown", filters, options);
export const fetchPurchasingProducts = (filters, options) => get("products", filters, options);
export const fetchPurchasingSuppliers = (filters, options) => get("suppliers", filters, options);
