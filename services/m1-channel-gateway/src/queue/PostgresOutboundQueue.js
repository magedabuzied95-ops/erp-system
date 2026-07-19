import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import { retryDecision } from './retryPolicy.js';

const row = (result) => result.rows[0] || null;

const MANUAL_REVIEW_CODES = new Set([
  'CONVERSATION_HEADER_MISMATCH', 'USERNAME_MISMATCH', 'CONVERSATION_NOT_FOUND',
  'LOW_IDENTITY_CONFIDENCE', 'CONVERSATION_FINGERPRINT_MISMATCH',
  'COMPOSER_NOT_AVAILABLE', 'UNSUPPORTED_IN_CURRENT_PHASE',
  'AI_AUTO_SEND_FORBIDDEN', 'MANUAL_ACTION_REQUIRED',
]);

export function queueFailureDecision(error = {}, attempts = 0, maxAttempts = 7, now = new Date()) {
  const code = String(error.code || '').toUpperCase();
  // Authentication loss is recoverable operator downtime. Keep the durable
  // job queued with the normal backoff so it can resume after manual login;
  // never hammer the provider login page and never discard the message.
  if (code === 'LOGIN_REQUIRED' || code === 'SESSION_EXPIRED') {
    return retryDecision(attempts, maxAttempts, now);
  }
  return error.needsManualReview || MANUAL_REVIEW_CODES.has(code)
    ? { status: 'needs_manual_review', nextRetryAt: null, delaySeconds: null }
    : retryDecision(attempts, maxAttempts, now);
}

export class PostgresOutboundQueue {
  constructor(pool, { workerId = `gateway-${process.pid}-${randomUUID()}`, staleAfterSeconds = 120 } = {}) {
    this.pool = pool;
    this.workerId = workerId;
    this.staleAfterSeconds = Math.max(30, Number(staleAfterSeconds));
  }

  async enqueue({ jobKey = randomUUID(), idempotencyKey, tenantId, connectionId, externalConversationId,
    internalConversationId = null, payload, priority = 100, maxAttempts = 7 }) {
    if (!idempotencyKey) throw new Error('idempotencyKey is required');
    if (!externalConversationId) throw new Error('externalConversationId is required');

    return withTransaction(this.pool, async (client) => {
      await client.query(`
        INSERT INTO channel_conversation_map (
          tenant_id, connection_id, external_conversation_id, internal_conversation_id
        ) VALUES ($1,$2,$3,$4)
        ON CONFLICT (connection_id, external_conversation_id) DO UPDATE SET
          internal_conversation_id = COALESCE(channel_conversation_map.internal_conversation_id, EXCLUDED.internal_conversation_id),
          updated_at = NOW()
      `, [tenantId, connectionId, externalConversationId, internalConversationId]);
      const mappedConversation = await client.query(`
        SELECT internal_conversation_id
        FROM channel_conversation_map
        WHERE connection_id = $1 AND external_conversation_id = $2
        LIMIT 1
      `, [connectionId, externalConversationId]);
      const resolvedInternalConversationId = internalConversationId
        || mappedConversation.rows[0]?.internal_conversation_id
        || null;
      const inserted = await client.query(`
        INSERT INTO outbound_message_jobs (
          job_key, idempotency_key, tenant_id, connection_id, external_conversation_id,
          internal_conversation_id, payload, priority, max_attempts
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING *
      `, [jobKey, idempotencyKey, tenantId, connectionId, externalConversationId,
        resolvedInternalConversationId, JSON.stringify(payload), priority, maxAttempts]);

      if (inserted.rowCount) return { job: row(inserted), duplicate: false };
      const existing = await client.query(
        'SELECT * FROM outbound_message_jobs WHERE tenant_id = $1 AND idempotency_key = $2',
        [tenantId, idempotencyKey],
      );
      return { job: row(existing), duplicate: true };
    });
  }

  async claimNext() {
    return withTransaction(this.pool, async (client) => {
      const candidates = await client.query(`
        SELECT * FROM outbound_message_jobs
        WHERE status IN ('queued', 'retrying') AND next_retry_at <= NOW()
        ORDER BY priority ASC, next_retry_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 25
      `);

      for (const job of candidates.rows) {
        const lane = await client.query(`
          INSERT INTO channel_queue_lanes (
            tenant_id, connection_id, external_conversation_id, job_id, locked_by, locked_at
          ) VALUES ($1,$2,$3,$4,$5,NOW())
          ON CONFLICT (tenant_id, connection_id, external_conversation_id) DO UPDATE SET
            job_id = EXCLUDED.job_id,
            locked_by = EXCLUDED.locked_by,
            locked_at = EXCLUDED.locked_at,
            updated_at = NOW()
          WHERE channel_queue_lanes.locked_at IS NULL
             OR channel_queue_lanes.locked_at < NOW() - ($6 * INTERVAL '1 second')
          RETURNING job_id
        `, [job.tenant_id, job.connection_id, job.external_conversation_id, job.id,
          this.workerId, this.staleAfterSeconds]);
        if (!lane.rowCount) continue;

        const claimed = await client.query(`
          UPDATE outbound_message_jobs SET
            status = 'processing', attempts = attempts + 1, locked_by = $2,
            locked_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `, [job.id, this.workerId]);
        return row(claimed);
      }
      return null;
    });
  }

