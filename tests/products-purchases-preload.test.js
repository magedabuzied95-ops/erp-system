import test from 'node:test';
import assert from 'node:assert/strict';
import { readProductListBootstrap, productListSignature } from '../src/modules/products/lib/productListBootstrap.js';
import { workspaceMutationKeys } from '../src/shared/lib/workspaceMutationKeys.js';
import { createPreparedWorkspaceCache } from '../src/shared/lib/preparedWorkspaceCache.js';

const storage = (values = {}) => ({ getItem: (key) => values[key] ?? null });

test('product preload matches saved filters and first-page size exactly', () => {
  const spec = readProductListBootstrap(storage({ 'erp.products.list.pageSize': '25',
    'erp.products.list.filters.v1': JSON.stringify({ brand: 'Adidas', catalogTab: 'offers', classifications: { gender: 'men' } }) }));
  assert.equal(spec.params.page, 1);
  assert.equal(spec.params.limit, 25);
  assert.equal(spec.params.brand, 'Adidas');
  assert.equal(spec.params.catalogTab, 'offers');
  assert.equal(spec.params.gender, 'men');
  assert.equal(spec.params.grade, 'all');
  assert.equal(spec.signature, productListSignature({ ...spec.params, refresh: 123 }));
  assert.notEqual(spec.signature, productListSignature({ ...spec.params, brand: 'Nike' }));
  assert.notEqual(spec.signature, productListSignature({ ...spec.params, page: 2 }));
  assert.notEqual(spec.signature, productListSignature({ ...spec.params, search: 'shoe' }));
});

test('large or all-product pages are never downloaded speculatively', () => {
  for (const size of ['100', '200', '500', '1000', 'all']) {
    assert.equal(readProductListBootstrap(storage({ 'erp.products.list.pageSize': size })), null);
  }
  assert.equal(readProductListBootstrap(storage()).params.limit, 10);
  assert.equal(readProductListBootstrap({ getItem() { throw new Error('storage blocked'); } }).params.limit, 10);
});

test('reads never invalidate snapshots; writes invalidate only dependent workspaces', () => {
  assert.deepEqual(workspaceMutationKeys('GET', '/purchases'), []);
  assert.deepEqual(workspaceMutationKeys('GET', '/products/admin-list'), []);
  assert.deepEqual(workspaceMutationKeys('PATCH', '/products/123/prices'), ['products', 'pos']);
  assert.deepEqual(workspaceMutationKeys('POST', '/purchases/123/receive'), ['purchases', 'products', 'pos']);
  assert.deepEqual(workspaceMutationKeys('DELETE', 'https://api.example.com/api/purchases/123'), ['purchases', 'products', 'pos']);
  assert.deepEqual(workspaceMutationKeys('POST', '/orders'), []);
});

test('invalidating products cancels old requests without dropping priority page snapshots', async () => {
  const cache = createPreparedWorkspaceCache({ scope: () => 'tenant:user' });
  await cache.prepare('dashboard', async () => ({ sales: 100 }));
  let resolve, signal;
  const pending = cache.prepare('products:filters', (s) => { signal = s; return new Promise((done) => { resolve = done; }); });
  await Promise.resolve();
  cache.invalidate('products');
  assert.equal(signal.aborted, true);
  resolve({ products: ['old'] });
  await assert.rejects(pending);
  assert.equal(cache.peek('products:filters'), null);
  assert.deepEqual(cache.peek('dashboard'), { sales: 100 });
});
