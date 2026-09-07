import test from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage stub so authStorage can resolve identity in node.
const makeLocalStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
};
const signIn = (user) => { globalThis.localStorage = makeLocalStorage(user ? { user: JSON.stringify(user) } : {}); };
signIn({ id: "u1", tenant_id: "t1" });
globalThis.window = globalThis.window || {};

const snap = await import("../src/modules/aiSupport/services/inboxCatalogSnapshot.js");

const products = [{ id: 1, name: "Sneaker", variants: [{ id: 11, size: "42", stock: 3 }] }];
let store;

test.beforeEach(() => {
  store = new Map();
  snap.__setStoreForTests(store);
  signIn({ id: "u1", tenant_id: "t1" });
});
test.afterEach(() => snap.__resetStoreForTests());

test("a written snapshot reads back with its catalog version", async () => {
  await snap.writeCatalogSnapshot(products, "1.2.3");
  const record = await snap.readCatalogSnapshot();
  assert.equal(record.catalog_version, "1.2.3");
  assert.deepEqual(record.products, products);
});

test("no identity means no read and no write", async () => {
  signIn(null);
  assert.equal(await snap.writeCatalogSnapshot(products, "v"), null);
  assert.equal(store.size, 0);
  assert.equal(await snap.readCatalogSnapshot(), null);
});

test("another user's snapshot is never served", async () => {
  await snap.writeCatalogSnapshot(products, "v");
  signIn({ id: "u2", tenant_id: "t1" });
  assert.equal(await snap.readCatalogSnapshot(), null);
  signIn({ id: "u1", tenant_id: "t2" });
  assert.equal(await snap.readCatalogSnapshot(), null);
});

test("a snapshot past the hard expiry is not painted", async () => {
  await snap.writeCatalogSnapshot(products, "v");
  const [key] = [...store.keys()];
  store.set(key, { ...store.get(key), cached_at: Date.now() - snap.SNAPSHOT_MAX_AGE_MS - 1 });
  assert.equal(await snap.readCatalogSnapshot(), null);
});

test("a snapshot from an older schema version is not painted", async () => {
  await snap.writeCatalogSnapshot(products, "v");
  const [key] = [...store.keys()];
  store.set(key, { ...store.get(key), schema_version: snap.INBOX_CATALOG_SCHEMA_VERSION - 1 });
  assert.equal(await snap.readCatalogSnapshot(), null);
});

test("an empty catalog never overwrites a good snapshot", async () => {
  await snap.writeCatalogSnapshot(products, "v1");
  await snap.writeCatalogSnapshot([], "v2");
  const record = await snap.readCatalogSnapshot();
  assert.equal(record.catalog_version, "v1");
  assert.equal(record.products.length, 1);
});

test("touch re-stamps freshness without changing the payload or version", async () => {
  await snap.writeCatalogSnapshot(products, "v1");
  const [key] = [...store.keys()];
  const stale = { ...store.get(key), cached_at: Date.now() - snap.SNAPSHOT_FRESH_MS - 1000 };
  store.set(key, stale);
  assert.ok(snap.snapshotAgeMs(stale) > snap.SNAPSHOT_FRESH_MS);
  const touched = await snap.touchCatalogSnapshot(stale);
  assert.ok(snap.snapshotAgeMs(touched) < snap.SNAPSHOT_FRESH_MS);
  assert.equal(touched.catalog_version, "v1");
  assert.deepEqual(touched.products, products);
  assert.deepEqual((await snap.readCatalogSnapshot()).products, products);
});

test("logout wipes every tenant's snapshot, not just the signed-in one", async () => {
  await snap.writeCatalogSnapshot(products, "v1");
  signIn({ id: "u2", tenant_id: "t9" });
  await snap.writeCatalogSnapshot(products, "v2");
  assert.equal(store.size, 2);
  await snap.clearAllCatalogSnapshots();
  assert.equal(store.size, 0);
});

test("a store that throws degrades to no cache instead of breaking the sheet", async () => {
  snap.__setStoreForTests({
    get() { throw new Error("boom"); },
    set() { throw new Error("boom"); },
    delete() { throw new Error("boom"); },
    clear() { throw new Error("boom"); },
  });
  assert.equal(await snap.readCatalogSnapshot(), null);
  await snap.writeCatalogSnapshot(products, "v");
  await snap.clearAllCatalogSnapshots();
});
