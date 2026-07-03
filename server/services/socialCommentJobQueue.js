const LEGACY_MAX_CONCURRENCY = 2;
const LEGACY_MAX_RETRIES = 3;
const JOB_METRICS_WINDOW = 120;

const queue = [];
let activeJobs = 0;
let processedCount = 0;
let failedCount = 0;
let retryCount = 0;
let droppedCount = 0;
const jobDurationsMs = [];
let pumpScheduled = false;
let nextWakeTimer = null;

const text = (value = "") => String(value ?? "").trim();
const featureFlagEnabled = (value = "") => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const getQueueConcurrency = () => {
  if (!featureFlagEnabled(process.env.SOCIAL_COMMENTS_FAST_REPLY_ENABLED || "false")) {
    return LEGACY_MAX_CONCURRENCY;
  }
  return Math.max(1, Number(process.env.SOCIAL_COMMENTS_PARALLEL_WORKERS || 1) || 1);
};
const getQueueMaxRetries = () => {
  if (!featureFlagEnabled(process.env.SOCIAL_COMMENTS_FAST_REPLY_ENABLED || "false")) {
    return LEGACY_MAX_RETRIES;
  }
  return Math.max(1, Math.min(5, Number(process.env.SOCIAL_COMMENTS_JOB_MAX_RETRIES || LEGACY_MAX_RETRIES) || LEGACY_MAX_RETRIES));
};

const normalizeJob = (job = {}) => ({
  type: text(job.type || ""),
  tenant_id: Number(job.tenant_id || job.tenantId || 0) || 0,
  platform: text(job.platform || ""),
  post_id: text(job.post_id || job.postId || ""),
  comment_id: text(job.comment_id || job.commentId || ""),
  external_comment_id: text(job.external_comment_id || job.comment_id || job.commentId || ""),
  payload: job.payload && typeof job.payload === "object" ? job.payload : {},
  created_at: text(job.created_at || job.createdAt || new Date().toISOString()),
  attempts: Number(job.attempts || 0) || 0,
  available_at: Number(job.available_at || job.availableAt || Date.now()) || Date.now(),
});

const getJobContext = (job = {}) => ({
  tenant_id: job.tenant_id,
  platform: job.platform,
  post_id: job.post_id,
  comment_id: job.comment_id,
  external_comment_id: job.external_comment_id,
});

const pushRollingMetric = (collection, value, limit = JOB_METRICS_WINDOW) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  collection.push(numeric);
  while (collection.length > limit) collection.shift();
};

const summarizeRollingMetric = (collection = []) => {
  const values = collection.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value));
  if (!values.length) {
    return { avg: 0, p95: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    avg: Number((total / sorted.length).toFixed(2)),
    p95: Number(sorted[index].toFixed(2)),
  };
};

const schedulePump = (delayMs = 0) => {
  if (pumpScheduled) return;
  pumpScheduled = true;
  if (nextWakeTimer) {
    clearTimeout(nextWakeTimer);
    nextWakeTimer = null;
  }
  nextWakeTimer = setTimeout(() => {
    pumpScheduled = false;
    nextWakeTimer = null;
    void pumpQueue();
  }, Math.max(0, delayMs));
};

const dequeueReadyJob = () => {
  const now = Date.now();
  let nextDelayedDelay = null;

  for (let index = 0; index < queue.length; index += 1) {
    const job = queue[index];
    if (job.available_at <= now) {
      queue.splice(index, 1);
      return { job, delayMs: 0 };
    }
    const delayMs = job.available_at - now;
    nextDelayedDelay = nextDelayedDelay === null ? delayMs : Math.min(nextDelayedDelay, delayMs);
  }

  return { job: null, delayMs: nextDelayedDelay };
};

const finalizeJob = async (job, status, patch = {}) => {
  if (!job) return;
  console.log(status, {
    type: job.type,
    tenant_id: job.tenant_id,
    platform: job.platform,
    post_id: job.post_id,
    comment_id: job.comment_id,
    external_comment_id: job.external_comment_id,
    attempts: job.attempts,
    ...patch,
  });
};

export const processSocialCommentJob = async (job = {}) => {
  const normalizedJob = normalizeJob(job);
  if (normalizedJob.type !== "social_comment_automation") {
    throw new Error(`Unsupported social comment job type: ${normalizedJob.type || "unknown"}`);
  }
  const dbModule = await import("../database/db.js");
  const db = dbModule.default || dbModule;
  const existing = await db.query(
    `
    SELECT public_reply_status, dm_status, like_status
    FROM social_comment_automation_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND comment_id = $3::text
    LIMIT 1
    `,
    [normalizedJob.tenant_id, normalizedJob.platform, normalizedJob.comment_id]
  ).catch(() => ({ rows: [] }));
  const currentRow = existing.rows?.[0] || null;
  if (["sent"].includes(String(currentRow?.public_reply_status || "").toLowerCase()) ||
      ["sent"].includes(String(currentRow?.dm_status || "").toLowerCase()) ||
      ["sent"].includes(String(currentRow?.like_status || "").toLowerCase())) {
    return {
      success: true,
      skipped: true,
      reason: "already_completed",
      job: normalizedJob,
    };
  }
  const module = await import("./socialCommentAutomationService.js");
  const handler = module.storeSocialCommentAutomationRuns;
  if (typeof handler !== "function") {
    throw new Error("social_comment_automation handler missing");
  }
  return handler({
    tenantId: normalizedJob.tenant_id,
    deferAutomation: false,
    events: [
      {
        ...(normalizedJob.payload?.row || {}),
        __job_only: true,
        row: normalizedJob.payload?.row || normalizedJob.payload || {},
        tenant_id: normalizedJob.tenant_id,
        platform: normalizedJob.platform,
        post_id: normalizedJob.post_id,
        comment_id: normalizedJob.comment_id,
      },
    ],
  });
};

