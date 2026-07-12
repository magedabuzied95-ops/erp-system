import { clearAuth, getCurrentTenant, getCurrentUser, getToken } from "../auth/authStorage";

import { API_BASE_URL } from "../constants/app.js?m1PreviewApi=2";
import { estimatePayloadSize, isErpPerfDebugEnabled } from "../lib/perfDebug";

const runtimeApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (hostname.endsWith(".nip.io")) return "/api";
  }
  return API_BASE_URL;
};

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

const jsonLog = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildHeaders = (
  body,
  extraHeaders = {}
) => {

  const token =
    getToken();
  const currentUser =
    getCurrentUser();
  const currentTenant =
    getCurrentTenant();
  const tenantId =
    currentUser?.tenant_id ||
    currentUser?.tenantId ||
    currentTenant?.id ||
    currentTenant?.tenant_id ||
    "";

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

  if (tenantId && !headers["x-tenant-id"] && !headers["X-Tenant-Id"]) {
    headers["x-tenant-id"] =
      String(tenantId);
  }

  if (
    body !== null &&
    body !== undefined &&
    !isFormData &&
    !headers["Content-Type"] &&
    !headers["content-type"]
  ) {
    headers["Content-Type"] =
      "application/json; charset=utf-8";
  }

  return headers;
};

const isDev = () =>
  typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

const isAiMarketingCenterEndpoint = (endpoint = "") =>
  String(endpoint || "").startsWith("/marketing/ai-center");

const debugAiMarketingRequest = ({
  endpoint,
  method,
  status,
  hasAuthToken,
  requestUrl,
  responseBody,
}) => {
  if (!isDev() || !isAiMarketingCenterEndpoint(endpoint)) return;
  console.debug("[ai-marketing-center] api auth debug", {
    endpoint,
    method,
    status,
    hasAuthToken,
    requestUrl,
    responseBody,
  });
};

const inflightRequestCounts = new Map();

const normalizePerfEndpoint = (endpoint = "", params) => {
  const query = params instanceof URLSearchParams ? params.toString() : "";
  return `${endpoint}${query ? `?${query}` : ""}`;
};

const logApiPerf = ({
  endpoint,
  method,
  status,
  startedAt,
  responseBody,
  duplicateRequestKey,
  component,
}) => {
  if (!isErpPerfDebugEnabled()) return;
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  console.info("[erp-perf] api", {
    route: typeof window !== "undefined" ? window.location.pathname : "",
    endpoint,
    method,
    duration_ms: durationMs,
    status,
    response_size: estimatePayloadSize(responseBody),
    duplicate_request_key: duplicateRequestKey,
    component: component || "",
  });
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
    debugLabel = "",
    perfComponent = "",
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
  const requestUrl = `${runtimeApiBaseUrl()}${endpoint}${queryString ? `${endpoint.includes("?") ? "&" : "?"}${queryString}` : ""}`;
  const perfEndpoint = normalizePerfEndpoint(endpoint, query);
  const duplicateRequestKey = `${method}:${perfEndpoint}`;
  const perfStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const token = getToken();
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
    inflightRequestCounts.set(duplicateRequestKey, (inflightRequestCounts.get(duplicateRequestKey) || 0) + 1);
    response = await fetch(requestUrl, {
      ...fetchOptions,
      method,
      headers: buildHeaders(body, extraHeaders),
      credentials: fetchOptions.credentials || "same-origin",
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
      throw new Error(networkError?.message || "انتهت مهلة الطلب", {
        cause: networkError,
      });
    }
    const hint = "Backend or Vite proxy is not reachable";
    debugAiMarketingRequest({
      endpoint,
      method,
      status: "network-error",
      hasAuthToken: Boolean(token),
      requestUrl,
      responseBody: null,
    });
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
  } finally {
    const count = inflightRequestCounts.get(duplicateRequestKey) || 0;
    if (count <= 1) inflightRequestCounts.delete(duplicateRequestKey);
    else inflightRequestCounts.set(duplicateRequestKey, count - 1);
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

  if (debugLabel) {
    console.log("[api] debug response:", {
      label: debugLabel,
      method,
      url: requestUrl,
      status: response.status,
      responseBody: data,
    });
  }

  debugAiMarketingRequest({
    endpoint,
    method,
    status: response.status,
    hasAuthToken: Boolean(token),
    requestUrl,
    responseBody: data,
  });

  logApiPerf({
    endpoint: perfEndpoint,
    method,
    status: response.status,
    startedAt: perfStartedAt,
    responseBody: data,
    duplicateRequestKey,
    component: perfComponent || debugLabel,
  });

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
      "Session expired or unauthorized"
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
      console.error("[api] request failed", jsonLog({
        method,
        url: requestUrl,
        status: response.status,
        responseBody: data,
        message: data?.message || data?.error || "تعذر إتمام الطلب",
      }));
    }

    const error = new Error(
      data.message || data.error || "تعذر إتمام الطلب"
    );
    error.status = response.status;
    error.responseBody = data;
    error.url = requestUrl;
    error.method = method;
    throw error;
  }

  if (data && typeof data === "object") {
    try {
      Object.defineProperty(data, "__status", {
        value: response.status,
        enumerable: false,
        configurable: true,
      });
    } catch {
      data.__status = response.status;
    }
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

  getAISettings: (
    options
  ) =>

    request(
      "/ai-agent/settings",
      "GET",
      null,
      options
    ),

  updateAISettings: (
    patch,
    options
  ) =>

    request(
      "/ai-agent/settings",
      "PUT",
      patch,
      options
    ),

  getSocialAutomationSettings: (
    options
  ) =>

    request(
      "/ai-inbox/social-automation/settings",
      "GET",
      null,
      options
    ),

  updateSocialAutomationSettings: (
    patch,
    options
  ) =>

    request(
      "/ai-inbox/social-automation/settings",
      "PATCH",
      patch,
      options
    ),

  testAIReply: (
    payload,
    options
  ) =>

    request(
      "/ai-agent/test-reply",
      "POST",
      payload,
      options
    ),

  getAISuggestedReplies: (
    payload,
    options
  ) =>

    request(
      "/ai-agent/suggested-replies",
      "POST",
      payload,
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
      options?.body ?? null,
      options
    ),
};
