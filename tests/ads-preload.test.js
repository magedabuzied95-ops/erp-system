import test from 'node:test';
import assert from 'node:assert/strict';
import { adRequestKey } from '../src/shared/lib/adRequestKey.js';
import { workspaceMutationKeys } from '../src/shared/lib/workspaceMutationKeys.js';
import { createPreparedWorkspaceCache } from '../src/shared/lib/preparedWorkspaceCache.js';

test('ad snapshots match query order but separate accounts, platforms, periods and levels', () => {
  const path = '/meta-ads/manager/data?account_id=1&level=campaign&days=all';
  assert.equal(adRequestKey(path), adRequestKey('/meta-ads/manager/data?days=all&level=campaign&account_id=1'));
  for (const other of [path.replace('=1', '=2'), path.replace('=all', '=30'), path.replace('=campaign', '=ad'), path.replace('meta-ads', 'tiktok-ads')]) {
    assert.notEqual(adRequestKey(path), adRequestKey(other));
  }
});

test('successful ad mutations invalidate only their platform; reads preserve snapshots', () => {
  for (const platform of ['google-ads', 'meta-ads', 'tiktok-ads']) {
    assert.deepEqual(workspaceMutationKeys('GET', `/${platform}/data`), []);
    assert.deepEqual(workspaceMutationKeys('POST', `/${platform}/accounts/1/disconnect`), [platform]);
  }
});

test('ad account mutation drops prepared responses without dropping inbox/POS priority data', async () => {
  const cache = createPreparedWorkspaceCache({ scope: () => 'tenant:user' });
  const key = adRequestKey('/google-ads/accounts/1/data?days=30');
  await cache.prepare(key, async () => ({ rows: ['old'] }));
  await cache.prepare('pos', async () => ({ products: [1] }));
  cache.invalidate('google-ads');
  assert.equal(cache.peek(key), null);
  assert.deepEqual(cache.peek('pos'), { products: [1] });
  assert.deepEqual(await cache.read(key, async () => ({ rows: ['new'] })), { rows: ['new'] });
});
