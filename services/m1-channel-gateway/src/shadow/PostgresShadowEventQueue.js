import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import { retryDecision } from '../queue/retryPolicy.js';

export class PostgresShadowEventQueue {
  constructor(pool, { workerId = `shadow-${process.pid}-${randomUUID()}`, staleAfterSeconds = 120 } = {}) {
    this.pool = pool;
    this.workerId = workerId;
    this.staleAfterSeconds = Math.max(30, Number(staleAfterSeconds));
  }

  async claimNext() {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(`
        WITH candidate AS (
          SELECT id FROM erp_channel_outbox_events
          WHERE status IN ('pending', 'retrying') AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE erp_channel_outbox_events event SET
          status = 'processing', attempts = attempts + 1,
          locked_by = $1, locked_at = NOW(), updated_at = NOW()
        FROM candidate WHERE event.id = candidate.id RETURNING event.*
      `, [this.workerId]);
      return result.rows[0] || null;
    });
  }

  async complete(event, comparison, startedAt) {
    return withTransaction(this.pool, async (client) => {
      const durationMs = Date.now() - startedAt;
      await client.query(`
        INSERT INTO channel_shadow_comparison_results (
          event_id, event_type, tenant_id, internal_entity_id, shadow_status,
          expected_result, actual_result, difference, processing_latency_ms, processed_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,NOW())
        ON CONFLICT (event_id) DO UPDATE SET
          shadow_status = EXCLUDED.shadow_status,
          expected_result = EXCLUDED.expected_result,
          actual_result = EXCLUDED.actual_result,
          difference = EXCLUDED.difference,
          error_code = NULL, error = NULL,
          processing_latency_ms = EXCLUDED.processing_latency_ms,
          processed_at = NOW(), updated_at = NOW()
      `, [event.event_id, event.event_type, event.tenant_id, comparison.internalEntityId,
        comparison.status, JSON.stringify(comparison.expected), JSON.stringify(comparison.actual),
        JSON.stringify(comparison.difference), durationMs]);
      await client.query(`
        UPDATE erp_channel_outbox_events SET status = 'processed', processed_at = NOW(),
          locked_by = NULL, locked_at = NULL, last_error_code = NULL, last_error = NULL, updated_at = NOW()
        WHERE id = $1 AND locked_by = $2
      `, [event.id, this.workerId]);
      await this.#recordAttempt(client, event, 'processed', null, durationMs, startedAt);
      return { status: 'processed', comparison, durationMs };
    });
  }

  async fail(event, error, startedAt) {
    return withTransaction(this.pool, async (client) => {
      const decision = retryDecision(event.attempts, event.max_attempts);
      const status = decision.status === 'needs_manual_review' ? 'dead_letter' : decision.status;
      const durationMs = Date.now() - startedAt;
      const errorCode = String(error.code || 'SHADOW_PROCESSING_FAILED').slice(0, 120);
      const safeError = String(error.message || error).slice(0, 2000);
      await client.query(`
        UPDATE erp_channel_outbox_events SET status = $2::varchar,
          next_attempt_at = COALESCE($3, next_attempt_at),
          locked_by = NULL, locked_at = NULL, last_error_code = $4, last_error = $5,
          failed_at = CASE WHEN $2::text = 'dead_letter' THEN NOW() ELSE failed_at END,
          updated_at = NOW()
        WHERE id = $1 AND locked_by = $6
      `, [event.id, status, decision.nextRetryAt, errorCode, safeError, this.workerId]);
      await client.query(`
        INSERT INTO channel_shadow_comparison_results (
          event_id, event_type, tenant_id, internal_entity_id, shadow_status,
          expected_result, actual_result, difference, error_code, error,
          processing_latency_ms, processed_at
        ) VALUES ($1,$2,$3,$4,'failed','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$5,$6,$7,NOW())
        ON CONFLICT (event_id) DO UPDATE SET shadow_status = 'failed', error_code = EXCLUDED.error_code,
          error = EXCLUDED.error, processing_latency_ms = EXCLUDED.processing_latency_ms,
          processed_at = NOW(), updated_at = NOW()
      `, [event.event_id, event.event_type, event.tenant_id, event.aggregate_id,
        errorCode, safeError, durationMs]);
      await this.#recordAttempt(client, event, status, { code: errorCode, message: safeError }, durationMs, startedAt);
      return { status, durationMs };
    });
  }

  async recoverStale() {
    return withTransaction(this.pool, async (client) => {
      const stale = await client.query(`
        UPDATE erp_channel_outbox_events SET status = 'retrying', next_attempt_at = NOW(),
          locked_by = NULL, locked_at = NULL, last_error_code = 'STALE_SHADOW_WORKER',
          last_error = 'Recovered expired shadow worker lock', updated_at = NOW()
        WHERE status = 'processing' AND locked_at < NOW() - ($1 * INTERVAL '1 second')
        RETURNING *
      `, [this.staleAfterSeconds]);
      for (const event of stale.rows) {
        await this.#recordAttempt(client, event, 'recovered', {
          code: 'STALE_SHADOW_WORKER', message: 'Recovered expired shadow worker lock',
        }, 0, Date.now());
      }
      return stale.rowCount;
    });
  }

  async retryDeadLetter(eventId) {
    const result = await this.pool.query(`
      UPDATE erp_channel_outbox_events SET status = 'retrying', attempts = 0,
        next_attempt_at = NOW(), failed_at = NULL, last_error_code = NULL,
        last_error = NULL, locked_by = NULL, locked_at = NULL, updated_at = NOW()
      WHERE event_id = $1::uuid AND status = 'dead_letter' RETURNING *
    `, [eventId]);
    return result.rows[0] || null;
  }

  async metrics(tenantId = null) {
    const values = tenantId == null ? [] : [tenantId];
    const where = tenantId == null ? '' : 'WHERE tenant_id = $1';
    const [statuses, comparisons, age, latency] = await Promise.all([
      this.pool.query(`SELECT status, COUNT(*)::int count FROM erp_channel_outbox_events ${where} GROUP BY status`, values),
      this.pool.query(`SELECT shadow_status, COUNT(*)::int count FROM channel_shadow_comparison_results ${where} GROUP BY shadow_status`, values),
      this.pool.query(`SELECT COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(created_at)), 0)::int age
        FROM erp_channel_outbox_events ${tenantId == null ? "WHERE status IN ('pending','retrying')" : "WHERE tenant_id = $1 AND status IN ('pending','retrying')"}`, values),
      this.pool.query(`SELECT COALESCE(AVG(processing_latency_ms), 0)::numeric(12,2) latency
        FROM channel_shadow_comparison_results ${where}`, values),
    ]);
    const statusMap = Object.fromEntries(statuses.rows.map((item) => [item.status, Number(item.count)]));
    const comparisonMap = Object.fromEntries(comparisons.rows.map((item) => [item.shadow_status, Number(item.count)]));
    return {
      metrics: {
        outbox_pending_total: statusMap.pending || 0,
        outbox_processing_total: statusMap.processing || 0,
        outbox_processed_total: statusMap.processed || 0,
        outbox_failed_total: (statusMap.failed || 0) + (statusMap.retrying || 0),
        outbox_dead_letter_total: statusMap.dead_letter || 0,
        shadow_matched_total: comparisonMap.matched || 0,
        shadow_mismatched_total: comparisonMap.mismatched || 0,
        shadow_failed_total: comparisonMap.failed || 0,
        processing_latency_ms: Number(latency.rows[0]?.latency || 0),
        oldest_pending_event_age_seconds: age.rows[0]?.age || 0,
      },
      statuses: statuses.rows,
      comparisons: comparisons.rows,
    };
  }

  async #recordAttempt(client, event, result, error, durationMs, startedAt) {
    await client.query(`
      INSERT INTO channel_outbox_attempt_history (
        event_id, attempt, worker_id, result, error_code, error, duration_ms, started_at, finished_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,TO_TIMESTAMP($8::double precision / 1000),NOW())
      ON CONFLICT (event_id, attempt) DO NOTHING
    `, [event.event_id, event.attempts, this.workerId, result,
      error?.code || null, error?.message || null, durationMs, Number(startedAt)]);
  }
}
