import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('shadow integration does not add a WebSocket broadcast path', async () => {
  const sources = await Promise.all([
    read('../server/services/channelOutboxPublisher.js'),
    read('../services/m1-channel-gateway/src/shadow/ShadowConsumer.js'),
    read('../services/m1-channel-gateway/src/shadow/ShadowComparator.js'),
  ]);
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /\.emit\s*\(/);
  assert.doesNotMatch(combined, /ai_inbox:message|ai_inbox:refresh/);
});

test('shadow integration has no external provider or browser authority', async () => {
  const consumer = await read('../services/m1-channel-gateway/src/shadow/ShadowConsumer.js');
  const comparator = await read('../services/m1-channel-gateway/src/shadow/ShadowComparator.js');
  const combined = `${consumer}\n${comparator}`;
  assert.doesNotMatch(combined, /playwright|puppeteer|sendText|sendMedia|fetch\s*\(|axios|Graph API|Evolution/i);
});

test('shadow API rejects both inbound and outbound transport endpoints', async () => {
  const source = await read('../services/m1-channel-gateway/src/app.js');
  assert.match(source, /config\.shadowMode \|\| !config\.inboundEnabled/);
  assert.match(source, /shadow_mode_inbound_disabled/);
  assert.match(source, /config\.shadowMode \|\| !config\.outboundEnabled/);
  assert.match(source, /shadow_mode_outbound_disabled/);
});

test('PWA service worker does not cache or process shadow events', async () => {
  const candidates = [
    '../public/inbox-sw.js',
    '../src/modules/aiSupport/pages/AiInboxPwa.jsx',
  ];
  const available = [];
  for (const path of candidates) {
    try { available.push(await read(path)); } catch { /* optional candidate */ }
  }
  assert.ok(available.length > 0);
  assert.doesNotMatch(available.join('\n'), /channel_shadow|erp_channel_outbox|shadow\.processed/);
});

test('ERP transcript persistence wraps message and outbox in one transaction only when enabled', async () => {
  const source = await read('../server/services/aiSupportLogService.js');
  assert.match(source, /!flags\.enabled \|\| \(!flags\.shadowMode && !flags\.outboundEnabled && !flags\.inboundEnabled\)/);
  assert.match(source, /await client\.query\('BEGIN'\)[\s\S]*publishTranscriptOutboxEvents[\s\S]*await client\.query\('COMMIT'\)/);
  assert.match(source, /await client\.query\('ROLLBACK'\)/);
});
