import { resolveTrustedClientIp } from "./trustedClientIp.js";

// In-process sliding-window counters for the public endpoints that have no login in front of
// them. One backend instance serves the shop, so a Map is enough; a restart forgets the counts,
// which only ever errs toward letting a customer back in.

// The caller's address as the proxy chain vouches for it. Behind nginx or Cloudflare `req.ip` is
// the proxy for every shopper unless TRUST_PROXY_HOPS / TRUST_CLOUDFLARE_PROXY is set, and then
// the whole shop would share one bucket.
export const rateLimitClientKey = (req = {}) => resolveTrustedClientIp(req) || "unknown";

export const createSlidingWindowCounter = ({ windowMs = 60_000, max = 10, now = Date.now, buckets = new Map() } = {}) => {
  let lastSweepAt = now();
  const recentFor = (key, at) => (buckets.get(key) || []).filter((time) => at - time < windowMs);
  const sweep = (at) => {
    if (at - lastSweepAt < windowMs) return;
    for (const [key, times] of buckets) {
      if (!times.length || at - times[times.length - 1] >= windowMs) buckets.delete(key);
    }
    lastSweepAt = at;
  };
  return {
    buckets,
    // Seconds until the oldest counted hit leaves the window, or 0 when the key is under the limit.
    retryAfterSeconds(key) {
      const at = now();
      sweep(at);
      const recent = recentFor(key, at);
      if (recent.length < max) return 0;
      return Math.max(1, Math.ceil((windowMs - (at - recent[0])) / 1000));
    },
    hit(key) {
      const at = now();
      const recent = recentFor(key, at);
      recent.push(at);
      buckets.set(key, recent);
    },
    reset(key) {
      buckets.delete(key);
    },
  };
};

export const TOO_MANY_ATTEMPTS_MESSAGE = "محاولات كثيرة. جرّب مرة أخرى بعد قليل.";

export const sendTooManyAttempts = (res, retryAfterSeconds, extra = {}) => {
  res.set?.("Retry-After", String(retryAfterSeconds));
  return res.status(429).json({
    success: false,
    error: "RATE_LIMITED",
    message: TOO_MANY_ATTEMPTS_MESSAGE,
    retry_after_seconds: retryAfterSeconds,
    ...extra,
  });
};

// Counts every request under each key `keysOf` returns (empty keys are skipped) and refuses the
// request once any of them is full.
export const createRequestRateLimit = ({ windowMs, max, keysOf = (req) => [rateLimitClientKey(req)], now, buckets } = {}) => {
  const counter = createSlidingWindowCounter({ windowMs, max, now, buckets });
  const middleware = (req, res, next) => {
    const keys = keysOf(req).filter(Boolean);
    const retryAfter = Math.max(0, ...keys.map((key) => counter.retryAfterSeconds(key)));
    if (retryAfter > 0) return sendTooManyAttempts(res, retryAfter);
    keys.forEach((key) => counter.hit(key));
    return next();
  };
  middleware.counter = counter;
  return middleware;
};

// Refuses once a key is full, but only counts requests that ended in a 2xx (or, with `countWhen`,
// whichever outcomes the caller names). A shopper retrying after a validation error is not
// charged for it; a script that keeps succeeding, or keeps missing, is.
export const createSuccessRateLimit = ({
  counter,
  keysOf,
  countWhen = (statusCode) => statusCode >= 200 && statusCode < 300,
} = {}) => (req, res, next) => {
  const keys = keysOf(req).filter(Boolean);
  const retryAfter = Math.max(0, ...keys.map((key) => counter.retryAfterSeconds(key)));
  if (retryAfter > 0) return sendTooManyAttempts(res, retryAfter);
  res.on?.("finish", () => {
    if (countWhen(Number(res.statusCode))) keys.forEach((key) => counter.hit(key));
  });
  return next();
};
