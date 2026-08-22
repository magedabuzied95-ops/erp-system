// Paymob online checkout — Intention API + Unified Checkout.
//
// Deliberately separate from paymobPosService.js. That service drives the
// in-store terminal over the legacy Accept API (auth token -> /ecommerce/orders
// -> push to a terminal id) and cannot surface Apple Pay. Apple Pay is only
// reachable through the newer Intention API, which authenticates with a secret
// key instead of an api key and returns a client secret the browser redeems on
// Paymob's hosted checkout page.
//
// The two share the webhook: Paymob posts terminal and online transactions to
// the same endpoint, and normalizePaymobPaymentPayload / verifyPaymobHmac in
// paymobPosService.js already handle both shapes.

const DEFAULT_ONLINE_BASE_URL = "https://accept.paymob.com";
const DEFAULT_STOREFRONT_URL = "https://m1store-egy.com";
const DEFAULT_API_URL = "https://api.m1store-egy.com";

const trimTrailingSlash = (value = "") => String(value || "").replace(/\/+$/, "");

const boolFromEnv = (value = "") => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const maskValue = (value = "") => {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

// Paymob rejects billing_data entries that are empty strings, but accepts the
// literal "NA". Every field below is mandatory even when we have nothing for it.
const NA = "NA";
const billingValue = (value) => firstNonEmpty(value) || NA;

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export const paymobOnlineConfig = () => {
  const storefrontUrl = trimTrailingSlash(
    firstNonEmpty(
      process.env.STOREFRONT_URL,
      process.env.PUBLIC_STOREFRONT_URL,
      process.env.VITE_PUBLIC_STOREFRONT_URL
    ) || DEFAULT_STOREFRONT_URL
  );
  const apiUrl = trimTrailingSlash(
    firstNonEmpty(process.env.PUBLIC_API_URL, process.env.PUBLIC_BACKEND_URL) || DEFAULT_API_URL
  );
  return {
    enabled: boolFromEnv(process.env.PAYMOB_ONLINE_ENABLED),
    secretKey: process.env.PAYMOB_SECRET_KEY || "",
    publicKey: process.env.PAYMOB_PUBLIC_KEY || "",
    cardIntegrationId: String(process.env.PAYMOB_CARD_INTEGRATION_ID || "").trim(),
    applePayIntegrationId: String(process.env.PAYMOB_APPLE_PAY_INTEGRATION_ID || "").trim(),
    baseUrl: trimTrailingSlash(process.env.PAYMOB_ONLINE_BASE_URL || DEFAULT_ONLINE_BASE_URL),
    storefrontUrl,
    // Paymob only calls a notification_url for card integration ids. The POS
    // webhook route already exists and verifies the same HMAC, so reuse it.
    notificationUrl: firstNonEmpty(process.env.PAYMOB_NOTIFICATION_URL) || `${apiUrl}/api/paymob/webhook`,
    currency: firstNonEmpty(process.env.PAYMOB_ONLINE_CURRENCY) || "EGP",
  };
};

// Which instruments are actually wired up. Apple Pay needs its own integration
// id from Paymob — without it the button simply never renders on the hosted
// page, silently, so treat a missing id as "not offered" rather than an error.
export const paymobOnlineIntegrationIds = (config = paymobOnlineConfig()) => {
  const ids = [];
  if (config.cardIntegrationId) ids.push(config.cardIntegrationId);
  if (config.applePayIntegrationId) ids.push(config.applePayIntegrationId);
  return ids;
};

export const isPaymobOnlineReady = (config = paymobOnlineConfig()) =>
  Boolean(config.enabled && config.secretKey && config.publicKey && paymobOnlineIntegrationIds(config).length);

// Reported to the storefront so the checkout can decide whether to render the
// online option at all, and which logos to show on it.
export const paymobOnlineAvailability = () => {
  const config = paymobOnlineConfig();
  return {
    enabled: isPaymobOnlineReady(config),
    card: Boolean(config.cardIntegrationId),
    apple_pay: Boolean(config.applePayIntegrationId),
  };
};

const requireReadyConfig = () => {
  const config = paymobOnlineConfig();
  if (!config.enabled) {
    const error = new Error("Paymob online payments are disabled");
    error.status = 503;
    throw error;
  }
  if (!config.secretKey) {
    const error = new Error("PAYMOB_SECRET_KEY is not configured");
    error.status = 500;
    throw error;
  }
  if (!config.publicKey) {
    const error = new Error("PAYMOB_PUBLIC_KEY is not configured");
    error.status = 500;
    throw error;
  }
  if (!paymobOnlineIntegrationIds(config).length) {
    const error = new Error("No Paymob online integration id is configured");
    error.status = 500;
    throw error;
  }
  return config;
};

const normalizeIntentionItems = (items = [], amountCents = 0) => {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
      const unitAmount = Number(item.price ?? item.sale_price ?? item.unit_price ?? 0);
      return {
        name: String(item.product_name || item.name || "Item").slice(0, 255),
        amount: Math.max(0, Math.round(unitAmount * 100)),
        description: String(item.variant_name || item.sku || item.product_name || "Item").slice(0, 255),
        quantity,
      };
    })
    .filter((item) => item.amount > 0);

  // Paymob validates that the item amounts sum to the intention amount. Any
  // order-level discount, coupon or delivery fee breaks that sum, so fall back
  // to a single synthetic line rather than sending a total Paymob will reject.
  const itemsTotal = normalized.reduce((sum, item) => sum + item.amount * item.quantity, 0);
  if (normalized.length && itemsTotal === amountCents) return normalized;
  return [{
    name: "Order total",
    amount: amountCents,
    description: "Website order",
    quantity: 1,
  }];
};

