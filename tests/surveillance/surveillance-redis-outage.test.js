// What happens to Surveillance when Redis is down.
//
// THE QUESTION THESE ANSWER
// -------------------------
// A rate limit that silently stops counting is worse than no rate limit,
// because the dashboard still says "protected". The dangerous actions here —
// restarting a recorder, writing an encoder setting — are exactly the ones an
// attacker would repeat, and "we could not count this" must never resolve to
// "go ahead" for them.
//
// But the opposite failure is also real: refusing every camera operation
// because a cache server is down would take the whole feature offline for a
// component it does not need. So the rule is deliberately narrow — a
// fail-closed action is refused only when the deployment has DECLARED it needs
// a distributed counter. A single-replica deployment gets an equally strong
// limit from memory and keeps working.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const { SURVEILLANCE_RATE_LIMITS, consumeRateLimit, describeRateLimits } = await import(
  "../../server/services/surveillance/surveillanceRateLimitPolicy.js"
);
const { __resetRateCounters } = await import(
  "../../server/services/surveillance/surveillanceRateLimitCounter.js"
);
const { redisStatus, resetSharedRedis } = await import(
  "../../server/services/redisInfrastructure.js"
);

/** Run with a temporary environment, always restored. */
const withEnv = async (vars, fn) => {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await resetSharedRedis();
  try { return await fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await resetSharedRedis();
    __resetRateCounters();
  }
};

test.beforeEach(__resetRateCounters);

/* ------------------------------------------------------------------ *
 * Redis configured but unreachable
 * ------------------------------------------------------------------ */

test("an unreachable Redis reports degraded rather than pretending to work", async () => {
  // A port nothing listens on. The connection attempt fails, is cached, and
  // the counter falls through to memory — which is fine, provided it SAYS so.
  await withEnv({ REDIS_URL: "redis://127.0.0.1:6399" }, async () => {
    const status = await redisStatus();
    assert.equal(status.configured, true);
    assert.equal(status.connected, false);
    assert.equal(status.degraded, true, "configured-but-unusable is the definition of degraded");
  });
});

test("a dangerous action is REFUSED when a distributed counter was required", async () => {
  await withEnv(
    { REDIS_URL: "redis://127.0.0.1:6399", SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: "true" },
    async () => {
      const verdict = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3, userId: 42 });
      assert.equal(verdict.allowed, false);
      assert.equal(verdict.reason, "counter-unavailable");
      assert.equal(verdict.degraded, true);
    },
  );
});

test("the same outage does NOT refuse a fail-open action", async () => {
  // Refusing to show a camera because a counter server is down would take the
  // feature offline for a component it does not depend on.
  await withEnv(
    { REDIS_URL: "redis://127.0.0.1:6399", SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: "true" },
    async () => {
      const verdict = await consumeRateLimit("stream", { tenantId: 7, userId: 42 });
      assert.equal(verdict.allowed, true);
      assert.equal(verdict.degraded, true, "still reported, just not fatal");
    },
  );
});

test("without the distributed requirement, a dangerous action still works on memory", async () => {
  // A single-replica deployment gets an equally strong limit from memory.
  // Refusing there would break the feature for no security gain.
  await withEnv(
    { REDIS_URL: "redis://127.0.0.1:6399", SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: undefined },
    async () => {
      const verdict = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3, userId: 42 });
      assert.equal(verdict.allowed, true);
      assert.equal(verdict.backend, "memory");
    },
  );
});

test("the memory limit still actually limits during an outage", async () => {
  // Degraded must mean "counted per process", not "not counted".
  await withEnv({ REDIS_URL: "redis://127.0.0.1:6399" }, async () => {
    const limit = SURVEILLANCE_RATE_LIMITS.restart.limit;
    const context = { tenantId: 7, deviceId: 3, userId: 42 };
    for (let i = 0; i < limit; i += 1) {
      assert.equal((await consumeRateLimit("restart", context)).allowed, true, `call ${i + 1}`);
    }
    const overflow = await consumeRateLimit("restart", context);
    assert.equal(overflow.allowed, false);
    assert.equal(overflow.reason, "rate-limited");
  });
});

/* ------------------------------------------------------------------ *
 * Redis not configured at all
 * ------------------------------------------------------------------ */

test("no Redis configured is the intended mode, not a fault", async () => {
  await withEnv({ REDIS_URL: undefined }, async () => {
    const status = await redisStatus();
    assert.equal(status.configured, false);
    assert.equal(status.degraded, false, "a dev machine must not report a fault it does not have");

    const verdict = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3, userId: 42 });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.degraded, false);
  });
});

test("the status report tells an operator whether limits are really enforced", async () => {
  // `dangerous_actions_enforced` is the field that matters: "Redis is
  // configured" and "dangerous actions are actually protected right now" are
  // different claims, and a status page that merges them tells an operator the
  // recorder is guarded while it is not.
  await withEnv(
    { REDIS_URL: "redis://127.0.0.1:6399", SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: "true" },
    async () => {
      const status = await describeRateLimits();
      assert.equal(status.redis_configured, true);
      assert.equal(status.degraded, true);
      assert.equal(status.dangerous_actions_enforced, false, "degraded + required means NOT enforced");
    },
  );

  // And the reassuring case must be reported as reassuring, or the warning
  // becomes background noise nobody reads.
  await withEnv({ REDIS_URL: undefined, SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: undefined }, async () => {
    const status = await describeRateLimits();
    assert.equal(status.degraded, false);
    assert.equal(status.dangerous_actions_enforced, true);
  });
});

/* ------------------------------------------------------------------ *
 * The legacy cache is not dragged along
 * ------------------------------------------------------------------ */

test("configuring Redis for counters leaves the legacy cache on memory", async () => {
  const cache = await import("../../server/services/cacheService.js");
  await withEnv({ REDIS_URL: "redis://127.0.0.1:6399", CACHE_USE_SHARED_REDIS: undefined }, async () => {
    // setCache/getCache must behave exactly as before: in-process memory.
    await cache.setCache("srv-test:key", { value: 1 }, 5);
    const read = await cache.getCache("srv-test:key");
    assert.deepEqual(read, { value: 1 }, "the memory cache must still work untouched");
  });
});
