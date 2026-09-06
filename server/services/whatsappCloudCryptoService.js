// WhatsApp Cloud API — access-token-at-rest encryption.
//
// The token this protects is a permanent business token: it can send messages as the shop, read
// the WABA, and manage phone numbers. It is the single most dangerous string in the database, and
// unlike the Evolution API key it cannot simply be rotated by re-scanning a QR.
//
// KEY MATERIAL — DEDICATED, NO FALLBACK
// -------------------------------------
// WHATSAPP_CLOUD_ENCRYPTION_KEY is the ONLY key material this module will ever read. There is
// deliberately no fallback to SECRET_ENCRYPTION_KEY, JWT_SECRET or META_APP_SECRET, for the same
// reason tiktokBusinessCryptoService.js has none: a fallback widens the blast radius of every
// other secret in the platform. A JWT_SECRET leak would otherwise also expose the WhatsApp token,
// and rotating JWT_SECRET would silently invalidate it with no error until the next decrypt.
//
// The envelope prefix is mixed into the derived key, so even if an operator sets this variable to
// the same string as another secret, the two surfaces still derive different AES keys. And
// decrypt rejects any envelope that is not ours, so a TikTok token written into this column fails
// closed at read time rather than being used against the wrong API.
//
// DORMANCY IS NOT A BOOT FAILURE
// ------------------------------
// Nothing here runs at import time and nothing throws until someone actually encrypts or decrypts
// a token — which cannot happen before an operator connects WhatsApp. So a server with no key set
// boots and serves normally; only the connect flow refuses, and it refuses with a typed code
// saying exactly which variable is missing.

import crypto from "node:crypto";

const ENVELOPE_PREFIX = "wac:v1";
const IV_BYTES = 12;

// A 256-bit key is 64 hex chars or 44 base64. 32 is the floor for any encoding — a minimum, not
// a target. Generate 32 random bytes.
const MIN_KEY_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

const PLACEHOLDER_PATTERNS = [
  /^changeme/i,
  /^replace/i,
  /^your[-_]?key/i,
  /^secret$/i,
  /^password/i,
  /^test/i,
  /^(.)\1+$/,
];

const text = (value = "") => String(value ?? "").trim();

export class WhatsappCloudCryptoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "WhatsappCloudCryptoError";
    this.code = code;
  }
}

const rawKeyMaterial = () => text(process.env.WHATSAPP_CLOUD_ENCRYPTION_KEY);

export const whatsappCloudEncryptionKeyConfigured = () => rawKeyMaterial().length > 0;

/*
 * Diagnostics return a CODE, never the key and never its length — a length is enough to narrow a
 * brute force, and these codes travel to an admin UI.
 */
export const describeWhatsappCloudEncryptionKey = () => {
  const key = rawKeyMaterial();
  if (!key) return { ok: false, code: "WHATSAPP_CLOUD_ENCRYPTION_KEY_MISSING" };
  if (key.length < MIN_KEY_LENGTH) return { ok: false, code: "WHATSAPP_CLOUD_ENCRYPTION_KEY_WEAK" };
  if (new Set(key).size < MIN_UNIQUE_CHARS) return { ok: false, code: "WHATSAPP_CLOUD_ENCRYPTION_KEY_WEAK" };
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(key))) {
    return { ok: false, code: "WHATSAPP_CLOUD_ENCRYPTION_KEY_WEAK" };
  }
  return { ok: true, code: "" };
};

const derivedKey = () => {
  const described = describeWhatsappCloudEncryptionKey();
  if (!described.ok) throw new WhatsappCloudCryptoError(described.code, `WhatsApp Cloud encryption key: ${described.code}`);
  // The prefix is the domain separator: the same env value used elsewhere still yields a
  // different AES key here.
  return crypto.createHash("sha256").update(`${ENVELOPE_PREFIX}:${rawKeyMaterial()}`).digest();
};

export const isWhatsappCloudEncryptedEnvelope = (value = "") => text(value).startsWith(`${ENVELOPE_PREFIX}:`);

export const encryptWhatsappCloudSecret = (value = "") => {
  const plain = String(value ?? "");
  if (!plain) return "";
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_PREFIX, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
};

export const decryptWhatsappCloudSecret = (value = "") => {
  const envelope = text(value);
  if (!envelope) return "";
  if (!isWhatsappCloudEncryptedEnvelope(envelope)) {
    // Fail closed rather than returning a value that was never ours to read.
    throw new WhatsappCloudCryptoError("WHATSAPP_CLOUD_ENVELOPE_INVALID", "Not a WhatsApp Cloud encrypted envelope");
  }
  const parts = envelope.split(":");
  if (parts.length !== 5) throw new WhatsappCloudCryptoError("WHATSAPP_CLOUD_ENVELOPE_INVALID", "Malformed encrypted envelope");
  const [, , ivPart, tagPart, dataPart] = [parts[0], parts[1], parts[2], parts[3], parts[4]];
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof WhatsappCloudCryptoError) throw error;
    throw new WhatsappCloudCryptoError("WHATSAPP_CLOUD_DECRYPT_FAILED", "Stored WhatsApp Cloud token could not be decrypted");
  }
};

export const tryDecryptWhatsappCloudSecret = (value = "", context = {}) => {
  try {
    return decryptWhatsappCloudSecret(value);
  } catch (error) {
    console.warn("[whatsapp-cloud:decrypt-failed]", { code: error?.code || "", ...context });
    return "";
  }
};

/*
 * The only representation of a token that may ever be logged or returned to a UI. Never the token,
 * never a prefix long enough to be useful — just enough to tell two tokens apart in a log.
 */
export const maskAccessToken = (value = "") => {
  const token = text(value);
  if (!token) return "";
  return `••••${token.slice(-4)}`;
};

export default {
  whatsappCloudEncryptionKeyConfigured,
  describeWhatsappCloudEncryptionKey,
  isWhatsappCloudEncryptedEnvelope,
  encryptWhatsappCloudSecret,
  decryptWhatsappCloudSecret,
  tryDecryptWhatsappCloudSecret,
  maskAccessToken,
  WhatsappCloudCryptoError,
};
