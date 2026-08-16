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
import os from "node:os";

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

/* ------------------------------------------------------------------ *
 * Infrastructure denial — three layers, none of them a guess
 * ------------------------------------------------------------------ */

// WHY THE ORIGINAL LIST WAS WRONG
// -------------------------------
// It hardcoded 172.17-172.20 because those were the Docker bridges that existed
// when it was written. A read-only audit of the production host found eight:
//
//   bridge                  172.17.0.0/16      evolution_default   172.18.0.0/16
//   evolution-v236-test-net 172.19.0.0/16      erp_default         172.20.0.0/16
//   erp-preview-net         172.21.0.0/16      m1-staging-network  172.22.0.0/16
//   m1-staging-egress       172.23.0.0/16      erp-system_default  172.24.0.0/16
//
// Four of them were outside the deny list. Enumerating them is not a fix — the
// next `docker compose up` allocates 172.25 and the list is stale again. A
// static list of someone else's dynamic allocations is always one deploy behind.
//
// So there are three layers, and only the first is a fixed list:

/**
 * LAYER 1 — Docker's default address pool.
 *
 * With no /etc/docker/daemon.json (the production case, verified), Docker
 * allocates local networks from 172.17.0.0/12 in /16 chunks, i.e. 172.17.0.0/16
 * through 172.31.0.0/16. Denying 172.16.0.0/12 covers every address Docker can
 * hand out of that pool, today and after any future `compose up`.
 *
 * This is the one layer a customer can legitimately collide with — a real LAN on
 * 172.20.x exists in the world — so it is the one layer an operator may exempt.
 * See infrastructureExemptRanges() for the guard on that.
 */
export const DOCKER_DEFAULT_POOL = Object.freeze(["172.16.0.0/12"]);

/**
 * LAYER 2 — the networks this process is actually attached to.
 *
 * Read from the host's own interfaces at runtime, so it adapts by construction:
 * a Docker network created after boot is covered the moment it appears, and no
 * list needs maintaining.
 *
 * This layer matters beyond Docker. Docker's built-in default pool also includes
 * 192.168.0.0/16 in /20 chunks, and 192.168.x is the single most common customer
 * LAN range there is. A static rule cannot deny 192.168.0.0/16 without denying
 * nearly every DVR on earth — but "deny the specific /20 this host is attached
 * to, and allow the rest" is both safe and precise. Only a runtime read can do
 * that.
 *
 * Cached briefly: os.networkInterfaces() is a syscall, this runs per request,
 * and a new bridge appearing within 30s of being created is soon enough.
 */
// TOPOLOGY: THE ONE THING A HEURISTIC CANNOT DECIDE
// -------------------------------------------------
// "Deny the networks this host sits on" is exactly right for a cloud VPS, whose
// only neighbours are Docker bridges and other tenants' machines. It is exactly
// WRONG for a self-hosted deployment or an edge agent, where the host shares a
// LAN with the recorder and denying its own subnet denies the entire feature.
//
// No property of an interface distinguishes the two cases reliably — a bridge is
// not always named "br-", and Docker's second default pool is 192.168.0.0/16 in
// /20 chunks, which is indistinguishable by address from an ordinary shop LAN.
//
// So it is declared, not guessed, and the default is the strict one:
//
//   cloud (default) — deny every network this host is attached to.
//   lan             — deny only this host's own addresses, plus the container
//                     pool. Set this only when the backend deliberately shares
//                     a LAN with the devices it manages.
//
// Defaulting to `cloud` means a misconfigured deployment fails closed and
// visibly (a device is unreachable) rather than open and silently.
export const hostTopology = () =>
  String(process.env.SURVEILLANCE_HOST_TOPOLOGY || "cloud").trim().toLowerCase() === "lan"
    ? "lan"
    : "cloud";

const INTERFACE_CACHE_MS = 30_000;
let interfaceCache = { at: 0, ranges: [], topology: "" };
let interfaceProvider = () => os.networkInterfaces();

