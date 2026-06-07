import { api } from "../../../shared/api/api";

export const getEmployeePortalProducts = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/products`, {
    params,
    suppressErrorStatuses: [404, 422],
  });
