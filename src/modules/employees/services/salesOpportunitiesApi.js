import { api } from "../../../shared/api/api";

export const getEmployeeSalesOpportunities = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/sales-opportunities`, {
    params,
    suppressErrorStatuses: [404, 422, 500],
  });
