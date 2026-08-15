// TikTok API for Business — environment configuration + validation.
//
// SEPARATE FROM tiktokConfigService.js BY DESIGN
// ---------------------------------------------
// tiktokConfigService.js configures the TikTok *for Developers* app (client_key
// / client_secret, Login Kit + Content Posting). That app is live in production
// and must not be touched.
//
// This file configures the TikTok *API for Business* app — a different portal
// (business-api.tiktok.com), a different app ("M1 Store ERP"), a different
// credential pair (app_id / app_secret), and a different authorization flow
// producing a business/advertiser-scoped token. Nothing is shared between them:
// not the env vars, not the token storage, not the encryption namespace.
//
// There is no documented path by which a Content Posting access token is valid
// against business-api.tiktok.com, so this module never reads TIKTOK_CLIENT_KEY
// or TIKTOK_CLIENT_SECRET. A test asserts that.
//
// CURRENT STATE
// -------------
// The Business developer app is PENDING review, so TIKTOK_BUSINESS_APP_ID does
// not exist yet. Everything here is therefore expected to report unconfigured,
// and every gate fails closed. That is the correct state, not a bug.

import {
  describeTikTokBusinessEncryptionKey,
  tiktokBusinessEncryptionKeyConfigured,
  tiktokBusinessEncryptionKeyIsDedicated,
} from "./tiktokBusinessCryptoService.js";

const text = (value = "") => String(value ?? "").trim();
const flag = (value, fallback = false) => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
};

// Official TikTok API for Business host. Distinct from open.tiktokapis.com,
// which is the TikTok for Developers host used by the Content Posting client.
// Overridable for tests only.
export const TIKTOK_BUSINESS_API_BASE =
  text(process.env.TIKTOK_BUSINESS_API_BASE_URL) || "https://business-api.tiktok.com";

// Version prefix used by the Business API. Kept as a constant rather than
// inlined so that a future migration to v1.4 is one edit.
export const TIKTOK_BUSINESS_API_VERSION = "v1.3";

// The permissions requested on the "M1 Store ERP" developer app, as submitted.
// Recorded here as data so the status endpoint can state exactly what was asked
// for versus what the Comments/Messaging features actually need.
export const TIKTOK_BUSINESS_REQUESTED_PERMISSIONS = Object.freeze([
  "Ad Account Management",
  "Measurement",
  "CTX Events Management",
  "TikTok Accounts",
]);

// AUDIT NOTE, surfaced deliberately rather than buried:
// none of the four permissions above is the Business Messaging grant, and
// organic comment management is not obviously covered by them either. TikTok
// treats Business Messaging as a separate application on top of an already
// approved app plus a Data Security & Privacy review. "TikTok Accounts" is the
// most likely home for organic account/video/comment reads, but that has NOT
// been confirmed against the portal and must not be assumed.
export const TIKTOK_BUSINESS_PERMISSION_GAPS = Object.freeze({
  business_messaging: "not_requested_separate_application_required",
  organic_comments: "possibly_covered_by_tiktok_accounts_unconfirmed",
});

export const tiktokBusinessEnabled = () => flag(process.env.TIKTOK_BUSINESS_ENABLED, false);
export const tiktokBusinessMessagingEnabled = () =>
  flag(process.env.TIKTOK_BUSINESS_MESSAGING_ENABLED, false);
export const tiktokBusinessCommentsEnabled = () =>
  flag(process.env.TIKTOK_BUSINESS_COMMENTS_ENABLED, false);
export const tiktokBusinessWebhookEnabled = () =>
  flag(process.env.TIKTOK_BUSINESS_WEBHOOK_ENABLED, false);

export const tiktokBusinessAppId = () => text(process.env.TIKTOK_BUSINESS_APP_ID);
export const tiktokBusinessAppSecret = () => text(process.env.TIKTOK_BUSINESS_APP_SECRET);
export const tiktokBusinessRedirectUri = () => text(process.env.TIKTOK_BUSINESS_REDIRECT_URI);

export class TikTokBusinessConfigError extends Error {
  constructor(message, code = "TIKTOK_BUSINESS_CONFIG_INVALID") {
    super(message);
    this.name = "TikTokBusinessConfigError";
    this.code = code;
    this.status = 503;
  }
}

