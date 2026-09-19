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

// `options` carries a timeout: with the phone's catalogue already answering, a
// lookup that a weak line cannot finish quickly is not worth waiting out.
export const lookupEmployeePortalInventoryVariants = (token, sessionId, params = {}, options = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/lookup`, { params, ...options });

export const upsertEmployeePortalInventoryItem = (token, sessionId, body = {}) =>
  api.put(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/items`, body);

// One request for every quantity the phone counted while it had no signal.
export const bulkUpsertEmployeePortalInventoryItems = (token, sessionId, items = []) =>
  api.put(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/items/bulk`, { items });

// Lean lookup snapshot cached on the device so scan/search works offline.
export const getEmployeePortalInventoryCatalogSnapshot = (token, params = {}) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/inventory/catalog-snapshot`, {
    params,
    suppressErrorStatuses: [404, 422],
  });

export const deleteEmployeePortalInventoryColorGroup = (token, sessionId, body = {}) =>
  api.delete(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/color-groups`, { body });

export const submitEmployeePortalInventorySession = (token, sessionId) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/submit`);

export const reopenEmployeePortalInventorySession = (token, sessionId) =>
  api.post(`/employee-portal/${encodeURIComponent(token)}/inventory/sessions/${encodeURIComponent(sessionId)}/reopen`);

// A few bytes: has the catalogue this phone holds changed? Asked before the
// snapshot so a weak line never downloads a catalogue that is already current.
// Hard-capped — on a line that cannot answer this quickly, the cache stands.
export const getEmployeePortalInventoryCatalogVersion = (token) =>
  api.get(`/employee-portal/${encodeURIComponent(token)}/inventory/catalog-version`, {
    timeoutMs: 8000,
    cache: "no-store",
    suppressErrorStatuses: [404, 422],
  });
