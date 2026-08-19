// The counter behind the Surveillance rate limits.
//
// WHAT IS SHARED AND WHAT IS NOT
// ------------------------------
// The CONNECTION is shared — one explicit Redis client for the platform, per
// the Redis decision record, so this does not open a second socket to the same
// server or duplicate reconnect handling.
//
// The COUNTER LOGIC is not. It previously came from cacheService, which meant a
// security control imported its implementation from the storefront cache
// module. That coupling has a specific cost: any future change to how the cache
// counts, expires or falls back would silently change how a dangerous camera
// command is throttled, and nothing in either file would say so.
//
// So the counting lives here, next to the policy that uses it, and
// cacheService is left alone.

import { incrementSharedCounter, redisStatus } from "../redisInfrastructure.js";

/**
 * Per-process fallback.
 *
 * A fixed window, matching the Lua script's semantics exactly: the window
 * starts at the first increment and does not slide. A sliding fallback would
 * throttle differently from the Redis path, so an outage would change the
 * limit's behaviour as well as its scope.
 */
const memoryCounters = new Map();

const incrementMemoryCounter = (key, windowMs) => {
  const now = Date.now();
  const entry = memoryCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryCounters.set(key, { count: 1, resetAt: now + windowMs });
    return { count: 1, ttlMs: windowMs };
  }
  entry.count += 1;
  return { count: entry.count, ttlMs: Math.max(0, entry.resetAt - now) };
};

/**
 * Bound the memory map.
 *
 * Without this, a key space of (action × tenant × device × user) grows for the
 * process lifetime — every expired window left behind as a dead entry. On a
 * long-running backend that is a slow leak in the one component that must not
 * fall over.
 */
const pruneExpired = () => {
  const now = Date.now();
  for (const [key, entry] of memoryCounters) {
    if (entry.resetAt <= now) memoryCounters.delete(key);
  }
};

let sinceLastPrune = 0;

/**
 * Increment the counter for one key.
 *
 * @returns {Promise<{count, ttlMs, backend, degraded}>}
 */
export const incrementRateCounter = async (key, windowMs) => {
  if ((sinceLastPrune += 1) >= 500) {
    sinceLastPrune = 0;
    pruneExpired();
  }
  return incrementSharedCounter(key, windowMs, { memoryFallback: incrementMemoryCounter });
};

/** What the limiter would actually do right now. */
export const rateCounterBackend = async () => {
  const status = await redisStatus();
  return {
    backend: status.connected ? "redis" : "memory",
    configured: status.configured,
    degraded: status.degraded,
  };
};

/** Test-only. */
export const __resetRateCounters = () => memoryCounters.clear();
