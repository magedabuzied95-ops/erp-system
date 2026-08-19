// Rate-limit policy regression suite (Phase 2B-0).
//
// These run against the in-memory counter, because `redis` is not installed on
// a dev machine — which is itself the finding that shaped this design. What is
// asserted here is the POLICY: scoping, fixed windows, atomicity of the counter
// contract, and the fail mode of every dangerous action. Whether the counter is
// backed by Redis or memory is a backend detail the policy reports but does not
// depend on.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FAIL_CLOSED,
  FAIL_OPEN,
  SURVEILLANCE_RATE_LIMITS,
  consumeRateLimit,
  describeRateLimits,
  rateLimitKey,
  requireDistributedCounters,
} from "../../server/services/surveillance/surveillanceRateLimitPolicy.js";
import { __resetRateCounters } from "../../server/services/surveillance/surveillanceRateLimitCounter.js";

test.beforeEach(__resetRateCounters);

const withEnv = async (values, fn) => {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

/* ------------------------------------------------------------------ *
 * Every dangerous action is fail-closed
 * ------------------------------------------------------------------ */

test("the actions the requirement names are all fail-closed", () => {
  // restart, network changes, storage destructive actions, authentication
  // failures, connection tests.
  for (const action of [
    "restart",
    "networkChange",
    "storageDestructive",
    "authFailure",
    "connectionTest",
    "credentialRotation",
    "settingsWrite",
    "probe",
    "deviceCreate",
  ]) {
    assert.equal(SURVEILLANCE_RATE_LIMITS[action]?.failMode, FAIL_CLOSED, action);
  }
});

test("only the live-viewing path is fail-open", () => {
  // Refusing these on a counter blip blacks out the cameras, which is a worse
  // outcome than a few extra frames.
  for (const action of ["ptz", "snapshot", "stream", "playback"]) {
    assert.equal(SURVEILLANCE_RATE_LIMITS[action]?.failMode, FAIL_OPEN, action);
  }
});

test("every action declares a limit, a window, a scope and a fail mode", () => {
  for (const [action, policy] of Object.entries(SURVEILLANCE_RATE_LIMITS)) {
    assert.ok(Number.isInteger(policy.limit) && policy.limit > 0, action);
    assert.ok(Number.isInteger(policy.windowMs) && policy.windowMs > 0, action);
    assert.ok(Array.isArray(policy.scope) && policy.scope.length > 0, action);
    assert.ok([FAIL_OPEN, FAIL_CLOSED].includes(policy.failMode), action);
    // Tenant is always in scope, so no two tenants can share a budget.
    assert.equal(policy.scope[0], "tenant", action);
  }
});

/* ------------------------------------------------------------------ *
 * Scoping — tenant, device, user
 * ------------------------------------------------------------------ */

test("the counter key is tenant-first and keeps a fixed shape", () => {
  const key = rateLimitKey("restart", ["tenant", "device"], { tenantId: 7, deviceId: 3 });
  assert.equal(key, "srv-rl:restart:tenant:7:device:3");

  // A missing id becomes "none" rather than being dropped: dropping it would let
  // tenant:7:device:<missing> collide with a different dimension's key.
  assert.equal(
    rateLimitKey("restart", ["tenant", "device"], { tenantId: 7 }),
    "srv-rl:restart:tenant:7:device:none",
  );
  assert.notEqual(
    rateLimitKey("stream", ["tenant", "user"], { tenantId: 7 }),
    rateLimitKey("stream", ["tenant", "device"], { tenantId: 7 }),
  );
});

test("two tenants never share a budget, even on the same device id", async () => {
  const a = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3, userId: 1 });
  const b = await consumeRateLimit("restart", { tenantId: 99, deviceId: 3, userId: 1 });
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);

  // Both are now spent within their own tenant.
  assert.equal((await consumeRateLimit("restart", { tenantId: 7, deviceId: 3, userId: 1 })).allowed, false);
  assert.equal((await consumeRateLimit("restart", { tenantId: 99, deviceId: 3, userId: 1 })).allowed, false);
});

test("device-scoped limits do not leak between devices", async () => {
  assert.equal((await consumeRateLimit("restart", { tenantId: 7, deviceId: 3 })).allowed, true);
  assert.equal((await consumeRateLimit("restart", { tenantId: 7, deviceId: 4 })).allowed, true);
  assert.equal((await consumeRateLimit("restart", { tenantId: 7, deviceId: 3 })).allowed, false);
});

test("user-scoped limits do not leak between users", async () => {
  // connectionTest is the SSRF probe primitive, scoped per user because that is
  // who probes.
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await consumeRateLimit("connectionTest", { tenantId: 7, userId: 1 })).allowed, true, `try ${i}`);
  }
  assert.equal((await consumeRateLimit("connectionTest", { tenantId: 7, userId: 1 })).allowed, false);
  // A second operator is unaffected.
  assert.equal((await consumeRateLimit("connectionTest", { tenantId: 7, userId: 2 })).allowed, true);
});

test("device auth failures are counted per device, not per user", async () => {
  // Many Dahua units disable an account after a handful of bad passwords, so the
  // thing being protected is the recorder's lockout policy. Two operators
  // fumbling the same device must share one budget.
  const context = { tenantId: 7, deviceId: 3 };
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await consumeRateLimit("authFailure", { ...context, userId: i })).allowed, true, `attempt ${i}`);
  }
  assert.equal((await consumeRateLimit("authFailure", { ...context, userId: 99 })).allowed, false);
});

