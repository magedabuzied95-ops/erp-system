// Timing-only diagnostics for the cold storefront cache builder.
// OFF unless STOREFRONT_PERF_DIAGNOSTICS=1. Stage names + ms only:
// no payloads, no SQL, no bind parameters, no PII, no product names, no URLs.

export const STOREFRONT_PERF_ENABLED =
  String(process.env.STOREFRONT_PERF_DIAGNOSTICS || "") === "1";

const msSince = (start) => Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(1));

const NOOP_TRACE = {
  enabled: false,
  step: (_name, fn) => fn(),
  sync: (_name, fn) => fn(),
  set: () => {},
  end: () => {},
};

export const createPerfTrace = (label) => {
  if (!STOREFRONT_PERF_ENABLED) return NOOP_TRACE;
  const t0 = process.hrtime.bigint();
  const stages = {};
  const meta = {};
  let ended = false;
  return {
    enabled: true,
    async step(name, fn) {
      const s = process.hrtime.bigint();
      try { return await fn(); } finally { stages[name] = (stages[name] || 0) + msSince(s); }
    },
    sync(name, fn) {
      const s = process.hrtime.bigint();
      try { return fn(); } finally { stages[name] = (stages[name] || 0) + msSince(s); }
    },
    set(name, value) {
      if (typeof value === "number") stages[name] = (stages[name] || 0) + Number(value.toFixed(1));
      else meta[name] = value;
    },
    end(extra = {}) {
      if (ended) return;
      ended = true;
      const total = msSince(t0);
      const accounted = Object.values(stages).reduce((a, b) => a + b, 0);
      console.info("[storefront:perf]", JSON.stringify({
        trace: label,
        ...stages,
        accounted_ms: Number(accounted.toFixed(1)),
        unaccounted_ms: Number((total - accounted).toFixed(1)),
        total_ms: total,
        ...meta,
        ...extra,
      }));
    },
  };
};
