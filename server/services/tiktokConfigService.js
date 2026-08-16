// TikTok environment configuration + validation.
//
// Every TikTok credential is read from the environment and never from the
// database, source, or the frontend. Nothing in this module returns the client
// secret to a caller outside the OAuth/webhook services; `describeTikTokConfig`
// is the only shape that may reach an API response and it is presence-only.

import { TIKTOK_ENCRYPTION_KEY_ENV, describeTikTokEncryptionKey } from "./tiktokCryptoService.js";

const text = (value = "") => String(value ?? "").trim();
const flag = (value, fallback = false) => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
};

// Official TikTok hosts. Authorization is on www.tiktok.com; every API call is
// on open.tiktokapis.com. Overridable only for tests/sandbox, never in prod code.
export const TIKTOK_AUTH_BASE = text(process.env.TIKTOK_AUTH_BASE_URL) || "https://www.tiktok.com";
export const TIKTOK_API_BASE = text(process.env.TIKTOK_API_BASE_URL) || "https://open.tiktokapis.com";

// Literal TikTok scope names. `video.upload` = share to draft/inbox for the user
// to finish in the TikTok app; `video.publish` = Direct Post. They are different
// products and are requested together only because the ERP offers both flows.
export const TIKTOK_SCOPES = Object.freeze({
  USER_INFO_BASIC: "user.info.basic",
  VIDEO_UPLOAD: "video.upload",
  VIDEO_PUBLISH: "video.publish",
});

export const TIKTOK_DEFAULT_SCOPES = Object.freeze([
  TIKTOK_SCOPES.USER_INFO_BASIC,
  TIKTOK_SCOPES.VIDEO_UPLOAD,
  TIKTOK_SCOPES.VIDEO_PUBLISH,
]);

export const tiktokEnabled = () => flag(process.env.TIKTOK_ENABLED, false);
export const tiktokWebhookEnabled = () => flag(process.env.TIKTOK_WEBHOOK_ENABLED, false);
export const tiktokClientKey = () => text(process.env.TIKTOK_CLIENT_KEY);
export const tiktokClientSecret = () => text(process.env.TIKTOK_CLIENT_SECRET);
export const tiktokRedirectUri = () => text(process.env.TIKTOK_REDIRECT_URI);

export const tiktokIntakePollIntervalMs = () =>
  Math.max(1_000, Number(process.env.TIKTOK_INTAKE_POLL_INTERVAL_MS || 10_000));

// Where the browser is sent after the OAuth callback.
//
// This must be the ERP app, NOT the storefront. PUBLIC_APP_URL, FRONTEND_URL,
// PUBLIC_STOREFRONT_URL and STORE_FRONT_URL all point at the public shop; the
// ERP lives on a different host and has no canonical variable of its own today.
// Using the storefront URL sent the user to <shop>/admin/ai-channels, which is
// not an ERP route at all.
//
// Resolution order:
//   1. An explicit ERP URL variable, if a deployment ever defines one.
//   2. The ERP entry in CORS_ALLOWED_ORIGINS — the one place the ERP host is
//      already declared, so this needs no new configuration.
//   3. PUBLIC_APP_URL as a last resort, so a misconfigured deployment still
//      lands somewhere rather than nowhere.
const ERP_HOST_HINT = /^erp\./i;

export const tiktokAppOrigin = () => {
  const explicit = text(process.env.PUBLIC_ERP_URL || process.env.ERP_APP_URL);
  if (explicit) return explicit.replace(/\/+$/g, "");

  for (const entry of text(process.env.CORS_ALLOWED_ORIGINS).split(",").map((item) => text(item)).filter(Boolean)) {
    try {
      const parsed = new URL(entry);
      if (ERP_HOST_HINT.test(parsed.hostname)) return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // Ignore malformed allowlist entries rather than failing the callback.
    }
  }

  return text(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL).replace(/\/+$/g, "");
};

