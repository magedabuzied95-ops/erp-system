import { api } from "../../../shared/api/api";

/** Analytics v2 sales client. Same conventions as analyticsV2Api. */

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
  api.get(`/analytics/v2/sales/${path}${buildQuery(filters)}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });

export const fetchSalesSummary = (filters, options) => get("summary", filters, options);
export const fetchSalesBreakdown = (filters, options) => get("breakdown", filters, options);
export const fetchSalesProducts = (filters, options) => get("products", filters, options);
export const fetchSalesSizes = (filters, options) => get("sizes", filters, options);
