import { retryDecision } from '../queue/retryPolicy.js';
import { withTransaction } from '../db/pool.js';

export class TransactionalOutboxPublisher {
  constructor(pool, { publisherId, publish, staleAfterSeconds = 120 }) {
    this.pool = pool;
    this.publisherId = publisherId;
    this.publish = publish;
    this.staleAfterSeconds = staleAfterSeconds;
  }

  async claimNext() {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(`
        WITH candidate AS (
          SELECT id FROM channel_gateway_outbox_events
          WHERE status IN ('pending', 'retrying') AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE channel_gateway_outbox_events event SET
          status = 'publishing', attempts = attempts + 1,
          locked_by = $1, locked_at = NOW(), updated_at = NOW()
        FROM candidate WHERE event.id = candidate.id
        RETURNING event.*
      `, [this.publisherId]);
      return result.rows[0] || null;
    });
  }

  async publishOnce() {
    const event = await this.claimNext();
    if (!event) return null;
    try {
      await this.publish(event);
      await this.pool.query(`
        UPDATE channel_gateway_outbox_events SET status = 'published', published_at = NOW(),
          locked_by = NULL, locked_at = NULL, last_error = NULL, updated_at = NOW()
        WHERE id = $1 AND locked_by = $2
      `, [event.id, this.publisherId]);
      return { event, published: true };
    } catch (error) {
      const decision = retryDecision(event.attempts, 7);
      await this.pool.query(`
        UPDATE channel_gateway_outbox_events SET status = $2,
          next_attempt_at = COALESCE($3, next_attempt_at), last_error = $4,
          locked_by = NULL, locked_at = NULL, updated_at = NOW()
        WHERE id = $1 AND locked_by = $5
      `, [event.id, decision.status === 'needs_manual_review' ? 'failed' : decision.status,
        decision.nextRetryAt, String(error.message || error).slice(0, 4000), this.publisherId]);
      return { event, published: false };
    }
  }

  async recoverStale() {
    const result = await this.pool.query(`
      UPDATE channel_gateway_outbox_events SET status = 'retrying', next_attempt_at = NOW(),
        locked_by = NULL, locked_at = NULL, last_error = 'Recovered expired publisher lock', updated_at = NOW()
      WHERE status = 'publishing' AND locked_at < NOW() - ($1 * INTERVAL '1 second')
    `, [this.staleAfterSeconds]);
    return result.rowCount;
  }
}
