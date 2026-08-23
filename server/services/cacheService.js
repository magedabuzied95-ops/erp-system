import { legacyCacheMayUseRedis } from "./redisInfrastructure.js";

const memoryCache = new Map();
let redisClientPromise = null;
let redisUnavailableLogged = false;

const DEFAULT_TTL_SECONDS = 30;
const REDIS_URL = process.env.REDIS_URL || process.env.CACHE_REDIS_URL || "";
const CACHE_DISABLED = String(process.env.CACHE_DISABLED || "").toLowerCase() === "true";

const now = () => Date.now();

// LEGACY CACHE REDIS IS NOW BEHIND ITS OWN SWITCH.
//
// Before this change, setting REDIS_URL moved the public storefront cache from
// memory to Redis. That made "give Surveillance a distributed rate-limit
// counter" and "change the hot path of the storefront" the same action, which
// is exactly the coupling the Redis decision record rejected: losing a cache
// entry costs latency, losing a counter degrades a security control, and one
// switch must not move both.
//
// Caching therefore stays on memory until CACHE_USE_SHARED_REDIS is set, whose
// prerequisites are listed in the decision record (maxmemory + allkeys-lru,
// AOF off or a separate database, a guard on invalidateProductStorefrontCache,
// and the build id in the cache key).
const getRedisClient = async () => {
  if (CACHE_DISABLED || !REDIS_URL) return null;
  if (!legacyCacheMayUseRedis()) return null;
  if (!redisClientPromise) {
    redisClientPromise = import("redis")
      .then(async ({ createClient }) => {
        const client = createClient({ url: REDIS_URL });
        client.on("error", (error) => {
          if (!redisUnavailableLogged) {
            redisUnavailableLogged = true;
            console.warn("[cache] redis unavailable, using in-memory fallback", error?.message || error);
          }
        });
        await client.connect();
        return client;
      })
      .catch((error) => {
        if (!redisUnavailableLogged) {
          redisUnavailableLogged = true;
          console.warn("[cache] redis disabled, using in-memory fallback", error?.message || error);
        }
        redisClientPromise = Promise.resolve(null);
        return null;
      });
  }
  return redisClientPromise;
};

const pruneExpiredMemory = () => {
  const current = now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= current) memoryCache.delete(key);
  }
};

export const buildCacheKey = (...parts) =>
  parts
    .flat()
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(":");

export const getCache = async (key) => {
  if (CACHE_DISABLED || !key) return null;
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(key).catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const entry = memoryCache.get(key);
  if (!entry || entry.expiresAt <= now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
};

export const setCache = async (key, value, ttlSeconds = DEFAULT_TTL_SECONDS) => {
  if (CACHE_DISABLED || !key || ttlSeconds <= 0) return value;
  const ttl = Math.max(1, Number(ttlSeconds || DEFAULT_TTL_SECONDS));
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(key, JSON.stringify(value), { EX: ttl }).catch(() => {});
    return value;
  }

  if (memoryCache.size > 1000) pruneExpiredMemory();
  memoryCache.set(key, { value, expiresAt: now() + ttl * 1000 });
  return value;
};

// `diagnostics` is optional and undefined for every normal caller. When supplied it
// receives timing only. Caching semantics are unchanged; no single-flight is added here.
export const getOrSetCache = async (key, ttlSeconds, loader, diagnostics) => {
  const lookupStart = diagnostics ? process.hrtime.bigint() : null;
  const cached = await getCache(key);
  if (diagnostics) {
    diagnostics.cache_lookup_ms = Number((Number(process.hrtime.bigint() - lookupStart) / 1e6).toFixed(1));
  }
  if (cached !== null && cached !== undefined) {
    if (diagnostics) diagnostics.cache = "hit";
    return cached;
  }
  if (diagnostics) diagnostics.cache = "miss";
  const value = await loader();
  const writeStart = diagnostics ? process.hrtime.bigint() : null;
  await setCache(key, value, ttlSeconds);
  if (diagnostics) {
    diagnostics.cache_write_ms = Number((Number(process.hrtime.bigint() - writeStart) / 1e6).toFixed(1));
  }
  return value;
};

/* ------------------------------------------------------------------ *
 * Stale-while-revalidate + single flight
 * ------------------------------------------------------------------ */

