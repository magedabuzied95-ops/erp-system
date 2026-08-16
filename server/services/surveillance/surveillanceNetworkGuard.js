// Surveillance Center — destination guard (SSRF protection).
//
// THE PROBLEM THIS SOLVES
// -----------------------
// The Add Device wizard asks a user for a host and a port, then the server
// connects to it. That is a server-side request forgery primitive handed to the
// user by design. Unguarded, "add a DVR at 127.0.0.1:5432" turns the connector
// into a port scanner and a probe against our own Postgres, Redis, Docker
// socket and the backend's internal routes.
//
// WHY THE USUAL RULE IS INVERTED HERE
// -----------------------------------
// The standard SSRF defence is "deny RFC1918". We cannot use it: a DVR lives at
// 192.168.1.108. The whole point of the feature is to reach private space.
//
// So the model is not "block private, allow public". It is:
//
//   1. HARD DENY   — loopback, link-local, cloud metadata, multicast, reserved,
//                    IPv6 transition/obfuscation ranges, and operator-configured
//                    infrastructure ranges (this VPS, the Docker networks).
//                    Not overridable by anything. Evaluated first.
//
//   2. ALLOWLIST   — a destination must fall inside a CIDR the tenant has been
//                    explicitly granted, tied to an authorised transport. No
//                    allowlist entry means no connection, private or public.
//
//   3. PUBLIC      — denied unless the operator opts in globally. Requirement
//                    #17 forbids exposing a DVR to the internet; a public
//                    destination almost always means someone port-forwarded a
//                    DVR, so refusing it enforces the security rule in code
//                    rather than in a document.
//
// "Deny-list plus mandatory allowlist" means a gap in the deny-list is not
// automatically an exploit: the address still has to be inside a CIDR an
// operator deliberately granted to that tenant.
//
// WHY NOT A REGEX
// ---------------
// Because `0177.0.0.1`, `2130706433`, `::ffff:127.0.0.1`, `localhost.`,
// `127.0.0.1.nip.io` and a hostname whose DNS record flips between answers all
// defeat string matching. Every check here runs on a *numeric* address, and
// hostnames are resolved first and then judged on what they resolved to — never
// on how they were spelled.

import dns from "node:dns/promises";
import net from "node:net";

