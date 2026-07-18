import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramPlaywrightDriver, shouldSkipInstagramMessageCandidate } from '../src/browser/InstagramPlaywrightDriver.js';

test('message candidate filter keeps avatar-backed message bubbles but skips the profile card', () => {
  const identityLabels = ['IG-A-001', 'Test User A'];
  assert.equal(shouldSkipInstagramMessageCandidate({ text: 'IG-A-001', hasLinkedImage: true, identityLabels }), true);
  assert.equal(shouldSkipInstagramMessageCandidate({ text: 'IG-A-PARALLEL-20260718-215940', hasLinkedImage: true, identityLabels }), false);
  assert.equal(shouldSkipInstagramMessageCandidate({ text: 'IG-A-001-20260718-215940', hasLinkedImage: false, identityLabels }), false);
  assert.equal(shouldSkipInstagramMessageCandidate({ text: 'Accept', identityLabels }), true);
  assert.equal(shouldSkipInstagramMessageCandidate({ text: 'Video', identityLabels }), true);
});

test('conversation discovery always reserves capacity for message requests', async () => {
  const driver = new InstagramPlaywrightDriver({
    config: {}, diagnostics: null, safety: { beforeConversationOpen: async () => {} },
  });
  const calls = [];
  driver.openInbox = async () => {};
  driver.collectLinkedConversations = async (limit) => {
    calls.push(['linked', limit]);
    return Array.from({ length: limit }, (_, index) => ({ threadId: `inbox-${index}` }));
  };
  driver.collectButtonConversations = async (url, limit) => {
    calls.push([url, limit]);
    return Array.from({ length: limit }, (_, index) => ({ threadId: `request-${index}` }));
  };

  const conversations = await driver.listConversations({ limit: 6 });

  assert.equal(conversations.length, 6);
  assert.deepEqual(calls, [
    ['linked', 4],
    ['https://www.instagram.com/direct/requests/', 2],
  ]);
  assert.equal(conversations.filter((item) => item.threadId.startsWith('request-')).length, 2);
  assert.equal(conversations[0].threadId, 'request-0');
});

test('button-based inbox discovery scans both Primary and General tabs', async () => {
  const driver = new InstagramPlaywrightDriver({
    config: {}, diagnostics: null, safety: { beforeConversationOpen: async () => {} },
  });
  const calls = [];
  driver.openInbox = async () => {};
  driver.collectLinkedConversations = async () => [];
  driver.collectButtonConversations = async (url, limit, options = {}) => {
    const scope = options.tabName || 'Requests';
    calls.push([url, limit, scope]);
    return Array.from({ length: limit }, (_, index) => ({ threadId: `${scope}-${index}` }));
  };

  const conversations = await driver.listConversations({ limit: 6 });

  assert.deepEqual(calls, [
    ['https://www.instagram.com/direct/inbox/', 2, 'Primary'],
    ['https://www.instagram.com/direct/inbox/', 2, 'General'],
    ['https://www.instagram.com/direct/requests/', 2, 'Requests'],
  ]);
  assert.equal(conversations.length, 6);
  assert.equal(conversations[0].threadId, 'Requests-0');
  assert.ok(conversations.some((item) => item.threadId === 'Primary-0'));
  assert.ok(conversations.some((item) => item.threadId === 'General-0'));
});
