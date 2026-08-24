import { api } from "../../../shared/api/api";

/**
 * Analytics v2 client. Uses the shared api helper so auth, tenant headers and the
 * auth-expiry event behave exactly as everywhere else in the app.
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

/**
 * @param {object} filters  from/to/compare/branchId/granularity
 * @param {object} options  { signal } — an AbortSignal so a superseded period change
 *                          cancels its in-flight request instead of racing it.
 */
export const fetchExecutiveOverview = async (filters = {}, options = {}) =>
  api.get(`/analytics/v2/overview${buildQuery(filters)}`, {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 30000,
    // 403 is a legitimate answer (no reports:view) and is rendered as a restricted
    // state rather than a toast-worthy failure.
    suppressErrorStatuses: [403],
  });

/**
 * The values every filter control can take, scoped to the caller's tenant, the selected
 * window and the canonical order predicate.
 *
 * Kept separate from the report requests on purpose: a failure here costs the reader
 * their dropdowns, not their report, so the filter bar renders a one-line note and the
 * page carries on.
 */
export const fetchFilterOptions = async ({ from, to } = {}, options = {}) =>
  api.get(`/analytics/v2/filter-options${buildQuery({ from, to })}`, {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 20000,
    suppressErrorStatuses: [403],
  });