// WHY THIS EXISTS
//
// getOrSetCache above is a plain expiry cache: the moment an entry expires the
// NEXT visitor becomes the one who rebuilds it, and waits for the whole build.
// On the storefront product list that build measures 4-6s in production, and it
// is FLAT with page size (limit=1 costs the same as limit=48) because the query
// materialises the entire candidate catalogue before it pages it. With a 120s
// TTL a real shopper ate a multi-second blank page every two minutes -- and every
// request arriving DURING that rebuild started its own identical rebuild.
//
// This variant fixes both halves:
//   - freshSeconds..staleSeconds is a stale window. Inside it the cached value is
//     returned IMMEDIATELY and the rebuild runs behind the response, so a visitor
//     never waits for an entry that merely got old.
//   - a single-flight map collapses concurrent rebuilds of one key into one, so a
//     cold key costs one query instead of one query per waiting request.
//
// The stored shape is an envelope so the freshness deadline survives Redis. It is
// namespaced with `__swr` and read defensively: a value written by the plain
// getOrSetCache (or by an older build mid-rollout) is honoured as-is rather than
// treated as a miss.

const SWR_ENVELOPE = "__swr";
const inFlightBuilds = new Map();

const isSwrEnvelope = (value) =>
  Boolean(value) && typeof value === "object" && value[SWR_ENVELOPE] === 1 && "v" in value;

// One rebuild per key at a time. Later callers join the running promise instead
// of starting a second identical query.
const singleFlight = (key, loader) => {
  const running = inFlightBuilds.get(key);
  if (running) return running;
  const promise = Promise.resolve()
    .then(loader)
    .finally(() => {
      inFlightBuilds.delete(key);
    });
  inFlightBuilds.set(key, promise);
  return promise;
};

/**
 * Cache read with a stale window.
 *
 * @param {string} key
 * @param {{freshSeconds:number, staleSeconds:number}} windows
 *   freshSeconds - how long the value is served with no rebuild at all.
 *   staleSeconds - total lifetime. Between fresh and stale the value is still
 *                  served instantly, with a background rebuild kicked off.
 * @param {() => Promise<any>} loader
 * @param {object} [diagnostics] timing only; undefined for normal callers.
 */
export const getOrSetCacheSWR = async (key, windows, loader, diagnostics) => {
  const freshSeconds = Math.max(1, Number(windows?.freshSeconds) || DEFAULT_TTL_SECONDS);
  const staleSeconds = Math.max(freshSeconds, Number(windows?.staleSeconds) || freshSeconds);

  if (CACHE_DISABLED || !key) {
    if (diagnostics) diagnostics.cache = "disabled";
    return loader();
  }

  const lookupStart = diagnostics ? process.hrtime.bigint() : null;
  const cached = await getCache(key);
  if (diagnostics) {
    diagnostics.cache_lookup_ms = Number((Number(process.hrtime.bigint() - lookupStart) / 1e6).toFixed(1));
  }

  const build = async () => {
    const value = await loader();
    const writeStart = diagnostics ? process.hrtime.bigint() : null;
    await setCache(key, { [SWR_ENVELOPE]: 1, v: value, f: now() + freshSeconds * 1000 }, staleSeconds);
    if (diagnostics) {
      diagnostics.cache_write_ms = Number((Number(process.hrtime.bigint() - writeStart) / 1e6).toFixed(1));
    }
    return value;
  };

  if (cached !== null && cached !== undefined) {
    if (!isSwrEnvelope(cached)) {
      if (diagnostics) diagnostics.cache = "hit";
      return cached;
    }
    if (now() < Number(cached.f || 0)) {
      if (diagnostics) diagnostics.cache = "hit";
      return cached.v;
    }
    // Stale: answer now, refresh behind the response. A failed background rebuild
    // must never reach this visitor -- the entry just stays stale until the next
    // attempt, or until its staleSeconds lifetime runs out.
    if (diagnostics) diagnostics.cache = "stale";
    singleFlight(key, build).catch((error) => {
      console.warn("[cache] background revalidate failed", key, error?.message || error);
    });
    return cached.v;
  }

  if (diagnostics) diagnostics.cache = "miss";
  return singleFlight(key, build);
};

/** Rebuilds an entry unconditionally. Used by the storefront cache warmer. */
export const primeCacheSWR = async (key, windows, loader) => {
  const freshSeconds = Math.max(1, Number(windows?.freshSeconds) || DEFAULT_TTL_SECONDS);
  const staleSeconds = Math.max(freshSeconds, Number(windows?.staleSeconds) || freshSeconds);
  if (CACHE_DISABLED || !key) return null;
  return singleFlight(key, async () => {
    const value = await loader();
    await setCache(key, { [SWR_ENVELOPE]: 1, v: value, f: now() + freshSeconds * 1000 }, staleSeconds);
    return value;
  });
};

