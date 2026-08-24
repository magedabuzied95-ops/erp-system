import { api } from "../../../shared/api/api";

/**
 * Analytics v2 reconciliation client.
 *
 * One endpoint, because the reconciliation is one comparison. It is deliberately slower
 * than the other reports — it runs every summary plus the accounting profit and loss — so
 * it carries a longer timeout than the 30s the section endpoints use.
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

export const fetchReconciliation = (filters, options) =>
  api.get(`/analytics/v2/reconciliation${buildQuery(filters)}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 60000,
    suppressErrorStatuses: [403],
  });

export default fetchReconciliation;
