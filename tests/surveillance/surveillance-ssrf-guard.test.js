// SSRF regression suite for the surveillance destination guard.
//
// These are BEHAVIOURAL tests: they call the guard and assert what it decides,
// rather than grepping the source for a pattern. A regex-based test would pass
// against a regex-based guard, which is exactly the implementation the
// requirement forbids.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNotRedirect,
  assertPortAllowed,
  cidrContains,
  classifyAddress,
  parseCidr,
  parseIpLiteral,
  resolveDestination,
  validateHostShape,
} from "../../server/services/surveillance/surveillanceNetworkGuard.js";

// A realistic tenant grant: the store LAN, and nothing else.
const STORE_LAN = ["192.168.1.0/24"];
// A deliberately over-broad grant, used to prove the hard-deny list wins.
const EVERYTHING = ["0.0.0.0/0", "::/0"];

const denied = (ip, allowedCidrs = EVERYTHING) => classifyAddress(ip, { allowedCidrs });

/* ------------------------------------------------------------------ *
 * Address arithmetic
 * ------------------------------------------------------------------ */

test("IPv4 and IPv6 literals parse into comparable values", () => {
  assert.equal(parseIpLiteral("192.168.1.108").family, 4);
  assert.equal(parseIpLiteral("fd00::1").family, 6);
  assert.equal(parseIpLiteral("not-an-ip"), null);
  assert.equal(parseIpLiteral(""), null);
});

test("CIDR containment does not match across address families", () => {
  // Comparing an IPv4 integer against an IPv6 range would produce nonsense
  // matches in both directions; both must simply be false.
  assert.equal(cidrContains("10.0.0.0/8", parseIpLiteral("10.1.2.3")), true);
  assert.equal(cidrContains("10.0.0.0/8", parseIpLiteral("::1")), false);
  assert.equal(cidrContains("fc00::/7", parseIpLiteral("10.1.2.3")), false);
  assert.equal(cidrContains("fc00::/7", parseIpLiteral("fd12:3456::1")), true);
});

test("a CIDR with host bits set still matches its network", () => {
  // "192.168.1.108/24" is a common way to write it; it must behave as /24.
  const range = parseCidr("192.168.1.108/24");
  assert.equal(cidrContains(range, parseIpLiteral("192.168.1.5")), true);
  assert.equal(cidrContains(range, parseIpLiteral("192.168.2.5")), false);
});

/* ------------------------------------------------------------------ *
 * Hard deny — not overridable by any allowlist
 * ------------------------------------------------------------------ */

test("loopback is refused even when the tenant allowlist covers everything", () => {
  for (const ip of ["127.0.0.1", "127.1.2.3", "127.255.255.254"]) {
    const verdict = denied(ip);
    assert.equal(verdict.allowed, false, ip);
    assert.equal(verdict.reason, "loopback", ip);
  }
  const v6 = denied("::1");
  assert.equal(v6.allowed, false);
  assert.equal(v6.reason, "loopback");
});

test("0.0.0.0 and the unspecified IPv6 address are refused", () => {
  // "0.0.0.0" and bare "0" both reach the local host on most stacks.
  assert.equal(denied("0.0.0.0").allowed, false);
  assert.equal(denied("0.0.0.0").reason, "unspecified");
  assert.equal(denied("::").allowed, false);
});

test("cloud metadata endpoints are refused on IPv4 and IPv6", () => {
  const aws = denied("169.254.169.254");
  assert.equal(aws.allowed, false);
  assert.equal(aws.reason, "link-local-or-metadata");

  const alibaba = denied("100.100.100.200");
  assert.equal(alibaba.allowed, false);
  assert.equal(alibaba.reason, "cloud-metadata");

  const awsV6 = denied("fd00:ec2::254");
  assert.equal(awsV6.allowed, false);
  assert.equal(awsV6.reason, "cloud-metadata");
});

test("the whole link-local range is refused, not just the metadata address", () => {
  // Blocking only 169.254.169.254 leaves 169.254.169.253 and every other
  // link-local address reachable, which is a scan surface.
  assert.equal(denied("169.254.0.1").allowed, false);
  assert.equal(denied("169.254.255.255").allowed, false);
  assert.equal(denied("fe80::1").allowed, false);
});

test("IPv4-mapped IPv6 cannot smuggle a loopback address past the guard", () => {
  // The classic bypass: a guard that only understands dotted quads sees
  // "::ffff:127.0.0.1" as an unfamiliar IPv6 address and lets it through, while
  // the socket layer connects to 127.0.0.1.
  for (const ip of ["::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.1.1"]) {
    const verdict = denied(ip);
    assert.equal(verdict.allowed, false, ip);
    assert.equal(verdict.reason, "ipv4-mapped-ipv6", ip);
  }
});

test("IPv6 transition and obfuscation ranges are refused", () => {
  assert.equal(denied("64:ff9b::7f00:1").reason, "nat64");
  assert.equal(denied("2002:7f00:1::1").reason, "6to4");
  assert.equal(denied("2001:0:1::1").reason, "teredo");
});

