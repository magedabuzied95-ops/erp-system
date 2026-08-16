// Surveillance Center — safe error model.
//
// WHY A DEDICATED ERROR TYPE
// --------------------------
// Every failure in this subsystem is one hop away from something sensitive: a
// DVR password, an internal IP, an RTSP URL, a hostname on the customer's LAN.
// A bare `throw new Error(...)` here eventually reaches a route handler that
// does `res.status(500).json({ error: error.message })` — a pattern that exists
// in this codebase — and the message leaks.
//
// So every surveillance error carries TWO messages:
//
//   * `message`     — for operators. May name the rule that was violated.
//                     Must still never contain a credential (see redaction).
//   * `publicCode`  — a stable machine code the API returns to the browser.
//                     The frontend maps it to a translated sentence.
//
// The browser never receives `message`. `toPublicJSON()` is the only sanctioned
// way to serialise one of these for an HTTP response, and it emits the code and
// nothing else. That is what makes requirement #33 ("show a clear message, not
// Error 500") implementable without turning the error channel into an
// information-disclosure channel.

/** Stable codes. The frontend translates these; never renaming one silently. */
export const SURVEILLANCE_ERROR_CODES = Object.freeze({
  TENANT_CONTEXT_MISSING: "SURVEILLANCE_TENANT_CONTEXT_MISSING",
  TENANT_MISMATCH: "SURVEILLANCE_TENANT_MISMATCH",
  BRANCH_FORBIDDEN: "SURVEILLANCE_BRANCH_FORBIDDEN",
  OWNER_REQUIRED: "SURVEILLANCE_OWNER_REQUIRED",
  PERMISSION_DENIED: "SURVEILLANCE_PERMISSION_DENIED",
  STEP_UP_REQUIRED: "SURVEILLANCE_STEP_UP_REQUIRED",
  RATE_LIMITED: "SURVEILLANCE_RATE_LIMITED",

  DEVICE_NOT_FOUND: "SURVEILLANCE_DEVICE_NOT_FOUND",
  CHANNEL_NOT_FOUND: "SURVEILLANCE_CHANNEL_NOT_FOUND",
  DEVICE_OFFLINE: "SURVEILLANCE_DEVICE_OFFLINE",
  DEVICE_UNAUTHORIZED: "SURVEILLANCE_DEVICE_UNAUTHORIZED",
  DEVICE_TIMEOUT: "SURVEILLANCE_DEVICE_TIMEOUT",

  CAPABILITY_UNSUPPORTED: "SURVEILLANCE_CAPABILITY_UNSUPPORTED",
  CAPABILITY_UNKNOWN: "SURVEILLANCE_CAPABILITY_UNKNOWN",
  CAPABILITY_READ_ONLY: "SURVEILLANCE_CAPABILITY_READ_ONLY",

  DESTINATION_BLOCKED: "SURVEILLANCE_DESTINATION_BLOCKED",
  DESTINATION_UNRESOLVABLE: "SURVEILLANCE_DESTINATION_UNRESOLVABLE",
  PORT_BLOCKED: "SURVEILLANCE_PORT_BLOCKED",
  REDIRECT_BLOCKED: "SURVEILLANCE_REDIRECT_BLOCKED",

  CREDENTIALS_MISSING: "SURVEILLANCE_CREDENTIALS_MISSING",
  CREDENTIALS_UNREADABLE: "SURVEILLANCE_CREDENTIALS_UNREADABLE",
  ENCRYPTION_KEY_MISSING: "SURVEILLANCE_ENCRYPTION_KEY_MISSING",
  ENCRYPTION_KEY_WEAK: "SURVEILLANCE_ENCRYPTION_KEY_WEAK",
  ENVELOPE_INVALID: "SURVEILLANCE_ENVELOPE_INVALID",
  ENVELOPE_MALFORMED: "SURVEILLANCE_ENVELOPE_MALFORMED",
  ENVELOPE_TAMPERED: "SURVEILLANCE_ENVELOPE_TAMPERED",

  VALIDATION_FAILED: "SURVEILLANCE_VALIDATION_FAILED",
  PROVIDER_UNKNOWN: "SURVEILLANCE_PROVIDER_UNKNOWN",
  TRANSPORT_UNKNOWN: "SURVEILLANCE_TRANSPORT_UNKNOWN",
  MEDIA_GATEWAY_UNAVAILABLE: "SURVEILLANCE_MEDIA_GATEWAY_UNAVAILABLE",
  NOT_IMPLEMENTED: "SURVEILLANCE_NOT_IMPLEMENTED",
});

