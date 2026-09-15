import { api } from "../../../shared/api/api";

const tokenPath = (token) => `/employee-portal/${encodeURIComponent(token)}`;

export const getEmployeePortalInboxAccess = (token) =>
  api.get(`${tokenPath(token)}/inbox-access`, {
    cache: "no-store",
    suppressErrorStatuses: [403, 404, 422],
  });

export const openEmployeePortalInboxSession = (token) =>
  api.post(`${tokenPath(token)}/inbox-session`, {}, {
    suppressErrorStatuses: [403, 404, 422],
  });

// Admin side (employee profile).
export const getEmployeePortalInboxSwitch = (employeeId) =>
  api.get(`/employees/${encodeURIComponent(employeeId)}/portal-inbox-access`, { cache: "no-store" });

export const setEmployeePortalInboxSwitch = (employeeId, enabled) =>
  api.patch(`/employees/${encodeURIComponent(employeeId)}/portal-inbox-access`, { enabled: Boolean(enabled) });
