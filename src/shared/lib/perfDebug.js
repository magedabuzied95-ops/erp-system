const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

export const isErpPerfDebugEnabled = () =>
  truthy(import.meta.env?.VITE_PERF_DEBUG) || truthy(import.meta.env?.VITE_ERP_PERF_DEBUG);

export const logPagePerf = (page, startedAt, meta = {}) => {
  if (!isErpPerfDebugEnabled()) return;
  const totalMs = Math.round((performance.now() - startedAt) * 100) / 100;
  console.info("[erp-perf]", {
    page,
    total_ms: totalMs,
    slowest_phase: meta.slowest_phase || "request",
    ...meta,
  });
};

export const estimatePayloadSize = (value) => {
  try {
    return new Blob([JSON.stringify(value ?? null)]).size;
  } catch {
    try {
      return JSON.stringify(value ?? null).length;
    } catch {
      return 0;
    }
  }
};