  async complete(jobId, { providerMessageId = null, confirmed = false } = {}) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(`
        UPDATE outbound_message_jobs SET
          status = $3, provider_message_id = COALESCE($2, provider_message_id),
          sent_at = COALESCE(sent_at, NOW()), confirmed_at = CASE WHEN $4 THEN NOW() ELSE confirmed_at END,
          locked_by = NULL, locked_at = NULL, last_error_code = NULL, last_error_message = NULL,
          updated_at = NOW()
        WHERE id = $1 AND status = 'processing' AND locked_by = $5
        RETURNING *
      `, [jobId, providerMessageId, confirmed ? 'confirmed' : 'sent_unconfirmed', confirmed, this.workerId]);
      const completed = row(result);
      if (!completed) throw new Error(`Job ${jobId} is not owned by ${this.workerId}`);
      const conversation = await client.query(`
        SELECT id FROM channel_conversation_map
        WHERE connection_id = $1 AND external_conversation_id = $2
        LIMIT 1
      `, [completed.connection_id, completed.external_conversation_id]);
      await client.query(`
        INSERT INTO channel_message_map (
          tenant_id, connection_id, conversation_map_id, external_conversation_id,
          external_message_id, internal_message_id, direction, status, dedupe_hash,
          idempotency_key, provider_timestamp, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,'outbound',$7,$8,$9,NOW(),$10::jsonb)
        ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
          external_message_id = COALESCE(EXCLUDED.external_message_id, channel_message_map.external_message_id),
          status = EXCLUDED.status, updated_at = NOW()
      `, [completed.tenant_id, completed.connection_id, conversation.rows[0]?.id || null,
        completed.external_conversation_id, completed.provider_message_id,
        completed.payload?.metadata?.internal_message_id || null,
        completed.status, completed.payload?.dedupe_hash || null, completed.idempotency_key,
        JSON.stringify({ job_key: completed.job_key })]);
      await this.#releaseLane(client, completed);
      await client.query(`
        INSERT INTO channel_gateway_outbox_events (event_key, tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES ($1,$2,'outbound_message_job',$3,'channel.message.status',$4::jsonb)
        ON CONFLICT (event_key) DO NOTHING
      `, [`status:${completed.job_key}:${completed.status}`, completed.tenant_id, String(completed.id), JSON.stringify({
        tenant_id: completed.tenant_id,
        internal_conversation_id: completed.internal_conversation_id,
        internal_message_id: completed.payload?.metadata?.internal_message_id || null,
        provider_message_id: completed.provider_message_id || completed.job_key,
        delivery_status: completed.status,
        job_key: completed.job_key,
      })]);
      return completed;
    });
  }

  async fail(jobId, error = {}) {
    return withTransaction(this.pool, async (client) => {
      const current = await client.query(
        `SELECT * FROM outbound_message_jobs WHERE id = $1 AND status = 'processing' AND locked_by = $2 FOR UPDATE`,
        [jobId, this.workerId],
      );
      const job = row(current);
      if (!job) throw new Error(`Job ${jobId} is not owned by ${this.workerId}`);
      const decision = queueFailureDecision(error, job.attempts, job.max_attempts);
      const updated = await client.query(`
        UPDATE outbound_message_jobs SET
          status = $2, next_retry_at = COALESCE($3, next_retry_at),
          last_error_code = $4, last_error_message = $5, last_error_at = NOW(),
          locked_by = NULL, locked_at = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *
      `, [jobId, decision.status, decision.nextRetryAt,
        String(error.code || 'SEND_FAILED').slice(0, 120), String(error.message || error).slice(0, 4000)]);
      await this.#releaseLane(client, job);
      const failed = row(updated);
      await client.query(`
        INSERT INTO channel_gateway_outbox_events (event_key, tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES ($1,$2,'outbound_message_job',$3,'channel.message.status',$4::jsonb)
        ON CONFLICT (event_key) DO NOTHING
      `, [`status:${failed.job_key}:${failed.status}:${failed.attempts}`, failed.tenant_id, String(failed.id), JSON.stringify({
        tenant_id: failed.tenant_id,
        internal_conversation_id: failed.internal_conversation_id,
        internal_message_id: failed.payload?.metadata?.internal_message_id || null,
        provider_message_id: failed.provider_message_id || failed.job_key,
        delivery_status: failed.status,
        delivery_error: String(error.message || error),
        error_code: String(error.code || 'SEND_FAILED'),
        job_key: failed.job_key,
      })]);
      return failed;
    });
  }

  async recoverStale() {
    return withTransaction(this.pool, async (client) => {
      const stale = await client.query(`
        SELECT * FROM outbound_message_jobs
        WHERE status = 'processing' AND locked_at < NOW() - ($1 * INTERVAL '1 second')
        FOR UPDATE SKIP LOCKED
      `, [this.staleAfterSeconds]);
      let recovered = 0;
      let manualReview = 0;
      for (const job of stale.rows) {
        const decision = retryDecision(job.attempts, job.max_attempts);
        await client.query(`
          UPDATE outbound_message_jobs SET status = $2, next_retry_at = COALESCE($3, NOW()),
            locked_by = NULL, locked_at = NULL, last_error_code = 'STALE_WORKER_RECOVERY',
            last_error_message = 'Recovered after worker restart or expired processing lock',
            last_error_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [job.id, decision.status, decision.nextRetryAt]);
        await this.#releaseLane(client, job, false);
        recovered += 1;
        if (decision.status === 'needs_manual_review') manualReview += 1;
      }
      await client.query(`
        UPDATE channel_queue_lanes SET job_id = NULL, locked_by = NULL, locked_at = NULL, updated_at = NOW()
        WHERE locked_at < NOW() - ($1 * INTERVAL '1 second')
      `, [this.staleAfterSeconds]);
      return { recovered, manualReview };
    });
  }

  async getByKey(jobKey, tenantId = null) {
    const values = tenantId == null ? [jobKey] : [jobKey, tenantId];
    const result = await this.pool.query(
      `SELECT * FROM outbound_message_jobs WHERE job_key = $1${tenantId == null ? '' : ' AND tenant_id = $2'}`,
      values,
    );
    return row(result);
  }

  async metrics(tenantId = null) {
    const values = tenantId == null ? [] : [tenantId];
    const result = await this.pool.query(`
      SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest_at
      FROM outbound_message_jobs ${tenantId == null ? '' : 'WHERE tenant_id = $1'}
      GROUP BY status ORDER BY status
    `, values);
    return result.rows;
  }

  async reconcile(jobKey, { status, externalMessageId = null, reason = '' } = {}) {
    if (!['confirmed', 'needs_manual_review'].includes(status)) throw Object.assign(new Error('Invalid reconciliation status'), { code: 'INVALID_RECONCILIATION_STATUS', status: 400 });
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query(`
        UPDATE outbound_message_jobs SET status=$2,
          provider_message_id=COALESCE(NULLIF($3,''),provider_message_id),
          confirmed_at=CASE WHEN $2='confirmed' THEN NOW() ELSE confirmed_at END,
          last_error_code=CASE WHEN $2='needs_manual_review' THEN 'RECONCILIATION_UNRESOLVED' ELSE NULL END,
          last_error_message=CASE WHEN $2='needs_manual_review' THEN $4 ELSE NULL END,
          updated_at=NOW()
        WHERE job_key=$1 AND status IN ('sent_unconfirmed','sent','needs_manual_review')
        RETURNING *
      `, [jobKey, status, externalMessageId, reason]);
      const job = row(updated);
      if (!job) return null;
      await client.query(`
        INSERT INTO channel_gateway_outbox_events (event_key, tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES ($1,$2,'outbound_message_job',$3,'channel.message.status',$4::jsonb)
        ON CONFLICT (event_key) DO NOTHING
      `, [`status:${job.job_key}:${status}:reconciled`, job.tenant_id, String(job.id), JSON.stringify({ tenant_id: job.tenant_id, internal_conversation_id: job.internal_conversation_id, internal_message_id: job.payload?.metadata?.internal_message_id || null, provider_message_id: job.provider_message_id || job.job_key, delivery_status: status, delivery_error: reason, job_key: job.job_key })]);
      return job;
    });
  }

  async #releaseLane(client, job, requireOwner = true) {
    await client.query(`
      UPDATE channel_queue_lanes SET job_id = NULL, locked_by = NULL, locked_at = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND connection_id = $2 AND external_conversation_id = $3
        AND job_id = $4 ${requireOwner ? 'AND locked_by = $5' : ''}
    `, requireOwner
      ? [job.tenant_id, job.connection_id, job.external_conversation_id, job.id, this.workerId]
      : [job.tenant_id, job.connection_id, job.external_conversation_id, job.id]);
  }
}
