// Surveillance Center — rate limit policy and distributed enforcement.
//
// WHY THIS REPLACED THE IN-MEMORY MAP
// -----------------------------------
// Phase 1 used a per-process Map, matching the pattern already in aiSupport.js
// and storefront.js. That is fine for "don't hammer the search endpoint" and it
// is not fine for "one recorder restart per ten minutes": with N backend
// processes the effective limit silently becomes N restarts per ten minutes,
// and a limit that quietly does a fraction of what it claims is worse than no
// limit, because it is trusted.
//
// WHAT THE PRODUCTION AUDIT ACTUALLY FOUND
// ----------------------------------------
// A read-only check of the running backend turned up something that changes how
// this module has to behave:
//
//   REDIS_URL=redis://erp-redis:6379      <- set
//   node_modules/redis                    <- NOT INSTALLED
//   erp-redis DBSIZE                      <- 0
//
// `redis` is not a declared dependency in either package.json. cacheService
// imports it dynamically and swallows the failure, so every cache in the ERP
// that believes it is distributed has been per-process memory, and the Redis
// container has been idle for weeks.
//
// This module therefore cannot assume Redis works just because a URL is set. It
// asks, it reports, and it makes the consequence explicit per action.
//
// FAIL MODE: THE HONEST VERSION
// -----------------------------
// The tempting design is "dangerous action + Redis down = refuse". Taken
// literally that would refuse every restart in production today, because Redis
// is unreachable — the feature would ship broken.
//
// The accurate statement is that memory fallback is not "no limit". It is a
// correct limit for ONE process and an under-count by the replica factor for
// more. Production runs a single backend container, so today the fallback is
// exactly as strong as Redis would be.
//
// So the refusal is tied to the thing that actually makes the fallback wrong:
//
//   SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED=true
//
// Set it the day a second replica exists. From then on, a dangerous action with
// a degraded counter is refused rather than under-enforced. Until then the
// fallback is honest, loud in the logs, and visible through describeRateLimits().
//
// This is deliberately not defaulted to true. A default that breaks restart in
// the only deployment that exists would be removed by the next person under
// pressure, and a security control that gets removed protects nothing.

// The counter comes from the surveillance module, not from cacheService: a
// security control must not inherit its counting, expiry and fallback
// semantics from the storefront cache. The Redis CONNECTION is still shared.
import { incrementRateCounter, rateCounterBackend } from "./surveillanceRateLimitCounter.js";
import { surveillanceLog } from "./surveillanceRedaction.js";

/** Refusing costs a click; allowing costs a reboot. */
export const FAIL_CLOSED = "closed";
/** Refusing breaks live viewing; allowing costs a few extra frames. */
export const FAIL_OPEN = "open";

/**
 * Per-action policy.
 *
 * `scope` composes the counter key. Order is fixed so the key is stable:
 *   tenant  — always present; two tenants never share a budget
 *   device  — per recorder, so one noisy device cannot lock out another
 *   user    — per operator, for actions where the abuser is a person not a device
 *
 * `failMode` is what happens when the counter cannot be trusted. Every
 * dangerous action is `closed`; every action in the live-viewing path is `open`,
 * because a Redis blip must not black out the cameras.
 */
export const SURVEILLANCE_RATE_LIMITS = Object.freeze({
  // ---- dangerous: refuse rather than under-enforce -------------------
  restart: { limit: 1, windowMs: 600_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },
  networkChange: { limit: 3, windowMs: 3_600_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },
  storageDestructive: { limit: 1, windowMs: 3_600_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },
  credentialRotation: { limit: 5, windowMs: 3_600_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },
  settingsWrite: { limit: 20, windowMs: 60_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },

  // Authentication failures against a DEVICE. Counted per device, not per user:
  // the thing being protected is the recorder's own lockout policy, and many
  // Dahua units disable an account after a handful of bad passwords. Getting
  // this wrong locks the ERP out of the customer's own cameras.
  authFailure: { limit: 5, windowMs: 900_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },

  // Connection tests are an SSRF probe primitive — the one endpoint that dials
  // an address the caller typed. Scoped per user because that is who probes.
  connectionTest: { limit: 10, windowMs: 60_000, scope: ["tenant", "user"], failMode: FAIL_CLOSED },
  probe: { limit: 6, windowMs: 60_000, scope: ["tenant", "device"], failMode: FAIL_CLOSED },
  deviceCreate: { limit: 20, windowMs: 3_600_000, scope: ["tenant", "user"], failMode: FAIL_CLOSED },

  // ---- live path: degrade rather than black out ----------------------
  // PTZ is high because a directional pad emits a burst while a button is held.
  ptz: { limit: 30, windowMs: 10_000, scope: ["tenant", "device", "user"], failMode: FAIL_OPEN },
  snapshot: { limit: 30, windowMs: 60_000, scope: ["tenant", "device", "user"], failMode: FAIL_OPEN },
  stream: { limit: 60, windowMs: 60_000, scope: ["tenant", "user"], failMode: FAIL_OPEN },
  playback: { limit: 60, windowMs: 60_000, scope: ["tenant", "user"], failMode: FAIL_OPEN },
});

