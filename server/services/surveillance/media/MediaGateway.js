// Surveillance Center — the media gateway abstraction.
//
// THE PROBLEM
// -----------
// Browsers cannot play RTSP. Something must sit between the recorder and the
// tab and re-package the stream. That something is the most security-sensitive
// component in the feature, because the naive version of it — hand the browser
// an RTSP URL, or proxy with the credentials in the query string — puts a DVR
// password into the browser, into the address bar, into browser history, into
// the CDN's access logs, and into every screenshot the user ever takes.
//
// THE CONTRACT THIS CLASS ENFORCES
// --------------------------------
//   1. The credentialed source URL is created server-side, handed to the
//      gateway server-side, and never returned from any API.
//   2. The browser receives a play URL that contains no credential and no
//      device address, plus a TICKET.
//   3. The ticket is short-lived, single-purpose, and bound to the exact
//      (tenant, user, channel, stream) tuple it was minted for. Replaying it
//      for a different channel fails. Sharing it with another user fails.
//      Keeping it fails after `ttlSeconds`.
//
// Ticket minting and verification are implemented HERE rather than in each
// gateway, because they are the security boundary and there must be exactly one
// of them. A gateway subclass decides how to talk to its media server; it does
// not get to decide what counts as an authorised viewer.
//
// KEY MATERIAL
// ------------
// Tickets are HMACed with a key derived from SURVEILLANCE_ENCRYPTION_KEY under
// a distinct domain-separation label. Reusing the surveillance key here is
// deliberate and is not the fallback pattern the crypto module forbids: a
// ticket and a device credential belong to the same trust domain and rotate
// together, and the label means the HMAC key and the AES key are different
// values derived from the same secret. What matters — and what the crypto
// module protects — is that this domain never borrows JWT_SECRET, whose
// rotation is routine and whose blast radius is the whole platform.

import crypto from "node:crypto";

import { NotImplementedError, SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

const TICKET_LABEL = "srv:ticket:v1";
const DEFAULT_TTL_SECONDS = 60;

const ticketKey = () => {
  const material = String(process.env.SURVEILLANCE_ENCRYPTION_KEY || "").trim();
  if (!material) {
    throw new SurveillanceError("SURVEILLANCE_ENCRYPTION_KEY must be set before stream tickets can be issued", {
      code: SURVEILLANCE_ERROR_CODES.ENCRYPTION_KEY_MISSING,
      status: 500,
    });
  }
  return crypto.createHash("sha256").update(`${TICKET_LABEL}:${material}`).digest();
};

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

/**
 * The claims a ticket carries.
 *
 * Every field is part of the signature, so none of them can be edited after
 * minting. `jti` exists so a gateway that wants single-use semantics can record
 * spent ids; the base class does not keep that state because it would not
 * survive a restart or a second backend process — enforcing single use is the
 * gateway's job, and expiry is the guarantee this class actually makes.
 */
export const buildTicketClaims = ({ tenantId, userId, deviceId, channelId, stream, ttlSeconds }) => {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(ttlSeconds) > 0 ? Number(ttlSeconds) : DEFAULT_TTL_SECONDS;
  return {
    v: 1,
    t: Number(tenantId),
    u: Number(userId),
    d: Number(deviceId),
    c: Number(channelId),
    s: String(stream || "sub"),
    iat: now,
    exp: now + ttl,
    jti: crypto.randomBytes(9).toString("base64url"),
  };
};

export const signTicket = (claims) => {
  const payload = b64url(JSON.stringify(claims));
  const signature = b64url(crypto.createHmac("sha256", ticketKey()).update(payload).digest());
  return `${payload}.${signature}`;
};

/**
 * Verify a ticket and return its claims.
 *
 * `expected` is compared field by field. A caller that omits a field is not
 * checking it — so the media-auth endpoint must pass every field it knows,
 * and the tests assert that a ticket minted for one channel fails for another.
 */
export const verifyTicket = (ticket, expected = {}) => {
  const raw = String(ticket || "");
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) {
    throw new SurveillanceError("malformed stream ticket", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  const expectedSignature = b64url(crypto.createHmac("sha256", ticketKey()).update(payload).digest());
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expectedSignature);
  // Length check first: timingSafeEqual throws on a length mismatch, and an
  // exception thrown from the comparison is itself a (crude) oracle.
  if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
    throw new SurveillanceError("stream ticket signature is invalid", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new SurveillanceError("malformed stream ticket", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  if (Math.floor(Date.now() / 1000) >= Number(claims.exp)) {
    throw new SurveillanceError("stream ticket expired", {
      code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
      status: 403,
    });
  }

  const bindings = [
    ["t", expected.tenantId],
    ["u", expected.userId],
    ["d", expected.deviceId],
    ["c", expected.channelId],
    ["s", expected.stream],
  ];
  for (const [field, value] of bindings) {
    if (value === undefined || value === null) continue;
    const claimed = field === "s" ? String(claims[field]) : Number(claims[field]);
    const wanted = field === "s" ? String(value) : Number(value);
    if (claimed !== wanted) {
      throw new SurveillanceError("stream ticket does not match this stream", {
        code: SURVEILLANCE_ERROR_CODES.PERMISSION_DENIED,
        status: 403,
      });
    }
  }

  return claims;
};

export class MediaGateway {
  static gatewayKey = "";
  static displayName = "";

  constructor({ config = {} } = {}) {
    if (new.target === MediaGateway) {
      throw new NotImplementedError("MediaGateway is abstract");
    }
    this.config = config;
  }

  get gatewayKey() {
    return this.constructor.gatewayKey;
  }

  /**
   * A stable, non-guessable path name for one channel+stream.
   *
   * Deliberately not "device 4 channel 2": path names appear in the media
   * server's own logs and metrics, and an id-shaped name is enumerable by
   * anyone who reaches the gateway. The HMAC makes the namespace opaque while
   * staying deterministic, so re-requesting the same stream reuses the same
   * path instead of starting a second copy of it.
   */
  pathNameFor({ tenantId, deviceId, channelId, stream }) {
    const digest = crypto
      .createHmac("sha256", ticketKey())
      .update(`path:${tenantId}:${deviceId}:${channelId}:${stream}`)
      .digest("hex")
      .slice(0, 24);
    return `s${digest}`;
  }

  /**
   * Ensure the media server is configured to pull this source, and return the
   * browser-facing descriptor.
   *
   * @param {object} _options
   * @param {string} _options.sourceUrl  CREDENTIALED. Never leaves the server.
   * @returns {Promise<{ pathName, whepUrl, hlsUrl, ticket }>}
   */
  async ensurePath(_options) {
    throw new NotImplementedError(`${this.gatewayKey}.ensurePath`);
  }

  /**
   * Tear a path down.
   *
   * Requirement #32: no process, socket or session outlives its last viewer.
   * A gateway whose media server already implements on-demand lifecycle may
   * make this a no-op and say so — but it must not be forgotten silently.
   */
  async releasePath(_pathName) {
    throw new NotImplementedError(`${this.gatewayKey}.releasePath`);
  }

  /** @returns {Promise<{ paths: number, viewers: number }>} */
  async getStats() {
    throw new NotImplementedError(`${this.gatewayKey}.getStats`);
  }

  async healthCheck() {
    throw new NotImplementedError(`${this.gatewayKey}.healthCheck`);
  }
}

export default MediaGateway;
