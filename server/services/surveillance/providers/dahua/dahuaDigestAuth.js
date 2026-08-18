// HTTP Digest authentication — the scheme Dahua devices actually use.
//
// WHY NOT JUST USE A LIBRARY
// --------------------------
// Because the interesting part is not the arithmetic, it is the failure modes,
// and a library hides them. Digest is a challenge-response: the first request is
// SUPPOSED to get a 401 carrying a nonce, and the second request answers it.
// That means every device call is potentially two round trips, that a stale
// nonce must be retried exactly once (not in a loop), and that the credential
// exists in memory across both — all things this subsystem has opinions about.
//
// PURE, SO IT IS TESTABLE WITHOUT A DEVICE
// ----------------------------------------
// Nothing here opens a socket. It parses a challenge and computes a header. The
// transport does the I/O. That split is what lets the whole authentication path
// be tested against captured challenge strings.
//
// NEVER LOG A VALUE FROM THIS FILE
// --------------------------------
// The `response` field is a hash of the password with a server nonce. It is not
// the password, but it is a password-equivalent for the lifetime of the nonce,
// and it is exactly what the redaction module strips. Nothing here logs.

import crypto from "node:crypto";

const md5 = (value) => crypto.createHash("md5").update(value, "utf8").digest("hex");

const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Supported digest algorithms.
 *
 * MD5 is what Dahua firmware sends. It is a weak hash and that is not our
 * choice — the device dictates the scheme, and refusing MD5 would mean refusing
 * every Dahua recorder in existence. SHA-256 is accepted for the devices that
 * offer it, which is why the algorithm is read from the challenge rather than
 * assumed.
 *
 * This is also part of why the transport must be tunnelled rather than exposed:
 * the wire protection here is weak, so the network path has to provide it.
 */
const ALGORITHMS = Object.freeze({
  MD5: md5,
  "MD5-SESS": md5,
  "SHA-256": sha256,
  "SHA-256-SESS": sha256,
});

/**
 * Parse a WWW-Authenticate header into its fields.
 *
 * Handles quoted and unquoted values, and the comma-inside-quotes case that
 * naive splitting gets wrong — `qop="auth,auth-int"` is one field, not two.
 */
export const parseDigestChallenge = (header = "") => {
  const raw = String(header ?? "").trim();
  const match = raw.match(/^Digest\s+(.*)$/is);
  if (!match) return null;

  const fields = {};
  // key=value where value is either "quoted, possibly with commas" or bare.
  const pattern = /(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g;
  let entry;
  while ((entry = pattern.exec(match[1])) !== null) {
    const [, key, quoted, bare] = entry;
    fields[key.toLowerCase()] = quoted !== undefined ? quoted.replace(/\\(.)/g, "$1") : bare;
  }

  if (!fields.realm || !fields.nonce) return null;
  return {
    realm: fields.realm,
    nonce: fields.nonce,
    qop: fields.qop || "",
    opaque: fields.opaque || "",
    algorithm: (fields.algorithm || "MD5").toUpperCase(),
    // `stale=true` means the nonce expired but the credentials were right. It is
    // the one 401 that should be retried rather than reported as a bad password,
    // and conflating the two is how a working integration gets reported as an
    // auth failure.
    stale: String(fields.stale || "").toLowerCase() === "true",
  };
};

const clientNonce = () => crypto.randomBytes(8).toString("hex");

/**
 * Build the Authorization header for one request.
 *
 * @param {object} options
 * @param {string} options.method    HTTP method, uppercase
 * @param {string} options.uri       path + query exactly as sent on the wire
 * @param {object} options.challenge parsed challenge
 * @param {string} options.username
 * @param {string} options.password
 * @param {number} options.nc        nonce count for this nonce, 1-based
 * @param {string} options.cnonce    injectable for deterministic tests only
 */
export const buildDigestHeader = ({
  method = "GET",
  uri = "/",
  challenge,
  username,
  password,
  nc = 1,
  cnonce = clientNonce(),
} = {}) => {
  if (!challenge) throw new Error("digest challenge is required");

  const hash = ALGORITHMS[challenge.algorithm] || md5;
  const sessionAlgorithm = challenge.algorithm.endsWith("-SESS");

  let ha1 = hash(`${username}:${challenge.realm}:${password}`);
  if (sessionAlgorithm) ha1 = hash(`${ha1}:${challenge.nonce}:${cnonce}`);

  // qop=auth-int would hash the body too. Dahua uses auth (or omits qop), and
  // implementing auth-int for a case no device sends would be untested code on
  // a security path.
  const ha2 = hash(`${method.toUpperCase()}:${uri}`);

  const ncValue = String(nc).padStart(8, "0");
  const useQop = challenge.qop.split(",").map((value) => value.trim()).includes("auth");

  const response = useQop
    ? hash(`${ha1}:${challenge.nonce}:${ncValue}:${cnonce}:auth:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm !== "MD5") parts.push(`algorithm=${challenge.algorithm}`);
  if (useQop) parts.push(`qop=auth`, `nc=${ncValue}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);

  return `Digest ${parts.join(", ")}`;
};

/**
 * Basic auth, for the few older firmwares that fall back to it.
 *
 * Kept explicit and separate so that "this device is sending our password in
 * reversible base64" is a visible decision at the call site rather than an
 * invisible downgrade inside a generic auth helper.
 */
export const buildBasicHeader = ({ username, password }) =>
  `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;

/**
 * The authentication strategy for a device, decided from its own challenge.
 *
 * Returned as a small stateful object because nonce counts must increment per
 * nonce: reusing an nc value lets a replay through, and resetting it on every
 * request makes some firmwares reject the second call.
 */
export const createDigestSession = ({ username, password } = {}) => {
  let challenge = null;
  let nonceCount = 0;

  return {
    get scheme() {
      return challenge ? "digest" : "none";
    },
    get hasChallenge() {
      return Boolean(challenge);
    },
    /** Feed a 401's WWW-Authenticate header back in. */
    accept(header) {
      const parsed = parseDigestChallenge(header);
      if (!parsed) return false;
      // A new nonce restarts the count. Continuing the old count against a new
      // nonce is rejected by strict implementations.
      if (!challenge || parsed.nonce !== challenge.nonce) nonceCount = 0;
      challenge = parsed;
      return true;
    },
    /** Whether a 401 means "retry with a fresh nonce" rather than "wrong password". */
    isStale(header) {
      const parsed = parseDigestChallenge(header);
      return Boolean(parsed?.stale);
    },
    authorize(method, uri, options = {}) {
      if (!challenge) return "";
      nonceCount += 1;
      return buildDigestHeader({
        method,
        uri,
        challenge,
        username,
        password,
        nc: nonceCount,
        ...options,
      });
    },
    reset() {
      challenge = null;
      nonceCount = 0;
    },
    /** Guard against the session object being serialised into a log. */
    toJSON() {
      return { scheme: challenge ? "digest" : "none", authenticated: Boolean(challenge) };
    },
  };
};
