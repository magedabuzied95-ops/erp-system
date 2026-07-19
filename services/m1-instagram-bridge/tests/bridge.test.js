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
  listConversations() { return Object.values(this.conversations); }
  async setReconciliation(key, value) { this.reconciliations[key] = value; }
  async clearReconciliation(key) { delete this.reconciliations[key]; }
  listReconciliations() { return Object.entries(this.reconciliations); }
}

const config = { enabled: true, inboundEnabled: true, outboundEnabled: true, recoverySyncEnabled: true, tenantId: 1, connectionId: '2', channelAccountId: 'instagram-test-account', expectedUsername: 'm.one.store.pro', maxConversationsPerMinute: 12, liveWatchIntervalMs: 999999, recoverySyncIntervalMs: 999999, selectorFailurePauseThreshold: 3 };
const identity = buildConversationIdentity({ threadId: 'thread-a', externalUsername: 'user_a', headerIdentity: 'User A', channelAccountId: 'instagram-test-account', channelConnectionId: 2 });

function fixture({ messages = [], actualIdentity = identity } = {}) {
  const imported = [];
  const driver = {
    page: null, connect: async () => {}, disconnect: async () => {}, openInbox: async () => {},
    listConversations: async () => [{ threadId: 'thread-a', url: '/direct/t/thread-a/', preview: 'Unread' }],
    openConversation: async () => actualIdentity, readMessages: async () => messages,
    sendText: async () => ({ clickedAt: '2026-07-18T10:00:00Z' }), markAsRead: async () => ({ marked: true }),
    getHealthProbe: async () => ({ browserRunning: true, authenticated: true, inboxLoaded: true, session: 'authenticated', currentAccountUsername: 'm.one.store.pro' }), memoryUsageMb: async () => 10,
    reload: async () => {}, reopenInboxTab: async () => {},
  };
  const state = new MemoryState();
  const bridge = new InstagramBridge({ config, driver, state, gateway: { importMessage: async (event) => { imported.push(event); return { duplicate: false }; } }, diagnostics: { capture: async () => {} }, safety: { assertSendAllowed() {}, beforeConversationOpen: async () => {}, success() {}, failure() {} }, logger: { warn() {} } });
  bridge.paused = false;
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

test('kill switch blocks manual outbound before browser interaction', async () => {
  const { bridge, state } = fixture();
  await state.saveConversation(identity);
  bridge.paused = true;
  let opened = 0;
  bridge.driver.openConversation = async () => { opened += 1; return identity; };
  await assert.rejects(
    () => bridge.sendText('thread-a', 'blocked by kill switch', { manual_user_id: 7 }),
    (error) => error.code === 'BRIDGE_PAUSED' && error.status === 409,
  );
  assert.equal(opened, 0);
});

test('account identity mismatch keeps watchers and outbound disabled', async () => {
  const { bridge, state } = fixture();
  await state.saveConversation(identity);
  bridge.driver.openInbox = async () => { throw Object.assign(new Error('wrong account'), { code: 'ACCOUNT_IDENTITY_MISMATCH', expectedUsername: 'm.one.store.pro', currentUsername: 'm1store' }); };
  bridge.driver.getHealthProbe = async () => ({ browserRunning: true, authenticated: true, inboxLoaded: true, session: 'authenticated', currentAccountUsername: 'm1store' });
  const health = await bridge.start();
  assert.equal(health.status, 'account_mismatch');
  assert.equal(health.test_account_verified, false);
  assert.equal(bridge.paused, true);
  assert.equal(bridge.liveTimer, null);
  assert.equal(bridge.recoveryTimer, null);
  await assert.rejects(
    () => bridge.sendText('thread-a', 'must not send', { manual_user_id: 7 }),
    (error) => error.code === 'BRIDGE_PAUSED' || error.code === 'ACCOUNT_IDENTITY_MISMATCH',
  );
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
  assert.ok(calls >= 1);
});

test('startup session expiry keeps health API state alive and pauses all watchers', async () => {
  const { bridge } = fixture();
  bridge.driver.openInbox = async () => { throw Object.assign(new Error('session_expired'), { code: 'SESSION_EXPIRED' }); };
  bridge.driver.getHealthProbe = async () => ({ browserRunning: true, authenticated: false, inboxLoaded: false, session: 'session_expired' });

  const health = await bridge.start();

  assert.equal(health.status, 'login_required');
  assert.equal(health.session_state, 'session_expired');
  assert.equal(bridge.running, true);
  assert.equal(bridge.paused, true);
  assert.equal(bridge.liveTimer, null);
  assert.equal(bridge.recoveryTimer, null);
});

test('outbound is rejected before browser interaction while login is required', async () => {
  const { bridge, state } = fixture();
  await state.saveConversation(identity);
  bridge.driver.getHealthProbe = async () => ({ browserRunning: true, authenticated: false, inboxLoaded: false, session: 'session_expired' });
  let opened = 0;
  bridge.driver.openConversation = async () => { opened += 1; return identity; };

  await assert.rejects(
    () => bridge.sendText('thread-a', 'blocked reply', { manual_user_id: 7, job_key: 'login-blocked' }),
    (error) => error.code === 'LOGIN_REQUIRED',
  );
  assert.equal(opened, 0);
});

test('manual outbound waits for live browser navigation before verifying the target', async () => {
  const { bridge, state } = fixture({ messages: [{ text: 'reply', direction: 'outgoing', externalMessageId: 'out-lock-1', sentAt: '2026-07-18T10:00:03Z' }] });
  await state.saveConversation(identity);
  bridge.browserOperationInFlight = true;
  setTimeout(() => { bridge.browserOperationInFlight = false; }, 30);
  const startedAt = Date.now();

  const result = await bridge.sendText('thread-a', 'reply', { manual_user_id: 7, job_key: 'j-lock' });

  assert.equal(result.status, 'confirmed');
  assert.ok(Date.now() - startedAt >= 25);
});

test('manual recovery waits for an active scheduled browser operation', async () => {
  const { bridge } = fixture();
  bridge.browserOperationInFlight = true;
  setTimeout(() => { bridge.browserOperationInFlight = false; }, 30);
  const startedAt = Date.now();
  const result = await bridge.forceRecoverySync();
  assert.equal(result.scanned, 1);
  assert.ok(Date.now() - startedAt >= 25);
});

test('recovery sync revisits known conversations even when inbox discovery omits them', async () => {
  const message = { text: 'Known thread update', direction: 'incoming', externalMessageId: 'known-1', sentAt: '2026-07-18T10:00:00Z' };
  const { bridge, state, imported } = fixture({ messages: [message] });
  await state.saveConversation(identity);
  bridge.driver.listConversations = async () => [];
  bridge.paused = false;

  const result = await bridge.recoverySync();

  assert.equal(result.scanned, 1);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].external_conversation_id, 'thread-a');
});

