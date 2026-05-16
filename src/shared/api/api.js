import { clearAuth, getToken } from "../auth/authStorage";

import { API_BASE_URL }
from "../constants/app";

const hasFormData =
  typeof FormData !== "undefined";

const isProtectedRequest = (endpoint = "") => {
  const path = String(endpoint || "");
  return ![
    "/auth/login",
    "/auth/register",
    "/health",
    "/api/health",
  ].some((publicPath) => path === publicPath || path.startsWith(`${publicPath}?`));
};

const notifyAuthExpired = (requestUrl, method) => {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  window.dispatchEvent(
    new CustomEvent("erp:auth-expired", {
      detail: { requestUrl, method },
    })
  );
};

const buildHeaders = (
  body,
  extraHeaders = {}
) => {

  const token =
    getToken();

  const headers = {
    ...extraHeaders
  };

  const isFormData =
    hasFormData &&
    body instanceof FormData;

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  if (
    body !== null &&
    body !== undefined &&
    !isFormData &&
    !headers["Content-Type"] &&
    !headers["content-type"]
  ) {
    headers["Content-Type"] =
      "application/json";
  }

  return headers;
};

/* ======================================================
   REQUEST
====================================================== */

const request = async (
  endpoint,
  method = "GET",
  body = null,
  options = {}
) => {

  const {
    headers: extraHeaders,
    params,
    timeoutMs,
    signal,
    suppressErrorStatuses = [],
    ...fetchOptions
  } = options;

  const isFormData =
    hasFormData &&
    body instanceof FormData;

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
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId = null;

  if (controller && signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
  }

  if (controller && Number(timeoutMs) > 0) {
    timeoutId = window.setTimeout(() => {
      controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError"));
    }, Number(timeoutMs));
  }

  let response;
  let data;

  try {
    response = await fetch(requestUrl, {
      ...fetchOptions,
      method,
      headers: buildHeaders(body, extraHeaders),
      signal: controller ? controller.signal : signal,
      body:
        body === null ||
        body === undefined ||
        method === "GET"
          ? undefined
          : isFormData
            ? body
            : JSON.stringify(body),
    });
  } catch (networkError) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (networkError?.name === "AbortError" || networkError?.name === "TimeoutError") {
      throw new Error(networkError?.message || "Request timed out", {
        cause: networkError,
      });
    }
    const hint = "Backend or Vite proxy is not reachable";
    console.error("[api] network error:", {
      url: requestUrl,
      method,
      hint,
      error: networkError?.message || networkError,
    });
    const error = new Error(
      `NetworkError when attempting to fetch ${requestUrl} (${method}). Hint: ${hint}.`
    );
    error.url = requestUrl;
    error.method = method;
    error.hint = hint;
    error.cause = networkError;
    throw error;
  }

  try {

    data =
      await response.json();

  } catch {

    data = {};
  }

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  /* =========================
     UNAUTHORIZED
  ========================= */

  if (
    response.status === 401
  ) {
    if (isProtectedRequest(endpoint)) {
      clearAuth();
      notifyAuthExpired(requestUrl, method);
    }

    const error = new Error(
      "Session expired. Please login again."
    );
    error.status = 401;
    error.responseBody = data;
    error.url = requestUrl;
    error.method = method;
    throw error;
  }

  /* =========================
     ERROR
  ========================= */

  if (!response.ok) {
    if (!suppressErrorStatuses.includes(response.status)) {
      console.error("[api] request failed:", {
        method,
        url: requestUrl,
        status: response.status,
        responseBody: data,
        message: data?.message || data?.error || "Request Failed",
      });
    }

    const error = new Error(
      data.message || "Request Failed"
    );
    error.status = response.status;
    error.responseBody = data;
    error.url = requestUrl;
    error.method = method;
    throw error;
  }

  return data;
};

/* ======================================================
   METHODS
====================================================== */

export const api = {

  get: (
    endpoint,
    options
  ) =>

    request(
      endpoint,
      "GET",
      null,
      options
    ),

  post: (
    endpoint,
    body,
    options
  ) =>

    request(
      endpoint,
      "POST",
      body,
      options
    ),

  put: (
    endpoint,
    body,
    options
  ) =>

    request(
      endpoint,
      "PUT",
      body,
      options
    ),

  patch: (
    endpoint,
    body,
    options
  ) =>

    request(
      endpoint,
      "PATCH",
      body,
      options
    ),

  delete: (
    endpoint,
    options
  ) =>

    request(
      endpoint,
      "DELETE",
      null,
      options
    ),
};
