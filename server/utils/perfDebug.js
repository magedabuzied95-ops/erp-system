import { AsyncLocalStorage } from "node:async_hooks";

const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

export const isPerfDebugEnabled = () => truthy(process.env.ERP_PERF_DEBUG);

const requestPerfContext = new AsyncLocalStorage();

export const runWithPerfContext = (context, fn) => requestPerfContext.run(context || {}, fn);

export const getPerfContext = () => requestPerfContext.getStore?.() || {};

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

const rounded = (value) => Math.round(Number(value || 0) * 100) / 100;

export const slowestPhaseFromTimings = (timings = {}) => {
  let slowest = { name: "total", ms: rounded(timings.total_ms || 0) };
  for (const [name, value] of Object.entries(timings || {})) {
    if (name === "total_ms" || !name.endsWith("_ms")) continue;
    const ms = rounded(value);
    if (ms >= slowest.ms || slowest.name === "total") slowest = { name, ms };
  }
  return slowest;
};

export const logPerfTiming = (endpoint, timings = {}, meta = {}) => {
  if (!isPerfDebugEnabled()) return;
  const slowest = slowestPhaseFromTimings(timings);
  console.info("[erp-perf]", {
    endpoint,
    total_ms: rounded(timings.total_ms || 0),
    slowest_phase: slowest.name,
    slowest_phase_ms: slowest.ms,
    ...meta,
    timings,
  });
};

export const createPerfTimer = (endpoint, meta = {}) => {
  const startedAt = nowMs();
  const timings = {};
  return {
    mark(name, phaseStartedAt) {
      timings[`${name.replace(/_ms$/, "")}_ms`] = rounded(nowMs() - (phaseStartedAt || startedAt));
    },
    end(extra = {}) {
      timings.total_ms = rounded(nowMs() - startedAt);
      logPerfTiming(endpoint, timings, { ...meta, ...extra });
      return timings;
    },
    fail(error, extra = {}) {
      timings.total_ms = rounded(nowMs() - startedAt);
      logPerfTiming(endpoint, timings, {
        ...meta,
        ...extra,
        failed: true,
        error: error?.message || String(error || ""),
      });
      return timings;
    },
    phaseStart() {
      return nowMs();
    },
    timings,
  };
};
