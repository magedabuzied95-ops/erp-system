const handlers = new Map();
const memoryQueue = [];
const deadLetterQueue = [];
const jobStatuses = new Map();
const activeDedupeKeys = new Map();
let running = false;
let jobId = 0;
let scheduledRunTimer = null;
let scheduledRunAt = null;
let persistentAdapter = null;

const QUEUE_DISABLED = String(process.env.JOBS_DISABLED || "").toLowerCase() === "true";
const MAX_TRACKED_STATUSES = Number(process.env.JOBS_STATUS_LIMIT || 500);
const MAX_DEAD_LETTERS = Number(process.env.JOBS_DEAD_LETTER_LIMIT || 100);
const DEFAULT_MAX_ATTEMPTS = Math.max(1, Number(process.env.JOBS_MAX_ATTEMPTS || 1));
const DEFAULT_BACKOFF_MS = Math.max(0, Number(process.env.JOBS_BACKOFF_MS || 1000));
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

const now = () => Date.now();

const clampNumber = (value, fallback, min = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
};

const trimTrackedMap = (map, limit) => {
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
};

const setJobStatus = async (job, status, patch = {}) => {
  const nextStatus = {
    id: job.id,
    type: job.type,
    status,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.maxAttempts,
    dedupeKey: job.dedupeKey || null,
    context: getJobContext(job),
    updatedAt: new Date().toISOString(),
    ...patch,
  };
  jobStatuses.set(job.id, nextStatus);
  trimTrackedMap(jobStatuses, MAX_TRACKED_STATUSES);

  if (persistentAdapter?.setStatus) {
    try {
      await persistentAdapter.setStatus(job, nextStatus);
    } catch (error) {
      console.warn("[jobs] status adapter failed", { type: job.type, id: job.id, status, error: error?.message || error });
    }
  }
};

const clearDedupeKey = (job) => {
  if (job?.dedupeKey && activeDedupeKeys.get(job.dedupeKey) === job.id) {
    activeDedupeKeys.delete(job.dedupeKey);
  }
};

const getRetryDelayMs = (job) => {
  const baseDelay = clampNumber(job.backoffMs, DEFAULT_BACKOFF_MS);
  if (!baseDelay) return 0;
  const exponent = Math.max(0, job.attemptsMade - 1);
  const delay = baseDelay * (2 ** exponent);
  return Math.min(delay, clampNumber(job.maxBackoffMs, 60_000));
};

const scheduleRun = (delayMs = 0) => {
  if (QUEUE_DISABLED) return;
  const targetRunAt = now() + Math.max(0, delayMs);
  if (scheduledRunTimer && scheduledRunAt !== null && scheduledRunAt <= targetRunAt) return;
  if (scheduledRunTimer) clearTimeout(scheduledRunTimer);
  scheduledRunAt = targetRunAt;
  scheduledRunTimer = setTimeout(() => {
    scheduledRunTimer = null;
    scheduledRunAt = null;
    void runNext();
  }, Math.max(0, delayMs));
};

const getNextReadyJob = () => {
  const currentTime = now();
  let nextIndex = -1;
  let nextAvailableAt = Infinity;

  for (let index = 0; index < memoryQueue.length; index += 1) {
    const job = memoryQueue[index];
    if (job.availableAt <= currentTime) {
      nextIndex = index;
      break;
    }
    nextAvailableAt = Math.min(nextAvailableAt, job.availableAt);
  }

  if (nextIndex >= 0) return { job: memoryQueue.splice(nextIndex, 1)[0], delayMs: 0 };
  return { job: null, delayMs: Number.isFinite(nextAvailableAt) ? nextAvailableAt - currentTime : null };
};

export const registerJobHandler = (type, handler) => {
  if (!type || typeof handler !== "function") return;
  handlers.set(String(type), handler);
};

export const registerJobQueueAdapter = (adapter = null) => {
  persistentAdapter = adapter && typeof adapter === "object" ? adapter : null;
  return { registered: Boolean(persistentAdapter), name: persistentAdapter?.name || null };
};

