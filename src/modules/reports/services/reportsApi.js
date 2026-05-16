import { api } from "../../../shared/api/api";

const unwrap = (payload) => payload?.data ?? payload ?? {};

const buildParams = (filters = {}) => {
  const params = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params[key] = value;
  });
  return params;
};

export const getReportsDashboard = async (filters = {}) => unwrap(await api.get("/reports/dashboard", { params: buildParams(filters), timeoutMs: 30000 }));
export const getSalesReports = async (filters = {}) => unwrap(await api.get("/reports/sales", { params: buildParams(filters), timeoutMs: 30000 }));
export const getEmployeeReports = async (filters = {}) => unwrap(await api.get("/reports/employees", { params: buildParams(filters), timeoutMs: 30000 }));
export const getInventoryReports = async (filters = {}) => unwrap(await api.get("/reports/inventory", { params: buildParams(filters), timeoutMs: 30000 }));
export const getCustomerReports = async (filters = {}) => unwrap(await api.get("/reports/customers", { params: buildParams(filters), timeoutMs: 30000 }));
export const getFinancialReports = async (filters = {}) => unwrap(await api.get("/reports/financial", { params: buildParams(filters), timeoutMs: 30000 }));
export const getAiInsights = async (filters = {}) => unwrap(await api.get("/reports/insights", { params: buildParams(filters), timeoutMs: 30000 }));
export const exportReportCsv = async (filters = {}) => api.get("/reports/export", { params: buildParams(filters), timeoutMs: 30000 });
