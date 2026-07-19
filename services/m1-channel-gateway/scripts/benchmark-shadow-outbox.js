import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/db/migrate.js';
import { ChannelOutboxPublisher } from '../../../server/services/channelOutboxPublisher.js';

const databaseUrl = process.env.GATEWAY_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('GATEWAY_TEST_DATABASE_URL is required');
const schema = `gateway_bench_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: databaseUrl });
let pool;

const percentile = (values, value) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)].toFixed(3));
};

async function timed(work) {
  const started = process.hrtime.bigint();
  await work();
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${schema}.tenants (id BIGSERIAL PRIMARY KEY)`);
  await admin.query(`INSERT INTO ${schema}.tenants DEFAULT VALUES`);
  await admin.query(`CREATE TABLE ${schema}.ai_support_messages (
    id BIGSERIAL PRIMARY KEY, tenant_id BIGINT NOT NULL, session_id TEXT NOT NULL,
    channel TEXT NOT NULL, sender_type TEXT NOT NULL, message_type TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL DEFAULT '',
    message_text TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  pool = new pg.Pool({ connectionString: scopedUrl.toString(), max: 4 });
  await migrate(pool);

  const baseline = [];
  const shadow = [];
  const iterations = 120;
  for (let index = 0; index < iterations; index += 1) {
    baseline.push(await timed(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO ai_support_messages (
          tenant_id,session_id,channel,sender_type,message_type,delivery_status,idempotency_key,message_text
        ) VALUES (1,$1,'whatsapp','staff','text','sent',$2,'benchmark')`,
        [`baseline-${index}`, `baseline-${index}`]);
        await client.query('COMMIT');
      } finally { client.release(); }
    }));
  }
  for (let index = 0; index < iterations; index += 1) {
    shadow.push(await timed(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const message = await client.query(`INSERT INTO ai_support_messages (
          tenant_id,session_id,channel,sender_type,message_type,delivery_status,idempotency_key,message_text
        ) VALUES (1,$1,'whatsapp','staff','text','sent',$2,'benchmark') RETURNING id`,
        [`shadow-${index}`, `shadow-${index}`]);
        const publisher = new ChannelOutboxPublisher({ executor: client, flags: { enabled: true, shadowMode: true } });
        await publisher.publishMessageCreatedEvent({
          tenantId: 1, aggregateId: String(message.rows[0].id), correlationId: `shadow-${index}`,
          payload: { conversation_id: `shadow-${index}`, message_id: String(message.rows[0].id), channel: 'whatsapp', direction: 'outgoing', message_type: 'text', status: 'sent' },
        });
        await client.query('COMMIT');
      } finally { client.release(); }
    }));
  }
  const stats = (values) => ({ p50_ms: percentile(values, 0.50), p95_ms: percentile(values, 0.95), p99_ms: percentile(values, 0.99) });
  const before = stats(baseline);
  const after = stats(shadow);
  process.stdout.write(`${JSON.stringify({ iterations, before, after, delta: {
    p50_ms: Number((after.p50_ms - before.p50_ms).toFixed(3)),
    p95_ms: Number((after.p95_ms - before.p95_ms).toFixed(3)),
    p99_ms: Number((after.p99_ms - before.p99_ms).toFixed(3)),
  } }, null, 2)}\n`);
} finally {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
  }
}
