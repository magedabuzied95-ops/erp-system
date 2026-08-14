// TikTok secret-at-rest encryption.
//
// Deliberately independent of metaIntegrationService.js: that file is 25k lines,
// currently dirty in the worktree, and mixing a TikTok rollout with a Meta
// refactor would widen the regression surface for no benefit. This module keeps
// the same security properties (AES-256-GCM, random 96-bit IV, authenticated
// tag, key derived from the same SECRET_ENCRYPTION_KEY) and is small enough that
// a later shared-crypto refactor is a rename, not a rewrite.
//
// Two deliberate differences from the Meta implementation, both tightening:
//   1. No plaintext passthrough. Meta returns the raw value when the envelope
//      prefix is absent (a legacy-data affordance). TikTok storage is new, so an
//      unenveloped value is corruption, not legacy — it throws.
//   2. No hardcoded key fallback. Meta falls back to the literal "SECRET_KEY"
//      when no env key is set, which would encrypt production tokens under a
//      public constant. Here a missing key is a startup-visible error.

import crypto from "node:crypto";

const ENVELOPE_PREFIX = "tk:v1";
const IV_BYTES = 12;

const text = (value = "") => String(value ?? "").trim();

export class TikTokCryptoError extends Error {
  constructor(message, code = "TIKTOK_CRYPTO_ERROR") {
    super(message);
    this.name = "TikTokCryptoError";
    this.code = code;
  }
}

const rawKeyMaterial = () => text(process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "");

export const tiktokEncryptionKeyConfigured = () => rawKeyMaterial().length > 0;

const encryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) {
    throw new TikTokCryptoError(
      "SECRET_ENCRYPTION_KEY (or JWT_SECRET) must be set before TikTok tokens can be stored",
      "TIKTOK_ENCRYPTION_KEY_MISSING"
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