const buildBillingData = (billing = {}) => {
  const rawName = firstNonEmpty(billing.full_name, billing.name);
  const parts = rawName.split(/\s+/).filter(Boolean);
  return {
    first_name: billingValue(billing.first_name || parts[0]),
    last_name: billingValue(billing.last_name || parts.slice(1).join(" ")),
    email: billingValue(billing.email),
    phone_number: billingValue(billing.phone),
    street: billingValue(billing.street),
    building: billingValue(billing.building),
    floor: billingValue(billing.floor),
    apartment: billingValue(billing.apartment),
    city: billingValue(billing.city),
    state: billingValue(billing.state),
    country: billingValue(billing.country || "EG"),
    postal_code: billingValue(billing.postal_code),
    shipping_method: NA,
  };
};

/**
 * Create a Paymob payment intention and return the hosted checkout URL.
 *
 * `specialReference` must be unique per attempt — Paymob rejects a duplicate
 * with a 422, so a retry on the same order has to mint a new one.
 */
export const createPaymentIntention = async ({
  tenantId,
  orderId,
  amountCents,
  currency,
  items = [],
  billing = {},
  specialReference,
  redirectionUrl,
  notificationUrl,
} = {}) => {
  const config = requireReadyConfig();
  const cents = Number(amountCents || 0);
  if (!Number.isInteger(cents) || cents <= 0) {
    const error = new Error("amountCents must be a positive integer");
    error.status = 400;
    throw error;
  }

  const reference = firstNonEmpty(specialReference) || `erp-${tenantId || "tenant"}-${orderId || "order"}-${Date.now()}`;
  const resolvedCurrency = firstNonEmpty(currency) || config.currency;
  const requestPayload = {
    amount: cents,
    currency: resolvedCurrency,
    payment_methods: paymobOnlineIntegrationIds(config).map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
    items: normalizeIntentionItems(items, cents),
    billing_data: buildBillingData(billing),
    special_reference: reference,
    notification_url: firstNonEmpty(notificationUrl) || config.notificationUrl,
    redirection_url: firstNonEmpty(redirectionUrl) || `${config.storefrontUrl}/shop/confirm/pending`,
    extras: {
      tenant_id: tenantId ? String(tenantId) : "",
      order_id: orderId ? String(orderId) : "",
      channel: "storefront",
    },
  };

  console.log("[paymob-online-intention]", {
    tenant_id: tenantId || null,
    order_id: orderId || null,
    amount_cents: cents,
    currency: resolvedCurrency,
    special_reference: reference,
    payment_methods: requestPayload.payment_methods.length,
    apple_pay: Boolean(config.applePayIntegrationId),
  });

  const response = await fetch(`${config.baseUrl}/v1/intention/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${config.secretKey}`,
    },
    body: JSON.stringify(requestPayload),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || !payload?.client_secret) {
    const error = new Error(payload?.message || payload?.detail || "Paymob intention creation failed");
    error.status = response.status || 502;
    error.payload = payload;
    throw error;
  }

  const providerOrderId = String(
    payload?.intention_order_id ||
    payload?.payment_keys?.[0]?.order_id ||
    payload?.order?.id ||
    payload?.intention_detail?.order_id ||
    ""
  );
  // The webhook is matched primarily on provider_order_id. Paymob's intention
  // response has changed shape between doc revisions, so log the keys we got:
  // if the id lands empty the first live payment says exactly which field holds
  // it, instead of leaving an unmatchable transaction to debug blind. Matching
  // still has a fallback — special_reference comes back as merchant_order_id,
  // which findPaymobTransaction parses into the local order id.
  if (!providerOrderId) {
    console.warn("[paymob-online-intention] no provider order id in response", {
      order_id: orderId || null,
      response_keys: Object.keys(payload || {}),
      special_reference: reference,
    });
  }

  const checkoutUrl = `${config.baseUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(config.publicKey)}&clientSecret=${encodeURIComponent(payload.client_secret)}`;
  return {
    intentionId: payload.id || payload.intention_id || null,
    clientSecret: payload.client_secret,
    checkoutUrl,
    specialReference: reference,
    // The provider order id is what the webhook arrives with, so persist it on
    // the payment_transactions row or the callback can never be matched back.
    providerOrderId,
    requestPayload: { ...requestPayload, billing_data: { ...requestPayload.billing_data, email: maskValue(requestPayload.billing_data.email) } },
    responsePayload: payload,
  };
};

// Paymob reports the instrument used in source_data. Apple Pay rides on a card
// token, so the transaction still looks like a card payment except for this
// marker — without it we would record every Apple Pay sale as a plain card.
export const detectPaymobInstrument = (payload = {}) => {
  const obj = payload?.obj && typeof payload.obj === "object" ? payload.obj : payload;
  const haystack = [
    obj?.source_data?.sub_type,
    obj?.source_data?.type,
    obj?.source_data?.wallet_type,
    obj?.data?.gateway_integration_pk,
    obj?.payment_method,
    obj?.wallet_issuer,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  if (haystack.includes("apple")) return "apple_pay";
  if (haystack.includes("google")) return "google_pay";
  return "card";
};