export class SurveillanceError extends Error {
  /**
   * @param {string} message     operator-facing. Never a credential.
   * @param {object} options
   * @param {string} options.code    one of SURVEILLANCE_ERROR_CODES
   * @param {number} options.status  HTTP status the route should use
   * @param {object} options.details non-sensitive structured context (ids, names)
   * @param {Error}  options.cause   original error, kept out of any response
   */
  constructor(message, { code, status = 500, details = {}, cause = null } = {}) {
    super(message);
    this.name = "SurveillanceError";
    this.code = code || SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED;
    this.status = status;
    this.details = details && typeof details === "object" ? details : {};
    if (cause) this.cause = cause;
  }

  /**
   * The ONLY sanctioned serialisation for an HTTP response body.
   *
   * Deliberately omits `message`, `stack`, `cause` and anything derived from
   * them. `details` is included but callers must only ever put non-sensitive
   * identifiers there — enforced by review and by the redaction tests.
   */
  toPublicJSON() {
    return {
      success: false,
      code: this.code,
      details: this.details,
    };
  }
}

/** A capability the device does not have, or that we have not proven it has. */
export class UnsupportedCapabilityError extends SurveillanceError {
  constructor(capability, state = "unsupported") {
    const code =
      state === "unknown"
        ? SURVEILLANCE_ERROR_CODES.CAPABILITY_UNKNOWN
        : state === "read-only"
          ? SURVEILLANCE_ERROR_CODES.CAPABILITY_READ_ONLY
          : SURVEILLANCE_ERROR_CODES.CAPABILITY_UNSUPPORTED;
    super(`capability "${capability}" is ${state} on this device`, {
      code,
      status: 409,
      details: { capability, state },
    });
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
    this.state = state;
  }
}

/** A destination the network guard refused. `reason` names the rule, not the host. */
export class BlockedDestinationError extends SurveillanceError {
  constructor(reason, details = {}) {
    super(`destination refused by network guard: ${reason}`, {
      code:
        details.kind === "port"
          ? SURVEILLANCE_ERROR_CODES.PORT_BLOCKED
          : SURVEILLANCE_ERROR_CODES.DESTINATION_BLOCKED,
      status: 400,
      // `reason` is a rule name ("loopback", "cloud-metadata"). It intentionally
      // does NOT echo the host back: telling an attacker which of their probes
      // resolved where is exactly the SSRF oracle we are trying to deny.
      details: { reason },
    });
    this.name = "BlockedDestinationError";
    this.reason = reason;
  }
}

/** Thrown by abstract base classes so a half-built adapter fails loudly. */
export class NotImplementedError extends SurveillanceError {
  constructor(what = "operation") {
    super(`${what} is not implemented`, {
      code: SURVEILLANCE_ERROR_CODES.NOT_IMPLEMENTED,
      status: 501,
      details: { operation: what },
    });
    this.name = "NotImplementedError";
  }
}

export const isSurveillanceError = (error) => error instanceof SurveillanceError;

/**
 * Turn ANY thrown value into a response body.
 *
 * The fallback branch is the important one: an unexpected error (a pg error
 * naming a column, an axios error carrying the full request config including
 * the Authorization header) must never reach the client. It collapses to an
 * opaque code, and the caller is responsible for logging the original through
 * the redaction helper.
 */
export const toErrorResponse = (error) => {
  if (isSurveillanceError(error)) return error.toPublicJSON();
  return { success: false, code: "SURVEILLANCE_INTERNAL_ERROR", details: {} };
};

export const errorStatus = (error) => (isSurveillanceError(error) ? error.status : 500);
