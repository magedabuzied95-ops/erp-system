import crypto from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) - the variant every authenticator app supports.
// Implemented on node:crypto so no third-party code touches the shared secret.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (input) => {
  const clean = String(input || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export const totpCodeAt = (secretBase32, step) => {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
};

export const currentTotpStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);

// Returns the matched time step (so the caller can refuse a replay of the same code), or null.
// Accepts one step of clock drift either side.
export const verifyTotp = (secretBase32, code, { nowMs = Date.now(), window = 1, lastUsedStep = null } = {}) => {
  const normalized = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = currentTotpStep(nowMs);
  const expected = Buffer.from(normalized);
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= Number(lastUsedStep)) continue;
    const candidate = Buffer.from(totpCodeAt(secretBase32, step));
    if (crypto.timingSafeEqual(candidate, expected)) return step;
  }
  return null;
};

export const buildOtpauthUri = ({ secret, accountName, issuer = "M One ERP" }) => {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};
