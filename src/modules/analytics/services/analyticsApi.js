import { api } from "../../../shared/api/api";
import { API_BASE_URL } from "../../../shared/constants/app";
import { getToken } from "../../../shared/auth/authStorage";

const unwrap = (payload) =>
  payload?.data ??
  payload?.analytics ??
  payload?.result ??
  payload?.payload ??
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

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

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
    throw new Error(data.message || "Request Failed");
  }

  return unwrap(data);
};

const request = async (endpoint, params = {}) => {
  try {
    const query = toQueryString(params);
    return unwrap(await api.get(`${endpoint}${query}`));
  } catch (error) {
    try {
      return await fetchWithToken(endpoint, params);
    } catch (fallbackError) {
      throw fallbackError || error;
    }
  }
};

export const getAnalyticsOverview = (params = {}) => request("/analytics/overview", params);

export const getSalesAnalytics = (params = {}) => request("/analytics/sales", params);

export const getProfitAnalytics = (params = {}) => request("/analytics/profit", params);

export const getInventoryIntelligence = (params = {}) => request("/analytics/inventory", params);

export const getCustomerAnalytics = (params = {}) => request("/analytics/customers", params);

export const getAiInsights = (params = {}) => request("/analytics/ai-insights", params);

export const getReorderSuggestions = (params = {}) => request("/analytics/reorder-suggestions", params);

export const getDeadStockAnalysis = (params = {}) => request("/analytics/dead-stock", params);

export const getCustomerIntelligence = (params = {}) => request("/analytics/customer-intelligence", params);
