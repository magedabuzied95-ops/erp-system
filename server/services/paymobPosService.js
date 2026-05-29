import crypto from "crypto";

const DEFAULT_PAYMOB_BASE_URL = "https://accept.paymob.com/api";
const DEFAULT_PAYMOB_AUTH_BASE_URL = "https://accept.paymobsolutions.com/api";

const trimTrailingSlash = (value = "") => String(value || "").replace(/\/+$/, "");

const boolFromEnv = (value = "") => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const maskValue = (value = "") => {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const paymobConfig = () => ({
  enabled: boolFromEnv(process.env.PAYMOB_ENABLED),
  apiKey: process.env.PAYMOB_API_KEY || "",
  hmacSecret: process.env.PAYMOB_HMAC_SECRET || process.env.PAYMOB_HMAC_KEY || "",
  baseUrl: trimTrailingSlash(process.env.PAYMOB_BASE_URL || DEFAULT_PAYMOB_BASE_URL),
  authBaseUrl: trimTrailingSlash(process.env.PAYMOB_AUTH_BASE_URL || DEFAULT_PAYMOB_AUTH_BASE_URL),
  statusEndpoint: process.env.PAYMOB_STATUS_ENDPOINT || "auto",
  statusMethod: String(process.env.PAYMOB_STATUS_METHOD || "GET").trim().toUpperCase(),
  terminalId: process.env.PAYMOB_TERMINAL_ID || "",
  preferredPaymentMethod: process.env.PAYMOB_PREFERRED_METHOD || "card",
});

const PAYMOB_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const valueAtPath = (object = {}, path = "") =>
  String(path || "")
    .split(".")
    .reduce((current, key) => (current && current[key] !== undefined && current[key] !== null ? current[key] : ""), object);

const boolValue = (value) => {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(text);
};

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

const PAYMOB_APPROVAL_RESPONSE_CODES = new Set(["0", "00", "000", "approved", "captured", "success", "successful"]);

const maskSensitiveUrl = (value = "") => {
  try {
    const url = new URL(String(value));
    ["auth_token", "token", "api_key", "key", "hmac"].forEach((key) => {
      if (url.searchParams.has(key)) url.searchParams.set(key, maskValue(url.searchParams.get(key)));
    });
    return url.toString();
  } catch {
    return String(value || "").replace(/(auth_token|token|api_key|key|hmac)=([^&\s]+)/gi, (_match, key, secret) => `${key}=${maskValue(secret)}`);
  }
};

const resolvePaymobUrl = (baseUrl = "", endpoint = "") => {
  const text = String(endpoint || "").trim();
  if (/^https?:\/\//i.test(text)) return new URL(text);
  return new URL(`${trimTrailingSlash(baseUrl)}${text.startsWith("/") ? "" : "/"}${text}`);
};

const numericText = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : "";
};

const pendingStatusResult = (payload = {}) => ({
  payload,
  normalized: normalizePaymobPaymentPayload({
    ...payload,
    status: "pending",
    pending: true,
  }),
});

const buildPaymobStatusRequest = ({ config, token, providerOrderId, merchantOrderId, transactionReference } = {}) => {
  const method = config.statusMethod || "GET";
  const rawEndpoint = String(config.statusEndpoint || "").trim();
  const transactionId = String(transactionReference || "").trim();
  const orderId = numericText(providerOrderId);
  const merchantId = numericText(merchantOrderId);
  const lowerEndpoint = rawEndpoint.toLowerCase();

  if (lowerEndpoint === "auto") {
    if (transactionId) {
      const url = resolvePaymobUrl(config.baseUrl, `/acceptance/transactions/${encodeURIComponent(transactionId)}`);
      if (method === "GET") url.searchParams.set("auth_token", token);
      return { valid: true, method, url };
    }
    if (orderId) {
      const url = resolvePaymobUrl(config.baseUrl, `/ecommerce/orders/${encodeURIComponent(orderId)}`);
      if (method === "GET") url.searchParams.set("auth_token", token);
      return { valid: true, method, url };
    }
    return { valid: false, reason: "invalid_status_endpoint", method, endpoint: rawEndpoint };
  }

  if (!rawEndpoint || lowerEndpoint.endsWith("/inquire") || lowerEndpoint.includes("/inquire?")) {
    return { valid: false, reason: "invalid_status_endpoint", method, endpoint: rawEndpoint };
  }

  let resolvedEndpoint = rawEndpoint;
  const replacements = {
    transaction_id: transactionId,
    transactionId,
    order_id: orderId,
    orderId,
    merchant_order_id: merchantId,
    merchantOrderId: merchantId,
    id: transactionId || orderId,
  };
  const placeholderMatches = [...resolvedEndpoint.matchAll(/\{([A-Za-z0-9_]+)\}|:([A-Za-z0-9_]+)/g)];
  for (const match of placeholderMatches) {
    const key = match[1] || match[2];
    const value = replacements[key] || "";
    if (!value) return { valid: false, reason: "invalid_status_endpoint", method, endpoint: rawEndpoint };
    resolvedEndpoint = resolvedEndpoint.replace(match[0], encodeURIComponent(value));
  }

  const url = resolvePaymobUrl(config.baseUrl, resolvedEndpoint);
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] || "";
  const hasPlaceholder = placeholderMatches.length > 0;

  if (!hasPlaceholder && !numericText(lastSegment)) {
    if (lowerEndpoint.endsWith("/transactions") && transactionId) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(transactionId)}`;
    } else if (lowerEndpoint.endsWith("/orders") && orderId) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(orderId)}`;
    } else {
      return { valid: false, reason: "invalid_status_endpoint", method, endpoint: rawEndpoint };
    }
  }

  if (method === "GET") {
    url.searchParams.set("auth_token", token);
  }

  return { valid: true, method, url };
};

