// Surveillance Center — input validation.
//
// Hand-rolled rather than schema-library-based because the project has no
// validation dependency and adding one for this feature would be a platform
// decision made as a side effect. The surface is small and the rules are
// specific enough that a generic schema would need custom refinements anyway.
//
// Two principles:
//
//   * Validate to a NEW object. Every function returns a freshly built value
//     containing only known fields, so an extra key in the request body can
//     never reach a SQL builder or a provider. Mutating and returning the input
//     is how mass-assignment bugs happen.
//   * Reject, do not coerce, anything security-relevant. A port of "80abc"
//     becomes an error, not 80. Silent coercion is how a guard gets bypassed by
//     a value that looked different when it was checked than when it was used.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";
import { CAPABILITY_KEYS } from "./surveillanceCapabilities.js";

const fail = (field, rule) => {
  throw new SurveillanceError(`validation failed for "${field}": ${rule}`, {
    code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
    status: 400,
    details: { field, rule },
  });
};

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());

export const requiredString = (value, field, { min = 1, max = 255 } = {}) => {
  const out = text(value);
  if (out.length < min) fail(field, `must be at least ${min} characters`);
  if (out.length > max) fail(field, `must be at most ${max} characters`);
  // Control characters in a device name end up in log lines and in the media
  // path namespace. Strip them at the door rather than defending downstream.
  if ([...out].some((ch) => ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127)) {
    fail(field, "must not contain control characters");
  }
  return out;
};

export const optionalString = (value, field, options = {}) => {
  const out = text(value);
  return out ? requiredString(out, field, options) : "";
};

export const requiredId = (value, field) => {
  const out = Number(value);
  if (!Number.isInteger(out) || out <= 0) fail(field, "must be a positive integer id");
  return out;
};

export const optionalId = (value, field) => {
  if (value === null || value === undefined || value === "") return null;
  return requiredId(value, field);
};

export const requiredPort = (value, field = "port") => {
  // Digits only, after trimming surrounding whitespace. Number() would happily
  // accept "0x50", "8e1", "" and " " and turn each into something plausible;
  // every one of those is a value an operator never typed, and a port that was
  // coerced rather than read is a port the guard checked in one form and the
  // socket used in another.
  const raw = text(value);
  if (!/^\d{1,5}$/.test(raw)) fail(field, "must be an integer between 1 and 65535");
  const out = Number(raw);
  if (out < 1 || out > 65535) fail(field, "must be an integer between 1 and 65535");
  return out;
};

export const requiredEnum = (value, field, allowed = []) => {
  const out = text(value).toLowerCase();
  if (!allowed.includes(out)) fail(field, `must be one of: ${allowed.join(", ")}`);
  return out;
};

export const requiredBoolean = (value, field) => {
  if (typeof value === "boolean") return value;
  const out = text(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(out)) return true;
  if (["false", "0", "no", "off"].includes(out)) return false;
  return fail(field, "must be a boolean");
};

export const requiredIsoDate = (value, field) => {
  const raw = text(value);
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) fail(field, "must be an ISO 8601 timestamp");
  return parsed;
};

/* ------------------------------------------------------------------ *
 * Composite payloads
 * ------------------------------------------------------------------ */

export const DEVICE_PROTOCOLS = Object.freeze(["http", "https"]);
export const STREAM_KINDS = Object.freeze(["main", "sub"]);
export const LAYOUT_SIZES = Object.freeze(["1", "4", "8", "9", "16"]);

/**
 * Add / edit device.
 *
 * Note what is NOT here: `status`, `model`, `firmware`, `channel_count`,
 * `capabilities`. Those are discovered from the device, never accepted from the
 * client — a caller who could set `capabilities` could switch on every
 * dangerous control for a device that does not support them, which is precisely
 * the gate the capability model exists to hold.
 */
