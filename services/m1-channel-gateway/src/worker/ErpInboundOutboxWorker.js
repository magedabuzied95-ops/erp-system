import { randomUUID } from 'node:crypto';
import { signGatewayRequest } from '../security/hmac.js';
import { withTransaction } from '../db/pool.js';

export class ErpInboundOutboxWorker {
  constructor({ pool, baseUrl, secret, fetchImpl = fetch, logger, pollIntervalMs = 750, workerId = `erp-inbound-${process.pid}-${randomUUID()}` }) {
    this.pool = pool; this.baseUrl = String(baseUrl || '').replace(/\/$/, ''); this.secret = secret; this.fetch = fetchImpl;
    this.logger = logger; this.pollIntervalMs = pollIntervalMs; this.workerId = workerId; this.running = false; this.timer = null; this.active = null;
  }
  async start() { if (this.running) return; this.running = true; await this.recoverStale(); this.schedule(0); }
  async stop() { this.running = false; if (this.timer) clearTimeout(this.timer); await this.active?.catch(() => {}); }
  schedule(delay = this.pollIntervalMs) { if (!this.running) return; this.timer = setTimeout(() => { this.active = this.tick().finally(() => { this.active = null; this.schedule(); }); }, delay); this.timer.unref?.(); }
  async claim() {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(`
        SELECT o.*, COALESCE(i.normalized_payload, o.payload) AS delivery_payload
        FROM channel_gateway_outbox_events o
        LEFT JOIN channel_inbound_events i ON o.event_type='channel.message.accepted' AND i.id = (o.payload->>'inbound_event_id')::bigint
        WHERE o.event_type IN ('channel.message.accepted','channel.message.status') AND o.status IN ('pending','retrying') AND o.next_attempt_at <= NOW()
        ORDER BY o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1
      `);
      if (!result.rowCount) return null;
      const row = result.rows[0];
      await client.query(`UPDATE channel_gateway_outbox_events SET status='publishing', attempts=attempts+1, locked_by=$2, locked_at=NOW(), updated_at=NOW() WHERE id=$1`, [row.id, this.workerId]);
      return { ...row, attempts: Number(row.attempts) + 1 };
    });
  }
  async tick() {
    const event = await this.claim(); if (!event) return;
    const path = event.event_type === 'channel.message.status'
      ? '/api/internal/channel-gateway/status'
      : '/api/internal/channel-gateway/inbound';
    const rawBody = JSON.stringify(event.delivery_payload || {});
    const timestamp = String(Date.now()); const nonce = randomUUID();
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-m1-timestamp': timestamp, 'x-m1-nonce': nonce, 'x-m1-signature': signGatewayRequest({ secret: this.secret, timestamp, nonce, method: 'POST', path, rawBody }) }, body: rawBody });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error || `ERP ${response.status}`), { code: payload.error || 'ERP_INBOUND_FAILED' });
      if (event.event_type === 'channel.message.accepted' && payload.conversation_id) {
        await this.pool.query(`
          UPDATE channel_conversation_map
          SET internal_conversation_id = COALESCE(internal_conversation_id, $3), updated_at = NOW()
          WHERE connection_id = $1 AND external_conversation_id = $2
        `, [event.delivery_payload?.connection_id, event.delivery_payload?.external_conversation_id, payload.conversation_id]);
      }
      await this.pool.query(`UPDATE channel_gateway_outbox_events SET status='published', published_at=NOW(), locked_by=NULL, locked_at=NULL, last_error=NULL, updated_at=NOW() WHERE id=$1 AND locked_by=$2`, [event.id, this.workerId]);
      this.logger.info('erp_channel_event.published', { event_id: event.event_key, event_type: event.event_type });
    } catch (error) {
      const terminal = event.attempts >= 7; const delaySeconds = Math.min(900, 2 ** Math.min(event.attempts, 9));
      await this.pool.query(`UPDATE channel_gateway_outbox_events SET status=$3, next_attempt_at=NOW()+($4*INTERVAL '1 second'), locked_by=NULL, locked_at=NULL, last_error=$5, updated_at=NOW() WHERE id=$1 AND locked_by=$2`, [event.id, this.workerId, terminal ? 'failed' : 'retrying', delaySeconds, String(error.code || error.message).slice(0, 1000)]);
      this.logger.warn('erp_inbound.failed', { event_id: event.event_key, attempts: event.attempts, terminal, error_code: error.code || 'ERP_INBOUND_FAILED' });
    }
  }
  recoverStale() { return this.pool.query(`UPDATE channel_gateway_outbox_events SET status='retrying', locked_by=NULL, locked_at=NULL, next_attempt_at=NOW(), last_error='stale publisher recovered', updated_at=NOW() WHERE event_type IN ('channel.message.accepted','channel.message.status') AND status='publishing' AND locked_at < NOW()-INTERVAL '2 minutes'`); }
}
