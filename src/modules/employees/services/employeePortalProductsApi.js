import { api } from "../../../shared/api/api";

export const getEmployeePortalProducts = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/products`, {
    params,
    suppressErrorStatuses: [404, 422],
  });

export const requestEmployeeWarehousePick = (token, payload = {}) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/warehouse-request`, payload, {
    suppressErrorStatuses: [400, 404, 409, 422],
  });
