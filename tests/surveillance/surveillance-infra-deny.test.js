// Infrastructure-denial regression suite (Phase 2B-0).
//
// The gap this closes: the Phase 1 guard hardcoded 172.17-172.20 because those
// were the Docker bridges that existed when it was written. A read-only audit of
// the production host found eight, reaching 172.24 — four of them outside the
// deny list.
//
// Enumerating the eight would not have been a fix either; the next
// `docker compose up` allocates 172.25. So these tests assert the RULE (the
// whole container pool is denied, and what the host is attached to is denied
// whatever its address) rather than a list of today's subnets.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DOCKER_DEFAULT_POOL,
  __resetInterfaceCache,
  __setInterfaceProvider,
  classifyAddress,
  hostTopology,
  infrastructureExemptRanges,
  localInterfaceRanges,
} from "../../server/services/surveillance/surveillanceNetworkGuard.js";

/**
 * The real production topology, read from the host on 2026-08-17.
 * Using the actual allocation rather than an invented one keeps these tests
 * anchored to the thing they are protecting.
 */
const PRODUCTION_INTERFACES = {
  eth0: [{ address: "13.140.141.50", family: "IPv4", internal: false, cidr: "13.140.141.50/18" }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false, cidr: "172.17.0.1/16" }],
  "br-09e320b547c3": [{ address: "172.18.0.1", family: "IPv4", internal: false, cidr: "172.18.0.1/16" }],
  "br-b5e14092ecbf": [{ address: "172.19.0.1", family: "IPv4", internal: false, cidr: "172.19.0.1/16" }],
  "br-b4bbdd5e7d80": [{ address: "172.20.0.1", family: "IPv4", internal: false, cidr: "172.20.0.1/16" }],
  "br-bb3c604c1af6": [{ address: "172.21.0.1", family: "IPv4", internal: false, cidr: "172.21.0.1/16" }],
  "br-12141e9809b4": [{ address: "172.22.0.1", family: "IPv4", internal: false, cidr: "172.22.0.1/16" }],
  "br-6a7949bbf62c": [{ address: "172.23.0.1", family: "IPv4", internal: false, cidr: "172.23.0.1/16" }],
  "br-efed717ea2c5": [{ address: "172.24.0.1", family: "IPv4", internal: false, cidr: "172.24.0.1/16" }],
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true, cidr: "127.0.0.1/8" }],
};

/** A self-hosted box sharing the shop LAN with the recorder. */
const LAN_HOST_INTERFACES = {
  eth0: [{ address: "192.168.1.50", family: "IPv4", internal: false, cidr: "192.168.1.50/24" }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false, cidr: "172.17.0.1/16" }],
};

const withEnv = (values, fn) => {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  __resetInterfaceCache();
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetInterfaceCache();
  }
};

test.beforeEach(() => {
  __setInterfaceProvider(() => PRODUCTION_INTERFACES);
});

test.after(() => {
  __setInterfaceProvider(null);
});

/* ------------------------------------------------------------------ *
 * The whole container pool, including the ranges the old list missed
 * ------------------------------------------------------------------ */

// 172.16 and 172.31 are the pool boundaries; 172.21 and 172.24 are the two the
// Phase 1 list actually missed in production; 172.17 and 172.20 were covered.
const POOL_ADDRESSES = ["172.16.0.1", "172.17.0.2", "172.20.0.5", "172.21.0.1", "172.24.0.9", "172.31.255.254"];

test("every address in Docker's default pool is refused", () => {
  for (const ip of POOL_ADDRESSES) {
    // Granted the whole /12, which is the most permissive grant that could
    // plausibly be written for a customer LAN in this space.
    const verdict = classifyAddress(ip, { allowedCidrs: ["172.16.0.0/12"] });
    assert.equal(verdict.allowed, false, ip);
    assert.equal(verdict.category, "hard-deny", ip);
  }
});

