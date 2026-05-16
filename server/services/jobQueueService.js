const handlers = new Map();
const memoryQueue = [];
let running = false;
let jobId = 0;

const QUEUE_DISABLED = String(process.env.JOBS_DISABLED || "").toLowerCase() === "true";
const SECRET_KEY_PATTERN = /(token|secret|password|authorization|access[_-]?token|phone[_-]?number[_-]?id|app[_-]?secret)/i;

const sanitizeForLog = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => sanitizeForLog(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key, SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeForLog(item, depth + 1)])
    );
  }
  if (typeof value === "string" && value.length > 240) return `${value.slice(0, 240)}...`;
  return value;
};

const getJobContext = (job) =>
  sanitizeForLog(job?.context || job?.payload?.context || {
    tenantId: job?.payload?.tenantId ?? job?.payload?.tenant_id ?? null,
    orderId: job?.payload?.orderId ?? job?.payload?.order_id ?? null,
    invoiceNumber: job?.payload?.invoiceNumber ?? job?.payload?.invoice_number ?? null,
    postId: job?.payload?.postId ?? job?.payload?.post_id ?? job?.payload?.post?.id ?? null,
    storyId: job?.payload?.storyId ?? job?.payload?.story_id ?? job?.payload?.story?.id ?? null,
  });

export const registerJobHandler = (type, handler) => {
  if (!type || typeof handler !== "function") return;
  handlers.set(String(type), handler);
};

const runNext = async () => {
  if (running || QUEUE_DISABLED) return;
  const job = memoryQueue.shift();
  if (!job) return;
  running = true;
  const startedAt = Date.now();
  const context = getJobContext(job);
  try {
    const handler = handlers.get(job.type);
    if (!handler) {
      console.warn("[jobs] no handler registered", { type: job.type, id: job.id, context });
    } else {
      console.log("[jobs] start", { type: job.type, id: job.id, context });
      await handler(job.payload, job);
      console.log("[jobs] success", { type: job.type, id: job.id, durationMs: Date.now() - startedAt, context });
    }
  } catch (error) {
    console.error("[jobs] failed", { type: job.type, id: job.id, durationMs: Date.now() - startedAt, context, error: error?.message || error });
  } finally {
    running = false;
    if (memoryQueue.length) setImmediate(runNext);
  }
};

export const enqueueJob = async (type, payload = {}, options = {}) => {
  const job = {
    id: `${Date.now()}-${++jobId}`,
    type: String(type || "unknown"),
    payload,
    context: options.context || null,
    attempts: Number(options.attempts || 0),
    createdAt: new Date().toISOString(),
  };

  if (QUEUE_DISABLED) {
    console.warn("[jobs] enqueue skipped", { type: job.type, id: job.id, fallback: "disabled", context: getJobContext(job) });
    return { accepted: false, fallback: "disabled", job };
  }

  memoryQueue.push(job);
  console.log("[jobs] enqueue", { type: job.type, id: job.id, backend: "memory", context: getJobContext(job) });
  setImmediate(runNext);
  return { accepted: true, backend: "memory", job };
};

export const queueStatus = () => ({
  disabled: QUEUE_DISABLED,
  backend: "memory",
  pending: memoryQueue.length,
  handlers: Array.from(handlers.keys()),
  running,
});
