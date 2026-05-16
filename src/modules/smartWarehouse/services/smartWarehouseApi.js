import { api } from "../../../shared/api/api";

const buildQuery = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  });
  const value = query.toString();
  return value ? `?${value}` : "";
};

export const smartWarehouseApi = {
  sections: (params) => api.get(`/smart-warehouse/sections${buildQuery(params)}`),
  createSection: (payload) => api.post("/smart-warehouse/sections", payload),
  sectionByCode: (code) => api.get(`/smart-warehouse/sections/${encodeURIComponent(code)}`),
  generateMasterQr: (productId) => api.post(`/smart-warehouse/master-qr/products/${encodeURIComponent(productId)}`, {}),
  masterQr: (qrValue) => api.get(`/smart-warehouse/master-qr/${encodeURIComponent(qrValue)}`),
  saveQuickCount: (payload) => api.post("/smart-warehouse/counts/quick", payload),
  counts: (params) => api.get(`/smart-warehouse/counts${buildQuery(params)}`),
  cycleTasks: (params) => api.get(`/smart-warehouse/counts/cycle-tasks${buildQuery(params)}`),
  reports: () => api.get("/smart-warehouse/reports"),
};
