import { api } from "../../../shared/api/api";

export const getEmployeeSalesOpportunities = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/sales-opportunities`, {
    params,
    suppressErrorStatuses: [404, 422, 500],
  });

// Browsable board: models in العروض + models down to their last piece, with the
// size / الجمهور / الفئة facets the dropdowns are built from.
export const getEmployeeSalesBoard = (token, params = {}, { signal } = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/sales-board`, {
    params,
    signal,
    suppressErrorStatuses: [404, 422, 500],
  });
