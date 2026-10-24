import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedWorkspaceCache } from '../src/shared/lib/preparedWorkspaceCache.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('navigation joins a running preload; ready data is available synchronously', async () => {
  const cache = createPreparedWorkspaceCache({ scope: () => 'tenant:user:branch:permissions' });
  const d = deferred(); let requests = 0;
  const loader = () => { requests++; return d.promise; };
  const warm = cache.prepare('orders', loader);
  const open = cache.read('orders', loader);
  assert.equal(warm, open);
  assert.equal(cache.peek('orders'), null);
  d.resolve([{ id: 1 }]);
  await open;
  assert.equal(requests, 1);
  assert.deepEqual(cache.peek('orders'), [{ id: 1 }]);
});

test('preloaded data is handed off once; explicit refresh and later reads use live requests', async () => {
  const cache = createPreparedWorkspaceCache({ scope: () => 'one' });
  let requests = 0;
  const loader = async () => ++requests;
  await cache.prepare('dashboard', loader);
  assert.equal(await cache.read('dashboard', loader), 1);
  assert.equal(await cache.read('dashboard', loader), 2);
  assert.equal(await cache.read('dashboard', loader, { force: true }), 3);
});

test('tenant, user, branch or permissions changes abort pending preloads and reject late writes', async () => {
  let scope = 'old'; let signal;
  const cache = createPreparedWorkspaceCache({ scope: () => scope });
  const d = deferred();
  const warm = cache.prepare('pos', (s) => { signal = s; return d.promise; });
  await Promise.resolve();
  scope = 'new';
  assert.equal(cache.peek('pos'), null);
  assert.equal(signal.aborted, true);
  d.resolve({ products: ['private'] });
  await assert.rejects(warm);
  assert.equal(cache.peek('pos'), null);
});

test('logout clears snapshots and no unidentified account starts a preload', async () => {
  let scope = 'user'; let calls = 0;
  const cache = createPreparedWorkspaceCache({ scope: () => scope });
  await cache.prepare('pos', async () => ({ products: [1] }));
  scope = '';
  assert.equal(cache.peek('pos'), null);
  await cache.prepare('pos', async () => calls++);
  assert.equal(calls, 0);
});

test('expired data and failed preloads fall back to the normal live loader', async () => {
  let now = 0;
  const cache = createPreparedWorkspaceCache({ scope: () => 'one', now: () => now });
  await cache.prepare('orders', async () => 'old');
  now = 31000;
  assert.equal(cache.peek('orders'), null);
  assert.equal(await cache.read('orders', async () => 'fresh'), 'fresh');
  await assert.rejects(cache.prepare('pos', async () => { throw new Error('offline'); }));
  assert.equal(await cache.read('pos', async () => 'recovered'), 'recovered');
});
