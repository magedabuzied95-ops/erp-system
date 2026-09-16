import crypto from "node:crypto";

// AES-256-GCM for TOTP secrets at rest in users.mfa_secret_encrypted.
// Key: MFA_ENCRYPTION_KEY, else SECRET_ENCRYPTION_KEY, else JWT_SECRET - always passed through
// HKDF with an MFA-only label, so the raw key used here never equals a key used elsewhere.
// Rotating the source key makes existing enrolments unreadable (users re-enrol), so set
// MFA_ENCRYPTION_KEY once and keep it.

const PREFIX = "mfa1:";

const keySource = () => String(process.env.MFA_ENCRYPTION_KEY || process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "");

const deriveKey = () => {
  const source = keySource();
  if (source.length < 16) throw new Error("MFA encryption key is not configured");
  return Buffer.from(crypto.hkdfSync("sha256", source, "m1-erp", "staff-mfa-totp-secret-v1", 32));
};

export const sealMfaSecret = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
};

// Throws on tampering or a wrong key - callers treat that as "cannot verify", never as success.
export const openMfaSecret = (sealed) => {
  const value = String(sealed || "");
  if (!value.startsWith(PREFIX)) throw new Error("unsupported MFA secret format");
  const [iv, tag, data] = value.slice(PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

// Recovery codes are stored as SHA-256 hashes; each is 10 random base32 chars (50 bits), single-use.
export const hashRecoveryCode = (code) =>
  crypto.createHash("sha256").update(String(code || "").toUpperCase().replace(/[^A-Z2-7]/g, "")).digest("hex");

export const generateRecoveryCodes = (count = 10) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ234567".replace(/[^A-Z2-7]/g, "");
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(10);
    const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
};