test("a tenant grant cannot override the container pool", () => {
  // The exact escalation the requirement names: a network grant must not be a
  // way past infrastructure denial.
  for (const ip of POOL_ADDRESSES) {
    for (const grant of ["0.0.0.0/0", "172.16.0.0/12", "172.21.0.0/16", "172.24.0.0/24"]) {
      const verdict = classifyAddress(ip, { allowedCidrs: [grant] });
      assert.equal(verdict.allowed, false, `${ip} via ${grant}`);
    }
  }
});

test("the pool constant covers the documented Docker allocation range", () => {
  // Docker's built-in local pool is 172.17.0.0/12 in /16 chunks. Denying
  // 172.16.0.0/12 covers every /16 it can hand out, now and after any future
  // `compose up` — which a list of today's bridges does not.
  assert.deepEqual([...DOCKER_DEFAULT_POOL], ["172.16.0.0/12"]);
});

test("addresses just outside the pool are not swept up by it", () => {
  // 172.15 and 172.32 are ordinary public space. The guard must not over-deny;
  // over-denial is how a security control becomes something people disable.
  for (const ip of ["172.15.0.1", "172.32.0.1"]) {
    const verdict = classifyAddress(ip, { allowedCidrs: [`${ip}/32`] });
    assert.notEqual(verdict.reason, "container-network-pool", ip);
  }
});

/* ------------------------------------------------------------------ *
 * Runtime discovery — adapts when Docker subnets change
 * ------------------------------------------------------------------ */

test("the guard reads the host's real interfaces rather than a fixed list", () => {
  const ranges = localInterfaceRanges();
  // All eight production bridges plus the public interface; loopback excluded
  // because it is internal and already hard-denied.
  assert.equal(ranges.length, 9);
  assert.ok(ranges.includes("172.24.0.1/16"));
  assert.ok(!ranges.some((cidr) => cidr.startsWith("127.")));
});

test("a Docker network created after the fact is denied without a code change", () => {
  // The failure mode of the Phase 1 list: a new bridge appears and the guard
  // does not know. Here the guard re-reads and covers it.
  __setInterfaceProvider(() => ({
    ...PRODUCTION_INTERFACES,
    "br-brand-new": [{ address: "10.99.0.1", family: "IPv4", internal: false, cidr: "10.99.0.1/16" }],
  }));
  __resetInterfaceCache();

  // 10.99.x is outside the container pool entirely, so only runtime discovery
  // can catch it. A tenant granted 10.0.0.0/8 still cannot reach it.
  const verdict = classifyAddress("10.99.0.5", { allowedCidrs: ["10.0.0.0/8"] });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "erp-infrastructure");

  // And an unrelated 10.x address the host is NOT attached to stays reachable.
  assert.equal(classifyAddress("10.5.0.5", { allowedCidrs: ["10.0.0.0/8"] }).allowed, true);
});

test("the host's own public address is refused even with a matching grant", () => {
  const verdict = classifyAddress("13.140.141.50", { allowedCidrs: ["13.140.141.0/24"] });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "erp-infrastructure");
});

/* ------------------------------------------------------------------ *
 * Topology
 * ------------------------------------------------------------------ */

test("the default topology is the strict one", () => {
  withEnv({ SURVEILLANCE_HOST_TOPOLOGY: null }, () => {
    assert.equal(hostTopology(), "cloud");
  });
  withEnv({ SURVEILLANCE_HOST_TOPOLOGY: "nonsense" }, () => {
    assert.equal(hostTopology(), "cloud");
  });
});