export const verifyPaymobHmac = ({ body = {}, query = {} } = {}) => {
  const config = paymobConfig();
  const received = String(firstValue(query.hmac, body.hmac, body.obj?.hmac) || "").trim();
  if (!received) return { checked: false, valid: true, reason: "missing_hmac" };
  if (!config.hmacSecret) return { checked: false, valid: true, reason: "missing_secret" };

  const obj = body.obj && typeof body.obj === "object" ? body.obj : body;
  const message = PAYMOB_HMAC_FIELDS.map((field) => valueAtPath(obj, field)).join("");
  const expected = crypto.createHmac("sha512", config.hmacSecret).update(message).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  const valid = expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  return { checked: true, valid, reason: valid ? "valid" : "invalid" };
};

export const normalizePaymobPaymentPayload = (payload = {}) => {
  const arrayCandidate = Array.isArray(payload?.results) ? payload.results[0] : Array.isArray(payload?.transactions) ? payload.transactions[0] : null;
  const obj = payload.obj && typeof payload.obj === "object"
    ? payload.obj
    : payload.transaction && typeof payload.transaction === "object"
      ? payload.transaction
      : payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data
        : arrayCandidate && typeof arrayCandidate === "object"
          ? arrayCandidate
          : payload;
  const providerOrderId = firstValue(
    obj.order?.id,
    obj.order_id,
    obj.order,
    payload.order_id,
    payload.order?.id,
    payload.provider_order_id
  );
  const merchantOrderId = firstValue(obj.order?.merchant_order_id, obj.merchant_order_id, payload.merchant_order_id);
  const transactionReference = firstValue(
    obj.id,
    payload.transaction_id,
    payload.transaction_reference,
    payload.id,
    obj.transaction_id,
    obj.data?.transaction_id
  );
  const terminalId = firstValue(obj.terminal_id, payload.terminal_id, obj.source_data?.terminal_id);
  const amountCents = Number(firstValue(obj.amount_cents, payload.amount_cents, payload.amount, 0) || 0);
  const success = boolValue(firstValue(obj.success, payload.success));
  const pending = boolValue(firstValue(obj.pending, payload.pending));
  const errorOccured = boolValue(firstValue(obj.error_occured, obj.error_occurred, payload.error_occured, payload.error_occurred));
  const isVoided = boolValue(firstValue(obj.is_voided, payload.is_voided));
  const isRefunded = boolValue(firstValue(obj.is_refunded, payload.is_refunded));
  const responseCode = String(firstValue(obj.txn_response_code, payload.txn_response_code, obj.data?.txn_response_code, obj.acq_response_code, payload.acq_response_code, "") || "").trim();
  const rawStatus = String(firstValue(obj.status, obj.state, obj.payment_status, payload.status, payload.state, payload.payment_status, "") || "").toLowerCase();
  const successStates = ["approved", "paid", "captured", "success", "successful", "done", "completed", "complete"];
  const isApprovedResponseCode = PAYMOB_APPROVAL_RESPONSE_CODES.has(responseCode.toLowerCase());
  const isApprovedState = successStates.includes(rawStatus);

  let status = "pending";
  if ((success || isApprovedResponseCode || isApprovedState) && !pending && !errorOccured && !isVoided && !isRefunded) status = "success";
  else if (isVoided || ["cancelled", "canceled", "voided", "cancel"].includes(rawStatus)) status = "cancelled";
  else if (errorOccured || ["failed", "declined", "rejected", "error"].includes(rawStatus)) status = "failed";
  else if (pending || ["pending", "created", "sent", "processing"].includes(rawStatus)) status = "pending";

  return {
    providerOrderId: providerOrderId ? String(providerOrderId) : "",
    merchantOrderId: merchantOrderId ? String(merchantOrderId) : "",
    invoiceOrOrderId: firstValue(payload.invoice_id, payload.invoiceId, payload.local_order_id, payload.orderId),
    terminalId: terminalId ? String(terminalId) : "",
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    amount: Number.isFinite(amountCents) ? amountCents / 100 : 0,
    currency: String(firstValue(obj.currency, payload.currency, "EGP") || "EGP").toUpperCase(),
    status,
    transactionReference: transactionReference ? String(transactionReference) : "",
    success,
    pending,
    isVoided,
    isRefunded,
    responseCode,
    rawStatus,
    payload,
  };
};