const pumpQueue = async () => {
  const maxConcurrency = getQueueConcurrency();
  if (activeJobs >= maxConcurrency) return;
  while (activeJobs < maxConcurrency) {
    const { job, delayMs } = dequeueReadyJob();
    if (!job) {
      if (delayMs !== null) schedulePump(delayMs);
      return;
    }

    activeJobs += 1;
    job.attempts += 1;
    console.log("SOCIAL_COMMENT_JOB_STARTED", {
      type: job.type,
      tenant_id: job.tenant_id,
      platform: job.platform,
      post_id: job.post_id,
      comment_id: job.comment_id,
      external_comment_id: job.external_comment_id,
      attempts: job.attempts,
    });

    void (async () => {
      const startedAt = Date.now();
      try {
        await processSocialCommentJob(job);
        processedCount += 1;
        console.log("SOCIAL_COMMENT_JOB_DONE", {
          type: job.type,
          tenant_id: job.tenant_id,
          platform: job.platform,
          post_id: job.post_id,
          comment_id: job.comment_id,
          external_comment_id: job.external_comment_id,
          attempts: job.attempts,
        });
      } catch (error) {
        failedCount += 1;
        const errorMessage = error?.message || String(error || "social comment job failed");
        console.warn("SOCIAL_COMMENT_JOB_FAILED", {
          type: job.type,
          tenant_id: job.tenant_id,
          platform: job.platform,
          post_id: job.post_id,
          comment_id: job.comment_id,
          external_comment_id: job.external_comment_id,
          attempts: job.attempts,
          message: errorMessage,
        });

        if (job.attempts <= getQueueMaxRetries()) {
          retryCount += 1;
          job.available_at = Date.now() + Math.min(1000 * job.attempts, 10_000);
          queue.push(job);
          console.log("SOCIAL_COMMENT_JOB_RETRY", {
            type: job.type,
            tenant_id: job.tenant_id,
            platform: job.platform,
            post_id: job.post_id,
            comment_id: job.comment_id,
            external_comment_id: job.external_comment_id,
            attempts: job.attempts,
            next_available_at: new Date(job.available_at).toISOString(),
          });
          schedulePump(job.available_at - Date.now());
        } else {
          droppedCount += 1;
          console.warn("SOCIAL_COMMENT_JOB_DROPPED", {
            type: job.type,
            tenant_id: job.tenant_id,
            platform: job.platform,
            post_id: job.post_id,
            comment_id: job.comment_id,
            external_comment_id: job.external_comment_id,
            attempts: job.attempts,
            message: errorMessage,
          });
        }
      } finally {
        pushRollingMetric(jobDurationsMs, Date.now() - startedAt);
        activeJobs = Math.max(0, activeJobs - 1);
        if (queue.length > 0) schedulePump(0);
      }
    })();
  }
};

export const enqueueSocialCommentJob = async (job = {}) => {
  const normalizedJob = normalizeJob(job);
  if (normalizedJob.type !== "social_comment_automation") {
    throw new Error(`Unsupported social comment job type: ${normalizedJob.type || "unknown"}`);
  }
  queue.push(normalizedJob);
  console.log("SOCIAL_COMMENT_JOB_ENQUEUED", {
    type: normalizedJob.type,
    tenant_id: normalizedJob.tenant_id,
    platform: normalizedJob.platform,
    post_id: normalizedJob.post_id,
    comment_id: normalizedJob.comment_id,
    external_comment_id: normalizedJob.external_comment_id,
    queue_length: queue.length,
    context: getJobContext(normalizedJob),
    latency_trace: normalizedJob.payload?.latency_trace || {},
  });
  schedulePump(0);
  return { accepted: true, queue_length: queue.length };
};

export const startSocialCommentJobWorker = () => {
  if (globalThis.__SOCIAL_COMMENT_JOB_WORKER_STARTED__) {
    return { started: false, reason: "already_started" };
  }
  globalThis.__SOCIAL_COMMENT_JOB_WORKER_STARTED__ = true;
  console.log("SOCIAL_COMMENT_JOB_WORKER_STARTED", {
    concurrency: getQueueConcurrency(),
    retries: getQueueMaxRetries(),
    fast_reply_enabled: featureFlagEnabled(process.env.SOCIAL_COMMENTS_FAST_REPLY_ENABLED || "false"),
    at: new Date().toISOString(),
  });
  schedulePump(0);
  return { started: true, concurrency: getQueueConcurrency() };
};

export const getSocialCommentJobQueueStatus = () => ({
  queue_length: queue.length,
  active_jobs: activeJobs,
  processed_count: processedCount,
  failed_count: failedCount,
  retry_count: retryCount,
  dropped_count: droppedCount,
  job_avg_ms: summarizeRollingMetric(jobDurationsMs).avg,
  job_p95_ms: summarizeRollingMetric(jobDurationsMs).p95,
  configured_concurrency: getQueueConcurrency(),
  configured_retries: getQueueMaxRetries(),
  fast_reply_enabled: featureFlagEnabled(process.env.SOCIAL_COMMENTS_FAST_REPLY_ENABLED || "false"),
});
