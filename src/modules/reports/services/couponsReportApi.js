import { api } from "../../../shared/api/api";

/**
 * Coupon performance client. Same conventions as the other reports clients: a 403 is
 * suppressed so the page can render its own "not permitted" state instead of a toast.
 */
export const fetchCouponPerformance = async ({ from, to } = {}, options = {}) => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const response = await api.get(`/coupons/reports/performance${query ? `?${query}` : ""}`, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30000,
    suppressErrorStatuses: [403],
  });
  // The /coupons family answers flat ({ success, totals, ... }) while useAnalyticsResource reads
  // `response.data`. Adapt at this boundary rather than making one endpoint of the family odd.
  return { data: response ?? null, meta: response?.period ?? null, warnings: [] };
};

export default fetchCouponPerformance;
