const text = (value = "") => String(value ?? "").trim();

const runtimeCacheBuckets = new Map();

const isRuntimeCacheEnabled = () => {
  const raw = text(process.env.SOCIAL_COMMENTS_RUNTIME_CACHE_ENABLED || "true").toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
};

const getRuntimeCacheTtlMs = () => {
  const parsed = Number(process.env.SOCIAL_COMMENTS_RUNTIME_CACHE_TTL_MS || 60000);
  if (!Number.isFinite(parsed) || parsed < 1000) return 60000;
  return Math.max(1000, Math.trunc(parsed));
};

const cloneRuntimeCacheValue = (value) => {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value));
};

const getRuntimeCacheBucket = (cacheName = "") => {
  const safeCacheName = text(cacheName);
  if (!runtimeCacheBuckets.has(safeCacheName)) {
    runtimeCacheBuckets.set(safeCacheName, new Map());
  }
  return runtimeCacheBuckets.get(safeCacheName);
};

const pruneRuntimeCacheBucket = (bucket = new Map(), now = Date.now()) => {
  for (const [cacheKey, entry] of bucket.entries()) {
    if (!entry || Number(entry.expires_at || 0) <= now) {
      bucket.delete(cacheKey);
    }
  }
};

const logRuntimeCacheEvent = (eventName = "", payload = {}) => {
  console.log(eventName, payload);
};

export const withSocialCommentRuntimeCache = async ({
  cacheName = "",
  cacheKey = "",
  loader,
  ttlMs = null,
  metadata = {},
} = {}) => {
  const safeCacheName = text(cacheName);
  const safeCacheKey = text(cacheKey);
  if (!safeCacheName || !safeCacheKey || typeof loader !== "function" || !isRuntimeCacheEnabled()) {
    return loader();
  }
  const bucket = getRuntimeCacheBucket(safeCacheName);
  const now = Date.now();
  pruneRuntimeCacheBucket(bucket, now);
  const entry = bucket.get(safeCacheKey);
  if (entry && Number(entry.expires_at || 0) > now) {
    logRuntimeCacheEvent("SOCIAL_COMMENT_RUNTIME_CACHE_HIT", {
      cache_name: safeCacheName,
      cache_key: safeCacheKey,
      ttl_ms: Number(entry.expires_at || 0) - now,
      ...metadata,
    });
    if (entry.pending && entry.promise) {
      return entry.promise.then((value) => cloneRuntimeCacheValue(value));
    }
    return cloneRuntimeCacheValue(entry.value);
  }
  logRuntimeCacheEvent("SOCIAL_COMMENT_RUNTIME_CACHE_MISS", {
    cache_name: safeCacheName,
    cache_key: safeCacheKey,
    ...metadata,
  });
  const effectiveTtlMs = Number.isFinite(Number(ttlMs)) ? Math.max(1000, Math.trunc(Number(ttlMs))) : getRuntimeCacheTtlMs();
  const promise = Promise.resolve()
    .then(() => loader())
    .then((value) => {
      bucket.set(safeCacheKey, {
        value: cloneRuntimeCacheValue(value),
        expires_at: Date.now() + effectiveTtlMs,
        pending: false,
        promise: null,
      });
      return value;
    })
    .catch((error) => {
      bucket.delete(safeCacheKey);
      throw error;
    });
  bucket.set(safeCacheKey, {
    value: null,
    expires_at: now + effectiveTtlMs,
    pending: true,
    promise,
  });
  return promise.then((value) => cloneRuntimeCacheValue(value));
};

export const clearSocialCommentRuntimeCache = ({ cacheName = "" } = {}) => {
  const safeCacheName = text(cacheName);
  if (!safeCacheName) {
    runtimeCacheBuckets.clear();
    return;
  }
  runtimeCacheBuckets.delete(safeCacheName);
};

export const getSocialCommentRuntimeCacheConfig = () => ({
  enabled: isRuntimeCacheEnabled(),
  ttl_ms: getRuntimeCacheTtlMs(),
});
