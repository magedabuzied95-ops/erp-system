// Dahua CGI response parsing.
//
// Dahua's HTTP API answers in a flat, line-oriented format rather than JSON:
//
//   table.Encode[0].MainFormat[0].Video.Compression=H.264
//   table.Encode[0].MainFormat[0].Video.Width=1920
//   table.Encode[0].ExtraFormat[0].Video.Width=352
//
// Every consumer that parses this inline ends up with a slightly different set
// of bugs, so it is parsed once, here, into ordinary nested objects and arrays.
//
// PURE ON PURPOSE
// ---------------
// Nothing in this file opens a socket. It turns text into data, which means the
// whole Dahua response surface can be tested against captured fixtures with no
// device, no network path, and no credentials — which is the only kind of Dahua
// work that can honestly be done before a network path exists.
//
// DEFENSIVE ABOUT SHAPE
// ---------------------
// The response is attacker-adjacent: it comes from a device on a customer
// network that we do not control and whose firmware we have not audited. So the
// parser bounds what it will build (line count, key depth, array index) rather
// than trusting the device to be reasonable. A recorder that answers with
// `a[999999999]=1` must not allocate a billion-element array.

const MAX_LINES = 5000;
const MAX_DEPTH = 12;
const MAX_INDEX = 1024;

/** Dahua uses CRLF; some firmwares mix. Split on either and drop blanks. */
const splitLines = (body = "") =>
  String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);

/**
 * "Video.Compression" -> ["Video", "Compression"]
 * "Encode[0].MainFormat[1]" -> ["Encode", 0, "MainFormat", 1]
 *
 * Returns null for a path we will not build: too deep, or an index far outside
 * anything a real device produces.
 */
export const parseKeyPath = (key = "") => {
  const path = [];
  for (const segment of String(key).split(".")) {
    const match = segment.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!match) return null;
    const [, name, indexes] = match;
    if (name) path.push(name);
    for (const index of indexes.match(/\d+/g) || []) {
      const value = Number(index);
      if (!Number.isInteger(value) || value < 0 || value > MAX_INDEX) return null;
      path.push(value);
    }
    if (path.length > MAX_DEPTH) return null;
  }
  return path.length ? path : null;
};

/**
 * Dahua values are untyped text. Coerce the unambiguous cases and leave the
 * rest as strings — guessing wrong on an identifier is worse than a string.
 */
export const coerceValue = (raw = "") => {
  const value = String(raw).trim();
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  // Integers and decimals only. Deliberately NOT hex or exponent notation: a
  // serial number like "4E13" must stay a string, not become 4e13.
  if (/^-?\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
};

const assign = (root, path, value) => {
  let node = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    const wantArray = typeof nextSegment === "number";
    if (node[segment] === undefined || typeof node[segment] !== "object" || node[segment] === null) {
      node[segment] = wantArray ? [] : {};
    }
    node = node[segment];
  }
  node[path[path.length - 1]] = value;
};

/**
 * Parse a CGI body into a nested object.
 *
 * Unparseable lines are skipped rather than throwing: a firmware that emits one
 * odd line must not make an otherwise-good response unusable, and a probe that
 * throws on junk reports "unsupported" for a capability the device has.
 */
export const parseDahuaResponse = (body = "") => {
  const root = {};
  for (const line of splitLines(body)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const path = parseKeyPath(line.slice(0, separator));
    if (!path) continue;
    assign(root, path, coerceValue(line.slice(separator + 1)));
  }
  return root;
};

/**
 * Most config responses are wrapped in a single `table` or `list` key that
 * carries no information. Unwrap it so callers do not repeat the check.
 */
export const unwrapDahuaTable = (parsed = {}) => {
  const keys = Object.keys(parsed);
  if (keys.length === 1 && (keys[0] === "table" || keys[0] === "list")) return parsed[keys[0]];
  return parsed;
};

/** Convenience: parse and unwrap in one step. */
export const parseDahuaConfig = (body = "") => unwrapDahuaTable(parseDahuaResponse(body));

/**
 * Did the device answer with an error?
 *
 * Dahua signals failure in the body as often as in the status code, and the
 * wording varies by firmware, so both are checked. An unsupported CGI typically
 * answers 400 with "Error" — which is a legitimate "this model cannot do that"
 * and is exactly what the capability probe needs to see.
 */
export const isDahuaError = (status, body = "") => {
  if (Number(status) >= 400) return true;
  const text = String(body ?? "").trim().toLowerCase();
  return text === "error" || text.startsWith("error:") || text.includes("invalid request");
};
