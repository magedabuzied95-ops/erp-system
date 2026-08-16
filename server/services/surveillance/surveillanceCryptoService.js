// Surveillance Center — device credential encryption at rest.
//
// This deliberately mirrors server/services/tiktokBusinessCryptoService.js. That
// module is in production, its properties are covered by tests, and copying a
// proven shape is worth more here than inventing a second one. The differences
// are the envelope prefix and the key variable; everything else is the same
// contract on purpose, so a reader who knows one knows both.
//
// ENVELOPE "srv:v1"
// -----------------
// AES-256-GCM. Format:  srv:v1:<iv b64>:<tag b64>:<ciphertext b64>
//
// The prefix is enforcement, not decoration. decryptSurveillanceSecret() refuses
// a "tk:v1" or "tkb:v1" envelope outright. So if a TikTok token were ever
// written into a DVR password column — or, far more likely, if a future bug
// crossed the two credential services — it fails closed at read time instead of
// being shipped to a camera as a password.
//
// KEY MATERIAL — DEDICATED, NO FALLBACK
// -------------------------------------
// SURVEILLANCE_ENCRYPTION_KEY is the only material this module reads. There is
// deliberately no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET, or any TikTok
// key.
//
// Why that matters more here than anywhere else in the platform: a DVR password
// is not a revocable API token. It is a password on a device sitting on a
// customer's LAN, very often reused, and rotating it means someone physically
// visiting a store. If DVR passwords were derivable from JWT_SECRET, then one
// JWT_SECRET leak would hand an attacker live camera access to every store —
// and rotating JWT_SECRET (a routine action) would silently make every stored
// DVR credential undecryptable with no error until the next connection attempt.
//
// Domain separation is layered on top: the envelope prefix is mixed into the
// key derivation, so even an operator who sets this variable to the same string
// as another platform secret still gets a different AES key here.
//
// DORMANCY IS NOT A BOOT FAILURE
// ------------------------------
// A missing key must never take production down while surveillance is off.
// Nothing runs at import time and nothing throws until someone actually
// encrypts or decrypts. Disabled => dormant and silent. Enabled without a key
// => loud, typed, fail-closed.

import crypto from "node:crypto";

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";

const ENVELOPE_PREFIX = "srv:v1";
const IV_BYTES = 12;

// 32 is a floor for any encoding, not a target. 32 random bytes rendered as hex
// is 64 chars; as base64 it is 44. Anything shorter is a typo or a placeholder.
const MIN_KEY_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

const text = (value = "") => String(value ?? "").trim();

export class SurveillanceCryptoError extends SurveillanceError {
  constructor(message, code = SURVEILLANCE_ERROR_CODES.ENVELOPE_INVALID) {
    super(message, { code, status: 500 });
    this.name = "SurveillanceCryptoError";
  }
}

// The single read site. Nothing else in this file touches process.env, so there
// is exactly one place a fallback could ever be reintroduced — and a test
// asserts that setting every OTHER platform secret leaves this unconfigured.
const rawKeyMaterial = () => text(process.env.SURVEILLANCE_ENCRYPTION_KEY);

const PLACEHOLDER_PATTERNS = [
  /^surveillance[-_ ]?encryption[-_ ]?key$/i,
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
  // "aaaa…" is 64 chars and worthless. Distinct-character count is a cheap
  // proxy for "did someone actually generate this".
  if (new Set(material).size < MIN_UNIQUE_CHARS) {
    return `must contain at least ${MIN_UNIQUE_CHARS} distinct characters`;
  }
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(material))) {
    return "looks like a placeholder rather than generated key material";
  }
  return "";
};

export const surveillanceEncryptionKeyConfigured = () => {
  const material = rawKeyMaterial();
  return material.length > 0 && !weaknessOf(material);
};

/**
 * Presence-only diagnosis for status endpoints and boot logs.
 * Returns a code. Never the key, never its length, never any part of its value.
 */
export const describeSurveillanceEncryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) return { ok: false, code: SURVEILLANCE_ERROR_CODES.ENCRYPTION_KEY_MISSING };
  if (weaknessOf(material)) return { ok: false, code: SURVEILLANCE_ERROR_CODES.ENCRYPTION_KEY_WEAK };
  return { ok: true, code: "" };
};

const encryptionKey = () => {
  const material = rawKeyMaterial();
  if (!material) {
    throw new SurveillanceCryptoError(
      "SURVEILLANCE_ENCRYPTION_KEY must be set before device credentials can be stored. There is no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET, or any TikTok key by design.",
      SURVEILLANCE_ERROR_CODES.ENCRYPTION_KEY_MISSING,
    );
  }
  const weakness = weaknessOf(material);
  if (weakness) {
    // The message describes the rule. It never describes the value.
    throw new SurveillanceCryptoError(
      `SURVEILLANCE_ENCRYPTION_KEY is too weak: it ${weakness}.`,
      SURVEILLANCE_ERROR_CODES.ENCRYPTION_KEY_WEAK,
    );
  }
  return crypto.createHash("sha256").update(`${ENVELOPE_PREFIX}:${material}`).digest();
};

export const isSurveillanceEncryptedEnvelope = (value = "") =>
  text(value).startsWith(`${ENVELOPE_PREFIX}:`);

export const encryptSurveillanceSecret = (value = "") => {
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

export const decryptSurveillanceSecret = (value = "") => {
  const raw = text(value);
  if (!raw) return "";

  if (!isSurveillanceEncryptedEnvelope(raw)) {
    // Reaching here means either a plaintext password was written straight into
    // the column (the bug this whole module exists to prevent), or a foreign
    // envelope crossed over. Both must fail rather than be returned.
    throw new SurveillanceCryptoError(
      "value is not a surveillance encrypted envelope (srv:v1)",
      SURVEILLANCE_ERROR_CODES.ENVELOPE_INVALID,
    );
  }

  // "srv:v1" itself contains a colon, so the envelope splits into five parts:
  // ["srv", "v1", iv, tag, payload]. Skip the first two.
  const parts = raw.split(":");
  const [, , ivRaw, tagRaw, payloadRaw] = parts;
  if (parts.length !== 5 || !ivRaw || !tagRaw || !payloadRaw) {
    throw new SurveillanceCryptoError(
      "surveillance secret envelope is malformed",
      SURVEILLANCE_ERROR_CODES.ENVELOPE_MALFORMED,
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivRaw, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payloadRaw, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    // GCM authentication failure. Someone edited the ciphertext in the database,
    // or the key changed. Either way the only safe answer is "no".
    //
    // Re-thrown as a typed error so callers cannot accidentally surface the
    // OpenSSL message, and so a key problem is never mistaken for "no password
    // configured" — which would otherwise silently downgrade to an anonymous
    // connection attempt.
    if (error instanceof SurveillanceCryptoError) throw error;
    throw new SurveillanceCryptoError(
      "surveillance secret failed authentication; the ciphertext or the key changed",
      SURVEILLANCE_ERROR_CODES.ENVELOPE_TAMPERED,
    );
  }
};

/**
 * For status reads and health checks that must not crash on a bad envelope.
 * Logs identity only — never the ciphertext, never the plaintext.
 */
export const tryDecryptSurveillanceSecret = (value = "", context = {}) => {
  try {
    return { value: decryptSurveillanceSecret(value), error: null };
  } catch (error) {
    console.error("[surveillance] credential_decrypt_failed", {
      tenant_id: context.tenantId ?? null,
      device_id: context.deviceId ?? null,
      field: context.field || "",
      code: error?.code || SURVEILLANCE_ERROR_CODES.ENVELOPE_INVALID,
    });
    return { value: "", error };
  }
};
