import { api } from "../../../shared/api/api";

export const listInventoryCountSessions = (params = {}) => api.get("/inventory-count/sessions", { params });
export const createInventoryCountSession = (body = {}) => api.post("/inventory-count/sessions", body);
export const getInventoryCountSession = (id) => api.get(`/inventory-count/sessions/${encodeURIComponent(id)}`);
export const updateInventoryCountSession = (id, body = {}) => api.patch(`/inventory-count/sessions/${encodeURIComponent(id)}`, body);
export const openInventoryCountSession = (id) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/open`);
export const searchInventoryCountVariants = (id, params = {}) => api.get(`/inventory-count/sessions/${encodeURIComponent(id)}/lookup`, { params });
export const upsertInventoryCountItem = (id, body = {}) => api.put(`/inventory-count/sessions/${encodeURIComponent(id)}/items`, body);
export const addInventoryCountModel = (id, body = {}) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/models`, body);
export const submitInventoryCountSession = (id) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/submit`);
export const approveInventoryCountSession = (id) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/approve`);
export const rejectInventoryCountSession = (id, body = {}) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/reject`, body);
export const reopenInventoryCountSession = (id) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/reopen`);
export const cancelInventoryCountSession = (id, body = {}) => api.post(`/inventory-count/sessions/${encodeURIComponent(id)}/cancel`, body);
export const deleteInventoryCountSession = (id) => api.delete(`/inventory-count/sessions/${encodeURIComponent(id)}`);
