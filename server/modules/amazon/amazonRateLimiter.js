// Per-operation token buckets matching Amazon's published default usage plans.
// In-process only: the ERP backend runs as a single node process, and every sync job
// additionally holds a Postgres advisory lock, so two processes never share a bucket.

export const AMAZON_OPERATION_LIMITS = Object.freeze({
  getMarketplaceParticipations: { rate: 0.016, burst: 15 },
  searchOrders: { rate: 0.0056, burst: 20 },
  getOrder: { rate: 0.5, burst: 30 },
  createReport: { rate: 0.0167, burst: 15 },
  getReport: { rate: 2, burst: 15 },
  getReportDocument: { rate: 0.0167, burst: 15 },
  getInventorySummaries: { rate: 2, burst: 2 },
  getPricing: { rate: 0.5, burst: 1 },
  getListingsItem: { rate: 5, burst: 10 },
  searchListingsItems: { rate: 5, burst: 5 },
  default: { rate: 0.5, burst: 1 },
});

export const createAmazonRateLimiter = ({ now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), limits = AMAZON_OPERATION_LIMITS, maxWaitMs = 10 * 60 * 1000 } = {}) => {
  const buckets = new Map();

  const bucketFor = (operation) => {
    if (!buckets.has(operation)) {
      const limit = limits[operation] || limits.default;
      buckets.set(operation, { tokens: limit.burst, updatedAt: now(), ...limit });
    }
    return buckets.get(operation);
  };

  const refill = (bucket) => {
    const at = now();
    const elapsedSeconds = Math.max(0, at - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsedSeconds * bucket.rate);
    bucket.updatedAt = at;
  };

  return {
    // Resolves when one token is available; throws when the wait would exceed maxWaitMs.
    async acquire(operation) {
      const bucket = bucketFor(operation);
      refill(bucket);
      if (bucket.tokens < 1) {
        const waitMs = Math.ceil(((1 - bucket.tokens) / bucket.rate) * 1000);
        if (waitMs > maxWaitMs) {
          const error = new Error(`local rate limit for ${operation} needs ${Math.round(waitMs / 1000)}s`);
          error.localRateLimit = true;
          error.waitMs = waitMs;
          throw error;
        }
        await sleep(waitMs);
        refill(bucket);
      }
      bucket.tokens = Math.max(0, bucket.tokens - 1);
    },
    // After a 429 Amazon's bucket is empty; mirror that so the next call waits.
    drain(operation) {
      const bucket = bucketFor(operation);
      bucket.tokens = 0;
      bucket.updatedAt = now();
    },
    snapshot(operation) {
      const bucket = bucketFor(operation);
      refill(bucket);
      return { tokens: bucket.tokens, rate: bucket.rate, burst: bucket.burst };
    },
  };
};
