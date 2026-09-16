// Sync-run bookkeeping + the advisory lock that keeps one run per job at a time.
// Stored messages are redacted and bounded; no Amazon payloads are written here.

import db from "../../database/db.js";
import { amazonMarketplaceId } from "./amazonConfig.js";
import { redactAmazonText, toSafeError } from "./amazonErrors.js";

// Class id for pg_try_advisory_lock(int, int); the second int is the job.
const AMAZON_LOCK_CLASS = 74017301;
export const AMAZON_JOBS = Object.freeze({
  connection_test: 1,
  orders: 2,
  listings: 3,
  inventory: 4,
  pricing: 5,
  sku_suggestions: 6,
  order_projection: 7,
});

export const withAmazonJobLock = async (jobType, fn, { database = db } = {}) => {
  const jobKey = AMAZON_JOBS[jobType];
  if (!jobKey) throw new Error(`unknown Amazon job ${jobType}`);
  const lockClient = await database.connect();
  let locked = false;
  try {
    const result = await lockClient.query("SELECT pg_try_advisory_lock($1, $2) AS locked", [AMAZON_LOCK_CLASS, jobKey]);
    locked = Boolean(result.rows[0]?.locked);
    if (!locked) return { skipped: true, reason: "already_running" };
    return await fn();
  } finally {
    if (locked) {
      await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [AMAZON_LOCK_CLASS, jobKey]).catch(() => {});
    }
    lockClient.release();
  }
};

export const isAmazonJobRunning = async (jobType, { database = db } = {}) => {
  const jobKey = AMAZON_JOBS[jobType];
  const result = await database.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_locks
       WHERE locktype = 'advisory' AND classid = $1::int::oid AND objid = $2::int::oid AND granted
     ) AS running`,
    [AMAZON_LOCK_CLASS, jobKey]
  );
  return Boolean(result.rows[0]?.running);
};

export const startSyncRun = async ({ tenantId, jobType, trigger = "manual", requestedBy = null, cursorBefore = null, database = db }) => {
  const result = await database.query(
    `INSERT INTO amazon_sync_runs (tenant_id, marketplace_id, job_type, trigger, requested_by, cursor_before)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, started_at`,
    [tenantId, amazonMarketplaceId(), jobType, trigger, requestedBy, cursorBefore]
  );
  return result.rows[0];
};

export const finishSyncRun = async ({ runId, status, counts = {}, cursorAfter = null, error = null, details = null, database = db }) => {
  const safe = error ? toSafeError(error) : null;
  await database.query(
    `UPDATE amazon_sync_runs
     SET status = $2, finished_at = NOW(),
         records_read = $3, records_created = $4, records_updated = $5, records_failed = $6,
         cursor_after = $7, error_category = $8, error_message = $9, details = $10::jsonb
     WHERE id = $1`,
    [
      runId,
      status,
      Number(counts.read || 0),
      Number(counts.created || 0),
      Number(counts.updated || 0),
      Number(counts.failed || 0),
      cursorAfter,
      safe?.category || null,
      safe ? redactAmazonText(safe.message, 500) : null,
      details ? JSON.stringify(details) : null,
    ]
  );
};

export const listSyncRuns = async ({ tenantId, jobType = "", limit = 50, database = db } = {}) => {
  const params = [tenantId];
  let where = "tenant_id = $1";
  if (jobType) {
    params.push(jobType);
    where += ` AND job_type = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const result = await database.query(
    `SELECT id, job_type, trigger, requested_by, status, started_at, finished_at,
            records_read, records_created, records_updated, records_failed,
            cursor_before, cursor_after, error_category, error_message, details
     FROM amazon_sync_runs WHERE ${where}
     ORDER BY started_at DESC LIMIT $${params.length}`,
    params
  );
  return result.rows;
};

export const latestRunsByJob = async ({ tenantId, database = db }) => {
  const result = await database.query(
    `SELECT DISTINCT ON (job_type) job_type, id, status, trigger, started_at, finished_at,
            records_read, records_created, records_updated, records_failed, error_category, error_message
     FROM amazon_sync_runs WHERE tenant_id = $1
     ORDER BY job_type, started_at DESC`,
    [tenantId]
  );
  return Object.fromEntries(result.rows.map((row) => [row.job_type, row]));
};

export const lastSuccessfulRun = async ({ tenantId, jobType, database = db }) => {
  const result = await database.query(
    `SELECT id, finished_at FROM amazon_sync_runs
     WHERE tenant_id = $1 AND job_type = $2 AND status IN ('succeeded','partial')
     ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
    [tenantId, jobType]
  );
  return result.rows[0] || null;
};

// Runs left 'running' by a process that died (deploy/restart) are closed on boot.
export const closeAbandonedRuns = async ({ database = db } = {}) => {
  await database.query(
    `UPDATE amazon_sync_runs
     SET status = 'failed', finished_at = NOW(), error_category = 'internal',
         error_message = 'interrupted (server restarted before the run finished)'
     WHERE status = 'running' AND started_at < NOW() - INTERVAL '2 hours'`
  );
};

export const getCursor = async ({ tenantId, jobType, database = db }) => {
  const result = await database.query(
    `SELECT checkpoint_at FROM amazon_sync_cursors WHERE tenant_id = $1 AND marketplace_id = $2 AND job_type = $3`,
    [tenantId, amazonMarketplaceId(), jobType]
  );
  return result.rows[0]?.checkpoint_at || null;
};

export const saveCursor = async ({ tenantId, jobType, checkpointAt, database = db }) => {
  await database.query(
    `INSERT INTO amazon_sync_cursors (tenant_id, marketplace_id, job_type, checkpoint_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (tenant_id, marketplace_id, job_type)
     DO UPDATE SET checkpoint_at = GREATEST(amazon_sync_cursors.checkpoint_at, EXCLUDED.checkpoint_at), updated_at = NOW()`,
    [tenantId, amazonMarketplaceId(), jobType, checkpointAt]
  );
};
