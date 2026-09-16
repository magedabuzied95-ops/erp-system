// Error type + redaction for everything Amazon. Anything that could hold a token,
// secret or authorization header is scrubbed before it reaches a log, the DB or a response.

export const AMAZON_ERROR_CATEGORY = Object.freeze({
  NOT_CONFIGURED: "not_configured",
  AUTHENTICATION: "authentication",     // LWA refused the refresh token / client credentials
  AUTHORIZATION: "authorization",       // SP-API 403: role or seller authorization missing
  RATE_LIMITED: "rate_limited",         // 429 after retries, or local limiter wait too long
  INVALID_REQUEST: "invalid_request",   // 400/404/422
  UPSTREAM: "upstream_unavailable",     // 5xx after retries
  NETWORK: "network",                   // DNS / connection / timeout after retries
  WRITE_DISABLED: "write_disabled",
  INTERNAL: "internal",
});

const SECRET_PATTERNS = [
  /Atza\|[A-Za-z0-9_\-+/=.]+/g,                    // LWA access tokens
  /Atzr\|[A-Za-z0-9_\-+/=.]+/g,                    // LWA refresh tokens
  /amzn1\.oa2-cs\.[A-Za-z0-9_.-]+/g,               // client secrets
  /amzn1\.application-oa2-client\.[A-Za-z0-9]+/g,  // client ids
  /(x-amz-access-token|authorization)\s*[:=]\s*\S+/gi,
  /(refresh_token|client_secret|access_token)=[^&\s"]+/gi,
  /https:\/\/[^\s"]*[?&](X-Amz-Signature|X-Amz-Credential|Signature)=[^\s"]*/gi, // pre-signed report URLs
];

export const redactAmazonText = (value = "", maxLength = 300) => {
  let output = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[redacted]");
  return output.length > maxLength ? `${output.slice(0, maxLength)}…` : output;
};

export class AmazonApiError extends Error {
  constructor(message, { category = AMAZON_ERROR_CATEGORY.INTERNAL, status = null, code = "", operation = "", retryable = false, requestId = "" } = {}) {
    super(redactAmazonText(message));
    this.name = "AmazonApiError";
    this.category = category;
    this.status = status;
    this.code = redactAmazonText(code, 80);
    this.operation = operation;
    this.retryable = retryable;
    this.requestId = redactAmazonText(requestId, 80);
  }

  toSafeJSON() {
    return {
      category: this.category,
      status: this.status,
      code: this.code || null,
      operation: this.operation || null,
      message: this.message,
      request_id: this.requestId || null,
    };
  }
}

export const categoryForStatus = (status) => {
  if (status === 401) return AMAZON_ERROR_CATEGORY.AUTHENTICATION;
  if (status === 403) return AMAZON_ERROR_CATEGORY.AUTHORIZATION;
  if (status === 429) return AMAZON_ERROR_CATEGORY.RATE_LIMITED;
  if (status >= 500) return AMAZON_ERROR_CATEGORY.UPSTREAM;
  if (status >= 400) return AMAZON_ERROR_CATEGORY.INVALID_REQUEST;
  return AMAZON_ERROR_CATEGORY.INTERNAL;
};

export const toSafeError = (error) => {
  if (error instanceof AmazonApiError) return error.toSafeJSON();
  return {
    category: AMAZON_ERROR_CATEGORY.INTERNAL,
    status: null,
    code: null,
    operation: null,
    message: redactAmazonText(error?.message || String(error || "unknown error")),
    request_id: null,
  };
};
