import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serviceUrl = new URL('../server/services/channelGatewayAdminService.js', import.meta.url);

test('production compose keeps Instagram opt-in and locks all safety flags', async () => {
  const compose = await readFile(new URL('../docker-compose.channels.production.yml', import.meta.url), 'utf8');
  assert.match(compose, /profiles:\s*\[instagram-test\]/);
  assert.match(compose, /INSTAGRAM_EXPECTED_USERNAME:\s*m\.one\.store\.pro/);
  assert.match(compose, /INSTAGRAM_TEST_ACCOUNT_ONLY:\s*"true"/);
  assert.match(compose, /INSTAGRAM_BRIDGE_MEDIA_ENABLED:\s*"false"/);
  assert.match(compose, /INSTAGRAM_BRIDGE_AI_AUTO_SEND_ENABLED:\s*"false"/);
  assert.match(compose, /INSTAGRAM_AI_MODE:\s*draft_only/);
  const bridgeBlock = compose.split(/\n  instagram-bridge:/)[1].split(/\nvolumes:/)[0];
  assert.doesNotMatch(bridgeBlock, /\n\s+ports:/);
});

test('admin status exposes the TEST ACCOUNT label only after exact account verification', async () => {
  process.env.CHANNEL_GATEWAY_HMAC_SECRET = 'test-only-secret';
  process.env.INSTAGRAM_CHANNEL_CONNECTION_ID = 'test-connection';
  process.env.INSTAGRAM_EXPECTED_USERNAME = 'm.one.store.pro';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('bridge-health')
      ? { status: 'healthy', current_connected_account: 'm.one.store.pro', test_account_verified: true }
      : { queue: { pending: 0 }, activity: {} },
  });
  try {
    const { getInstagramBridgeAdminStatus } = await import(`${serviceUrl.href}?status=${Date.now()}`);
    const status = await getInstagramBridgeAdminStatus({ tenantId: 1 });
    assert.equal(status.label, 'TEST ACCOUNT');
    assert.equal(status.current_connected_account, 'm.one.store.pro');
    assert.equal(status.test_account_verified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin enable fails closed and re-pauses when the connected account differs', async () => {
  process.env.CHANNEL_GATEWAY_HMAC_SECRET = 'test-only-secret';
  process.env.INSTAGRAM_CHANNEL_CONNECTION_ID = 'test-connection';
  process.env.INSTAGRAM_EXPECTED_USERNAME = 'm.one.store.pro';
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push([String(url), options.method]);
    return { ok: true, status: 200, json: async () => ({ current_connected_account: 'real-store-account', test_account_verified: false }) };
  };
  try {
    const { enableInstagramBridge } = await import(`${serviceUrl.href}?enable=${Date.now()}`);
    await assert.rejects(() => enableInstagramBridge(), (error) => error.code === 'TEST_ACCOUNT_VERIFICATION_FAILED');
    assert.equal(calls.length, 2);
    assert.match(calls[0][0], /\/resume$/);
    assert.match(calls[1][0], /\/pause$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI Channels contains a visible test label and an immediate Instagram kill switch', async () => {
  const source = await readFile(new URL('../src/modules/aiSupport/pages/AiChannels.jsx', import.meta.url), 'utf8');
  assert.match(source, /Instagram Test Environment/);
  assert.match(source, /Current Connected Account/);
  assert.match(source, /Disable Instagram Bridge/);
  assert.match(source, /channel-gateway-admin\/instagram\/\$\{enabled \? "enable" : "disable"\}/);
});

test('ERP inbound authentication prefers its dedicated shared secret', async () => {
  const source = await readFile(new URL('../server/middleware/channelGatewayAuth.js', import.meta.url), 'utf8');
  assert.match(source, /ERP_CHANNEL_GATEWAY_HMAC_SECRET\s*\|\|\s*process\.env\.CHANNEL_GATEWAY_HMAC_SECRET/);
});

test('admin resume allows a bounded browser startup without weakening normal request timeouts', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  assert.match(source, /timeoutMs = 10_000/);
  assert.match(source, /\/resume`, \{ method: 'POST', timeoutMs: 180_000 \}/);
  assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/);
});