// The SPA route the TikTok card lives on, registered in src/App.jsx.
//
// The card moved out of the old /admin/ai-channels page and into the AI Inbox
// integrations center; `?integrations=tiktok` is what opens that center on the
// TikTok tab, so the merchant lands on the connection they just approved.
export const TIKTOK_CHANNEL_SETTINGS_PATH = "/admin/ai-inbox";
export const TIKTOK_CHANNEL_SETTINGS_QUERY = { integrations: "tiktok" };

export const tiktokRequestedScopes = () => {
  const configured = text(process.env.TIKTOK_SCOPES);
  if (!configured) return [...TIKTOK_DEFAULT_SCOPES];
  const known = new Set(Object.values(TIKTOK_SCOPES));
  // Silently dropping an unknown scope is safer than sending it: TikTok rejects
  // the whole authorization request if any scope is not approved for the app.
  return configured
    .split(/[,\s]+/)
    .map((item) => text(item))
    .filter((item) => known.has(item));
};

export class TikTokConfigError extends Error {
  constructor(message, code = "TIKTOK_CONFIG_INVALID") {
    super(message);
    this.name = "TikTokConfigError";
    this.code = code;
    this.status = 503;
  }
}

// Returns every problem at once rather than failing on the first, so the
// operator fixes one .env in one pass instead of playing whack-a-mole.
export const validateTikTokConfig = () => {
  const problems = [];
  if (!tiktokClientKey()) problems.push("TIKTOK_CLIENT_KEY is not set");
  if (!tiktokClientSecret()) problems.push("TIKTOK_CLIENT_SECRET is not set");

  const redirectUri = tiktokRedirectUri();
  if (!redirectUri) {
    problems.push("TIKTOK_REDIRECT_URI is not set");
  } else {
    let parsed = null;
    try {
      parsed = new URL(redirectUri);
    } catch {
      problems.push("TIKTOK_REDIRECT_URI is not a valid URL");
    }
    if (parsed) {
      // TikTok requires the registered redirect URI to be HTTPS and static:
      // a query string or fragment makes the callback fail at TikTok's end,
      // long before our code runs, with an opaque error.
      if (parsed.protocol !== "https:") problems.push("TIKTOK_REDIRECT_URI must use https");
      if (parsed.search) problems.push("TIKTOK_REDIRECT_URI must not contain a query string");
      if (parsed.hash) problems.push("TIKTOK_REDIRECT_URI must not contain a fragment");
    }
  }

  if (!tiktokRequestedScopes().length) problems.push("TIKTOK_SCOPES resolved to an empty scope list");
  // Fail closed: TikTok has its own key and never borrows another secret, so a
  // missing or weak key is a hard configuration error rather than a silent
  // downgrade onto JWT_SECRET.
  const encryptionKeyState = describeTikTokEncryptionKey();
  if (!encryptionKeyState.configured) {
    problems.push(
      encryptionKeyState.reason === "too_short"
        ? `${TIKTOK_ENCRYPTION_KEY_ENV} is set but too short to be usable key material`
        : `${TIKTOK_ENCRYPTION_KEY_ENV} is required to store TikTok tokens (no fallback to SECRET_ENCRYPTION_KEY or JWT_SECRET)`
    );
  }

  return { valid: problems.length === 0, problems };
};

export const assertTikTokConfig = () => {
  const { valid, problems } = validateTikTokConfig();
  if (!valid) throw new TikTokConfigError(`TikTok is not configured: ${problems.join("; ")}`);
  return true;
};

// Safe to serialise into an API response: presence booleans and the redirect URI
// (which is public by definition — it is registered in the TikTok portal).
// Never add client_secret, tokens, or the encryption key to this shape.
export const describeTikTokConfig = () => {
  const { valid, problems } = validateTikTokConfig();
  return {
    enabled: tiktokEnabled(),
    webhook_enabled: tiktokWebhookEnabled(),
    configured: valid,
    problems,
    client_key_present: Boolean(tiktokClientKey()),
    encryption_key_present: describeTikTokEncryptionKey().configured,
    client_secret_present: Boolean(tiktokClientSecret()),
    redirect_uri: tiktokRedirectUri(),
    requested_scopes: tiktokRequestedScopes(),
  };
};
