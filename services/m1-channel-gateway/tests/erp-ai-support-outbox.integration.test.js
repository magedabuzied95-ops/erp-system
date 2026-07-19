import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/db/migrate.js';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('real AI support persistence writes message and ERP outbox atomically in shadow mode', async () => {
  const schema = `erp_outbox_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: databaseUrl });
  let scopedPool;
  let serverPool;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.tenants (id BIGSERIAL PRIMARY KEY)`);
    await admin.query(`INSERT INTO ${schema}.tenants DEFAULT VALUES`);
    await admin.query(`CREATE TABLE ${schema}.ai_channel_conversations (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      channel TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL,
      external_customer_id TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, channel, external_conversation_id)
    )`);
    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    scopedPool = new pg.Pool({ connectionString: scopedUrl.toString(), max: 4 });
    await migrate(scopedPool);

    process.env.DATABASE_URL = scopedUrl.toString();
    process.env.CHANNEL_GATEWAY_ENABLED = 'true';
    process.env.CHANNEL_GATEWAY_SHADOW_MODE = 'true';
    process.env.CHANNEL_GATEWAY_OUTBOUND_ENABLED = 'false';
    process.env.CHANNEL_GATEWAY_INBOUND_ENABLED = 'false';
    process.env.CHANNEL_GATEWAY_COMPARE_ENABLED = 'true';

    const support = await import(`../../../server/services/aiSupportLogService.js?shadow_test=${randomUUID()}`);
    serverPool = (await import(`../../../server/database/db.js`)).default;
    const inbound = await support.appendInboundAiSupportMessage({
      tenantId: 1,
      sessionId: '201000000001@s.whatsapp.net',
      message: 'shadow inbound',
      channel: 'whatsapp',
      externalMessageId: 'shadow-provider-inbound',
      providerMessageId: 'shadow-provider-inbound',
      deliveryStatus: 'received',
    });
    assert.ok(inbound?.id);
    const inboundAtomic = await scopedPool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ai_support_messages WHERE id = $1) messages,
        (SELECT COUNT(*)::int FROM erp_channel_outbox_events
          WHERE aggregate_id = $1::text AND event_type = 'message.created') events
    `, [inbound.id]);
    assert.deepEqual(inboundAtomic.rows[0], { messages: 1, events: 1 });

    const outbound = await support.appendChannelOutboundSupportReply({
      tenantId: 1,
      sessionId: '201000000001@s.whatsapp.net',
      message: 'shadow outbound',
      channel: 'whatsapp',
      deliveryStatus: 'sent',
      idempotencyKey: 'shadow-real-outbound',
      providerMessageId: 'shadow-provider-outbound',
    });
    const outboundEvents = await scopedPool.query(`
      SELECT event_type FROM erp_channel_outbox_events WHERE aggregate_id = $1::text ORDER BY event_type
    `, [outbound.id]);
    assert.deepEqual(outboundEvents.rows.map((item) => item.event_type), [
      'message.created', 'message.outbound_requested', 'message.status_changed',
    ]);

    await scopedPool.query(`ALTER TABLE erp_channel_outbox_events RENAME TO erp_channel_outbox_events_unavailable`);
    await assert.rejects(() => support.appendInboundAiSupportMessage({
      tenantId: 1,
      sessionId: '201000000002@s.whatsapp.net',
      message: 'must rollback with outbox',
      channel: 'whatsapp',
      externalMessageId: 'shadow-rollback-provider',
    }), /erp_channel_outbox_events/);
    const rolledBack = await scopedPool.query(`
      SELECT COUNT(*)::int count FROM ai_support_messages WHERE external_message_id = 'shadow-rollback-provider'
    `);
    assert.equal(rolledBack.rows[0].count, 0);
    await scopedPool.query(`ALTER TABLE erp_channel_outbox_events_unavailable RENAME TO erp_channel_outbox_events`);
  } finally {
    await serverPool?.end().catch(() => {});
    await scopedPool?.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      await admin.end().catch(() => {});
    }
    delete process.env.DATABASE_URL;
    delete process.env.CHANNEL_GATEWAY_ENABLED;
    delete process.env.CHANNEL_GATEWAY_SHADOW_MODE;
    delete process.env.CHANNEL_GATEWAY_OUTBOUND_ENABLED;
    delete process.env.CHANNEL_GATEWAY_INBOUND_ENABLED;
    delete process.env.CHANNEL_GATEWAY_COMPARE_ENABLED;
  }
});