const extractTerminalTransactionReference = (payload = {}) => {
  const transaction = payload.transaction && typeof payload.transaction === "object" ? payload.transaction : null;
  const data = payload.data && typeof payload.data === "object" ? payload.data : null;
  const candidate = firstValue(
    payload.transaction_reference,
    payload.transaction_id,
    payload.terminal_transaction_id,
    payload.payment_transaction_id,
    transaction?.id,
    transaction?.transaction_id,
    transaction?.transaction_reference,
    data?.transaction_id,
    data?.transaction_reference,
    data?.terminal_transaction_id
  );
  return candidate ? String(candidate) : "";
};

const normalizeItems = (items = [], amountCents = 0, currency = "EGP") => {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
      const unitAmount = Number(item.price ?? item.unit_price ?? item.sale_price ?? 0);
      const totalAmount = Number(item.total_amount ?? item.total ?? 0);
      const itemAmount = unitAmount > 0 ? unitAmount : totalAmount > 0 ? totalAmount / quantity : 0;
      return {
        name: String(item.product_name || item.name || item.description || "POS item").slice(0, 255),
        amount_cents: Math.max(0, Math.round(itemAmount * 100)) || Math.round(amountCents / Math.max(1, quantity)),
        description: String(item.variant_name || item.sku || item.barcode || item.product_name || "POS item").slice(0, 255),
        quantity,
      };
    })
    .filter((item) => item.amount_cents > 0);

  if (normalized.length) return normalized;
  return [{
    name: "POS invoice",
    amount_cents: amountCents,
    description: `POS invoice ${currency}`,
    quantity: 1,
  }];
};

export const normalizePaymobError = (error) => {
  const status = error?.status || error?.response?.status || 500;
  const payload = error?.payload || error?.response?.data || error?.data || null;
  const message =
    payload?.message ||
    payload?.detail ||
    payload?.error ||
    (Array.isArray(payload?.non_field_errors) ? payload.non_field_errors.join(", ") : "") ||
    error?.message ||
    "Paymob POS request failed";
  return {
    status,
    message,
    payload,
  };
};

