// TikTok API for Business — secret-at-rest encryption.
//
// WHY THIS IS NOT tiktokCryptoService.js
// --------------------------------------
// These are two different TikTok developer surfaces with two different sets of
// credentials:
//
//   * tiktokCryptoService.js  — envelope "tk:v1"  — TikTok for Developers
//     (Login Kit / Content Posting). Live in production today.
//   * this file               — envelope "tkb:v1" — TikTok API for Business
//     (Business App ID/Secret, Business Account authorization).
//
// The distinct envelope prefix is the enforcement mechanism, not decoration.
// decryptTikTokBusinessSecret() rejects a "tk:v1" envelope outright, and
// decryptTikTokSecret() rejects "tkb:v1" for the same reason. So even if a
// Content Posting access token were somehow written into a Business token
// column (or vice versa), it would fail closed at read time rather than being
// silently used against the wrong API. That property is covered by a test.
//
// KEY MATERIAL — DEDICATED, NO FALLBACK
// -------------------------------------
// TIKTOK_BUSINESS_ENCRYPTION_KEY is the ONLY key material this module will ever
// read. There is deliberately no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET,
// or TIKTOK_ENCRYPTION_KEY.
//
// Why no fallback: a fallback silently widens the blast radius of every other
// secret in the platform. If Business tokens were derivable from JWT_SECRET,
// then a JWT_SECRET leak would also expose TikTok Business access tokens, and
// rotating JWT_SECRET would silently invalidate every stored Business token
// with no error until the next decrypt. Sharing key material also removes the
// ability to rotate Business credentials independently, which is the whole
// point of keeping this app's secrets separate from the Content Posting app's.
//
// Domain separation is kept on top of that: the envelope prefix is mixed into
// the derived key, so even if an operator set this variable to the same string
// as another secret, the two surfaces still derive different AES keys.
//
// DORMANCY IS NOT A BOOT FAILURE
// ------------------------------
// A missing key must never take production down while the integration is off.
// Nothing in this module runs at import time, and nothing throws until someone
// actually tries to encrypt or decrypt a Business token — which cannot happen
// while TIKTOK_BUSINESS_ENABLED is false, because every live path is gated
// behind assertTikTokBusinessReady(). So: disabled => dormant and silent;
// enabled without a key => loud, typed, fail-closed.

import crypto from "node:crypto";

const ENVELOPE_PREFIX = "tkb:v1";
const IV_BYTES = 12;

// A 256-bit key rendered as hex is 64 chars; base64 is 44. 32 is the floor we
// accept for any encoding, and is well above what a typo or a placeholder
// survives. This is a minimum, not a target — generate 32 random bytes.
const MIN_KEY_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

const text = (value = "") => String(value ?? "").trim();

export class TikTokBusinessCryptoError extends Error {
  constructor(message, code = "TIKTOK_BUSINESS_CRYPTO_ERROR") {
    super(message);
    this.name = "TikTokBusinessCryptoError";
    this.code = code;
  }
}

// The single read site. Nothing else in this file touches process.env, so there
// is exactly one place a fallback could ever be reintroduced — and a test
// asserts that setting the other secrets alone leaves this unconfigured.
const rawKeyMaterial = () => text(process.env.TIKTOK_BUSINESS_ENCRYPTION_KEY);

// Placeholder-ish values that are technically long enough but are obviously not
// generated key material. Cheap to check, and catches the realistic mistake of
// copying the example line and padding it out.
const PLACEHOLDER_PATTERNS = [
  /^tiktok[-_ ]?business[-_ ]?encryption[-_ ]?key$/i,
  /^change[-_ ]?me/i,
  /^replace[-_ ]?me/i,
  /^your[-_ ]?key/i,
  /^placeholder/i,
  /^(test|dummy|example|sample|secret|password)$/i,
];

