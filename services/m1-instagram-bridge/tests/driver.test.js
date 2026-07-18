import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramPlaywrightDriver } from '../src/browser/InstagramPlaywrightDriver.js';

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