const runNext = async () => {
  if (running || QUEUE_DISABLED) return;
  const { job, delayMs } = getNextReadyJob();
  if (!job) {
    if (delayMs !== null) scheduleRun(delayMs);
    return;
  }
  running = true;
  const startedAt = Date.now();
  const context = getJobContext(job);
  job.attemptsMade += 1;
  job.startedAt = new Date().toISOString();
  await setJobStatus(job, "running", { startedAt: job.startedAt });
  try {
    const handler = handlers.get(job.type);
    if (!handler) {
      console.warn("[jobs] no handler registered", { type: job.type, id: job.id, context });
      await setJobStatus(job, "skipped", { reason: "no_handler" });
      clearDedupeKey(job);
    } else {
      console.log("[jobs] start", { type: job.type, id: job.id, attempt: job.attemptsMade, maxAttempts: job.maxAttempts, context });
      await handler(job.payload, job);
      console.log("[jobs] success", { type: job.type, id: job.id, attempt: job.attemptsMade, durationMs: Date.now() - startedAt, context });
      await setJobStatus(job, "succeeded", { durationMs: Date.now() - startedAt, completedAt: new Date().toISOString() });
      clearDedupeKey(job);
    }
  } catch (error) {
    const errorMessage = error?.message || error;
    const durationMs = Date.now() - startedAt;
    if (job.attemptsMade < job.maxAttempts) {
      const retryDelayMs = getRetryDelayMs(job);
      job.availableAt = now() + retryDelayMs;
      job.lastError = String(errorMessage || "Job failed");
      memoryQueue.push(job);
      console.warn("[jobs] retry scheduled", {
        type: job.type,
        id: job.id,
        attempt: job.attemptsMade,
        maxAttempts: job.maxAttempts,
        retryDelayMs,
        durationMs,
        context,
        error: errorMessage,
      });
      await setJobStatus(job, "retry_scheduled", { error: String(errorMessage || "Job failed"), retryDelayMs, nextRunAt: new Date(job.availableAt).toISOString() });
    } else {
      const deadLetter = {
        ...job,
        failedAt: new Date().toISOString(),
        error: String(errorMessage || "Job failed"),
      };
      deadLetterQueue.push(deadLetter);
      while (deadLetterQueue.length > MAX_DEAD_LETTERS) deadLetterQueue.shift();
      console.error("[jobs] failed", { type: job.type, id: job.id, attempt: job.attemptsMade, durationMs, context, error: errorMessage });
      await setJobStatus(job, "dead_letter", { error: String(errorMessage || "Job failed"), durationMs, failedAt: deadLetter.failedAt });
      clearDedupeKey(job);
    }
  } finally {
    running = false;
    if (memoryQueue.length) scheduleRun(0);
  }
};

export const enqueueJob = async (type, payload = {}, options = {}) => {
  const dedupeKey = options.dedupeKey || options.idempotencyKey || payload?.dedupeKey || payload?.idempotencyKey || null;
  const activeJobId = dedupeKey ? activeDedupeKeys.get(String(dedupeKey)) : null;
  if (activeJobId) {
    const existing = jobStatuses.get(activeJobId) || { id: activeJobId, type: String(type || "unknown") };
    console.log("[jobs] duplicate skipped", { type: existing.type, id: activeJobId, dedupeKey: String(dedupeKey), context: sanitizeForLog(options.context || payload?.context || {}) });
    return { accepted: true, duplicate: true, backend: "memory", job: existing };
  }

  const job = {
    id: `${Date.now()}-${++jobId}`,
    type: String(type || "unknown"),
    payload,
    context: options.context || null,
    attempts: Number(options.attempts || 0),
    attemptsMade: 0,
    maxAttempts: clampNumber(options.maxAttempts ?? options.attempts, DEFAULT_MAX_ATTEMPTS, 1),
    backoffMs: clampNumber(options.backoffMs, DEFAULT_BACKOFF_MS),
    maxBackoffMs: clampNumber(options.maxBackoffMs, 60_000),
    dedupeKey: dedupeKey ? String(dedupeKey) : null,
    availableAt: now() + clampNumber(options.delayMs, 0),
    createdAt: new Date().toISOString(),
  };

  if (QUEUE_DISABLED) {
    console.warn("[jobs] enqueue skipped", { type: job.type, id: job.id, fallback: "disabled", context: getJobContext(job) });
    return { accepted: false, fallback: "disabled", job };
  }

  if (job.dedupeKey) activeDedupeKeys.set(job.dedupeKey, job.id);
  memoryQueue.push(job);
  await setJobStatus(job, job.availableAt > now() ? "delayed" : "queued", {
    createdAt: job.createdAt,
    availableAt: new Date(job.availableAt).toISOString(),
  });
  if (persistentAdapter?.enqueue) {
    try {
      await persistentAdapter.enqueue(job);
    } catch (error) {
      console.warn("[jobs] persistence adapter enqueue failed, using memory fallback", { type: job.type, id: job.id, error: error?.message || error });
    }
  }
  console.log("[jobs] enqueue", {
    type: job.type,
    id: job.id,
    backend: "memory",
    delayMs: Math.max(0, job.availableAt - now()),
    maxAttempts: job.maxAttempts,
    dedupeKey: job.dedupeKey || null,
    context: getJobContext(job),
  });
  scheduleRun(Math.max(0, job.availableAt - now()));
  return { accepted: true, backend: "memory", job };
};

export const queueStatus = () => ({
  disabled: QUEUE_DISABLED,
  backend: persistentAdapter?.name || "memory",
  memoryFallback: true,
  pending: memoryQueue.filter((job) => job.availableAt <= now()).length,
  delayed: memoryQueue.filter((job) => job.availableAt > now()).length,
  deadLetters: deadLetterQueue.length,
  trackedStatuses: jobStatuses.size,
  activeDedupeKeys: activeDedupeKeys.size,
  handlers: Array.from(handlers.keys()),
  running,
});

export const getJobStatus = (id) => jobStatuses.get(id) || null;

export const getActiveJobStatusByDedupeKey = (dedupeKey = "") => {
  const safeKey = String(dedupeKey || "").trim();
  if (!safeKey) return null;
  const activeJobId = activeDedupeKeys.get(safeKey);
  if (!activeJobId) return null;
  return {
    jobId: activeJobId,
    status: jobStatuses.get(activeJobId) || null,
  };
};

export const listDeadLetterJobs = () => deadLetterQueue.map((job) => ({
  id: job.id,
  type: job.type,
  attemptsMade: job.attemptsMade,
  maxAttempts: job.maxAttempts,
  failedAt: job.failedAt,
  error: job.error,
  context: getJobContext(job),
}));
