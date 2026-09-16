// Amazon SP-API configuration. Credentials live ONLY in the process environment
// (/opt/erp/backend/.env) and never leave this module except to the LWA token call.
// Nothing here returns a credential value to callers - only booleans.

const text = (value = "") => String(value ?? "").trim();
const flag = (value, fallback = false) => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

export const AMAZON_DEFAULTS = Object.freeze({
  endpoint: "https://sellingpartnerapi-eu.amazon.com",
  region: "eu-west-1",
  lwaTokenUrl: "https://api.amazon.com/auth/o2/token",
  marketplaceId: "ARBP9OOSHTCHU",
  marketplaceName: "Amazon.eg",
  countryCode: "EG",
  currencyCode: "EGP",
  storefrontDomain: "www.amazon.eg",
});

const httpsOnly = (value, fallback) => {
  const candidate = text(value) || fallback;
  if (!/^https:\/\//i.test(candidate)) {
    throw new Error("Amazon endpoints must use HTTPS");
  }
  return candidate.replace(/\/+$/, "");
};

export const amazonEndpoint = () => httpsOnly(process.env.AMAZON_SPAPI_ENDPOINT, AMAZON_DEFAULTS.endpoint);
export const amazonLwaTokenUrl = () => httpsOnly(process.env.AMAZON_SPAPI_LWA_TOKEN_URL, AMAZON_DEFAULTS.lwaTokenUrl);
export const amazonMarketplaceId = () => text(process.env.AMAZON_SPAPI_MARKETPLACE_ID) || AMAZON_DEFAULTS.marketplaceId;
export const amazonSellerIdFromEnv = () => text(process.env.AMAZON_SPAPI_SELLER_ID);
export const amazonTenantId = () => Number(process.env.AMAZON_SPAPI_TENANT_ID || 1) || 1;

// Read by the LWA client only.
export const readAmazonCredentials = () => ({
  refreshToken: text(process.env.AMAZON_SPAPI_REFRESH_TOKEN),
  clientId: text(process.env.AMAZON_SPAPI_LWA_CLIENT_ID),
  clientSecret: text(process.env.AMAZON_SPAPI_LWA_CLIENT_SECRET),
});

export const amazonCredentialPresence = () => {
  const credentials = readAmazonCredentials();
  return {
    refresh_token: Boolean(credentials.refreshToken),
    client_id: Boolean(credentials.clientId),
    client_secret: Boolean(credentials.clientSecret),
  };
};

export const isAmazonConfigured = () => Object.values(amazonCredentialPresence()).every(Boolean);

// Feature flags. All default OFF; env-only so nobody can flip them from the UI.
export const amazonFlags = () => ({
  // Scheduled (automatic) order synchronization. Manual sync works regardless.
  orderAutoSync: flag(process.env.AMAZON_ORDER_AUTO_SYNC_ENABLED, false),
  orderAutoSyncMinutes: Math.min(Math.max(Number(process.env.AMAZON_ORDER_AUTO_SYNC_MINUTES || 15) || 15, 10), 180),
  // Copying Amazon orders into the M1 `orders` table (never touches stock).
  orderProjection: flag(process.env.AMAZON_ORDER_PROJECTION_ENABLED, false),
  // ANY write to Amazon (inventory, price, listings). Must stay false until the owner approves.
  writeSync: flag(process.env.AMAZON_WRITE_SYNC_ENABLED, false),
});

export const amazonInitialBackfillDays = () =>
  Math.min(Math.max(Number(process.env.AMAZON_ORDER_BACKFILL_DAYS || 30) || 30, 1), 730);

export const amazonUserAgent = () => "M1ERP/1.0 (Language=JavaScript; Platform=Node.js)";

export const amazonProductUrl = (asin = "") => {
  const clean = text(asin).toUpperCase();
  return /^[A-Z0-9]{10}$/.test(clean) ? `https://${AMAZON_DEFAULTS.storefrontDomain}/dp/${clean}` : null;
};
