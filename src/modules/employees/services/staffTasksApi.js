import { api } from "../../../shared/api/api";

export const staffTasksApi = {
  bootstrap: () => api.get("/staff-tasks/bootstrap"),
  list: (params = {}) => api.get("/staff-tasks", { params }),
  my: (params = {}) => api.get("/staff-tasks/my", { params }),
  dashboard: () => api.get("/staff-tasks/dashboard"),
  create: (payload) => api.post("/staff-tasks", payload),
  updateStatus: (id, payload) => api.patch(`/staff-tasks/${id}/status`, payload),
  complete: (id, payload = {}) => api.post(`/staff-tasks/${id}/complete`, payload),
  addComment: (id, payload) => api.post(`/staff-tasks/${id}/comments`, payload),
  delete: (id) => api.delete(`/staff-tasks/${id}`),
  assignInventoryCounts: (payload = {}) => api.post("/staff-tasks/auto/inventory-counts", payload),
  redistributeAbsent: (payload = {}) => api.post("/staff-tasks/redistribute/absent", payload),
  reassignUnfinished: () => api.post("/staff-tasks/reassign/unfinished", {}),
};
