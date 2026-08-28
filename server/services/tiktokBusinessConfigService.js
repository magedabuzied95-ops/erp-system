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
// The "M1 Store ERP" Business app was APPROVED on 2026-08-28 with the TikTok
// Accounts > Account Comment permissions (Get Account Comment, Manage Account
// Comment). Approval alone changes nothing at runtime: this module still fails
// closed until TIKTOK_BUSINESS_APP_ID/SECRET/REDIRECT_URI and a dedicated
// encryption key are actually present in the environment, and until a TikTok
// account holder completes the authorization flow.
//
// The portal grant is NOT the authority for what the app can do. The authority
// is the `scope` string TikTok returns from /tt_user/token_info/get/ for the
// live token — see tiktokBusinessCapabilityService.js.

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

// The permissions approved on the "M1 Store ERP" developer app, verified in the
// portal on 2026-08-28 under TikTok Accounts > Account Comment.
export const TIKTOK_BUSINESS_REQUESTED_PERMISSIONS = Object.freeze([
  "Ad Account Management",
  "Measurement",
  "CTX Events Management",
  "TikTok Accounts",
  "TikTok Accounts > Get Account Comment",
  "TikTok Accounts > Manage Account Comment",
]);

// Literal TikTok scope names, as they appear in the `scope` string returned by
// /tt_user/oauth2/token/ and /tt_user/token_info/get/. These are the values the
// capability service matches on — a typo here silently disables a feature that
// is actually granted, so they are named constants rather than inline literals.
export const TIKTOK_BUSINESS_SCOPES = Object.freeze({
  // "Get Account Comment" — read comments and replies on owned content.
  COMMENT_LIST: "comment.list",
  // "Manage Account Comment" — reply to / manage comments on owned content.
  COMMENT_MANAGE: "comment.list.manage",
  // Needed to enumerate the videos whose comments we then read.
  VIDEO_LIST: "video.list",
  USER_INFO_BASIC: "user.info.basic",
  USER_INFO_USERNAME: "user.info.username",
});

// Business Messaging scopes. Listed ONLY so the capability service can assert
// they are absent and keep messaging closed. Nothing in this integration may
// request, enable, or act on them — messaging is a separate application plus a
// Data Security & Privacy review, and is deliberately out of scope.
export const TIKTOK_BUSINESS_MESSAGING_SCOPES = Object.freeze([
  "message.list.read",
  "message.list.send",
  "message.list.manage",
]);

// Scopes the Comments feature needs, split by capability so the UI can say
// "read works, reply does not" rather than a blanket failure.
export const TIKTOK_BUSINESS_COMMENT_READ_SCOPES = Object.freeze([TIKTOK_BUSINESS_SCOPES.COMMENT_LIST]);
export const TIKTOK_BUSINESS_COMMENT_REPLY_SCOPES = Object.freeze([TIKTOK_BUSINESS_SCOPES.COMMENT_MANAGE]);

export const TIKTOK_BUSINESS_PERMISSION_GAPS = Object.freeze({
  business_messaging: "not_requested_separate_application_required",
  organic_comments: "approved_2026_08_28_account_comment_get_and_manage",
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

// The "TikTok account holder authorization URL", copied verbatim from the
// developer portal. It already encodes the app's client_key and its approved
// scope list, which is exactly why we do not rebuild it from parts: TikTok
// rejects the entire authorization request if any scope parameter is wrong, and
// the scope parameter's name/format is not something to guess.
export const tiktokBusinessAuthorizeUrl = () => text(process.env.TIKTOK_BUSINESS_AUTHORIZE_URL);

// TikTok's documented formatting rules for a TikTok-account-holder redirect URL.
// Violating any of these is rejected at registration time in the portal, so the
// same rules are checked here — a mismatch between what we send as redirect_uri
// and what is registered fails the token exchange with an opaque error.
export const validateTikTokBusinessRedirectUri = (value = "") => {
  const problems = [];
  const raw = text(value);
  if (!raw) return { valid: false, problems: ["TIKTOK_BUSINESS_REDIRECT_URI is not set"] };

  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, problems: ["TIKTOK_BUSINESS_REDIRECT_URI is not a valid URL"] };
  }

  if (parsed.protocol !== "https:") problems.push("TIKTOK_BUSINESS_REDIRECT_URI must use https");
  if (parsed.port) problems.push("TIKTOK_BUSINESS_REDIRECT_URI must not include a port");
  if (parsed.hash) problems.push("TIKTOK_BUSINESS_REDIRECT_URI must not contain a fragment");
  if (parsed.search) problems.push("TIKTOK_BUSINESS_REDIRECT_URI must not contain query parameters");
  // Documented rule: the registered URL has to end with a forward slash. Our
  // Express route accepts both forms, but the value we SEND must match the
  // registration byte-for-byte.
  if (!parsed.pathname.endsWith("/")) problems.push("TIKTOK_BUSINESS_REDIRECT_URI must end with a trailing slash");
  if (raw.length < 10 || raw.length > 512) problems.push("TIKTOK_BUSINESS_REDIRECT_URI must be 10-512 characters");

  return { valid: problems.length === 0, problems };
};

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

  problems.push(...validateTikTokBusinessRedirectUri(tiktokBusinessRedirectUri()).problems);

  const authorizeUrl = tiktokBusinessAuthorizeUrl();
  if (!authorizeUrl) {
    problems.push("TIKTOK_BUSINESS_AUTHORIZE_URL is not set (copy it from My Apps > App Detail > Basic Information)");
  } else {
    try {
      const parsedAuthorize = new URL(authorizeUrl);
      if (parsedAuthorize.protocol !== "https:") problems.push("TIKTOK_BUSINESS_AUTHORIZE_URL must use https");
    } catch {
      problems.push("TIKTOK_BUSINESS_AUTHORIZE_URL is not a valid URL");
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
    // Public by definition — both are registered in the TikTok portal. The
    // authorize URL is reported as a presence flag only: it embeds the app's
    // client_key, which is not a secret but is not useful to a browser either.
    redirect_uri: tiktokBusinessRedirectUri(),
    authorize_url_present: Boolean(tiktokBusinessAuthorizeUrl()),
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
