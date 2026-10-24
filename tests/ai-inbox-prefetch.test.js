import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxPrefetch } from '../src/modules/aiSupport/services/inboxPrefetchState.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('opening the inbox joins the preload and consumes it only once', async () => {
  const pending = deferred();
  let calls = 0;
  const saved = [];
  const cache = createInboxPrefetch({ channels: ['wa'], isCurrent: (id) => id === 'tenant:user',
    fetchPage: () => { calls++; return pending.promise; }, savePage: (...args) => saved.push(args) });
  const batch = cache.start('tenant:user');
  await tick();
  const handoff = cache.take('tenant:user', 'wa');
  assert.ok(handoff);
  assert.equal(cache.take('tenant:user', 'wa'), null);
  await cache.start('tenant:user');
  assert.equal(calls, 1);
  const payload = { conversations: [{ session_id: 'wa:1' }], has_more: true, next_cursor: { activity_at: 'now' } };
  pending.resolve(payload);
  assert.equal(await handoff, payload);
  await batch;
  assert.deepEqual(saved, [['wa', payload]]);
});

test('a completed preload is available synchronously for the first React render', async () => {
  let current = true;
  const payload = { conversations: Array.from({ length: 30 }, (_, i) => ({ session_id: `thread:${i}` })) };
  const cache = createInboxPrefetch({ channels: ['preview'], isCurrent: () => current,
    fetchPage: async () => payload, savePage: () => {} });
  assert.equal(cache.peek('one', 'preview'), null);
  await cache.start('one');
  assert.equal(cache.peek('one', 'preview'), payload);
  assert.equal(cache.peek('one', 'preview').conversations.length, 30);
  assert.equal(await cache.take('one', 'preview'), payload);
  assert.equal(cache.peek('one', 'preview'), null);
  current = false;
  assert.equal(cache.peek('one', 'preview'), null);
});

test('preloading is bounded to two simultaneous requests and a failed channel does not stop the rest', async () => {
  const requests = new Map();
  let active = 0, peak = 0;
  const saved = [];
  const cache = createInboxPrefetch({ channels: ['wa', 'fb', 'ig', 'web'], isCurrent: () => true,
    fetchPage: (channel) => {
      const d = deferred(); requests.set(channel, d); active++; peak = Math.max(peak, active);
      return d.promise.finally(() => active--);
    }, savePage: (channel) => saved.push(channel) });
  const batch = cache.start('one');
  await tick();
  assert.deepEqual([...requests.keys()], ['wa', 'fb']);
  requests.get('wa').reject(new Error('offline'));
  requests.get('fb').resolve({ conversations: [] });
  await tick();
  assert.equal(cache.take('one', 'wa'), null);
  requests.get('ig').resolve({ conversations: [] });
  requests.get('web').resolve({ conversations: [] });
  await batch;
  assert.equal(peak, 2);
  assert.deepEqual(saved.sort(), ['fb', 'ig', 'web']);
});

test('logout cancels pending requests and late responses cannot repopulate the cache', async () => {
  const pending = deferred();
  let signal;
  const saved = [];
  const cache = createInboxPrefetch({ channels: ['wa'], isCurrent: () => true,
    fetchPage: (_channel, s) => { signal = s; return pending.promise; }, savePage: (...args) => saved.push(args) });
  const batch = cache.start('old');
  await tick();
  cache.clear();
  assert.equal(signal.aborted, true);
  pending.resolve({ conversations: [{ session_id: 'private' }] });
  await batch;
  assert.equal(saved.length, 0);
  assert.equal(cache.take('old', 'wa'), null);
});

test('different users/tenants and expired pages cannot use an earlier preload', async () => {
  let identity = 'tenant1:user1', clock = 100;
  let calls = 0;
  const cache = createInboxPrefetch({ channels: ['wa'], isCurrent: (id) => id === identity, now: () => clock,
    fetchPage: async () => { calls++; return { conversations: [] }; }, savePage: () => {} });
  await cache.start(identity);
  assert.equal(cache.take('tenant2:user1', 'wa'), null);
  clock += 60001;
  assert.equal(cache.take(identity, 'wa'), null);
  identity = 'tenant2:user1';
  assert.equal(cache.take('tenant1:user1', 'wa'), null);
  await cache.start(identity);
  assert.equal(calls, 2);
});
