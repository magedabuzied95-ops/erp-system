import test from 'node:test';
import assert from 'node:assert/strict';
import { ErpOutboundEventConsumer } from '../src/worker/ErpOutboundEventConsumer.js';

const logger = { info() {}, warn() {} };

test('manual Instagram ERP event becomes one durable outbound job', async () => {
  const enqueued = []; const updates = [];
  const worker = new ErpOutboundEventConsumer({
    pool: { query: async (sql, params) => { updates.push({ sql, params }); return { rows: [] }; } },
    queue: { enqueue: async (input) => { enqueued.push(input); return { duplicate: false, job: { job_key: input.jobKey } }; } },
    logger,
  });
  worker.claim = async () => ({ id: 1, event_id: '11111111-1111-5111-8111-111111111111', tenant_id: 1, aggregate_id: '99', correlation_id: 'instagram:7:thread-a', occurred_at: new Date(), attempts: 1, max_attempts: 7, payload: { channel: 'instagram', direction: 'outgoing', connection_id: '7', external_conversation_id: 'thread-a', text: 'hello', idempotency_key: 'idem-1', manual: true, manual_user_id: 9 } });
  await worker.tick();
  assert.equal(enqueued.length, 1); assert.equal(enqueued[0].externalConversationId, 'thread-a'); assert.equal(enqueued[0].payload.metadata.manual_user_id, 9);
  assert.match(updates[0].sql, /status='processed'/);
});

test('AI or non-manual outbound command is dead-lettered before the bridge', async () => {
  const updates = [];
  const worker = new ErpOutboundEventConsumer({ pool: { query: async (sql, params) => { updates.push({ sql, params }); return { rows: [] }; } }, queue: { enqueue: async () => assert.fail('must not enqueue') }, logger });
  worker.claim = async () => ({ id: 2, event_id: '22222222-2222-5222-8222-222222222222', tenant_id: 1, aggregate_id: '100', correlation_id: 'instagram:7:thread-a', occurred_at: new Date(), attempts: 1, max_attempts: 7, payload: { channel: 'instagram', direction: 'outgoing', connection_id: '7', external_conversation_id: 'thread-a', text: 'AI reply', manual: false } });
  await worker.tick();
  assert.equal(updates[0].params[2], 'dead_letter'); assert.equal(updates[0].params[4], 'MANUAL_ACTION_REQUIRED');
});
