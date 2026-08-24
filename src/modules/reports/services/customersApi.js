import { api } from "../../../shared/api/api";

/**
 * Analytics v2 customer client. Same conventions as salesApi.
 *
 * Note what is NOT here: there is no endpoint on this client that returns a phone number
 * or an email address, because no such endpoint exists on the server. A caller wanting
 * contact details goes to the customer record, where the access is attributable.
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
  api.get(`/analytics/v2/customers/${path}${buildQuery(filters)}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });

export const fetchCustomersSummary = (filters, options) => get("summary", filters, options);
export const fetchCustomersBreakdown = (filters, options) => get("breakdown", filters, options);
export const fetchCustomersList = (filters, options) => get("list", filters, options);
