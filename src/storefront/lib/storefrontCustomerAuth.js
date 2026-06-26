import { getCurrentTenant } from "../../shared/auth/authStorage";
import { API_BASE_URL } from "../../shared/constants/app";
import { safeSetLocalStorage } from "../../utils/safeStorage";

export const STOREFRONT_CUSTOMER_TOKEN_KEY = "storefront_customer_token";
export const STOREFRONT_CUSTOMER_PHONE_KEY = "storefront_customer_phone";

const isBrowser = () => typeof window !== "undefined";

export const normalizeStorefrontCustomerPhone = (phone = "") => String(phone || "").replace(/\D/g, "");

const readStorageValue = (key) => {
  if (!isBrowser()) return "";
  try {
    return String(window.localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
};

const removeStorageValue = (key) => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
};

const dispatchAuthChange = () => {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new CustomEvent("storefront-customer-auth-changed", { detail: readStorefrontCustomerAuth() }));
  } catch {
    // Ignore event dispatch failures.
  }
};

const getTenantId = () => {
  const tenant = getCurrentTenant();
  const currentTenantId = tenant?.id ?? tenant?.tenant_id ?? "";
  const value = Number(currentTenantId);
  return Number.isFinite(value) && value > 0 ? String(value) : "";
};

export const readStorefrontCustomerAuth = () => {
  const token = readStorageValue(STOREFRONT_CUSTOMER_TOKEN_KEY);
  const phone = normalizeStorefrontCustomerPhone(readStorageValue(STOREFRONT_CUSTOMER_PHONE_KEY));
  return { token, phone };
};

export const storeStorefrontCustomerAuth = ({ token = "", phone = "" } = {}) => {
  const safeToken = String(token || "").trim();
  const safePhone = normalizeStorefrontCustomerPhone(phone);
  if (safeToken) safeSetLocalStorage(STOREFRONT_CUSTOMER_TOKEN_KEY, safeToken);
  else removeStorageValue(STOREFRONT_CUSTOMER_TOKEN_KEY);
  if (safePhone) safeSetLocalStorage(STOREFRONT_CUSTOMER_PHONE_KEY, safePhone);
  else removeStorageValue(STOREFRONT_CUSTOMER_PHONE_KEY);
  dispatchAuthChange();
  return { token: safeToken, phone: safePhone };
};

export const clearStorefrontCustomerAuth = () => {
  removeStorageValue(STOREFRONT_CUSTOMER_TOKEN_KEY);
  removeStorageValue(STOREFRONT_CUSTOMER_PHONE_KEY);
  dispatchAuthChange();
};

export const getStorefrontCustomerAuthHeaders = (extraHeaders = {}) => {
  const { token } = readStorefrontCustomerAuth();
  const headers = { ...extraHeaders };
  const tenantId = getTenantId();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantId && !headers["x-tenant-id"] && !headers["X-Tenant-Id"]) {
    headers["x-tenant-id"] = tenantId;
  }
  return headers;
};

export const storefrontCustomerRequest = async (endpoint, options = {}) => {
  const {
    method = "GET",
    body = null,
    headers: extraHeaders = {},
    params,
    ...fetchOptions
  } = options;

  const query = params instanceof URLSearchParams ? params : new URLSearchParams();
  if (params && !(params instanceof URLSearchParams)) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item !== undefined && item !== null && item !== "") query.append(key, String(item));
        });
        return;
      }
      query.set(key, String(value));
    });
  }

  const queryString = query.toString();
  const requestUrl = `${API_BASE_URL}${endpoint}${queryString ? `${endpoint.includes("?") ? "&" : "?"}${queryString}` : ""}`;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = getStorefrontCustomerAuthHeaders(extraHeaders);
  if (!headers["Content-Type"] && !headers["content-type"] && body !== null && body !== undefined && method !== "GET" && !isFormData) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(requestUrl, {
    ...fetchOptions,
    method,
    headers,
    credentials: fetchOptions.credentials || "same-origin",
    body:
      body === null ||
      body === undefined ||
      method === "GET"
        ? undefined
        : isFormData
          ? body
          : JSON.stringify(body),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || "Request failed");
    error.status = response.status;
    error.responseBody = data;
    error.url = requestUrl;
    error.method = method;
    throw error;
  }

  return data;
};