test("multicast, broadcast and reserved space are refused", () => {
  assert.equal(denied("224.0.0.1").allowed, false);
  assert.equal(denied("255.255.255.255").allowed, false);
  assert.equal(denied("ff02::1").allowed, false);
});

test("Docker bridge networks are refused even when granted to the tenant", () => {
  // Compose service names (`db`, `redis`, `erp-postgres`) resolve into these
  // ranges. A tenant whose store LAN is 172.18.x would still not reach them.
  const verdict = classifyAddress("172.17.0.2", { allowedCidrs: ["172.16.0.0/12"] });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "erp-infrastructure");
});

test("operator-configured infrastructure ranges outrank the tenant allowlist", (t) => {
  // Simulates the VPS's own public address being listed in
  // SURVEILLANCE_BLOCKED_CIDRS.
  const original = process.env.SURVEILLANCE_BLOCKED_CIDRS;
  process.env.SURVEILLANCE_BLOCKED_CIDRS = "13.140.141.50/32";
  t.after(() => {
    if (original === undefined) delete process.env.SURVEILLANCE_BLOCKED_CIDRS;
    else process.env.SURVEILLANCE_BLOCKED_CIDRS = original;
  });

  const verdict = classifyAddress("13.140.141.50", { allowedCidrs: EVERYTHING });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "erp-infrastructure");
});

/* ------------------------------------------------------------------ *
 * Allowlist
 * ------------------------------------------------------------------ */

test("an empty allowlist denies every private address", () => {
  // The state of a tenant whose transport has not been provisioned. Adding a
  // device must not immediately make it usable as a probe.
  for (const ip of ["192.168.1.108", "10.0.0.5", "172.20.0.4"]) {
    const verdict = classifyAddress(ip, { allowedCidrs: [] });
    assert.equal(verdict.allowed, false, ip);
  }
});

test("a granted private range is reachable and its neighbours are not", () => {
  assert.equal(classifyAddress("192.168.1.108", { allowedCidrs: STORE_LAN }).allowed, true);
  assert.equal(classifyAddress("192.168.2.108", { allowedCidrs: STORE_LAN }).allowed, false);
  assert.equal(classifyAddress("10.0.0.1", { allowedCidrs: STORE_LAN }).allowed, false);
});

test("one tenant's grant does not admit another tenant's subnet", () => {
  const tenantA = ["192.168.1.0/24"];
  const tenantB = ["192.168.9.0/24"];
  assert.equal(classifyAddress("192.168.9.50", { allowedCidrs: tenantA }).allowed, false);
  assert.equal(classifyAddress("192.168.1.50", { allowedCidrs: tenantB }).allowed, false);
});

test("public destinations are refused unless the operator opts in", (t) => {
  const original = process.env.SURVEILLANCE_ALLOW_PUBLIC_DESTINATIONS;
  t.after(() => {
    if (original === undefined) delete process.env.SURVEILLANCE_ALLOW_PUBLIC_DESTINATIONS;
    else process.env.SURVEILLANCE_ALLOW_PUBLIC_DESTINATIONS = original;
  });

  delete process.env.SURVEILLANCE_ALLOW_PUBLIC_DESTINATIONS;
  const off = classifyAddress("8.8.8.8", { allowedCidrs: ["8.8.8.0/24"] });
  assert.equal(off.allowed, false);
  assert.equal(off.reason, "public-destination-disabled");

  // Even opted in, the allowlist still applies.
  process.env.SURVEILLANCE_ALLOW_PUBLIC_DESTINATIONS = "true";
  assert.equal(classifyAddress("8.8.8.8", { allowedCidrs: ["8.8.8.0/24"] }).allowed, true);
  assert.equal(classifyAddress("1.1.1.1", { allowedCidrs: ["8.8.8.0/24"] }).allowed, false);
});

/* ------------------------------------------------------------------ *
 * Hostnames
 * ------------------------------------------------------------------ */

test("internal hostnames are refused before DNS is consulted", () => {
  for (const host of ["localhost", "localhost.", "LOCALHOST", "api.localhost", "dvr.local", "svc.internal"]) {
    assert.throws(() => validateHostShape(host), /network guard/, host);
  }
});

test("single-label hostnames are refused, which covers every Docker service name", () => {
  // `db`, `redis`, `backend`, `erp-postgres`, `evolution-api` — all reachable
  // from inside the compose network, none of them a legitimate recorder address.
  for (const host of ["db", "redis", "backend", "erp-postgres", "evolution-api", "wppconnect-server"]) {
    assert.throws(
      () => validateHostShape(host),
      (error) => error.reason === "single-label-hostname",
      host,
    );
  }
});

test("malformed hosts are refused rather than normalised into something valid", () => {
  for (const host of ["", "   ", "a b.com", "http://dvr.example.com", "dvr.example.com/path", "-bad.example.com"]) {
    assert.throws(() => validateHostShape(host), /network guard/, JSON.stringify(host));
  }
});

