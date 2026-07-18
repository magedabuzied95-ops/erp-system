import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/db/migrate.js';
import { PostgresOutboundQueue } from '../src/queue/PostgresOutboundQueue.js';
import { InboundMessageStore } from '../src/messages/InboundMessageStore.js';
import { TransactionalOutboxPublisher } from '../src/outbox/TransactionalOutboxPublisher.js';
import { PostgresShadowEventQueue } from '../src/shadow/PostgresShadowEventQueue.js';
import { ShadowComparator } from '../src/shadow/ShadowComparator.js';
import { ChannelOutboxPublisher, stableEventUuid } from '../../../server/services/channelOutboxPublisher.js';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
const schema = `gateway_test_${randomUUID().replaceAll('-', '')}`;
let admin;
let pool;
let tenantId;
let connectionId;

before(async () => {
  if (!databaseUrl) return;
  admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${schema}.tenants (id BIGSERIAL PRIMARY KEY)`);
  await admin.query(`INSERT INTO ${schema}.tenants DEFAULT VALUES`);
  await admin.query(`CREATE TABLE ${schema}.ai_support_messages (
    id BIGSERIAL PRIMARY KEY, tenant_id BIGINT NOT NULL, session_id TEXT NOT NULL,
    channel TEXT NOT NULL, sender_type TEXT NOT NULL, message_type TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT '', external_message_id TEXT NOT NULL DEFAULT '',
    provider_message_id TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL DEFAULT '',
    message_text TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await admin.query(`CREATE TABLE ${schema}.ai_support_sessions (
    id BIGSERIAL PRIMARY KEY, tenant_id BIGINT NOT NULL, session_id TEXT NOT NULL,
    channel TEXT NOT NULL, status TEXT NOT NULL, ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_user_id BIGINT, assigned_user_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, session_id)
  )`);
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  pool = new pg.Pool({ connectionString: scopedUrl.toString(), max: 8 });
  await migrate(pool);
  tenantId = 1;
  const connection = await pool.query(`
    INSERT INTO channel_connections (tenant_id, channel, account_external_id)
    VALUES ($1, 'whatsapp', 'test-account') RETURNING id
  `, [tenantId]);
  connectionId = connection.rows[0].id;
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

integration('idempotent enqueue returns the original durable job', async () => {
  const queue = new PostgresOutboundQueue(pool, { workerId: 'worker-idempotency' });
  const input = {
    idempotencyKey: 'idem-1', tenantId, connectionId,
    externalConversationId: 'conversation-idem', payload: { text: 'hello' },
  };
  const first = await queue.enqueue(input);
  const second = await queue.enqueue({ ...input, payload: { text: 'must not replace original' } });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.job.id, first.job.id);
  assert.equal(second.job.payload.text, 'hello');
});

integration('only one job per conversation is active while other conversations run in parallel', async () => {
  const queueA = new PostgresOutboundQueue(pool, { workerId: 'worker-a' });
  const queueB = new PostgresOutboundQueue(pool, { workerId: 'worker-b' });
  for (const [key, conversation] of [['lane-1', 'same-lane'], ['lane-2', 'same-lane'], ['lane-3', 'parallel-lane']]) {
    await queueA.enqueue({
      idempotencyKey: key, tenantId, connectionId,
      externalConversationId: conversation, payload: { text: key }, priority: 10,
    });
  }
  const first = await queueA.claimNext();
  const parallel = await queueB.claimNext();
  assert.equal(first.external_conversation_id, 'same-lane');
  assert.equal(parallel.external_conversation_id, 'parallel-lane');
  await queueA.complete(first.id, { providerMessageId: 'provider-1' });
  await queueB.complete(parallel.id, { providerMessageId: 'provider-2' });
  const second = await queueA.claimNext();
  assert.equal(second.external_conversation_id, 'same-lane');
  await queueA.complete(second.id);
});

integration('stale processing work is recovered after a worker restart', async () => {
  const oldWorker = new PostgresOutboundQueue(pool, { workerId: 'old-worker', staleAfterSeconds: 30 });
  await oldWorker.enqueue({
    idempotencyKey: 'restart-1', tenantId, connectionId,
    externalConversationId: 'restart-lane', payload: { text: 'recover me' }, priority: 1,
  });
  const abandoned = await oldWorker.claimNext();
  await pool.query(`UPDATE outbound_message_jobs SET locked_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [abandoned.id]);
  await pool.query(`UPDATE channel_queue_lanes SET locked_at = NOW() - INTERVAL '5 minutes' WHERE job_id = $1`, [abandoned.id]);

  const newWorker = new PostgresOutboundQueue(pool, { workerId: 'new-worker', staleAfterSeconds: 30 });
  const recovery = await newWorker.recoverStale();
  assert.equal(recovery.recovered, 1);
  await pool.query(`UPDATE outbound_message_jobs SET next_retry_at = NOW() WHERE id = $1`, [abandoned.id]);
  const reclaimed = await newWorker.claimNext();
  assert.equal(reclaimed.id, abandoned.id);
  assert.equal(reclaimed.attempts, 2);
  await newWorker.complete(reclaimed.id);
});

integration('inbound external id and fallback hash both prevent duplicate events transactionally', async () => {
  const store = new InboundMessageStore(pool);
  const input = {
    tenant_id: tenantId,
    connection_id: connectionId,
    channel: 'whatsapp',
    external_conversation_id: 'inbound-c1',
    external_message_id: 'provider-message-1',
    sender_id: 'customer-1',
    text: 'مرحبا',
    occurred_at: '2026-07-18T12:00:00.000Z',
  };
  const first = await store.accept(input);
  const duplicate = await store.accept(input);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  const outbox = await pool.query(`SELECT COUNT(*)::int count FROM channel_gateway_outbox_events WHERE aggregate_id = $1`, [String(first.event.id)]);
  assert.equal(outbox.rows[0].count, 1);
  const mappings = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM channel_conversation_map WHERE external_conversation_id = 'inbound-c1') conversations,
      (SELECT COUNT(*)::int FROM channel_message_map WHERE external_message_id = 'provider-message-1') messages
  `);
  assert.deepEqual(mappings.rows[0], { conversations: 1, messages: 1 });
});

integration('transactional outbox publishes an accepted event once', async () => {
  // Earlier queue tests intentionally emit delivery-status events. Mark those
  // fixtures published so this assertion verifies one accepted inbound event
  // without depending on test execution order.
  await pool.query(`
    UPDATE channel_gateway_outbox_events
    SET status = 'published', published_at = NOW(), locked_by = NULL, locked_at = NULL
    WHERE status IN ('pending', 'publishing')
  `);
  const delivered = [];
  const publisher = new TransactionalOutboxPublisher(pool, {
    publisherId: 'publisher-1',
    publish: async (event) => delivered.push(event.event_key),
  });
  const result = await publisher.publishOnce();
  assert.equal(result.published, true);
  assert.equal(delivered.length, 1);
  const second = await publisher.publishOnce();
  assert.equal(second, null);
});

integration('ERP message and outbox event commit or rollback together', async () => {
  const client = await pool.connect();
  const eventId = stableEventUuid('shadow-transaction-success');
  try {
    await client.query('BEGIN');
    const message = await client.query(`
      INSERT INTO ai_support_messages (
        tenant_id, session_id, channel, sender_type, message_type, delivery_status,
        idempotency_key, message_text
      ) VALUES ($1,'shadow-conversation','whatsapp','staff','text','sent','shadow-idem','hello') RETURNING *
    `, [tenantId]);
    const publisher = new ChannelOutboxPublisher({ executor: client, flags: { enabled: true, shadowMode: true } });
    await publisher.publishMessageCreatedEvent({
      eventId, tenantId, aggregateId: String(message.rows[0].id),
      correlationId: 'shadow-conversation',
      payload: {
        conversation_id: 'shadow-conversation', message_id: String(message.rows[0].id),
        channel: 'whatsapp', direction: 'outgoing', message_type: 'text',
        status: 'sent', idempotency_key: 'shadow-idem',
      },
    });
    await client.query('COMMIT');
  } finally { client.release(); }
  const committed = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM ai_support_messages WHERE idempotency_key = 'shadow-idem') messages,
      (SELECT COUNT(*)::int FROM erp_channel_outbox_events WHERE event_id = $1) events
  `, [eventId]);
  assert.deepEqual(committed.rows[0], { messages: 1, events: 1 });

  const failedClient = await pool.connect();
  try {
    await failedClient.query('BEGIN');
    await failedClient.query(`INSERT INTO ai_support_messages (
      tenant_id, session_id, channel, sender_type, message_type, idempotency_key, message_text
    ) VALUES ($1,'rollback-conversation','whatsapp','staff','text','rollback-idem','must rollback')`, [tenantId]);
    const publisher = new ChannelOutboxPublisher({ executor: failedClient, flags: { enabled: true, shadowMode: true } });
    await assert.rejects(() => publisher.publishMessageCreatedEvent({
      eventVersion: 99, tenantId, aggregateId: 'invalid', payload: {},
    }), /unsupported_event_version/);
    await failedClient.query('ROLLBACK');
  } finally { failedClient.release(); }
  const rolledBack = await pool.query(`SELECT COUNT(*)::int count FROM ai_support_messages WHERE idempotency_key = 'rollback-idem'`);
  assert.equal(rolledBack.rows[0].count, 0);
});

integration('shadow comparison processes once without changing the AI Inbox message', async () => {
  const eventRow = await pool.query(`SELECT * FROM erp_channel_outbox_events WHERE event_id = $1`, [stableEventUuid('shadow-transaction-success')]);
  const before = await pool.query(`SELECT * FROM ai_support_messages WHERE idempotency_key = 'shadow-idem'`);
  await pool.query(`
    INSERT INTO channel_conversation_map (
      tenant_id, connection_id, external_conversation_id, internal_conversation_id
    ) VALUES ($1,$2,'shadow-conversation','shadow-conversation')
    ON CONFLICT (connection_id, external_conversation_id) DO UPDATE SET
      internal_conversation_id = EXCLUDED.internal_conversation_id
  `, [tenantId, connectionId]);
  const queue = new PostgresShadowEventQueue(pool, { workerId: 'shadow-test-worker' });
  const comparator = new ShadowComparator(pool);
  const claimed = await queue.claimNext();
  assert.equal(claimed.event_id, eventRow.rows[0].event_id);
  const comparison = await comparator.compare({
    ...claimed, event_id: String(claimed.event_id), tenant_id: Number(claimed.tenant_id),
  });
  assert.equal(comparison.status, 'matched');
  await queue.complete(claimed, comparison, Date.now());
  assert.equal(await queue.claimNext(), null);
  const afterMessage = await pool.query(`SELECT * FROM ai_support_messages WHERE idempotency_key = 'shadow-idem'`);
  assert.deepEqual(afterMessage.rows, before.rows);
  const result = await pool.query(`SELECT shadow_status FROM channel_shadow_comparison_results WHERE event_id = $1`, [claimed.event_id]);
  assert.equal(result.rows[0].shadow_status, 'matched');
});

integration('poison event reaches dead letter and does not block a valid event', async () => {
  const poisonId = stableEventUuid('poison-version');
  await pool.query(`
    INSERT INTO erp_channel_outbox_events (
      event_id,event_type,event_version,tenant_id,aggregate_type,aggregate_id,occurred_at,
      payload,payload_fingerprint,source,max_attempts
    ) VALUES ($1,'message.created',99,$2,'message','999',NOW(),'{}'::jsonb,$3,'erp-backend',2)
  `, [poisonId, tenantId, '0'.repeat(64)]);
  const queue = new PostgresShadowEventQueue(pool, { workerId: 'poison-worker' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const event = await queue.claimNext();
    assert.equal(String(event.event_id), poisonId);
    await queue.fail(event, { code: 'UNSUPPORTED_EVENT_VERSION', message: 'unsupported version' }, Date.now());
    await pool.query(`UPDATE erp_channel_outbox_events SET next_attempt_at = NOW() WHERE event_id = $1`, [poisonId]);
  }
  const poison = await pool.query(`SELECT status, attempts FROM erp_channel_outbox_events WHERE event_id = $1`, [poisonId]);
  assert.deepEqual(poison.rows[0], { status: 'dead_letter', attempts: 2 });

  const validId = stableEventUuid('valid-after-poison');
  const publisher = new ChannelOutboxPublisher({ executor: pool, flags: { enabled: true, shadowMode: true } });
  await publisher.publishMessageCreatedEvent({
    eventId: validId, tenantId, aggregateId: '404', correlationId: 'missing-but-valid',
    payload: { conversation_id: 'missing-but-valid', message_id: '404', channel: 'whatsapp', direction: 'incoming', message_type: 'text' },
  });
  const next = await queue.claimNext();
  assert.equal(String(next.event_id), validId);
});
