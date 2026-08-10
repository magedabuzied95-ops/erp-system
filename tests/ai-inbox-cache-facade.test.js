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
globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t1" }) });
globalThis.window = globalThis.window || {};

const cache = await import("../src/modules/aiSupport/services/inboxCache/inboxCache.js");
const { createMemoryAdapter } = await import("../src/modules/aiSupport/services/inboxCache/memoryAdapter.js");

const mergeByIdentity = (messages = []) => {
  const keyOf = (m) => m.client_request_id || m.message_identity_key || m.provider_message_id || (m.id != null ? `id:${m.id}` : null);
  const out = []; const idx = new Map();
  for (const m of messages) { const k = keyOf(m); if (k && idx.has(k)) { out[idx.get(k)] = { ...out[idx.get(k)], ...m }; continue; } if (k) idx.set(k, out.length); out.push(m); }
  return out;
};

const throwingAdapter = () => ({
  get: async () => { throw new Error("boom"); },
  set: async () => { throw new Error("boom"); },
  delete: async () => { throw new Error("boom"); },
  keys: async () => { throw new Error("boom"); },
  clear: async () => { throw new Error("boom"); },
  available: () => true,
});

test.afterEach(() => { cache.__resetAdapterForTests(); });

test("namespace resolves from authenticated identity (tenant + user)", () => {
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t1" }) });
  assert.ok(cache.resolveNamespace().length > 0);
});

test("no cache namespace without a user id (never caches ambiguously)", () => {
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ tenant_id: "t1" }) }); // no id
  assert.equal(cache.resolveNamespace(), "");
});

test("cache read failure falls back to null (caller uses network)", async () => {
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t1" }) });
  cache.__setAdapterForTests(throwingAdapter());
  assert.equal(await cache.primeList("all"), null);
  assert.equal(await cache.primeThread("wa:1"), null);
  assert.equal(await cache.readLastThread(), null);
});

test("cache write failure never throws (inbox stays functional)", async () => {
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t1" }) });
  cache.__setAdapterForTests(throwingAdapter());
  assert.equal(await cache.saveThreadNow("wa:1", [{ id: 1 }], mergeByIdentity), false);
  assert.equal(await cache.clearAllCache(), false);
  // Debounced writes must not throw synchronously either.
  assert.doesNotThrow(() => cache.saveList([{ session_id: "wa:1" }], "all"));
  assert.doesNotThrow(() => cache.saveThread("wa:1", [{ id: 1 }], mergeByIdentity));
});

test("round-trip: thread saved (immediate) can be primed back", async () => {
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t1" }) });
  cache.__setAdapterForTests(createMemoryAdapter());
  await cache.saveThreadNow("wa:1", [{ id: 10, text: "hi", created_at: "2024-01-01" }], mergeByIdentity);
  const primed = await cache.primeThread("wa:1");
  assert.equal(primed.messages.length, 1);
  assert.equal(primed.messages[0].id, 10);
});

test("no identity → cache ops are safe no-ops even with a working adapter", async () => {
  globalThis.localStorage = makeLocalStorage({}); // no user
  cache.__setAdapterForTests(createMemoryAdapter());
  assert.equal(await cache.primeList("all"), null);
  assert.equal(await cache.saveThreadNow("wa:1", [{ id: 1 }], mergeByIdentity), false);
});

test("different identities get different namespaces (cross-user cannot collide)", () => {
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t1" }) });
  const nsA = cache.resolveNamespace();
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u2", tenant_id: "t1" }) });
  const nsB = cache.resolveNamespace();
  globalThis.localStorage = makeLocalStorage({ user: JSON.stringify({ id: "u1", tenant_id: "t2" }) });
  const nsC = cache.resolveNamespace();
  assert.notEqual(nsA, nsB);
  assert.notEqual(nsA, nsC);
});