/* ------------------------------------------------------------------ *
 * Ports
 * ------------------------------------------------------------------ */

test("database, cache and mail ports are refused", () => {
  for (const port of [5432, 6379, 3306, 27017, 11211, 22, 25, 2375]) {
    assert.throws(() => assertPortAllowed(port), /network guard/, String(port));
  }
});

test("the ERP backend's own port is refused", (t) => {
  const original = process.env.PORT;
  process.env.PORT = "8000";
  t.after(() => {
    if (original === undefined) delete process.env.PORT;
    else process.env.PORT = original;
  });

  assert.throws(
    () => assertPortAllowed(8000),
    (error) => error.reason === "erp-backend-port",
  );
});

test("recorder ports are allowed and everything else is not", () => {
  for (const port of [80, 443, 554, 37777, 34567]) {
    assert.equal(assertPortAllowed(port), port);
  }
  for (const port of [1, 9999, 65535]) {
    assert.throws(() => assertPortAllowed(port), /network guard/, String(port));
  }
});

test("a port is rejected rather than coerced", () => {
  for (const port of ["80abc", "8 0", null, undefined, 1.5, -80, 70000]) {
    assert.throws(() => assertPortAllowed(port), /network guard/, JSON.stringify(port));
  }
});

/* ------------------------------------------------------------------ *
 * Resolution, pinning and rebinding
 * ------------------------------------------------------------------ */

const fakeLookup = (records) => async () => records;

test("resolution returns a pinned address, not the hostname", async () => {
  const result = await resolveDestination("dvr.example.com", 80, {
    allowedCidrs: STORE_LAN,
    lookup: fakeLookup([{ address: "192.168.1.108", family: 4 }]),
  });
  // The caller must dial `address`. Handing the hostname to a socket would let
  // it resolve a second time, and a second resolution is a rebinding window.
  assert.equal(result.address, "192.168.1.108");
  assert.equal(result.pinned, true);
  assert.equal(result.host, "dvr.example.com");
  assert.equal(result.port, 80);
});

test("a hostname resolving to loopback is refused however it is spelled", async () => {
  // Decimal, octal and wildcard-DNS spellings all end here: the guard judges
  // what the name resolved TO, never how it was written.
  await assert.rejects(
    resolveDestination("2130706433.example.com", 80, {
      allowedCidrs: EVERYTHING,
      lookup: fakeLookup([{ address: "127.0.0.1", family: 4 }]),
    }),
    (error) => error.reason === "loopback",
  );
});

test("a hostname resolving to cloud metadata is refused", async () => {
  await assert.rejects(
    resolveDestination("metadata.example.com", 80, {
      allowedCidrs: EVERYTHING,
      lookup: fakeLookup([{ address: "169.254.169.254", family: 4 }]),
    }),
    (error) => error.reason === "link-local-or-metadata",
  );
});

test("EVERY resolved record is validated, not just the first", async () => {
  // A rebinding-style answer: one benign record and one hostile one. A resolver
  // is free to return them in any order, so accepting the set because the first
  // entry passed would be a coin flip on every connection.
  await assert.rejects(
    resolveDestination("rebind.example.com", 80, {
      allowedCidrs: STORE_LAN,
      lookup: fakeLookup([
        { address: "192.168.1.108", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    }),
    (error) => error.reason === "loopback",
  );
});

test("an empty or failing resolution is refused without leaking the resolver error", async () => {
  await assert.rejects(
    resolveDestination("nothing.example.com", 80, { allowedCidrs: EVERYTHING, lookup: fakeLookup([]) }),
    (error) => error.code === "SURVEILLANCE_DESTINATION_UNRESOLVABLE",
  );

  const failing = async () => {
    throw new Error("queryA ENOTFOUND nothing.example.com");
  };
  await assert.rejects(
    resolveDestination("nothing.example.com", 80, { allowedCidrs: EVERYTHING, lookup: failing }),
    (error) =>
      error.code === "SURVEILLANCE_DESTINATION_UNRESOLVABLE" && !/ENOTFOUND/.test(error.message),
  );
});

test("a refusal never echoes the host back to the caller", async () => {
  // Telling the caller which of their probes resolved where is the SSRF oracle
  // the guard exists to deny.
  const error = await resolveDestination("secret-internal-host.example.com", 80, {
    allowedCidrs: EVERYTHING,
    lookup: fakeLookup([{ address: "127.0.0.1", family: 4 }]),
  }).catch((caught) => caught);

  const body = JSON.stringify(error.toPublicJSON());
  assert.ok(!body.includes("secret-internal-host"), body);
  assert.ok(!body.includes("127.0.0.1"), body);
});

test("redirects are refused rather than followed", () => {
  // A 302 to http://169.254.169.254/ defeats every check above, because the
  // checks ran against the original host.
  for (const status of [301, 302, 303, 307, 308]) {
    assert.throws(() => assertNotRedirect(status), /redirect/, String(status));
  }
  assert.equal(assertNotRedirect(200), 200);
  assert.equal(assertNotRedirect(401), 401);
});
