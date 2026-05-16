const memoryCache = new Map();
let redisClientPromise = null;
let redisUnavailableLogged = false;

const DEFAULT_TTL_SECONDS = 30;
const REDIS_URL = process.env.REDIS_URL || process.env.CACHE_REDIS_URL || "";
const CACHE_DISABLED = String(process.env.CACHE_DISABLED || "").toLowerCase() === "true";

const now = () => Date.now();

const getRedisClient = async () => {
  if (CACHE_DISABLED || !REDIS_URL) return null;
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

export const getOrSetCache = async (key, ttlSeconds, loader) => {
  const cached = await getCache(key);
  if (cached !== null && cached !== undefined) return cached;
  const value = await loader();
  await setCache(key, value, ttlSeconds);
  return value;
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