export const invalidateCache = async (key) => {
  if (!key) return;
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(key).catch(() => {});
  }
  memoryCache.delete(key);
};

export const invalidateCachePattern = async (pattern) => {
  if (!pattern) return;
  const redis = await getRedisClient();
  if (redis) {
    const stream = redis.scanIterator({ MATCH: pattern, COUNT: 100 });
    const keys = [];
    for await (const key of stream) keys.push(key);
    if (keys.length) await redis.del(keys).catch(() => {});
  }

  const regex = new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) memoryCache.delete(key);
  }
};

export const cacheStatus = () => ({
  disabled: CACHE_DISABLED,
  redisConfigured: Boolean(REDIS_URL),
  memoryEntries: memoryCache.size,
});

/* ------------------------------------------------------------------ *
 * Atomic counters (rate limiting)
 * ------------------------------------------------------------------ */

// Added for the surveillance rate limiter, which needs a counter shared across
// backend processes rather than a cache. Kept here rather than opening a second
// Redis connection elsewhere: one client, one place that knows whether Redis is
// actually working.
//
// GET-then-SET is not usable for this. Two concurrent requests both read 0, both
// write 1, and "one restart per ten minutes" becomes "as many restarts as you
// have parallel requests". The script below is evaluated inside Redis, so the
// increment and its expiry are one indivisible step.
//
// PEXPIRE only on the first increment keeps the window FIXED. Refreshing the TTL
// on every call would slide it, and a sliding window never resets under
// sustained load — the caller would be locked out permanently rather than for
// one period.
const RATE_COUNTER_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`;

const memoryCounters = new Map();

const incrementMemoryCounter = (key, windowMs) => {
  const current = now();
  const entry = memoryCounters.get(key);
  if (!entry || entry.resetAt <= current) {
    memoryCounters.set(key, { count: 1, resetAt: current + windowMs });
    return { count: 1, ttlMs: windowMs };
  }
  entry.count += 1;
  return { count: entry.count, ttlMs: Math.max(0, entry.resetAt - current) };
};

/**
 * Increment a counter inside a fixed window.
 *
 * @returns {Promise<{count:number, ttlMs:number, backend:"redis"|"memory", degraded:boolean}>}
 *
 * `degraded` is the field callers must not ignore: true means Redis was
 * configured but could not be used, so the count is per-process. With a single
 * backend container that is equivalent to a global count; with more than one it
 * is wrong by a factor of the replica count.
 */
export const incrementRateCounter = async (key, windowMs) => {
  const window = Math.max(1, Number(windowMs) || 1000);
  if (!key) return { count: 0, ttlMs: window, backend: "memory", degraded: false };

  const redis = await getRedisClient();
  if (redis) {
    try {
      const result = await redis.eval(RATE_COUNTER_SCRIPT, {
        keys: [key],
        arguments: [String(window)],
      });
      const [count, ttlMs] = Array.isArray(result) ? result : [0, window];
      return { count: Number(count), ttlMs: Math.max(0, Number(ttlMs)), backend: "redis", degraded: false };
    } catch (error) {
      // A live connection that failed mid-command. Fall through to memory but
      // report it, so a caller guarding a dangerous action can refuse instead.
      if (!redisUnavailableLogged) {
        redisUnavailableLogged = true;
        console.warn("[cache] rate counter fell back to memory", error?.message || error);
      }
    }
  }

  const counted = incrementMemoryCounter(key, window);
  // Configured-but-unusable is degraded. Not configured at all is the intended
  // single-process mode and is NOT degraded — otherwise every dev machine would
  // report a fault it does not have.
  return { ...counted, backend: "memory", degraded: Boolean(REDIS_URL) && !CACHE_DISABLED };
};

/** Whether a distributed counter is actually available right now. */
export const rateCounterBackend = async () => {
  if (CACHE_DISABLED || !REDIS_URL) return { backend: "memory", configured: false, degraded: false };
  const redis = await getRedisClient();
  return { backend: redis ? "redis" : "memory", configured: true, degraded: !redis };
};

/** Test-only. */
export const __resetRateCounters = () => memoryCounters.clear();