export const requireDistributedCounters = () =>
  ["1", "true", "yes", "on"].includes(
    String(process.env.SURVEILLANCE_RATE_LIMIT_REQUIRE_DISTRIBUTED || "").toLowerCase(),
  );

/**
 * Counter key.
 *
 * The tenant is always the first component, so a missing device or user id can
 * never collapse two tenants onto one budget. A missing id becomes "none"
 * rather than being dropped, which keeps the key shape fixed — dropping it
 * would let `tenant:7:device:none` and `tenant:7:user:none` collide.
 */
export const rateLimitKey = (action, scope, context = {}) => {
  const parts = [`srv-rl`, action];
  for (const dimension of scope) {
    const value =
      dimension === "tenant"
        ? context.tenantId
        : dimension === "device"
          ? context.deviceId
          : context.userId;
    parts.push(dimension, value === null || value === undefined || value === "" ? "none" : String(value));
  }
  return parts.join(":");
};

/**
 * Consume one unit of an action's budget.
 *
 * @returns {Promise<{allowed:boolean, reason:string, retryAfterSeconds:number,
 *                    count:number, limit:number, backend:string, degraded:boolean}>}
 *
 * `reason` is "" when allowed, "rate-limited" when the budget is spent, and
 * "counter-unavailable" when a fail-closed action could not be counted
 * reliably. The caller distinguishes them so the user is told the truth: "too
 * many attempts, wait" and "we cannot safely rate-limit this right now" are
 * different problems with different fixes.
 */
export const consumeRateLimit = async (action, context = {}) => {
  const policy = SURVEILLANCE_RATE_LIMITS[action];
  if (!policy) throw new Error(`unknown surveillance rate limit "${action}"`);

  const key = rateLimitKey(action, policy.scope, context);
  const { count, ttlMs, backend, degraded } = await incrementRateCounter(key, policy.windowMs);

  const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

  // A fail-closed action whose counter is degraded is refused ONLY when the
  // deployment has declared that it needs a distributed counter. See the header:
  // a single-replica deployment gets an equally strong limit from memory, and
  // refusing there would break the feature for no security gain.
  if (degraded && policy.failMode === FAIL_CLOSED && requireDistributedCounters()) {
    surveillanceLog("rate_limit_counter_unavailable", {
      action,
      backend,
      tenant_id: context.tenantId ?? null,
    });
    return {
      allowed: false,
      reason: "counter-unavailable",
      retryAfterSeconds,
      count,
      limit: policy.limit,
      backend,
      degraded,
    };
  }

  if (degraded) {
    // Loud but not fatal. This is the line that tells an operator the Redis
    // wiring is broken before it matters.
    surveillanceLog("rate_limit_degraded_to_memory", { action, backend });
  }

  if (count > policy.limit) {
    return { allowed: false, reason: "rate-limited", retryAfterSeconds, count, limit: policy.limit, backend, degraded };
  }

  return { allowed: true, reason: "", retryAfterSeconds, count, limit: policy.limit, backend, degraded };
};

/**
 * Operational view for a status endpoint.
 * Reports what the limiter would actually do right now, not what it intends to.
 */
export const describeRateLimits = async () => {
  const backend = await rateCounterBackend();
  const requireDistributed = requireDistributedCounters();
  return {
    backend: backend.backend,
    redis_configured: backend.configured,
    degraded: backend.degraded,
    require_distributed: requireDistributed,
    // The honest summary: are dangerous actions currently enforced at the
    // strength the policy claims?
    dangerous_actions_enforced: !backend.degraded || !requireDistributed,
    actions: Object.fromEntries(
      Object.entries(SURVEILLANCE_RATE_LIMITS).map(([action, policy]) => [
        action,
        {
          limit: policy.limit,
          window_seconds: policy.windowMs / 1000,
          scope: policy.scope,
          fail_mode: policy.failMode,
        },
      ]),
    ),
  };
};
