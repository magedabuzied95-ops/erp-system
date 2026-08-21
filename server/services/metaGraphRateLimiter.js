// Shared in-process governor for every graph.facebook.com call this backend makes.
//
// Meta meters an *app*, not an endpoint. Comment polling, insights sync, catalog
// feed pushes, Messenger sends and story publishing all draw down the same hourly
// budget, and when it runs out Graph answers `(#4) Application request limit
// reached` with HTTP 400 — not 429 — so any retry predicate that only watches for
// 429/5xx never notices it.
//
// Three jobs live here:
//   1. read the X-App-Usage / X-Business-Use-Case-Usage headers Meta returns on
//      every call, so the app knows how close it is to the ceiling *before* it is
//      cut off instead of discovering it from a failed publish;
//   2. space calls out and prioritise lanes, so a scheduled story publish is
//      never starved by the minute-by-minute background pollers;
//   3. open a breaker once Meta says no, so the recovery window is spent waiting
//      rather than re-triggering the same limit.

import process from "node:process";

const numberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const envNumber = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Percent-of-quota thresholds. Meta reports usage as 0-100 per bucket.
const SOFT_PRESSURE = envNumber("META_GRAPH_SOFT_PRESSURE_PCT", 60);
const HIGH_PRESSURE = envNumber("META_GRAPH_HIGH_PRESSURE_PCT", 75);
const CRITICAL_PRESSURE = envNumber("META_GRAPH_CRITICAL_PRESSURE_PCT", 90);

// Base spacing between consecutive Graph calls, per lane, at zero pressure.
const LANE_BASE_GAP_MS = {
  publish: envNumber("META_GRAPH_PUBLISH_GAP_MS", 400),
  interactive: envNumber("META_GRAPH_INTERACTIVE_GAP_MS", 120),
  background: envNumber("META_GRAPH_BACKGROUND_GAP_MS", 250),
};

const DEFAULT_BREAKER_MS = envNumber("META_GRAPH_BREAKER_MS", 5 * 60 * 1000);
const MIN_BREAKER_MS = 30 * 1000;
const MAX_BREAKER_MS = 30 * 60 * 1000;

// A user-visible publish must not hang behind an open breaker: it is running
// inside an HTTP request that this backend itself cuts off at 60s. It waits a
// short slice of the recovery window, takes its shot, and gives up early enough
// for the caller to see a real answer instead of a gateway timeout. Riding out a
// long throttle is the autopilot's job on its next slot, not this request's.
const MAX_PUBLISH_BREAKER_WAIT_MS = envNumber("META_GRAPH_PUBLISH_MAX_WAIT_MS", 8 * 1000);
const MAX_INTERACTIVE_BREAKER_WAIT_MS = envNumber("META_GRAPH_INTERACTIVE_MAX_WAIT_MS", 5 * 1000);

// Total time one request may spend waiting across all of its attempts.
const LANE_TOTAL_WAIT_BUDGET_MS = {
  publish: envNumber("META_GRAPH_PUBLISH_TOTAL_WAIT_MS", 20 * 1000),
  interactive: envNumber("META_GRAPH_INTERACTIVE_TOTAL_WAIT_MS", 10 * 1000),
  background: envNumber("META_GRAPH_BACKGROUND_TOTAL_WAIT_MS", 60 * 1000),
};

// Usage readings go stale: Meta's counters roll over hourly, and a reading nobody
// has refreshed says nothing about right now.
const USAGE_TTL_MS = envNumber("META_GRAPH_USAGE_TTL_MS", 15 * 60 * 1000);

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);

const state = {
  usage: { callCount: 0, cpuTime: 0, totalTime: 0, updatedAt: 0, source: "" },
  breaker: { openUntil: 0, reason: "", code: 0 },
  nextSlotAt: 0,
  chain: Promise.resolve(),
  counters: { calls: 0, deferred: 0, rateLimited: 0, retried: 0 },
};

const delay = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); }) : Promise.resolve());

const parseJsonHeader = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// X-Business-Use-Case-Usage nests one array of buckets per business id; the worst
// bucket is the one that will cut the app off, so that is the one worth keeping.
const worstBusinessUseCaseBucket = (payload = {}) => {
  let worst = null;
  let worstScore = -1;
  Object.values(payload || {}).forEach((buckets) => {
    (Array.isArray(buckets) ? buckets : []).forEach((bucket) => {
      const score = Math.max(
        numberOrZero(bucket?.call_count),
        numberOrZero(bucket?.total_cputime),
        numberOrZero(bucket?.total_time)
      );
      if (score > worstScore) {
        worst = bucket;
        worstScore = score;
      }
    });
  });
  return worst;
};

