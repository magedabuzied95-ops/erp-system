import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';

export class ErpOutboundEventConsumer {
  constructor({ pool, queue, logger, pollIntervalMs = 750, workerId = `erp-outbound-${process.pid}-${randomUUID()}` }) {
    this.pool = pool; this.queue = queue; this.logger = logger; this.pollIntervalMs = pollIntervalMs; this.workerId = workerId;
    this.running = false; this.timer = null; this.active = null;
  }
  async start() { if (this.running) return; this.running = true; await this.recoverStale(); this.schedule(0); }
  async stop() { this.running = false; if (this.timer) clearTimeout(this.timer); await this.active?.catch(() => {}); }
  schedule(delay = this.pollIntervalMs) { if (!this.running) return; this.timer = setTimeout(() => { this.active = this.tick().finally(() => { this.active = null; this.schedule(); }); }, delay); this.timer.unref?.(); }
  claim() {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(`SELECT * FROM erp_channel_outbox_events WHERE event_type='message.outbound_requested' AND status IN ('pending','retrying') AND next_attempt_at<=NOW() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!result.rowCount) return null;
      const event = result.rows[0];
      await client.query(`UPDATE erp_channel_outbox_events SET status='processing', attempts=attempts+1, locked_by=$2, locked_at=NOW(), updated_at=NOW() WHERE id=$1`, [event.id, this.workerId]);
      return { ...event, attempts: Number(event.attempts) + 1 };
    });
  }
  async tick() {
    const event = await this.claim(); if (!event) return;
    const payload = event.payload || {};
    try {
      if (payload.channel !== 'instagram' || payload.direction !== 'outgoing') throw Object.assign(new Error('Unsupported outbound pilot event'), { code: 'UNSUPPORTED_PILOT_EVENT', terminal: true });
      if (!payload.manual || !payload.manual_user_id) throw Object.assign(new Error('Manual employee action required'), { code: 'MANUAL_ACTION_REQUIRED', terminal: true });
      if (!payload.connection_id || !payload.external_conversation_id || !payload.text) throw Object.assign(new Error('Outbound mapping incomplete'), { code: 'OUTBOUND_MAPPING_INCOMPLETE', terminal: true });
      const queued = await this.queue.enqueue({
        jobKey: String(event.event_id), idempotencyKey: payload.idempotency_key || String(event.event_id),
        tenantId: event.tenant_id, connectionId: payload.connection_id,
        externalConversationId: payload.external_conversation_id,
        internalConversationId: event.correlation_id,
        payload: {
          version: '1.0', event_id: String(event.event_id), tenant_id: event.tenant_id,
          connection_id: payload.connection_id, channel: 'instagram', direction: 'outbound',
          external_conversation_id: payload.external_conversation_id, text: payload.text, attachments: [],
          occurred_at: event.occurred_at, idempotency_key: payload.idempotency_key || String(event.event_id),
          metadata: { internal_conversation_id: event.correlation_id, internal_message_id: event.aggregate_id, manual: true, manual_user_id: payload.manual_user_id, external_username: payload.external_username, external_display_name: payload.external_display_name, conversation_fingerprint: payload.conversation_fingerprint },
        },
      });
      await this.pool.query(`UPDATE erp_channel_outbox_events SET status='processed', processed_at=NOW(), locked_by=NULL, locked_at=NULL, last_error_code=NULL, last_error=NULL, updated_at=NOW() WHERE id=$1 AND locked_by=$2`, [event.id, this.workerId]);
      this.logger.info('erp_outbound.queued', { event_id: event.event_id, job_key: queued.job.job_key, duplicate: queued.duplicate });
    } catch (error) {
      const terminal = error.terminal || event.attempts >= Number(event.max_attempts || 7); const status = terminal ? 'dead_letter' : 'retrying';
      await this.pool.query(`UPDATE erp_channel_outbox_events SET status=$3, next_attempt_at=NOW()+(LEAST(900, POWER(2,$4))*INTERVAL '1 second'), locked_by=NULL, locked_at=NULL, last_error_code=$5, last_error=$6, failed_at=CASE WHEN $3='dead_letter' THEN NOW() ELSE failed_at END, updated_at=NOW() WHERE id=$1 AND locked_by=$2`, [event.id, this.workerId, status, event.attempts, String(error.code || 'OUTBOUND_CONSUME_FAILED').slice(0,120), String(error.message || error).slice(0,1000)]);
      this.logger.warn('erp_outbound.failed', { event_id: event.event_id, status, error_code: error.code || 'OUTBOUND_CONSUME_FAILED' });
    }
  }
  recoverStale() { return this.pool.query(`UPDATE erp_channel_outbox_events SET status='retrying', locked_by=NULL, locked_at=NULL, next_attempt_at=NOW(), last_error_code='STALE_OUTBOUND_CONSUMER', updated_at=NOW() WHERE event_type='message.outbound_requested' AND status='processing' AND locked_at<NOW()-INTERVAL '2 minutes'`); }
}
