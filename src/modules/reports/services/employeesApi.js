import { api } from "../../../shared/api/api";

/**
 * Analytics v2 employee and channel client. Same conventions as the other reports
 * clients: a 403 is suppressed so the page renders its own "not permitted" state, and
 * every request carries an abort signal so a superseded filter change cannot land late.
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
  api.get(`/analytics/v2/employees/${path}${buildQuery(filters)}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });

export const fetchEmployeesSummary = (filters, options) => get("summary", filters, options);
export const fetchEmployeesBreakdown = (filters, options) => get("breakdown", filters, options);
export const fetchEmployeesList = (filters, options) => get("list", filters, options);
