import { api } from "../../../shared/api/api";

/** Analytics v2 inventory client. Same conventions as salesApi. */

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
  api.get(`/analytics/v2/inventory/${path}${buildQuery(filters)}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });

export const fetchInventorySummary = (filters, options) => get("summary", filters, options);
export const fetchInventoryBreakdown = (filters, options) => get("breakdown", filters, options);
export const fetchInventoryProducts = (filters, options) => get("products", filters, options);
export const fetchInventorySizes = (filters, options) => get("sizes", filters, options);
