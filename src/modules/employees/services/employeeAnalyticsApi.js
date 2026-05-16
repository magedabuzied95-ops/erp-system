import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";
import { getToken } from "../../../shared/auth/authStorage";

const unwrap = (payload) =>
  payload?.data ??
  payload?.result ??
  payload?.payload ??
  payload?.employeeAnalytics ??
  payload ??
  {};

const toQueryString = (params = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    searchParams.set(key, value);
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

const fetchWithToken = async (endpoint, params = {}) => {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${endpoint}${toQueryString(params)}`, {
    method: "GET",
    headers,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Keep default data when the fallback response has no JSON body.
  }

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return unwrap(data);
};

const request = async (endpoint, params = {}) => {
  try {
    return unwrap(await api.get(`${endpoint}${toQueryString(params)}`));
  } catch {
    return fetchWithToken(endpoint, params);
  }
};

export const getSalesPerformance = (params = {}) => request("/employees/sales-performance", params);
export const getCommissions = (params = {}) => request("/employees/commissions", params);
export const getTopPerformers = (params = {}) => request("/employees/top-performers", params);
export const getCommissionRules = (params = {}) => request("/employees/commission-rules", params);
export const createCommissionRule = (payload = {}) => api.post("/employees/commission-rules", payload);
export const updateCommissionRule = (id, payload = {}) => api.put(`/employees/commission-rules/${id}`, payload);
