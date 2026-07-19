import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelAdapter, CHANNEL_ADAPTER_METHODS, assertChannelAdapter } from '../src/adapters/ChannelAdapter.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { InstagramBridgeAdapter } from '../src/adapters/InstagramBridgeAdapter.js';

class FakeAdapter extends ChannelAdapter {
  async connect() {}
  async disconnect() {}
  async getHealth() { return { status: 'ok' }; }
  async syncConversations() { return []; }
  async syncMessages() { return []; }
  async sendText() { return { external_message_id: '1' }; }
  async sendMedia() { return { external_message_id: '2' }; }
  async markAsRead() {}
  async restart() {}
}

test('adapter contract contains every future channel operation', () => {
  assert.deepEqual(CHANNEL_ADAPTER_METHODS, [
    'connect', 'disconnect', 'getHealth', 'syncConversations', 'syncMessages',
    'sendText', 'sendMedia', 'markAsRead', 'restart',
  ]);
  const adapter = new FakeAdapter({ channel: 'instagram', connectionId: '5' });
  assert.equal(assertChannelAdapter(adapter), adapter);
  const registry = new AdapterRegistry();
  registry.register('5', adapter);
  assert.equal(registry.get(5), adapter);
});

test('invalid adapter is rejected before registration', () => {
  assert.throws(() => assertChannelAdapter({ connect() {} }), /missing/);
});

test('Instagram remote adapter signs text calls and keeps media unsupported', async () => {
  const calls = [];
  const adapter = new InstagramBridgeAdapter({
    connectionId: '7', baseUrl: 'http://bridge', secret: 'test-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ status: 'confirmed', confirmed: true, external_message_id: 'ig-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await adapter.sendText('thread-a', 'hello', { event_id: 'job-1', metadata: { manual_user_id: 9 } });
  assert.equal(result.confirmed, true); assert.match(calls[0].url, /messages\/text/); assert.ok(calls[0].options.headers['x-m1-signature']);
  await assert.rejects(() => adapter.sendMedia(), /Media is disabled/);
});