export const ensurePaymentTransactionsSchema = async (clientOrPool) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
      order_id BIGINT NULL REFERENCES orders(id) ON DELETE SET NULL,
      provider VARCHAR(50) NOT NULL DEFAULT 'paymob',
      provider_order_id TEXT,
      terminal_id TEXT,
      amount_cents BIGINT NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'EGP',
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS provider_order_id TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS terminal_id TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS response_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS error_message TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS transaction_reference TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS confirmed_amount_cents BIGINT NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS confirmation_source TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS payment_transactions ADD COLUMN IF NOT EXISTS confirmed_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions (tenant_id, order_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_order ON payment_transactions (provider, provider_order_id)`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_reference ON payment_transactions (provider, transaction_reference) WHERE transaction_reference IS NOT NULL AND transaction_reference <> ''`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS payment_transaction_events (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NULL REFERENCES payment_transactions(id) ON DELETE SET NULL,
      provider VARCHAR(50) NOT NULL DEFAULT 'paymob',
      provider_event_id TEXT,
      event_type VARCHAR(80) NOT NULL DEFAULT 'payment_status',
      status VARCHAR(50),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transaction_events_provider_event ON payment_transaction_events (provider, provider_event_id) WHERE provider_event_id IS NOT NULL AND provider_event_id <> ''`);
};

export const authenticate = async () => {
  const config = paymobConfig();
  if (!config.enabled) {
    const error = new Error("Paymob POS is disabled");
    error.status = 503;
    throw error;
  }
  if (!config.apiKey) {
    const error = new Error("PAYMOB_API_KEY is not configured");
    error.status = 500;
    throw error;
  }

  console.log("[paymob-pos-auth]", { enabled: config.enabled, api_key: maskValue(config.apiKey), auth_base_url: config.authBaseUrl });
  const response = await fetch(`${config.authBaseUrl}/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: config.apiKey }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || !payload.token) {
    const error = new Error(payload?.message || "Paymob authentication failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { token: payload.token, payload };
};

export const createTerminalOrder = async ({
  tenantId,
  branchId,
  localOrderId,
  amountCents,
  currency = "EGP",
  items = [],
  terminalId,
  preferredPaymentMethod,
} = {}) => {
  const config = paymobConfig();
  const resolvedTerminalId = String(terminalId || config.terminalId || "").trim();
  const resolvedPreferredMethod = String(preferredPaymentMethod || config.preferredPaymentMethod || "card").trim();
  const cents = Number(amountCents || 0);

  if (!config.enabled) {
    const error = new Error("Paymob POS is disabled");
    error.status = 503;
    throw error;
  }
  if (!resolvedTerminalId) {
    const error = new Error("Paymob terminal ID is not configured");
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(cents) || cents <= 0) {
    const error = new Error("amountCents must be a positive integer");
    error.status = 400;
    throw error;
  }

  const auth = await authenticate();
  const merchantOrderId = `erp-${tenantId || "tenant"}-${localOrderId || "order"}-${Date.now()}`;
  const requestPayload = {
    auth_token: auth.token,
    delivery_needed: false,
    amount_cents: cents,
    currency,
    merchant_order_id: merchantOrderId,
    items: normalizeItems(items, cents, currency),
  };
  const safeRequestPayload = {
    ...requestPayload,
    auth_token: maskValue(auth.token),
  };
  const url = new URL(`${config.baseUrl}/ecommerce/orders`);
  url.searchParams.set("send_pay_notification_to_terminal_id", resolvedTerminalId);
  url.searchParams.set("preferred_payment_method", resolvedPreferredMethod);

  console.log("[paymob-pos-order]", {
    tenant_id: tenantId || null,
    branch_id: branchId || null,
    local_order_id: localOrderId || null,
    amount_cents: cents,
    currency,
    terminal_id: resolvedTerminalId,
    preferred_payment_method: resolvedPreferredMethod,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const error = new Error(payload?.message || "Paymob terminal order registration failed");
    error.status = response.status;
    error.payload = payload;
    error.requestPayload = safeRequestPayload;
    throw error;
  }
  return {
    providerOrderId: payload.id || payload.order_id || payload.order?.id || null,
    transactionReference: extractTerminalTransactionReference(payload),
    status: "sent",
    requestPayload: safeRequestPayload,
    responsePayload: payload,
    terminalId: resolvedTerminalId,
    preferredPaymentMethod: resolvedPreferredMethod,
    merchantOrderId,
  };
};

export const getOrderStatus = async ({ providerOrderId, merchantOrderId, transactionReference } = {}) => {
  const config = paymobConfig();
  if (!config.enabled) {
    const error = new Error("Paymob POS is disabled");
    error.status = 503;
    throw error;
  }

  const auth = await authenticate();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.token}`,
  };

  const statusRequest = buildPaymobStatusRequest({
    config,
    token: auth.token,
    providerOrderId,
    merchantOrderId,
    transactionReference,
  });

  if (statusRequest.valid) {
    const requestOptions = {
      method: statusRequest.method,
      headers,
    };
    console.log("[paymob-pos-status-request]", {
      method: statusRequest.method,
      url: maskSensitiveUrl(statusRequest.url.toString()),
      auth: "bearer",
      provider_order_id: providerOrderId ? String(providerOrderId) : "",
      merchant_order_id: merchantOrderId ? String(merchantOrderId) : "",
      transaction_reference: transactionReference ? String(transactionReference) : "",
    });
    const response = await fetch(statusRequest.url, requestOptions);
    const payload = await readJsonResponse(response);
    if (response.ok) return { payload, normalized: normalizePaymobPaymentPayload(payload) };
    if (response.status === 405) {
      console.warn("[paymob-pos-no-confirmation]", "status_endpoint_method_not_allowed", {
        method: statusRequest.method,
        url: maskSensitiveUrl(statusRequest.url.toString()),
        provider_order_id: providerOrderId ? String(providerOrderId) : "",
        merchant_order_id: merchantOrderId ? String(merchantOrderId) : "",
        transaction_reference: transactionReference ? String(transactionReference) : "",
      });
      return pendingStatusResult({
        ...payload,
        order_id: providerOrderId,
        merchant_order_id: merchantOrderId,
      });
    }
    const error = new Error(payload?.message || payload?.detail || "Paymob transaction status failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  console.warn("[paymob-pos-no-confirmation]", "invalid_status_endpoint", {
    method: statusRequest.method,
    endpoint: config.statusEndpoint,
    provider_order_id: providerOrderId ? String(providerOrderId) : "",
    merchant_order_id: merchantOrderId ? String(merchantOrderId) : "",
    transaction_reference: transactionReference ? String(transactionReference) : "",
  });
  return pendingStatusResult({
    order_id: providerOrderId,
    merchant_order_id: merchantOrderId,
    transaction_id: transactionReference,
  });
};
