import assert from "node:assert/strict";

const resetQueueModule = async () => {
  const cacheBuster = Date.now() + Math.random();
  return import(`../services/jobQueueService.js?test=${cacheBuster}`);
};

const run = async () => {
  process.env.JOBS_DISABLED = "false";
  process.env.SOCIAL_COMMENTS_FAST_REPLY_ENABLED = "false";
  process.env.SOCIAL_COMMENTS_PARALLEL_WORKERS = "4";

  const queueModule = await resetQueueModule();
  const { enqueueJob, registerJobHandler, queueStatus } = queueModule;

  const handled = [];
  registerJobHandler("test.social.comment.private_reply", async (payload = {}, job = {}) => {
    handled.push({
      commentId: payload.commentId || "",
      dedupeKey: job.dedupeKey || "",
    });
  });

  const first = await enqueueJob(
    "test.social.comment.private_reply",
    { commentId: "comment-1" },
    { dedupeKey: "social-comment:comment-1", maxAttempts: 1 }
  );
  const duplicate = await enqueueJob(
    "test.social.comment.private_reply",
    { commentId: "comment-1" },
    { dedupeKey: "social-comment:comment-1", maxAttempts: 1 }
  );

  assert.equal(first.accepted, true, "first job should be accepted");
  assert.equal(duplicate.duplicate, true, "duplicate job should be skipped by dedupe");
  assert.equal(queueStatus().configuredConcurrency, 1, "fast flag off must keep concurrency at 1");

  process.env.SOCIAL_COMMENTS_FAST_REPLY_ENABLED = "true";
  process.env.SOCIAL_COMMENTS_PARALLEL_WORKERS = "3";
  const fastQueueModule = await resetQueueModule();
  assert.equal(fastQueueModule.queueStatus().configuredConcurrency, 3, "fast flag should expose configured parallel workers");

  console.log(JSON.stringify({
    success: true,
    checks: {
      duplicate_job_deduped: true,
      fast_flag_off_keeps_single_worker: true,
      fast_flag_on_reads_parallel_workers: true,
    },
  }, null, 2));
};

run().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    message: error?.message || String(error),
    stack: error?.stack || "",
  }, null, 2));
  process.exit(1);
});