// Reports every problem at once rather than failing on the first, so an
// operator fixes one .env in one pass.
export const validateTikTokBusinessConfig = () => {
  const problems = [];
  if (!tiktokBusinessAppId()) problems.push("TIKTOK_BUSINESS_APP_ID is not set");
  if (!tiktokBusinessAppSecret()) problems.push("TIKTOK_BUSINESS_APP_SECRET is not set");

  const redirectUri = tiktokBusinessRedirectUri();
  if (!redirectUri) {
    problems.push("TIKTOK_BUSINESS_REDIRECT_URI is not set");
  } else {
    let parsed = null;
    try {
      parsed = new URL(redirectUri);
    } catch {
      problems.push("TIKTOK_BUSINESS_REDIRECT_URI is not a valid URL");
    }
    if (parsed) {
      if (parsed.protocol !== "https:") problems.push("TIKTOK_BUSINESS_REDIRECT_URI must use https");
      if (parsed.hash) problems.push("TIKTOK_BUSINESS_REDIRECT_URI must not contain a fragment");
    }
  }

  // Reported as the exact typed code so an operator can distinguish "never set
  // it" from "set it to something too weak" without us echoing the value.
  const key = describeTikTokBusinessEncryptionKey();
  if (!key.ok) {
    problems.push(
      key.code === "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK"
        ? "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK: TIKTOK_BUSINESS_ENCRYPTION_KEY does not meet the minimum strength requirement"
        : "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING: TIKTOK_BUSINESS_ENCRYPTION_KEY is required to store TikTok Business tokens (no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET, or TIKTOK_ENCRYPTION_KEY)"
    );
  }

  return { valid: problems.length === 0, problems };
};

export const assertTikTokBusinessConfig = () => {
  const { valid, problems } = validateTikTokBusinessConfig();
  if (!valid) {
    throw new TikTokBusinessConfigError(
      `TikTok API for Business is not configured: ${problems.join("; ")}`
    );
  }
  return true;
};

// Fail-closed gate. Enabling the flag without the credentials is a
// misconfiguration and must not silently degrade into a half-working
// integration — it throws at the call site instead.
//
// Order matters. The encryption key is checked BEFORE the generic config
// validation so the caller receives the specific, actionable code
// (TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING / _WEAK) rather than a generic
// TIKTOK_BUSINESS_CONFIG_INVALID that buries it among four other problems.
//
// This is also the only reason a missing key cannot affect a disabled
// deployment: the disabled branch returns first, and no live path reaches
// encryption without passing through here.
export const assertTikTokBusinessReady = (feature = "tiktok_business") => {
  if (!tiktokBusinessEnabled()) {
    throw new TikTokBusinessConfigError(
      `TikTok API for Business is disabled (TIKTOK_BUSINESS_ENABLED is not set) — cannot use ${feature}`,
      "TIKTOK_BUSINESS_DISABLED"
    );
  }

  const key = describeTikTokBusinessEncryptionKey();
  if (!key.ok) {
    throw new TikTokBusinessConfigError(
      key.code === "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK"
        ? `TIKTOK_BUSINESS_ENCRYPTION_KEY does not meet the minimum strength requirement — cannot use ${feature}`
        : `TIKTOK_BUSINESS_ENCRYPTION_KEY is not set — cannot use ${feature}. There is no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET, or TIKTOK_ENCRYPTION_KEY by design.`,
      key.code
    );
  }

  return assertTikTokBusinessConfig();
};

// Safe to serialise into an API response: presence booleans and the redirect
// URI (public by definition — it is registered in the TikTok portal).
// Never add app_secret, tokens, or key material to this shape.
export const describeTikTokBusinessConfig = () => {
  const { valid, problems } = validateTikTokBusinessConfig();
  return {
    enabled: tiktokBusinessEnabled(),
    configured: valid,
    problems,
    app_id_present: Boolean(tiktokBusinessAppId()),
    app_secret_present: Boolean(tiktokBusinessAppSecret()),
    redirect_uri: tiktokBusinessRedirectUri(),
    api_base: TIKTOK_BUSINESS_API_BASE,
    api_version: TIKTOK_BUSINESS_API_VERSION,
    messaging_enabled: tiktokBusinessMessagingEnabled(),
    comments_enabled: tiktokBusinessCommentsEnabled(),
    webhook_enabled: tiktokBusinessWebhookEnabled(),
    encryption_key_configured: tiktokBusinessEncryptionKeyConfigured(),
    // Always true when a key is present: with no fallback, the only key this
    // integration can use is its own.
    encryption_key_dedicated: tiktokBusinessEncryptionKeyIsDedicated(),
    // "", _MISSING, or _WEAK. A code, never the key or its length.
    encryption_key_code: describeTikTokBusinessEncryptionKey().code,
    requested_permissions: [...TIKTOK_BUSINESS_REQUESTED_PERMISSIONS],
    permission_gaps: { ...TIKTOK_BUSINESS_PERMISSION_GAPS },
  };
};
