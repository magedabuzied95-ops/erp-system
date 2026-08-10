import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";

export const getEmployeePortalProducts = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/products`, {
    params: { ...params, _inventory_refresh: Date.now() },
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    suppressErrorStatuses: [404, 422],
  });

// Compact Warehouse Request browse/search/size path — lean products+variants,
// no cache-buster (so identical queries dedupe), cancellable via AbortSignal.
export const getEmployeePortalCompactProducts = (token, params = {}, { signal } = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/products/compact`, {
    params,
    signal,
    suppressErrorStatuses: [404, 422],
  });

export const getEmployeePortalFacets = (token) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/facets`, {
    suppressErrorStatuses: [404, 422],
  });

export const requestEmployeeWarehousePick = (token, payload = {}) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/warehouse-request`, payload, {
    suppressErrorStatuses: [400, 404, 409, 422],
  });

if (typeof window !== "undefined") {
  console.info("[employee-portal-products:api-url]", {
    apiBaseUrl: API_BASE_URL,
  });
}