const openBreaker = ({ reason = "", code = 0, retryAfterMs = DEFAULT_BREAKER_MS } = {}) => {
  const window = Math.min(MAX_BREAKER_MS, Math.max(MIN_BREAKER_MS, retryAfterMs || DEFAULT_BREAKER_MS));
  const openUntil = Date.now() + window;
  if (openUntil <= state.breaker.openUntil) return state.breaker;
  state.breaker = { openUntil, reason, code };
  console.warn("[meta-graph-limiter] breaker opened", {
    reason,
    code,
    open_for_ms: window,
    open_until: new Date(openUntil).toISOString(),
    usage: state.usage,
  });
  return state.breaker;
};

const applyUsageReading = ({ callCount, cpuTime, totalTime, source, regainMinutes = 0 }) => {
  state.usage = {
    callCount: numberOrZero(callCount),
    cpuTime: numberOrZero(cpuTime),
    totalTime: numberOrZero(totalTime),
    updatedAt: Date.now(),
    source,
  };
  // Meta volunteers the recovery window before it ever returns an error. Honour it
  // as a breaker so the pollers stop digging while the app is already throttled.
  if (regainMinutes > 0) {
    openBreaker({ reason: `${source} estimated_time_to_regain_access`, code: 4, retryAfterMs: regainMinutes * 60 * 1000 });
  }
};

/**
 * Record the rate-limit headers from a Graph response. Safe to call on every
 * response, ok or not — Meta sends these headers on both.
 */
export const noteGraphResponse = (response) => {
  const headers = response?.headers;
  if (!headers || typeof headers.get !== "function") return;

  const appUsage = parseJsonHeader(headers.get("x-app-usage"));
  const businessUsage = parseJsonHeader(headers.get("x-business-use-case-usage"));
  const bucket = worstBusinessUseCaseBucket(businessUsage || {});

  const appScore = appUsage
    ? Math.max(numberOrZero(appUsage.call_count), numberOrZero(appUsage.total_cputime), numberOrZero(appUsage.total_time))
    : -1;
  const bucketScore = bucket
    ? Math.max(numberOrZero(bucket.call_count), numberOrZero(bucket.total_cputime), numberOrZero(bucket.total_time))
    : -1;

  if (bucket && bucketScore >= appScore) {
    applyUsageReading({
      callCount: bucket.call_count,
      cpuTime: bucket.total_cputime,
      totalTime: bucket.total_time,
      source: `business_use_case:${String(bucket.type || "unknown")}`,
      regainMinutes: numberOrZero(bucket.estimated_time_to_regain_access),
    });
    return;
  }
  if (appUsage) {
    applyUsageReading({
      callCount: appUsage.call_count,
      cpuTime: appUsage.total_cputime,
      totalTime: appUsage.total_time,
      source: "app_usage",
    });
  }
};

export const isGraphRateLimitError = (error = {}) => {
  const status = Number(error?.status || error?.meta?.status || error?.response?.status || 0) || 0;
  const code = Number(
    error?.meta?.code || error?.code || error?.metaResponse?.error?.code || error?.meta?.error?.code || 0
  ) || 0;
  if (status === 429 || RATE_LIMIT_CODES.has(code)) return true;
  const message = String(error?.message || error?.metaResponse?.error?.message || "").toLowerCase();
  return message.includes("request limit reached")
    || message.includes("rate limit")
    || message.includes("calls to this api have exceeded");
};

/**
 * Record a Graph failure. Only rate-limit shaped failures open the breaker; every
 * other error is the caller's problem, not the budget's.
 */
export const noteGraphRateLimitError = (error = {}) => {
  if (!isGraphRateLimitError(error)) return false;
  state.counters.rateLimited += 1;
  const regainMinutes = numberOrZero(
    error?.metaResponse?.error?.estimated_time_to_regain_access
      || error?.meta?.estimated_time_to_regain_access
  );
  openBreaker({
    reason: String(error?.message || "Graph rate limit").slice(0, 200),
    code: Number(error?.meta?.code || error?.metaResponse?.error?.code || 0) || 0,
    retryAfterMs: regainMinutes > 0 ? regainMinutes * 60 * 1000 : DEFAULT_BREAKER_MS,
  });
  return true;
};

const currentPressure = () => {
  const { updatedAt, callCount, cpuTime, totalTime } = state.usage;
  if (!updatedAt || Date.now() - updatedAt > USAGE_TTL_MS) return 0;
  return Math.max(callCount, cpuTime, totalTime);
};

const breakerMsRemaining = () => Math.max(0, state.breaker.openUntil - Date.now());

const laneGapMs = (lane) => {
  const base = LANE_BASE_GAP_MS[lane] ?? LANE_BASE_GAP_MS.interactive;
  const pressure = currentPressure();
  // The publish lane keeps its spacing flat: throttling the one call the owner is
  // watching, to protect a budget the pollers are spending, helps nobody.
  if (lane === "publish") return base;
  if (pressure >= CRITICAL_PRESSURE) return base * 12;
  if (pressure >= HIGH_PRESSURE) return base * 6;
  if (pressure >= SOFT_PRESSURE) return base * 3;
  return base;
};

