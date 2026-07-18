import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramBridge } from '../src/InstagramBridge.js';
import { buildConversationIdentity } from '../src/domain/identity.js';

class MemoryState {
  constructor() { this.seen = new Set(); this.conversations = {}; this.reconciliations = {}; }
  async load() {} hasMessage(key) { return this.seen.has(key); }
  async rememberMessage(key) { if (this.seen.has(key)) return false; this.seen.add(key); return true; }
  async saveConversation(identity) { this.conversations[identity.external_conversation_id] = identity; }
  getConversation(id) { return this.conversations[id] || null; }
  async setReconciliation(key, value) { this.reconciliations[key] = value; }
  async clearReconciliation(key) { delete this.reconciliations[key]; }
  listReconciliations() { return Object.entries(this.reconciliations); }
}

const config = { enabled: true, inboundEnabled: true, outboundEnabled: true, recoverySyncEnabled: true, tenantId: 1, connectionId: '2', channelAccountId: 'instagram-test-account', maxConversationsPerMinute: 12, liveWatchIntervalMs: 999999, recoverySyncIntervalMs: 999999, selectorFailurePauseThreshold: 3 };
const identity = buildConversationIdentity({ threadId: 'thread-a', externalUsername: 'user_a', headerIdentity: 'User A', channelAccountId: 'instagram-test-account', channelConnectionId: 2 });

function fixture({ messages = [], actualIdentity = identity } = {}) {
  const imported = [];
  const driver = {
    page: null, connect: async () => {}, disconnect: async () => {}, openInbox: async () => {},
    listConversations: async () => [{ threadId: 'thread-a', url: '/direct/t/thread-a/', preview: 'Unread' }],
    openConversation: async () => actualIdentity, readMessages: async () => messages,
    sendText: async () => ({ clickedAt: '2026-07-18T10:00:00Z' }), markAsRead: async () => ({ marked: true }),
    getHealthProbe: async () => ({ browserRunning: true, authenticated: true, inboxLoaded: true, session: 'authenticated' }), memoryUsageMb: async () => 10,
    reload: async () => {}, reopenInboxTab: async () => {},
  };
  const state = new MemoryState();
  const bridge = new InstagramBridge({ config, driver, state, gateway: { importMessage: async (event) => { imported.push(event); return { duplicate: false }; } }, diagnostics: { capture: async () => {} }, safety: { assertSendAllowed() {}, beforeConversationOpen: async () => {}, success() {}, failure() {} }, logger: { warn() {} } });
  return { bridge, state, imported };
}

test('live watch and recovery sync import the same incoming message once', async () => {
  const message = { text: 'Test A 001', direction: 'incoming', externalMessageId: 'm1', sentAt: '2026-07-18T10:00:00Z' };
  const { bridge, imported } = fixture({ messages: [message] });
  await bridge.syncMessages({ threadId: 'thread-a' }, 'live_watch'); await bridge.syncMessages({ threadId: 'thread-a' }, 'recovery_sync');
  assert.equal(imported.length, 1);
});

test('manual outbound confirms only after outgoing bubble appears', async () => {
  const { bridge, state } = fixture({ messages: [{ text: 'reply', direction: 'outgoing', externalMessageId: 'out-1', sentAt: '2026-07-18T10:00:03Z' }] });
  await state.saveConversation(identity);
  const result = await bridge.sendText('thread-a', 'reply', { manual_user_id: 7, job_key: 'j1' });
  assert.equal(result.status, 'confirmed'); assert.equal(result.external_message_id, 'out-1'); assert.equal(state.reconciliations.j1, undefined);
});

test('confirmation timeout becomes sent_unconfirmed and is not immediately retried', async () => {
  const { bridge, state } = fixture({ messages: [] }); await state.saveConversation(identity);
  const result = await bridge.sendText('thread-a', 'reply', { manual_user_id: 7, job_key: 'j2' });
  assert.equal(result.status, 'sent_unconfirmed'); assert.equal(result.reconciliation_required, true); assert.ok(state.reconciliations.j2);
});

test('wrong conversation header blocks send with manual review', async () => {
  const wrong = buildConversationIdentity({ threadId: 'thread-b', externalUsername: 'user_b', headerIdentity: 'User B', channelAccountId: 'instagram-test-account' });
  const { bridge, state } = fixture({ actualIdentity: wrong }); await state.saveConversation(identity);
  await assert.rejects(() => bridge.sendText('thread-a', 'reply', { manual_user_id: 7 }), (error) => error.needsManualReview && error.code === 'CONVERSATION_HEADER_MISMATCH');
});

test('AI auto-send and non-manual send are forbidden', async () => {
  const { bridge } = fixture();
  await assert.rejects(() => bridge.sendText('thread-a', 'reply', { ai_generated: true }), /AI auto-send/);
  await assert.rejects(() => bridge.sendText('thread-a', 'reply', {}), /Manual employee action/);
});

test('unsupported phase operations return explicit result', () => {
  const { bridge } = fixture();
  for (const operation of ['sendMedia', 'downloadMedia', 'sendReaction', 'typingIndicator']) assert.equal(bridge[operation]().status, 'unsupported_in_current_phase');
});

test('scheduled browser work starts immediately and never overlaps', async () => {
  const { bridge } = fixture();
  let active = 0; let maxActive = 0; let calls = 0;
  const timer = bridge.schedule(async () => {
    calls += 1; active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    active -= 1;
  }, 5, 'overlap_probe');
  await new Promise((resolve) => setTimeout(resolve, 62));
  clearInterval(timer);
  assert.equal(maxActive, 1);
  assert.ok(calls >= 2 && calls <= 3);
});

test('live watch and recovery timers share one browser-operation lock', async () => {
  const { bridge } = fixture();
  let active = 0; let maxActive = 0;
  const operation = async () => {
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
  };
  const live = bridge.schedule(operation, 5, 'live_watch_probe');
  const recovery = bridge.schedule(operation, 5, 'recovery_sync_probe');
  await new Promise((resolve) => setTimeout(resolve, 55));
  clearInterval(live); clearInterval(recovery);
  assert.equal(maxActive, 1);
});
