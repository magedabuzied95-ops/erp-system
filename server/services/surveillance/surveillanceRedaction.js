// Surveillance Center — secret redaction for logs and diagnostics.
//
// THE THREAT
// ----------
// The single most likely way a DVR password escapes this system is not a
// database dump. It is a log line. Specifically:
//
//   console.error("[surveillance] probe failed", error)
//
// where `error` is an axios/undici error whose `.config` still holds
// `auth: { username, password }` and whose `.request` holds the full URL
// `rtsp://erp_surveillance:Hunter2@192.168.1.108:554/cam/realmonitor`. Node
// prints nested objects happily, and the credential lands in journald forever.
//
// So this module does not trust callers to pick the right fields. It walks the
// whole value and rewrites anything that looks like a secret, then caps depth
// and size so a pathological object cannot become a log bomb.
//
// USAGE RULE FOR THIS SUBSYSTEM
// -----------------------------
// Nothing under server/services/surveillance/ may pass a raw error or a raw
// config object to console.*. Use `surveillanceLog()` / `surveillanceLogError()`,
// or wrap the value in `redactSurveillance()` first. A test asserts the module
// sources contain no unredacted console call.

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;

export const REDACTED = "[redacted]";

/**
 * Keys whose VALUE is always a secret regardless of content.
 *
 * Matched case-insensitively against the key with separators stripped, so
 * `password`, `Password`, `pass_word`, `devicePassword` and `PASSWORD` all hit.
 */
const SECRET_KEY_PATTERNS = [
  /pass(word|wd|phrase)?$/i,
  /^pwd$/i,
  /secret/i,
  /token/i,
  /credential/i,
  /authorization/i,
  /^auth$/i,
  /apikey/i,
  /accesskey/i,
  /privatekey/i,
  /encryptionkey/i,
  /^cookie$/i,
  /setcookie/i,
  /sessionid/i,
  /^digest$/i,
  /^nonce$/i,
  /^ticket$/i,
  /^stepuptoken$/i,
];

const normalizeKey = (key = "") => String(key).replace(/[\s_\-.]/g, "");

const isSecretKey = (key = "") => {
  const normalized = normalizeKey(key);
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
};

/**
 * Strip userinfo out of any URL-shaped string.
 *
 * Covers rtsp://, http://, https://, and the vendor-specific schemes, and does
 * not rely on the URL parser — `new URL("rtsp://...")` works but throws on the
 * malformed URLs that show up inside error messages, and we must never throw
 * from a logging path.
 *
 * `scheme://user:pass@host` → `scheme://[redacted]@host`
 */
const stripUrlCredentials = (value = "") =>
  value.replace(
    /\b([a-z][a-z0-9+.-]{1,15}:\/\/)([^/\s:@]+(?::[^/\s@]*)?)@/gi,
    (_match, scheme) => `${scheme}${REDACTED}@`,
  );

/**
 * Redact `Authorization:`-style headers that were already flattened to text,
 * plus the WWW-Authenticate/Digest `response=` field that is effectively a
 * password-equivalent hash.
 */
const stripInlineSecrets = (value = "") =>
  value
    .replace(/\b(authorization\s*[:=]\s*)(\S+)/gi, (_m, prefix) => `${prefix}${REDACTED}`)
    .replace(/\b(bearer|basic|digest)\s+[A-Za-z0-9+/=._~-]{8,}/gi, (_m, scheme) => `${scheme} ${REDACTED}`)
    .replace(/\b(response|cnonce|nonce)=("?)[A-Za-z0-9+/=._~-]{8,}\2/gi, (_m, field) => `${field}=${REDACTED}`)
    .replace(/\b(password|passwd|pwd|secret|token)\s*[:=]\s*("?)([^"&\s,}]{1,})\2/gi,
      (_m, field) => `${field}=${REDACTED}`);

/**
 * Redact an encrypted envelope down to its prefix.
 *
 * Ciphertext is not plaintext, but logging it is still pointless and it lets an
 * attacker with log access mount an offline attack or confirm a key rotation.
 * `srv:v1:iv:tag:payload` → `srv:v1:[redacted]`
 */
const stripEnvelopes = (value = "") =>
  value.replace(/\b((?:srv|tk|tkb):v\d+):[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g,
    (_m, prefix) => `${prefix}:${REDACTED}`);

export const redactString = (value = "") => {
  let out = String(value);
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[truncated]`;
  out = stripUrlCredentials(out);
  out = stripInlineSecrets(out);
  out = stripEnvelopes(out);
  return out;
};

const redactError = (error, depth) => {
  const shaped = {
    name: error.name || "Error",
    message: redactString(error.message || ""),
    code: error.code || null,
  };
  // Never include `stack` (file paths + inlined argument values on some
  // runtimes), `config`/`request`/`response` (axios: full URL + auth), or
  // `cause` chains that re-introduce all of the above.
  if (error instanceof Error && typeof error.status === "number") shaped.status = error.status;
  if (error?.details && depth < MAX_DEPTH) {
    shaped.details = redactSurveillance(error.details, depth + 1);
  }
  return shaped;
};

/**
 * Deep-redact any value for logging.
 *
 * Returns a NEW value; the input is never mutated (mutating an error object
 * mid-request would corrupt the caller's own handling of it).
 */
export const redactSurveillance = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return "[symbol]";

  if (value instanceof Error) return redactError(value, depth);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => redactSurveillance(item, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }

  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // A secret key is redacted whatever its value is — including when the
      // value is an object, which is how `auth: { username, password }` and
      // `headers: { authorization: ... }` get neutralised wholesale.
      out[key] = isSecretKey(key) ? REDACTED : redactSurveillance(item, depth + 1);
    }
    return out;
  }

  return String(value);
};

/**
 * Build the standard log context for this subsystem.
 *
 * Identity only: ids, never names that might embed a customer's address, never
 * hosts. `host` is deliberately absent — a DVR's LAN address is information
 * about the customer's network and has no place in a shared log.
 */
export const surveillanceLogContext = ({ tenantId, userId, deviceId, channelId, branchId } = {}) => ({
  tenant_id: tenantId ?? null,
  user_id: userId ?? null,
  device_id: deviceId ?? null,
  channel_id: channelId ?? null,
  branch_id: branchId ?? null,
});

export const surveillanceLog = (event = "", context = {}) => {
  console.log(`[surveillance] ${event}`, redactSurveillance(context));
};

export const surveillanceLogError = (event = "", error = null, context = {}) => {
  console.error(`[surveillance] ${event}`, {
    ...redactSurveillance(context),
    error: redactSurveillance(error),
  });
};