/**
 * Background pollers call this before starting a cycle. When the budget is under
 * pressure or the breaker is open they skip the cycle entirely instead of queueing
 * hundreds of calls the app cannot afford.
 */
export const shouldDeferBackgroundGraphWork = () => {
  const pressure = currentPressure();
  const remaining = breakerMsRemaining();
  if (remaining > 0) {
    state.counters.deferred += 1;
    return { defer: true, reason: "breaker_open", retry_after_ms: remaining, pressure };
  }
  if (pressure >= CRITICAL_PRESSURE) {
    state.counters.deferred += 1;
    return { defer: true, reason: "critical_pressure", retry_after_ms: 60 * 1000, pressure };
  }
  return { defer: false, reason: "", retry_after_ms: 0, pressure };
};

export const getMetaGraphBudgetSnapshot = () => ({
  usage: { ...state.usage },
  pressure: currentPressure(),
  breaker_open: breakerMsRemaining() > 0,
  breaker_ms_remaining: breakerMsRemaining(),
  breaker_reason: state.breaker.reason,
  counters: { ...state.counters },
  thresholds: { soft: SOFT_PRESSURE, high: HIGH_PRESSURE, critical: CRITICAL_PRESSURE },
});

const maxBreakerWaitFor = (lane) => {
  if (lane === "publish") return MAX_PUBLISH_BREAKER_WAIT_MS;
  if (lane === "interactive") return MAX_INTERACTIVE_BREAKER_WAIT_MS;
  return MAX_BREAKER_MS;
};

// One serialized queue keeps the spacing honest: without it ten callers all read
// `nextSlotAt` in the same tick and every one of them thinks the slot is free.
// Returns how long this caller actually waited, so the retry loop can hold itself
// to a total budget rather than to a per-attempt one.
const acquireSlot = (lane, remainingWaitBudgetMs) => {
  const ticket = state.chain.then(async () => {
    const startedAt = Date.now();
    const breakerWait = Math.min(breakerMsRemaining(), maxBreakerWaitFor(lane), Math.max(0, remainingWaitBudgetMs));
    if (breakerWait > 0) await delay(breakerWait);
    const gap = laneGapMs(lane);
    const now = Date.now();
    const spacingWait = Math.max(0, state.nextSlotAt - now);
    state.nextSlotAt = Math.max(now, state.nextSlotAt) + gap;
    if (spacingWait > 0) await delay(spacingWait);
    return Date.now() - startedAt;
  });
  state.chain = ticket.catch(() => {});
  return ticket;
};

/**
 * Run one Graph request under the governor.
 *
 * `run` must perform the request and throw the usual Meta-shaped error (with
 * `status` / `meta` / `metaResponse`) on failure; calling `noteGraphResponse` is
 * the caller's job, since only it holds the Response object.
 */
export const runGraphRequest = async ({ lane = "interactive", run, retries = 0, label = "" } = {}) => {
  if (typeof run !== "function") throw new TypeError("runGraphRequest requires a run() function");
  const attempts = Math.max(1, Number(retries) + 1);
  let waitBudgetMs = LANE_TOTAL_WAIT_BUDGET_MS[lane] ?? LANE_TOTAL_WAIT_BUDGET_MS.interactive;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    waitBudgetMs -= await acquireSlot(lane, waitBudgetMs);
    state.counters.calls += 1;
    try {
      return await run(attempt);
    } catch (error) {
      if (!noteGraphRateLimitError(error) || attempt === attempts) throw error;
      // Exponential, never shorter than what Meta said it needs, and never longer
      // than what is left of this request's wait budget.
      const backoffMs = Math.min(MAX_BREAKER_MS, Math.max(breakerMsRemaining(), 2000 * 2 ** (attempt - 1)));
      const waitMs = Math.min(backoffMs, maxBreakerWaitFor(lane), Math.max(0, waitBudgetMs));
      if (waitMs <= 0) throw error;
      state.counters.retried += 1;
      console.warn("[meta-graph-limiter] retrying after rate limit", {
        label,
        lane,
        attempt,
        attempts,
        wait_ms: waitMs,
        wait_budget_left_ms: waitBudgetMs,
        message: error?.message || "",
      });
      await delay(waitMs);
      waitBudgetMs -= waitMs;
    }
  }
  // Unreachable: the final attempt either returns or throws inside the loop.
  throw new Error("runGraphRequest exhausted its attempts");
};

export const __metaGraphRateLimiterTestHooks = {
  reset: () => {
    state.usage = { callCount: 0, cpuTime: 0, totalTime: 0, updatedAt: 0, source: "" };
    state.breaker = { openUntil: 0, reason: "", code: 0 };
    state.nextSlotAt = 0;
    state.chain = Promise.resolve();
    state.counters = { calls: 0, deferred: 0, rateLimited: 0, retried: 0 };
  },
  currentPressure,
  worstBusinessUseCaseBucket,
  openBreaker,
};