const weaknessOf = (material = "") => {
  if (material.length < MIN_KEY_LENGTH) {
    return `must be at least ${MIN_KEY_LENGTH} characters (got ${material.length})`;
  }
  // A long run of one repeated character passes a length check but has almost
  // no entropy — "aaaa…" is 64 chars and worthless.
  if (new Set(material).size < MIN_UNIQUE_CHARS) {
    return `must contain at least ${MIN_UNIQUE_CHARS} distinct characters`;
  }
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(material))) {
    return "looks like a placeholder rather than generated key material";
  }
  return "";
};

export const tiktokBusinessEncryptionKeyConfigured = () => {
  const material = rawKeyMaterial();
  return material.length > 0 && !weaknessOf(material);
};

// Retained for the status payload. With no fallback, a configured key is always
// the dedicated key — this stays true rather than becoming a lie.
export const tiktokBusinessEncryptionKeyIsDedicated = () => rawKeyMaterial().length > 0;

// Presence-only diagnosis for the status endpoint. Returns a code, never the
// key, its length, or any part of its value.
export const describeTikTokBusinessEncryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) return { ok: false, code: "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING" };
  if (weaknessOf(material)) return { ok: false, code: "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK" };
  return { ok: true, code: "" };
};

const encryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) {
    throw new TikTokBusinessCryptoError(
      "TIKTOK_BUSINESS_ENCRYPTION_KEY must be set before TikTok Business tokens can be stored. There is no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET, or TIKTOK_ENCRYPTION_KEY by design.",
      "TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING"
    );
  }
  const weakness = weaknessOf(material);
  if (weakness) {
    // The message describes the rule, never the value.
    throw new TikTokBusinessCryptoError(
      `TIKTOK_BUSINESS_ENCRYPTION_KEY is too weak: it ${weakness}.`,
      "TIKTOK_BUSINESS_ENCRYPTION_KEY_WEAK"
    );
  }
  // Domain-separating the digest with the envelope prefix means that even if
  // this variable were set to the same string as another platform secret, the
  // two surfaces still derive different AES keys.
  return crypto.createHash("sha256").update(`${ENVELOPE_PREFIX}:${material}`).digest();
};

export const isTikTokBusinessEncryptedEnvelope = (value = "") =>
  text(value).startsWith(`${ENVELOPE_PREFIX}:`);

export const encryptTikTokBusinessSecret = (value = "") => {
  const plain = text(value);
  if (!plain) return "";
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
};

export const decryptTikTokBusinessSecret = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (!isTikTokBusinessEncryptedEnvelope(raw)) {
    // A "tk:v1" value reaching here means a Content Posting token was written
    // into a Business column. Refusing is the whole point — returning it would
    // send a Login Kit token to business-api.tiktok.com.
    throw new TikTokBusinessCryptoError(
      "value is not a TikTok Business encrypted envelope (tkb:v1)",
      "TIKTOK_BUSINESS_ENVELOPE_INVALID"
    );
  }
  // "tkb:v1" itself contains a colon, so the envelope splits into five parts:
  // ["tkb", "v1", iv, tag, payload]. Skip the first two.
  const [, , ivRaw, tagRaw, payloadRaw] = raw.split(":");
  if (!ivRaw || !tagRaw || !payloadRaw) {
    throw new TikTokBusinessCryptoError(
      "TikTok Business secret envelope is malformed",
      "TIKTOK_BUSINESS_ENVELOPE_MALFORMED"
    );
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payloadRaw, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

// For status reads and health checks that must not crash on a bad envelope.
// Logs identity only — never the ciphertext, never the plaintext.
export const tryDecryptTikTokBusinessSecret = (value = "", context = {}) => {
  try {
    return { value: decryptTikTokBusinessSecret(value), error: null };
  } catch (error) {
    console.error("[tiktok-business] token_decrypt_failed", {
      tenant_id: context.tenant_id ?? null,
      field: context.field || "",
      code: error?.code || "TIKTOK_BUSINESS_CRYPTO_ERROR",
    });
    return { value: "", error };
  }
};