import { BlockedDestinationError, SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";

/* ------------------------------------------------------------------ *
 * Address arithmetic
 * ------------------------------------------------------------------ */

const ipv4ToBigInt = (ip) =>
  ip
    .split(".")
    .reduce((acc, octet) => (acc << 8n) + BigInt(Number(octet)), 0n);

/** Expand an IPv6 address (including "::" and embedded IPv4) to eight groups. */
const expandIpv6 = (ip) => {
  let value = ip;

  // A trailing IPv4 literal ("::ffff:192.168.0.1") becomes two hex groups.
  const embedded = value.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (embedded) {
    const octets = embedded[1].split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, embedded.index)}:${high}:${low}`;
  }

  const [head, tail] = value.split("::");
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const tailGroups = tail ? tail.split(":").filter(Boolean) : [];
  const fill = value.includes("::") ? Array(8 - headGroups.length - tailGroups.length).fill("0") : [];
  return [...headGroups, ...fill, ...tailGroups].map((group) => group || "0");
};

const ipv6ToBigInt = (ip) =>
  expandIpv6(ip).reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group, 16) || 0), 0n);

/**
 * Parse an address literal into comparable form.
 *
 * Returns null for anything that is not a literal IP — hostnames included.
 * Callers must not treat null as "safe"; it means "resolve it first".
 */
export const parseIpLiteral = (value = "") => {
  const raw = String(value ?? "").trim().replace(/^\[|\]$/g, "");
  const family = net.isIP(raw);
  if (family === 4) return { ip: raw, bits: 32, value: ipv4ToBigInt(raw), family: 4 };
  if (family === 6) return { ip: raw, bits: 128, value: ipv6ToBigInt(raw), family: 6 };
  return null;
};

/** Parse "10.0.0.0/8" or "fc00::/7" into a comparable mask. */
export const parseCidr = (cidr = "") => {
  const raw = String(cidr ?? "").trim();
  if (!raw) return null;
  const [address, prefixRaw] = raw.split("/");
  const parsed = parseIpLiteral(address);
  if (!parsed) return null;
  const prefix = prefixRaw === undefined ? parsed.bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) return null;
  const hostBits = BigInt(parsed.bits - prefix);
  const network = (parsed.value >> hostBits) << hostBits;
  return { network, hostBits, bits: parsed.bits, family: parsed.family };
};

export const cidrContains = (cidr, parsedIp) => {
  const range = typeof cidr === "string" ? parseCidr(cidr) : cidr;
  if (!range || !parsedIp) return false;
  // An IPv4 address is never inside an IPv6 range and vice versa. Comparing
  // their integers directly would produce nonsense matches.
  if (range.family !== parsedIp.family) return false;
  return (parsedIp.value >> range.hostBits) << range.hostBits === range.network;
};

const matchesAny = (ranges, parsedIp) => ranges.some((range) => cidrContains(range, parsedIp));

/* ------------------------------------------------------------------ *
 * Range tables
 * ------------------------------------------------------------------ */

/**
 * Never reachable. Not overridable by a tenant allowlist, by configuration, or
 * by a super admin. Each entry is labelled so a refusal names the rule.
 */
export const HARD_DENY_RANGES = Object.freeze([
  // --- IPv4 ---
  { cidr: "0.0.0.0/8", reason: "unspecified" },
  { cidr: "127.0.0.0/8", reason: "loopback" },
  { cidr: "169.254.0.0/16", reason: "link-local-or-metadata" }, // incl. 169.254.169.254
  { cidr: "192.0.0.0/24", reason: "ietf-protocol-assignments" },
  { cidr: "192.0.2.0/24", reason: "documentation" },
  { cidr: "192.88.99.0/24", reason: "6to4-relay-anycast" },
  { cidr: "198.18.0.0/15", reason: "benchmarking" },
  { cidr: "198.51.100.0/24", reason: "documentation" },
  { cidr: "203.0.113.0/24", reason: "documentation" },
  { cidr: "224.0.0.0/4", reason: "multicast" },
  { cidr: "240.0.0.0/4", reason: "reserved-or-broadcast" },
  // Alibaba Cloud metadata. Sits inside 100.64/10 (CGNAT), which is only
  // "private" in our model — so it needs its own hard entry.
  { cidr: "100.100.100.200/32", reason: "cloud-metadata" },

  // --- IPv6 ---
  { cidr: "::/128", reason: "unspecified" },
  { cidr: "::1/128", reason: "loopback" },
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) are pure
  // obfuscation vectors here: no DVR is ever legitimately addressed as
  // ::ffff:192.168.1.108, but that spelling is the classic way past a guard
  // that only understands dotted quads. Refuse the whole encoding.
  { cidr: "::ffff:0:0/96", reason: "ipv4-mapped-ipv6" },
  { cidr: "64:ff9b::/96", reason: "nat64" },
  { cidr: "100::/64", reason: "discard-only" },
  { cidr: "2001::/32", reason: "teredo" },
  { cidr: "2001:db8::/32", reason: "documentation" },
  { cidr: "2002::/16", reason: "6to4" },
  { cidr: "fe80::/10", reason: "link-local" },
  { cidr: "ff00::/8", reason: "multicast" },
  // AWS IMDS over IPv6. Inside fc00::/7 (ULA = "private"), so it needs its own
  // hard entry for the same reason as the Alibaba address above.
  { cidr: "fd00:ec2::254/128", reason: "cloud-metadata" },
]);

/** Reachable only when a tenant allowlist explicitly covers them. */
export const PRIVATE_RANGES = Object.freeze([
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10", // CGNAT — common on the ISP side of a store router
  "fc00::/7", // unique local
]);

/**
 * Ports refused no matter what the allowlist says.
 *
 * The port allowlist below already excludes these, but keeping an explicit
 * deny means widening the allowlist later cannot silently re-expose Postgres.
 */
export const HARD_DENY_PORTS = Object.freeze([
  22, // ssh
  23, // telnet
  25, 465, 587, // smtp — an open relay via the connector would be a spam incident
  53, // dns
  111, // rpcbind
  2375, 2376, // docker daemon
  3306, // mysql
  5432, // postgres
  6379, // redis
  9200, 9300, // elasticsearch
  11211, // memcached
  27017, // mongodb
]);

/** Ports a real recorder actually listens on. Narrow on purpose. */
const DEFAULT_ALLOWED_PORTS = Object.freeze([
  80, 443, // vendor HTTP/HTTPS CGI and ISAPI
  554, 8554, // RTSP
  8080, 8443, // alternate vendor web
  34567, // Dahua/XM legacy
  37777, 37778, // Dahua SDK / DHIP
]);

/* ------------------------------------------------------------------ *
 * Operator configuration
 * ------------------------------------------------------------------ */

const parseList = (value = "") =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Infrastructure this backend must never dial, on top of HARD_DENY_RANGES.
 *
 * SURVEILLANCE_BLOCKED_CIDRS is where the operator lists the VPS's own public
 * addresses and the Docker bridge networks. Those cannot be derived reliably at
 * runtime, and getting them wrong is the difference between "guarded" and
 * "reachable", so they are configuration rather than a guess.
 *
 * The Docker defaults are included because compose service names (`db`,
 * `redis`) resolve into these ranges, and a missing env var must not mean an
 * open door.
 */
export const infrastructureDenyRanges = () => [
  "172.17.0.0/16", // default docker bridge
  "172.18.0.0/16", // first user-defined compose network
  "172.19.0.0/16",
  "172.20.0.0/16",
  ...parseList(process.env.SURVEILLANCE_BLOCKED_CIDRS),
];

export const allowedPorts = () => {
  const configured = parseList(process.env.SURVEILLANCE_ALLOWED_PORTS)
    .map(Number)
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  return configured.length ? configured : [...DEFAULT_ALLOWED_PORTS];
};

/** This process's own listening port, so the connector cannot dial the ERP API. */
const selfPort = () => Number(process.env.PORT) || 8000;

export const publicDestinationsAllowed = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.SURVEILLANCE_ALLOW_PUBLIC_DESTINATIONS || "").toLowerCase());

/* ------------------------------------------------------------------ *
 * Hostname rules
 * ------------------------------------------------------------------ */

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Suffixes that only ever name something inside our own runtime.
 * Checked before DNS so the refusal is deterministic even if a resolver lies.
 */
const DENIED_HOST_SUFFIXES = Object.freeze([
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".docker",
  ".svc",
  ".svc.cluster.local",
]);

export const normalizeHost = (value = "") =>
  String(value ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "") // "localhost." and "localhost" are the same name
    .toLowerCase();

/**
 * Reject a hostname on its shape alone.
 *
 * The single-label rule is the important one and it is worth being explicit
 * about: inside Docker, every sibling container is addressable by a bare name
 * with no dot — `db`, `redis`, `backend`, `erp-postgres`, `evolution-api`.
 * Those names resolve to addresses the deny-list would catch, but refusing them
 * before DNS removes an entire class of attack and costs nothing: a recorder is
 * never legitimately addressed by a single-label name from a cloud VPS.
 */
export const validateHostShape = (host = "") => {
  const normalized = normalizeHost(host);
  if (!normalized) throw new BlockedDestinationError("empty-host");
  if (normalized.length > 253) throw new BlockedDestinationError("host-too-long");

  if (parseIpLiteral(normalized)) return { host: normalized, isLiteral: true };

  if (!HOSTNAME_PATTERN.test(normalized)) throw new BlockedDestinationError("malformed-host");

  for (const suffix of DENIED_HOST_SUFFIXES) {
    if (normalized === suffix || normalized.endsWith(suffix)) {
      throw new BlockedDestinationError("internal-hostname");
    }
  }

  if (!normalized.includes(".")) throw new BlockedDestinationError("single-label-hostname");

  return { host: normalized, isLiteral: false };
};

/* ------------------------------------------------------------------ *
 * Port and address classification
 * ------------------------------------------------------------------ */

export const assertPortAllowed = (port) => {
  const value = Number(port);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new BlockedDestinationError("invalid-port", { kind: "port" });
  }
  if (HARD_DENY_PORTS.includes(value)) {
    throw new BlockedDestinationError("infrastructure-port", { kind: "port" });
  }
  if (value === selfPort()) {
    throw new BlockedDestinationError("erp-backend-port", { kind: "port" });
  }
  if (!allowedPorts().includes(value)) {
    throw new BlockedDestinationError("port-not-allowlisted", { kind: "port" });
  }
  return value;
};

/**
 * Judge one numeric address.
 *
 * Pure and synchronous, which is what makes it exhaustively testable — the
 * whole hard-deny table can be asserted address by address with no network.
 *
 * @returns {{ allowed: boolean, reason: string, category: string }}
 */
export const classifyAddress = (ip, { allowedCidrs = [] } = {}) => {
  const parsed = parseIpLiteral(ip);
  if (!parsed) return { allowed: false, reason: "unparseable-address", category: "invalid" };

  // 1. Hard deny wins over everything, including an allowlist entry that
  //    overlaps it. An operator who allowlists 0.0.0.0/0 still cannot reach
  //    127.0.0.1 or the metadata service.
  for (const entry of HARD_DENY_RANGES) {
    if (cidrContains(entry.cidr, parsed)) {
      return { allowed: false, reason: entry.reason, category: "hard-deny" };
    }
  }

  // 2. Operator infrastructure. Also above the allowlist: a tenant granted
  //    172.16.0.0/12 for their LAN must still not reach the Docker network.
  if (matchesAny(infrastructureDenyRanges(), parsed)) {
    return { allowed: false, reason: "erp-infrastructure", category: "hard-deny" };
  }

  const isPrivate = matchesAny(PRIVATE_RANGES, parsed);
  const category = isPrivate ? "private" : "public";

  // 3. Public destinations are off unless the operator opted in. See the header:
  //    a public DVR address means a port-forwarded recorder.
  if (!isPrivate && !publicDestinationsAllowed()) {
    return { allowed: false, reason: "public-destination-disabled", category };
  }

  // 4. Mandatory allowlist. An empty allowlist denies everything — the safe
  //    direction for a tenant whose transport has not been provisioned yet.
  const allowed = matchesAny(allowedCidrs.filter(Boolean), parsed);
  if (!allowed) return { allowed: false, reason: "not-in-tenant-allowlist", category };

  return { allowed: true, reason: "", category };
};

/* ------------------------------------------------------------------ *
 * Resolution and pinning
 * ------------------------------------------------------------------ */

/**
 * Resolve a destination and return a PINNED address to connect to.
 *
 * DNS rebinding is the reason this returns an IP rather than a validated
 * hostname. If we validated `evil.example.com` and then handed the hostname to
 * an HTTP client, the client would resolve it a second time and could get a
 * different answer — the check and the connection would be looking at two
 * different machines. Callers must dial `result.address` and pass the original
 * host only as a Host/SNI header.
 *
 * Every returned address is checked; a hostname with mixed A records where any
 * one of them is disallowed is refused outright rather than partially used,
 * because a resolver is free to return them in any order.
 *
 * @param {object} options
 * @param {string[]} options.allowedCidrs  tenant's granted CIDRs
 * @param {number}   options.timeoutMs     DNS timeout
 * @param {Function} options.lookup        resolver override, tests only. Production
 *                                         callers must never pass this — it exists
 *                                         so the multi-record and rebinding rules
 *                                         can be asserted without a live resolver.
 */
export const resolveDestination = async (
  host,
  port,
  { allowedCidrs = [], timeoutMs = 4000, lookup = null } = {},
) => {
  const { host: normalized, isLiteral } = validateHostShape(host);
  const validatedPort = assertPortAllowed(port);

  if (isLiteral) {
    const verdict = classifyAddress(normalized, { allowedCidrs });
    if (!verdict.allowed) throw new BlockedDestinationError(verdict.reason);
    const parsed = parseIpLiteral(normalized);
    return { address: normalized, family: parsed.family, port: validatedPort, host: normalized, pinned: true };
  }

  const resolver = typeof lookup === "function" ? lookup : dns.lookup;

  let records = [];
  try {
    records = await withTimeout(
      resolver(normalized, { all: true, verbatim: true }),
      timeoutMs,
    );
  } catch {
    // Never echo the resolver's message: it distinguishes NXDOMAIN from
    // SERVFAIL from timeout, which is a usable oracle about internal DNS.
    throw new SurveillanceError("destination could not be resolved", {
      code: SURVEILLANCE_ERROR_CODES.DESTINATION_UNRESOLVABLE,
      status: 400,
    });
  }

  if (!records.length) {
    throw new SurveillanceError("destination could not be resolved", {
      code: SURVEILLANCE_ERROR_CODES.DESTINATION_UNRESOLVABLE,
      status: 400,
    });
  }

  for (const record of records) {
    const verdict = classifyAddress(record.address, { allowedCidrs });
    if (!verdict.allowed) throw new BlockedDestinationError(verdict.reason);
  }

  const chosen = records[0];
  return {
    address: chosen.address,
    family: chosen.family,
    port: validatedPort,
    host: normalized,
    pinned: true,
  };
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);

/**
 * Refuse a redirect.
 *
 * A 302 to http://169.254.169.254/ defeats every check above, because the check
 * ran against the original host. Transports must not enable redirect following;
 * this helper exists so the rule is enforced at the one place a response is
 * inspected rather than left to each client's default.
 */
export const assertNotRedirect = (status) => {
  if (Number(status) >= 300 && Number(status) < 400) {
    throw new SurveillanceError("device responded with a redirect, which is not followed", {
      code: SURVEILLANCE_ERROR_CODES.REDIRECT_BLOCKED,
      status: 502,
      details: { upstreamStatus: Number(status) },
    });
  }
  return Number(status);
};

/**
 * Convenience for callers that only need a yes/no and no pinned address.
 * Still performs the full resolution — there is no cheaper safe answer.
 */
export const isDestinationAllowed = async (host, port, options = {}) => {
  try {
    await resolveDestination(host, port, options);
    return { allowed: true, reason: "" };
  } catch (error) {
    return { allowed: false, reason: error?.reason || error?.code || "blocked" };
  }
};
