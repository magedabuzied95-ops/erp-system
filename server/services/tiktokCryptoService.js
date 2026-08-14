// TikTok secret-at-rest encryption.
//
// KEY ISOLATION — the important property of this module
// -----------------------------------------------------
// TikTok tokens are encrypted with TIKTOK_ENCRYPTION_KEY and nothing else.
// There is deliberately NO fallback to SECRET_ENCRYPTION_KEY or JWT_SECRET.
//
// Why it matters: four services in this codebase derive their at-rest key from
// `SECRET_ENCRYPTION_KEY || JWT_SECRET` — metaIntegrationService (Facebook Page
// and Instagram tokens), metaConversionsApiService, settingsService, and
// formerly this module. Production currently has SECRET_ENCRYPTION_KEY unset,
// so every existing Meta ciphertext is bound to JWT_SECRET. Sharing that
// precedence chain meant TikTok could not be given its own key without either
// (a) riding on JWT_SECRET, or (b) introducing SECRET_ENCRYPTION_KEY, which
// would have re-keyed Meta and silently broken live Facebook/Instagram tokens.
// A dedicated variable removes that coupling entirely: Meta's key selection is
// untouched, and rotating TIKTOK_ENCRYPTION_KEY can never affect Meta.
//
// FAIL CLOSED
// -----------
// A missing or unusable TIKTOK_ENCRYPTION_KEY is a hard configuration error, not
// a reason to reach for another secret. Falling back would encrypt production
// tokens under an unintended key — recoverable only by re-authorising every
// account, and undetectable until the fallback secret is rotated.
//
// Two further deliberate differences from the Meta implementation, both tightening:
//   1. No plaintext passthrough. Meta returns the raw value when the envelope
//      prefix is absent (a legacy-data affordance). TikTok storage is new, so an
//      unenveloped value is corruption, not legacy — it throws.
//   2. No hardcoded key fallback. Meta falls back to the literal "SECRET_KEY"
//      when no env key is set, which would encrypt production tokens under a
//      public constant.

import crypto from "node:crypto";

const ENVELOPE_PREFIX = "tk:v1";
const IV_BYTES = 12;
// Short keys are rejected outright: a two-character key would be accepted by the
// SHA-256 derivation and produce a valid-looking but worthless envelope.
const MIN_KEY_LENGTH = 16;

const text = (value = "") => String(value ?? "").trim();

export class TikTokCryptoError extends Error {
  constructor(message, code = "TIKTOK_CRYPTO_ERROR") {
    super(message);
    this.name = "TikTokCryptoError";
    this.code = code;
  }
}

// The ONLY source of TikTok key material. Do not add fallbacks here — see the
// header. `tests/tiktok/tiktok-encryption.test.js` fails the build if one appears.
export const TIKTOK_ENCRYPTION_KEY_ENV = "TIKTOK_ENCRYPTION_KEY";

const rawKeyMaterial = () => text(process.env[TIKTOK_ENCRYPTION_KEY_ENV]);

export const tiktokEncryptionKeyConfigured = () => rawKeyMaterial().length >= MIN_KEY_LENGTH;

// Presence-only description for config reporting. Never returns the key itself.
export const describeTikTokEncryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) return { configured: false, reason: "missing" };
  if (material.length < MIN_KEY_LENGTH) return { configured: false, reason: "too_short" };
  return { configured: true, reason: "" };
};

const encryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) {
    throw new TikTokCryptoError(
      `${TIKTOK_ENCRYPTION_KEY_ENV} must be set before TikTok tokens can be stored`,
      "TIKTOK_ENCRYPTION_KEY_MISSING"
    );
  }
  if (material.length < MIN_KEY_LENGTH) {
    throw new TikTokCryptoError(
      `${TIKTOK_ENCRYPTION_KEY_ENV} is too short; use at least ${MIN_KEY_LENGTH} characters of high-entropy material`,
      "TIKTOK_ENCRYPTION_KEY_WEAK"
    );
  }
  return crypto.createHash("sha256").update(material).digest();
};

export const isTikTokEncryptedEnvelope = (value = "") => text(value).startsWith(`${ENVELOPE_PREFIX}:`);

export const encryptTikTokSecret = (value = "") => {
  const plain = text(value);
  if (!plain) return "";
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_PREFIX, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
};

export const decryptTikTokSecret = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (!isTikTokEncryptedEnvelope(raw)) {
    // Never fall back to returning the value: an unenveloped string here is
    // either corruption or an attempt to smuggle plaintext into the store.
    throw new TikTokCryptoError("TikTok secret is not a valid encrypted envelope", "TIKTOK_ENVELOPE_INVALID");
  }
  // The prefix "tk:v1" itself contains a colon, so the envelope splits into
  // five parts: ["tk", "v1", iv, tag, payload]. Skip the first two.
  const [, , ivRaw, tagRaw, payloadRaw] = raw.split(":");
  if (!ivRaw || !tagRaw || !payloadRaw) {
    throw new TikTokCryptoError("TikTok secret envelope is malformed", "TIKTOK_ENVELOPE_MALFORMED");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payloadRaw, "base64")), decipher.final()]).toString("utf8");
};

// Callers that must not crash on a bad envelope (status reads, health checks)
// use this. It logs identity only — never the ciphertext and never the plaintext.
export const tryDecryptTikTokSecret = (value = "", context = {}) => {
  try {
    return { value: decryptTikTokSecret(value), error: null };
  } catch (error) {
    console.error("[tiktok] token_decrypt_failed", {
      tenant_id: context.tenant_id ?? null,
      field: context.field || "",
      code: error?.code || "TIKTOK_CRYPTO_ERROR",
    });
    return { value: "", error };
  }
};