test("a self-hosted backend can still reach a recorder on its own LAN", () => {
  // In `cloud` mode the whole 192.168.1.0/24 is denied because the host sits on
  // it. That is right for a VPS and fatal for a self-hosted install, where the
  // DVR is a LAN neighbour. `lan` narrows the denial to the host itself.
  __setInterfaceProvider(() => LAN_HOST_INTERFACES);

  withEnv({ SURVEILLANCE_HOST_TOPOLOGY: null }, () => {
    assert.equal(classifyAddress("192.168.1.108", { allowedCidrs: ["192.168.1.0/24"] }).allowed, false);
  });

  withEnv({ SURVEILLANCE_HOST_TOPOLOGY: "lan" }, () => {
    // The recorder is reachable...
    assert.equal(classifyAddress("192.168.1.108", { allowedCidrs: ["192.168.1.0/24"] }).allowed, true);
    // ...but the backend still cannot dial itself.
    const self = classifyAddress("192.168.1.50", { allowedCidrs: ["192.168.1.0/24"] });
    assert.equal(self.allowed, false);
    assert.equal(self.reason, "erp-infrastructure");
    // ...and its Docker bridge is still denied by the pool rule.
    assert.equal(classifyAddress("172.17.0.2", { allowedCidrs: ["172.16.0.0/12"] }).allowed, false);
  });
});

/* ------------------------------------------------------------------ *
 * The exemption, and the rule that stops it being a hole
 * ------------------------------------------------------------------ */

test("an exemption lets a genuine customer LAN inside the pool through", () => {
  // A real shop LAN on 172.30.x. Not one of this host's networks, so exempting
  // it is legitimate — and it still needs a tenant grant on top.
  withEnv({ SURVEILLANCE_INFRA_EXEMPT_CIDRS: "172.30.0.0/16" }, () => {
    assert.deepEqual(infrastructureExemptRanges(), ["172.30.0.0/16"]);
    assert.equal(classifyAddress("172.30.0.108", { allowedCidrs: ["172.30.0.0/16"] }).allowed, true);
    // Exemption alone is not enough; the tenant grant is still required.
    assert.equal(classifyAddress("172.30.0.108", { allowedCidrs: [] }).allowed, false);
  });
});

test("an exemption overlapping one of this host's own networks is inert", () => {
  // The dangerous configuration: someone exempts 172.21.0.0/24 believing it is a
  // customer LAN, while this host runs a bridge on 172.21.0.0/16. The exemption
  // is dropped rather than honoured.
  withEnv({ SURVEILLANCE_INFRA_EXEMPT_CIDRS: "172.21.0.0/24" }, () => {
    assert.deepEqual(infrastructureExemptRanges(), []);
    assert.equal(classifyAddress("172.21.0.5", { allowedCidrs: ["172.21.0.0/24"] }).allowed, false);
  });
});

test("an exemption swallowing a host network is inert in the other direction too", () => {
  // Overlap is checked both ways: a /12 exemption contains our /16 bridges.
  withEnv({ SURVEILLANCE_INFRA_EXEMPT_CIDRS: "172.16.0.0/12" }, () => {
    assert.deepEqual(infrastructureExemptRanges(), []);
    assert.equal(classifyAddress("172.24.0.5", { allowedCidrs: ["172.16.0.0/12"] }).allowed, false);
  });
});

test("a malformed exemption is dropped, not treated as a wildcard", () => {
  withEnv({ SURVEILLANCE_INFRA_EXEMPT_CIDRS: "not-a-cidr, 172.30.0.0/99, ,172.30.0.0/16" }, () => {
    assert.deepEqual(infrastructureExemptRanges(), ["172.30.0.0/16"]);
  });
});

test("an exemption cannot reach loopback or cloud metadata", () => {
  // The exemption carves a hole in the container pool only. It sits well below
  // the unconditional hard-deny table.
  withEnv({ SURVEILLANCE_INFRA_EXEMPT_CIDRS: "0.0.0.0/0" }, () => {
    for (const ip of ["127.0.0.1", "169.254.169.254", "::1"]) {
      assert.equal(classifyAddress(ip, { allowedCidrs: ["0.0.0.0/0", "::/0"] }).allowed, false, ip);
    }
  });
});