test('live watch round-robins one known conversation when visible discovery omits it', async () => {
  const message = { text: 'Known live update', direction: 'incoming', externalMessageId: 'known-live-1', sentAt: '2026-07-18T10:00:00Z' };
  const { bridge, state, imported } = fixture({ messages: [message] });
  await state.saveConversation(identity);
  bridge.driver.listConversations = async () => [];
  bridge.paused = false;

  const result = await bridge.liveWatch();

  assert.equal(result.opened, 1);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].external_conversation_id, 'thread-a');
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

test('manual outbound waiting yields scheduled conversation sweeps', async () => {
  const { bridge } = fixture();
  bridge.paused = false;
  bridge.config.maxConversationsPerMinute = 3;
  bridge.initialKnownSweepCompleted = false;
  bridge.state.listConversations = () => [{ threadId: 'a' }, { threadId: 'b' }, { threadId: 'c' }];
  let opened = 0;
  bridge.syncMessages = async () => {
    opened += 1;
    if (opened === 1) bridge.browserOperationPriorityWaiting = true;
  };
  bridge.syncConversations = async () => [];

  await bridge.liveWatch();

  assert.equal(opened, 1);
});

test('manual outbound safely resets a stuck scheduled browser operation', async () => {
  const { bridge } = fixture();
  let disconnected = 0; let connected = 0; let inboxOpened = 0;
  bridge.browserOperationInFlight = true;
  bridge.driver.interruptActivePage = async () => {
    disconnected += 1;
    bridge.browserOperationInFlight = false;
  };
  bridge.driver.reopenInboxTab = async () => { connected += 1; inboxOpened += 1; };

  const result = await bridge.withExclusiveBrowserOperation(async () => 'sent', 500, { preemptAfterMs: 10 });

  bridge.stopWatchers();
  assert.equal(result, 'sent');
  assert.equal(disconnected, 1);
  assert.equal(connected, 1);
  assert.equal(inboxOpened, 1);
});