export const localInterfaceRanges = ({ now = Date.now() } = {}) => {
  const topology = hostTopology();
  if (
    interfaceCache.ranges.length &&
    interfaceCache.topology === topology &&
    now - interfaceCache.at < INTERFACE_CACHE_MS
  ) {
    return interfaceCache.ranges;
  }

  const ranges = [];
  for (const entries of Object.values(interfaceProvider() || {})) {
    for (const entry of entries || []) {
      // `internal` is loopback, already hard-denied. `cidr` is "172.17.0.1/16".
      if (!entry || entry.internal || !entry.cidr) continue;
      if (!parseCidr(entry.cidr)) continue;

      if (topology === "lan") {
        // Only the host itself. `/32` (or `/128`) of the interface address, so a
        // recorder on the same subnet stays reachable while the backend can
        // still never dial its own listening ports.
        const bits = entry.family === "IPv6" || entry.address.includes(":") ? 128 : 32;
        ranges.push(`${entry.address}/${bits}`);
      } else {
        // The whole attached network: 172.17.0.1/16 -> 172.17.0.0/16.
        ranges.push(entry.cidr);
      }
    }
  }

  interfaceCache = { at: now, ranges, topology };
  return ranges;
};

/** Test-only: stub the interface source so guard behaviour is deterministic. */
export const __setInterfaceProvider = (provider) => {
  interfaceProvider = typeof provider === "function" ? provider : () => os.networkInterfaces();
  interfaceCache = { at: 0, ranges: [], topology: "" };
};

/** Test-only: force the next read to hit the source again. */
export const __resetInterfaceCache = () => {
  interfaceCache = { at: 0, ranges: [], topology: "" };
};

/**
 * LAYER 3 — operator-declared ranges.
 *
 * SURVEILLANCE_BLOCKED_CIDRS is for what cannot be derived: this VPS's own
 * public addresses (13.140.141.50/32 here), a peer's management network, a
 * corporate range that must stay off limits.
 */
export const configuredDenyRanges = () => parseList(process.env.SURVEILLANCE_BLOCKED_CIDRS);

/**
 * The exemption, and the rule that keeps it from becoming a hole.
 *
 * A customer whose shop LAN really is 172.21.0.0/24 must be reachable, so
 * SURVEILLANCE_INFRA_EXEMPT_CIDRS carves a hole in LAYER 1. But an exemption
 * that overlaps LAYER 2 is refused outright: if this host is itself attached to
 * 172.21.0.0/16, then "exempt 172.21.0.0/24" is not a customer LAN, it is a
 * request to dial our own Docker network, whatever the operator believed.
 *
 * That check is what makes the exemption safe to hand to an operator. The
 * dangerous configuration is not merely discouraged, it is inert.
 */
export const infrastructureExemptRanges = () => {
  const requested = parseList(process.env.SURVEILLANCE_INFRA_EXEMPT_CIDRS);
  if (!requested.length) return [];

  const local = localInterfaceRanges()
    .map((cidr) => parseCidr(cidr))
    .filter(Boolean);

  return requested.filter((cidr) => {
    const range = parseCidr(cidr);
    if (!range) return false;
    // Reject if the exemption overlaps any network this host sits on. Overlap in
    // either direction counts: a /24 inside our /16, or a /8 swallowing it.
    return !local.some((own) => rangesOverlap(range, own));
  });
};

/** Do two CIDRs share any address? */
const rangesOverlap = (a, b) => {
  if (!a || !b || a.family !== b.family) return false;
  const shift = a.hostBits < b.hostBits ? b.hostBits : a.hostBits;
  return (a.network >> shift) === (b.network >> shift);
};

/**
 * Everything this backend must never dial, on top of HARD_DENY_RANGES.
 * Retained as a single accessor so callers and tests have one entry point.
 */
export const infrastructureDenyRanges = () => [
  ...DOCKER_DEFAULT_POOL,
  ...localInterfaceRanges(),
  ...configuredDenyRanges(),
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

  // 2a. Networks this host is attached to, and ranges the operator declared.
  //     Above the tenant allowlist and NOT exemptable: a tenant granted
  //     172.16.0.0/12 for their LAN must still not reach our Docker networks,
  //     and no configuration may re-open the host's own attachments.
  if (matchesAny(localInterfaceRanges(), parsed)) {
    return { allowed: false, reason: "erp-infrastructure", category: "hard-deny" };
  }
  if (matchesAny(configuredDenyRanges(), parsed)) {
    return { allowed: false, reason: "erp-infrastructure", category: "hard-deny" };
  }

  // 2b. Docker's default allocation pool. Denied by default so a bridge created
  //     tomorrow is covered today, but exemptable — a customer LAN genuinely can
  //     live at 172.20.x. The exemption was already filtered against 2a above,
  //     so it cannot re-open a network this host sits on.
  if (matchesAny(DOCKER_DEFAULT_POOL, parsed) && !matchesAny(infrastructureExemptRanges(), parsed)) {
    return { allowed: false, reason: "container-network-pool", category: "hard-deny" };
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
