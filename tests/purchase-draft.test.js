import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const makeLocalStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
};
globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 7, tenant_id: 3 }) });
globalThis.window = globalThis.window || {};

const store = await import("../src/modules/purchases/services/purchaseDraftStore.js");

const memAdapter = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, keys: async () => [...m.keys()], available: () => true };
};
const throwing = () => ({ get: async () => { throw new Error("x"); }, set: async () => { throw new Error("x"); }, delete: async () => { throw new Error("x"); }, keys: async () => { throw new Error("x"); }, available: () => true });

test.beforeEach(() => { globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 7, tenant_id: 3 }) }); store.__setAdapterForTests(memAdapter()); });
test.afterEach(async () => { await store.clearPurchaseDraft().catch(() => {}); store.__resetAdapterForTests(); });

test("namespace is tenant+user, token-free; no-op without identity", () => {
  assert.equal(store.resolvePurchaseDraftKey(), "purchase:v1:t=3:u=7");
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 7 }) }); // no tenant
  assert.equal(store.resolvePurchaseDraftKey(), "");
  globalThis.localStorage = makeLocalStorage({}); // no user
  assert.equal(store.resolvePurchaseDraftKey(), "");
  // the key never contains a token/jwt — only numeric ids
  assert.doesNotMatch("purchase:v1:t=3:u=7", /token|jwt|bearer|secret/i);
});

test("save (debounced) → load round-trips; clear removes", async () => {
  assert.equal(await store.loadPurchaseDraft(), null);
  store.savePurchaseDraft({ supplier_id: "5", items: [{ variant_id: 11, quantity: 3, cost_price: 12 }] });
  await store.flushPendingPurchaseDraftWrites();
  const d = await store.loadPurchaseDraft();
  assert.equal(d.supplier_id, "5");
  assert.equal(d.items[0].variant_id, 11);
  await store.clearPurchaseDraft();
  assert.equal(await store.loadPurchaseDraft(), null);
});

test("user / tenant isolation: different identity resolves a different key", async () => {
  const k1 = store.resolvePurchaseDraftKey();
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 8, tenant_id: 3 }) }); // other user
  assert.notEqual(store.resolvePurchaseDraftKey(), k1);
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 7, tenant_id: 4 }) }); // other tenant
  assert.notEqual(store.resolvePurchaseDraftKey(), k1);
});

test("User B never loads User A's draft", async () => {
  const adapter = memAdapter();
  store.__setAdapterForTests(adapter);
  store.savePurchaseDraft({ supplier_id: "A", items: [{ variant_id: 1, quantity: 1 }] });
  await store.flushPendingPurchaseDraftWrites();
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 99, tenant_id: 3 }) }); // User B
  assert.equal(await store.loadPurchaseDraft(), null);
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: 7, tenant_id: 3 }) }); // back to A
  assert.equal((await store.loadPurchaseDraft())?.supplier_id, "A");
});

test("expired drafts (>TTL) are not returned and get swept", async () => {
  const adapter = memAdapter();
  store.__setAdapterForTests(adapter);
  const key = store.resolvePurchaseDraftKey();
  const old = Date.now() - 15 * 24 * 60 * 60 * 1000;
  await adapter.set(key, { schema: 1, updatedAt: old, draft: { items: [] } });
  assert.equal(await store.loadPurchaseDraft(), null);
  await adapter.set(key, { schema: 1, updatedAt: old, draft: { items: [] } });
  assert.ok((await store.sweepExpiredPurchaseDrafts()) >= 1);
  assert.equal((await adapter.keys()).length, 0);
});

test("fail-safe: read→null, writes/clear never throw", async () => {
  store.__setAdapterForTests(throwing());
  assert.equal(await store.loadPurchaseDraft(), null);
  assert.doesNotThrow(() => store.savePurchaseDraft({ items: [{ variant_id: 1, quantity: 1 }] }));
  await assert.doesNotReject(store.flushPendingPurchaseDraftWrites());
  await assert.doesNotReject(store.clearPurchaseDraft());
});

test("buildPurchaseDraftBody stays compact (no catalog/gallery); 100 lines is small", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({
    line_id: `l${i}`, product_id: i, variant_id: 1000 + i, product_name: "Model " + i,
    color: "c", size: String(30 + (i % 15)), quantity: i + 1, cost_price: 10 + i, selling_price: 20 + i,
    // heavy junk that must NOT be persisted:
    variants: new Array(20).fill({ x: 1 }), gallery: new Array(10).fill("http://img"), description: "x".repeat(500),
  }));
  const body = store.buildPurchaseDraftBody({ supplierId: "5", warehouseId: "2", branchId: "1", items });
  assert.equal(body.items.length, 100);
  assert.equal(body.items[0].variants, undefined);
  assert.equal(body.items[0].gallery, undefined);
  assert.equal(body.items[0].description, undefined);
  const bytes = JSON.stringify(body).length;
  assert.ok(bytes < 60 * 1024, `100-line draft should be small, got ${bytes} bytes`);
});

test("PurchaseOrder wiring: memoized CartLine, stable callbacks, draft persist/restore/cleanup", () => {
  const src = fs.readFileSync(new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url), "utf8");
  assert.match(src, /const CartLine = memo\(function CartLine\(/);
  assert.match(src, /const updateItem = useCallback\(/);
  assert.match(src, /const changeQty = useCallback\(/);
  assert.match(src, /const removeItem = useCallback\(/);
  assert.match(src, /const changeItemVariant = useCallback\([\s\S]*\}, \[variantsByProduct\]\)/);
  // draft: restore on open, autosave, clear only on authoritative success
  assert.match(src, /loadPurchaseDraft\(\)/);
  assert.match(src, /savePurchaseDraft\(\{/);
  assert.match(src, /purchaseSaveIdRef\.current = "";\s*\n\s*\/\/[\s\S]*\n\s*void clearPurchaseDraft\(\);/);
});