export const validateDevicePayload = (body = {}, { partial = false } = {}) => {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (!partial || has("name")) out.name = requiredString(body.name, "name", { max: 120 });
  if (!partial || has("branch_id")) out.branch_id = requiredId(body.branch_id, "branch_id");
  if (!partial || has("vendor_key")) out.vendor_key = requiredString(body.vendor_key, "vendor_key", { max: 40 }).toLowerCase();
  if (!partial || has("transport_type")) {
    out.transport_type = requiredString(body.transport_type, "transport_type", { max: 40 }).toLowerCase();
  }
  if (!partial || has("host")) out.host = requiredString(body.host, "host", { max: 253 }).toLowerCase();
  if (!partial || has("port")) out.port = requiredPort(body.port);
  if (!partial || has("protocol")) out.protocol = requiredEnum(body.protocol ?? "http", "protocol", DEVICE_PROTOCOLS);
  if (has("is_active")) out.is_active = requiredBoolean(body.is_active, "is_active");

  return out;
};

/**
 * Credentials. Separate from the device payload so they can never be returned
 * by a device read and so the audit entry for "device renamed" cannot
 * accidentally carry a password in its diff.
 */
export const validateCredentialPayload = (body = {}) => ({
  username: requiredString(body.username, "username", { max: 64 }),
  // No max-strength rule and no character restrictions: this is the DVR's
  // password, not ours, and rejecting a password the device already accepts
  // would make devices unaddable. Length ceiling only, to bound the ciphertext.
  password: requiredString(body.password, "password", { min: 1, max: 256 }),
});

export const validateChannelPayload = (body = {}) => {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, "display_name")) {
    // Requirement #9: the ERP-side name is editable and independent of the name
    // stored in the recorder. Empty means "fall back to the vendor name".
    out.display_name = optionalString(body.display_name, "display_name", { max: 120 });
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_enabled")) {
    out.is_enabled = requiredBoolean(body.is_enabled, "is_enabled");
  }
  return out;
};

export const validateStreamRequest = (body = {}) => ({
  stream: requiredEnum(body.stream ?? "sub", "stream", STREAM_KINDS),
});

export const validatePlaybackRequest = (body = {}) => {
  const from = requiredIsoDate(body.from, "from");
  const to = requiredIsoDate(body.to, "to");
  if (to <= from) fail("to", "must be after \"from\"");
  // A whole-day request is fine to SEARCH; it is downloading one that is
  // forbidden. The ceiling here bounds the search window so a single query
  // cannot ask a recorder to scan a year of index.
  const maxWindowMs = 7 * 24 * 60 * 60 * 1000;
  if (to - from > maxWindowMs) fail("to", "window must not exceed 7 days");
  return { from, to };
};

export const validateLayoutPayload = (body = {}) => ({
  name: requiredString(body.name, "name", { max: 60 }),
  layout: requiredEnum(body.layout, "layout", LAYOUT_SIZES),
  slots: validateLayoutSlots(body.slots),
  is_default: Object.prototype.hasOwnProperty.call(body, "is_default")
    ? requiredBoolean(body.is_default, "is_default")
    : false,
});

const validateLayoutSlots = (value) => {
  if (!Array.isArray(value)) fail("slots", "must be an array");
  if (value.length > 16) fail("slots", "must not exceed 16 entries");
  return value.map((slot, index) => ({
    position: requiredId(slot?.position ?? index + 1, `slots[${index}].position`),
    // A null channel is a legitimate empty tile in a 16-up grid.
    channel_id: optionalId(slot?.channel_id, `slots[${index}].channel_id`),
    stream: requiredEnum(slot?.stream ?? "sub", `slots[${index}].stream`, STREAM_KINDS),
  }));
};

/**
 * Capability sets coming from an ADAPTER (not from a client).
 *
 * Adapters are our own code, but a buggy probe returning a junk object must not
 * write junk into the column that gates dangerous actions.
 */
export const validateProbedCapabilities = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("capabilities", "must be an object");
  }
  const unknownKeys = Object.keys(value).filter((key) => !CAPABILITY_KEYS.includes(key));
  if (unknownKeys.length) {
    fail("capabilities", `contains unknown capability keys: ${unknownKeys.slice(0, 5).join(", ")}`);
  }
  return value;
};
