const handlers = new Map();
const memoryQueue = [];
let running = false;
let jobId = 0;

const QUEUE_DISABLED = String(process.env.JOBS_DISABLED || "").toLowerCase() === "true";

export const registerJobHandler = (type, handler) => {
  if (!type || typeof handler !== "function") return;
  handlers.set(String(type), handler);
};

const runNext = async () => {
  if (running || QUEUE_DISABLED) return;
  const job = memoryQueue.shift();
  if (!job) return;
  running = true;
  try {
    const handler = handlers.get(job.type);
    if (!handler) {
      console.warn("[jobs] no handler registered", { type: job.type, id: job.id });
    } else {
      await handler(job.payload, job);
    }
  } catch (error) {
    console.error("[jobs] job failed", { type: job.type, id: job.id, error: error?.message || error });
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
    attempts: Number(options.attempts || 0),
    createdAt: new Date().toISOString(),
  };

  if (QUEUE_DISABLED) {
    return { accepted: false, fallback: "disabled", job };
  }

  memoryQueue.push(job);
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
