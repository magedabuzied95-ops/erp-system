import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";

export const getEmployeePortalProducts = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/products`, {
    params,
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
