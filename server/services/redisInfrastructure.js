// The platform's one explicit Redis connection.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A SURVEILLANCE-ONLY CLIENT
// ------------------------------------------------------------
// Decided in docs/decisions/surveillance-redis-and-ssrf-scope.md after a
// read-only inspection of production. Three options were weighed:
//
//   1. Reuse cacheService's connection. Rejected: turning it on would switch
//      the public storefront's hot path from memory to Redis as a SIDE EFFECT
//      of shipping a camera feature — and would expose a real latent bug
//      (invalidateProductStorefrontCache has no catch, so a failed cache
//      invalidation would make saving a product fail).
//   2. A dedicated surveillance client. Rejected: solves it, but opens a second
//      connection to the same server and duplicates reconnect and failure
//      handling.
//   3. THIS. One explicit connection module. Surveillance uses it immediately;
//      caching stays on memory until somebody separately decides otherwise.
//
// The underlying reason is that counters and caches are different KINDS of
// data with different failure behaviour. Losing a cache entry costs latency.
// Losing a counter degrades a security control. Putting both behind one switch
// means a performance decision moves a security control, and vice versa.
//
// THE PRODUCTION SERVER IS CONFIGURED FOR COUNTERS, NOT FOR CACHE
// ---------------------------------------------------------------
// Observed in production: maxmemory 0, maxmemory-policy noeviction, appendonly
// yes. `noeviction` is the opposite of what a cache wants — when it fills, new
// writes FAIL rather than evicting. For small counters with a TTL, that is
// exactly right. This is the other half of why the two uses stay separate.

import { surveillanceLog } from "./surveillance/surveillanceRedaction.js";

/**
 * Fixed-window counter, atomically.
 *
 * INCR then PEXPIRE only on first increment. Setting the expiry on every
 * increment would slide the window forward on every request, so a caller
 * hitting the endpoint steadily would never reset — the limit would become
 * permanent rather than periodic.
 */
const RATE_COUNTER_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

const REDIS_URL = () => String(process.env.REDIS_URL || "").trim();

let clientPromise = null;
let lastErrorLogged = false;

/**
 * The shared connection, or null when Redis is not configured.
 *
 * Never throws. A caller that needs to know whether the connection is real
 * asks `redisStatus()`; a caller that just wants to count uses the counter
 * below and reads its `degraded` flag.
 */
export const getSharedRedis = async () => {
  const url = REDIS_URL();
  if (!url) return null;

  if (!clientPromise) {
    clientPromise = import("redis")
      .then(async ({ createClient }) => {
        const client = createClient({
          url,
          socket: {
            // Bounded. An unbounded reconnect loop against a dead server turns
            // one outage into a permanent CPU burn across every replica.
            reconnectStrategy: (attempts) => (attempts > 10 ? false : Math.min(attempts * 200, 3000)),
            connectTimeout: 5000,
          },
        });
        client.on("error", (error) => {
          if (!lastErrorLogged) {
            lastErrorLogged = true;
            // The URL can carry a password in userinfo, so only the code.
            surveillanceLog("redis_unavailable", { code: error?.code || "error" });
          }
        });
        await client.connect();
        lastErrorLogged = false;
        surveillanceLog("redis_connected", {});
        return client;
      })
      .catch((error) => {
        if (!lastErrorLogged) {
          lastErrorLogged = true;
          surveillanceLog("redis_connect_failed", { code: error?.code || "error" });
        }
        // Cache the failure so every request does not retry a dead server.
        // `resetSharedRedis()` clears it for an operator-triggered retry.
        clientPromise = Promise.resolve(null);
        return null;
      });
  }
  return clientPromise;
};

/** Is a distributed counter actually available right now? */
export const redisStatus = async () => {
  const configured = Boolean(REDIS_URL());
  if (!configured) return { configured: false, connected: false, degraded: false };
  const client = await getSharedRedis();
  return { configured: true, connected: Boolean(client), degraded: !client };
};

/**
 * Increment a fixed-window counter.
 *
 * @returns {Promise<{count, ttlMs, backend, degraded}>}
 *
 * `degraded` is the field a caller must not ignore. It means Redis was
 * CONFIGURED but unusable, so the count is per-process — which with more than
 * one replica is wrong by a factor of the replica count. Not configuring Redis
 * at all is the intended single-process mode and is NOT degraded, or every
 * developer machine would report a fault it does not have.
 */
export const incrementSharedCounter = async (key, windowMs, { memoryFallback }) => {
  const window = Math.max(1, Number(windowMs) || 1000);
  if (!key) return { count: 0, ttlMs: window, backend: "memory", degraded: false };

  const client = await getSharedRedis();
  if (client) {
    try {
      const result = await client.eval(RATE_COUNTER_SCRIPT, { keys: [key], arguments: [String(window)] });
      const [count, ttlMs] = Array.isArray(result) ? result : [0, window];
      return { count: Number(count), ttlMs: Math.max(0, Number(ttlMs)), backend: "redis", degraded: false };
    } catch (error) {
      // A live connection that failed mid-command. Fall through to memory, but
      // report it degraded so a fail-closed caller can refuse.
      surveillanceLog("redis_counter_failed", { code: error?.code || "error" });
    }
  }

  const counted = memoryFallback(key, window);
  return { ...counted, backend: "memory", degraded: Boolean(REDIS_URL()) };
};

/** Test/operator seam: drop the cached connection so the next call reconnects. */
export const resetSharedRedis = async () => {
  const pending = clientPromise;
  clientPromise = null;
  lastErrorLogged = false;
  const client = await pending?.catch(() => null);
  await client?.quit?.().catch(() => {});
};

/**
 * Whether the LEGACY cache may use this connection.
 *
 * Off by default and deliberately its own switch. Setting REDIS_URL gives
 * Surveillance a distributed counter and changes nothing about caching; making
 * the storefront cache distributed is a separate decision with its own
 * prerequisites, listed in the decision record: set maxmemory and
 * allkeys-lru, disable AOF or use a separate database, guard
 * invalidateProductStorefrontCache, and put the build id in the cache key.
 */
export const legacyCacheMayUseRedis = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.CACHE_USE_SHARED_REDIS || "").toLowerCase());