/* ------------------------------------------------------------------ *
 * Window behaviour
 * ------------------------------------------------------------------ */

test("the limit is the number of allowed calls, not one fewer", async () => {
  const limit = SURVEILLANCE_RATE_LIMITS.probe.limit;
  for (let i = 0; i < limit; i += 1) {
    assert.equal((await consumeRateLimit("probe", { tenantId: 7, deviceId: 3 })).allowed, true, `probe ${i}`);
  }
  assert.equal((await consumeRateLimit("probe", { tenantId: 7, deviceId: 3 })).allowed, false);
});

test("a refusal reports how long to wait, and the window does not slide", async () => {
  await consumeRateLimit("restart", { tenantId: 7, deviceId: 3 });
  const first = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3 });
  assert.equal(first.allowed, false);
  assert.ok(first.retryAfterSeconds > 0 && first.retryAfterSeconds <= 600);

  // A fixed window: further attempts must not push the reset further out, or a
  // caller under sustained load would be locked out permanently.
  const second = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3 });
  assert.ok(second.retryAfterSeconds <= first.retryAfterSeconds);
});

test("an unknown action fails loudly rather than silently allowing", async () => {
  await assert.rejects(
    consumeRateLimit("restrat", { tenantId: 7 }),
    /unknown surveillance rate limit/,
  );
});

/* ------------------------------------------------------------------ *
 * Degradation
 * ------------------------------------------------------------------ */

test("with no Redis configured, memory counting is normal and not degraded", async () => {
  // A dev machine must not report a fault it does not have — otherwise the
  // signal is worthless when it matters.
  await withEnv({ REDIS_URL: null, CACHE_REDIS_URL: null }, async () => {
    const verdict = await consumeRateLimit("restart", { tenantId: 7, deviceId: 3 });
    assert.equal(verdict.backend, "memory");
    assert.equal(verdict.degraded, false);
    assert.equal(verdict.allowed, true);
  });
});

test("requiring distributed counters is opt-in and off by default", () => {
  withEnvSync({ SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: null }, () => {
    assert.equal(requireDistributedCounters(), false);
  });
  withEnvSync({ SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: "true" }, () => {
    assert.equal(requireDistributedCounters(), true);
  });
});

const withEnvSync = (values, fn) => {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("the status report says plainly whether dangerous limits are really enforced", async () => {
  await withEnv({ REDIS_URL: null, SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED: null }, async () => {
    const status = await describeRateLimits();
    assert.equal(status.redis_configured, false);
    assert.equal(status.dangerous_actions_enforced, true);
    assert.equal(status.actions.restart.fail_mode, FAIL_CLOSED);
    assert.equal(status.actions.restart.window_seconds, 600);
  });
});

/* ------------------------------------------------------------------ *
 * The counter primitive
 * ------------------------------------------------------------------ */

test("the Redis path increments and expires in one atomic step", () => {
  // Asserted structurally: the atomicity lives in a Lua script evaluated inside
  // Redis, and its absence cannot be observed from a dev machine with no Redis.
  //
  // GET-then-SET would let two concurrent requests both read 0, both write 1,
  // and turn "one restart per ten minutes" into "one per parallel request".
  // Read from the module Surveillance ACTUALLY uses. This assertion pointed at
  // cacheService.js after the counter moved to shared Redis infrastructure, and
  // still passed — because cacheService kept its own copy of the old script.
  // A structural test that inspects a file the code no longer calls is a green
  // light attached to nothing.
  const source = readFileSync(
    new URL("../../server/services/redisInfrastructure.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /redis\.call\('INCR', KEYS\[1\]\)/);
  assert.match(source, /if current == 1 then/);
  assert.match(source, /redis\.call\('PEXPIRE', KEYS\[1\], ARGV\[1\]\)/);
  assert.match(source, /client\.eval\(RATE_COUNTER_SCRIPT/);
  // PEXPIRE is guarded by the first-increment check, so the window is fixed
  // rather than sliding forward on every request.
  assert.doesNotMatch(source, /redis\.call\('EXPIRE'[\s\S]{0,40}\nreturn/);
});

test("the surveillance counter does not come from the storefront cache module", () => {
  // The coupling this removes: a security control importing its counting,
  // expiry and fallback semantics from the module that caches product lists.
  const policy = readFileSync(
    new URL("../../server/services/surveillance/surveillanceRateLimitPolicy.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(policy, /from "\.\.\/cacheService\.js"/);
  assert.match(policy, /from "\.\/surveillanceRateLimitCounter\.js"/);
});

test("setting REDIS_URL does not switch the legacy cache to Redis", () => {
  // The whole point of the shared-infrastructure decision: giving Surveillance
  // a distributed counter must not move the public storefront's hot path from
  // memory to Redis as a side effect.
  const cache = readFileSync(
    new URL("../../server/services/cacheService.js", import.meta.url),
    "utf8",
  );
  assert.match(cache, /legacyCacheMayUseRedis\(\)/, "the legacy cache must be behind its own switch");
  const guard = /const getRedisClient[\s\S]{0,400}?if \(!legacyCacheMayUseRedis\(\)\) return null;/;
  assert.match(cache, guard, "the switch must gate the client, not merely be imported");
});

test("the middleware refuses rather than passing through when a fail-closed counter throws", () => {
  // "We could not count this" must never resolve to "go ahead" for a restart.
  const source = readFileSync(
    new URL("../../server/middleware/surveillanceGuards.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /failMode === FAIL_CLOSED/);
  assert.match(source, /status\(503\)/);
  assert.match(source, /counter-unavailable/);
});
