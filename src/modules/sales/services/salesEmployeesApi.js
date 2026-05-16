import { api } from "../../../shared/api/api";

export const getSalesEmployees = (options = {}) => api.get("/sales-employees", options);
export const createSalesEmployee = (payload = {}) => api.post("/sales-employees", payload);
export const updateSalesEmployee = (id, payload = {}) => api.put(`/sales-employees/${id}`, payload);
export const updateSalesEmployeeSettings = (payload = {}) => api.put("/sales-employees/settings", payload);
export const getSalesCommissionReport = (params = {}) => api.get("/sales-commissions/report", { params });
export const getSalesCommissionPayroll = (employeeId, params = {}) => api.get(`/sales-commissions/payroll/${employeeId}`, { params });
