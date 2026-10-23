import { api } from "../../../shared/api/api";

/**
 * Sales channels client (analytics v2). Answers { data, meta } like the other v2 clients;
 * a 403 is suppressed so the page can render its own "not permitted" state.
 */
export const fetchSalesChannels = async ({ from, to, compare } = {}, options = {}) => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (compare) params.set("compare", compare);
  const query = params.toString();
  return api.get(`/analytics/v2/sales/channels${query ? `?${query}` : ""}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });
};

export default fetchSalesChannels;
