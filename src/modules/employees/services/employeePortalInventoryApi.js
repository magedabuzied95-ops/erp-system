import { api } from "../../../shared/api/api";

export const listEmployeePortalInventorySessions = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions`, { params });

export const createEmployeePortalInventorySession = (token, body = {}) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions`, body);

export const getEmployeePortalInventorySession = (token, sessionId) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}`);

export const updateEmployeePortalInventorySession = (token, sessionId, body = {}) =>
  api.patch(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}`, body);

export const openEmployeePortalInventorySession = (token, sessionId) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/open`);

export const lookupEmployeePortalInventoryVariants = (token, sessionId, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/lookup`, { params });

export const upsertEmployeePortalInventoryItem = (token, sessionId, body = {}) =>
  api.put(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/items`, body);

export const deleteEmployeePortalInventoryColorGroup = (token, sessionId, body = {}) =>
  api.delete(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/color-groups`, { body });

export const submitEmployeePortalInventorySession = (token, sessionId) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/submit`);

export const reopenEmployeePortalInventorySession = (token, sessionId) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/reopen`);
