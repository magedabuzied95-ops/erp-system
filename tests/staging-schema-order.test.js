import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fresh database schema creates cashbox before orders references it', async () => {
  const schema = await readFile(new URL('../server/database/schema.sql', import.meta.url), 'utf8');
  const cashbox = schema.indexOf('CREATE TABLE IF NOT EXISTS cashbox (');
  const orders = schema.indexOf('CREATE TABLE IF NOT EXISTS orders (');
  assert.ok(cashbox >= 0, 'cashbox definition must exist');
  assert.ok(orders >= 0, 'orders definition must exist');
  assert.ok(cashbox < orders, 'cashbox must exist before orders foreign keys are parsed');
});

test('fresh database schema creates the AI channel conversation source of truth', async () => {
  const schema = await readFile(new URL('../server/database/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS ai_channel_conversations \(/);
  assert.match(schema, /UNIQUE \(tenant_id, channel, external_conversation_id\)/);
});
