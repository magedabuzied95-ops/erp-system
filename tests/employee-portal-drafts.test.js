import test from "node:test";
import assert from "node:assert/strict";

const store = await import("../src/modules/employees/services/employeeDrafts/employeeDraftStore.js");
const { createMemoryDraftAdapter } = await import("../src/modules/employees/services/employeeDrafts/draftDb.js");

const WH = { tenantId: 1, employeeId: 5, branchId: 2 };
const INV = { tenantId: 1, employeeId: 5, branchId: 2, sessionId: 9 };

const throwingAdapter = () => ({
  get: async () => { throw new Error("boom"); },
  set: async () => { throw new Error("boom"); },
  delete: async () => { throw new Error("boom"); },
  keys: async () => { throw new Error("boom"); },
  clear: async () => { throw new Error("boom"); },
  available: () => true,
});

test.beforeEach(() => { store.__setAdapterForTests(createMemoryDraftAdapter()); });
test.afterEach(async () => { await store.clearAllDrafts(); store.__resetAdapterForTests(); });

test("namespace requires tenant+employee+branch (else no-op)", () => {
  assert.equal(store.warehouseKey(WH), "wh:v1:t=1:e=5:b=2");
  assert.equal(store.warehouseKey({ tenantId: 1, employeeId: 5 }), "");
  assert.equal(store.inventoryKey(INV), "inv:v1:t=1:e=5:b=2:s=9");
  assert.equal(store.inventoryKey({ tenantId: 1, employeeId: 5, branchId: 2 }), "");
});

test("token is NOT part of the namespace — draft survives token rotation", () => {
  // Same identity, different portal tokens => identical key (token not an input).
  const k1 = store.warehouseKey({ ...WH, token: "tokenA" });
  const k2 = store.warehouseKey({ ...WH, token: "tokenB-rotated" });
  assert.equal(k1, k2);
  assert.equal(k1, "wh:v1:t=1:e=5:b=2");
});

test("warehouse draft round-trips and clears", async () => {
  assert.equal(await store.loadWarehouseDraft(WH), null);
  store.saveWarehouseDraft(WH, { items: [{ product_id: 10, variant_id: 100, color: "red", size: "42", requested_quantity: 3 }] });
  await store.flushPendingDraftWrites();
  const loaded = await store.loadWarehouseDraft(WH);
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].variant_id, 100);
  await store.clearWarehouseDraft(WH);
  assert.equal(await store.loadWarehouseDraft(WH), null);
});

test("inventory 100-row draft round-trips and stays bounded", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    product_id: i, variant_id: 1000 + i, color: "c", size: String(30 + (i % 15)),
    counted_quantity: i, local_updated_at: 1700000000000 + i,
  }));
  store.saveInventoryDraft(INV, { rows });
  await store.flushPendingDraftWrites();
  const loaded = await store.loadInventoryDraft(INV);
  assert.equal(loaded.rows.length, 100);
  assert.equal(loaded.rows[99].counted_quantity, 99);
  const bytes = JSON.stringify(loaded).length;
  assert.ok(bytes < 40 * 1024, `100-row draft should be small, got ${bytes} bytes`);
});

test("isolation: tenant / employee / branch / session never collide", async () => {
  store.saveInventoryDraft(INV, { rows: [{ variant_id: 1, counted_quantity: 7 }] });
  await store.flushPendingDraftWrites();
  assert.equal(await store.loadInventoryDraft({ ...INV, tenantId: 2 }), null); // other tenant
  assert.equal(await store.loadInventoryDraft({ ...INV, employeeId: 6 }), null); // other employee
  assert.equal(await store.loadInventoryDraft({ ...INV, branchId: 3 }), null); // other branch
  assert.equal(await store.loadInventoryDraft({ ...INV, sessionId: 10 }), null); // other session
  const mine = await store.loadInventoryDraft(INV);
  assert.equal(mine.rows[0].counted_quantity, 7);
});

test("expired drafts (older than TTL) are not returned and get swept", async () => {
  const adapter = createMemoryDraftAdapter();
  store.__setAdapterForTests(adapter);
  const key = store.inventoryKey(INV);
  const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
  await adapter.set(key, { schema: 1, kind: "inventory", updatedAt: old, draft: { rows: [] } });
  assert.equal(await store.loadInventoryDraft(INV), null); // read-through expiry
  await adapter.set(key, { schema: 1, kind: "inventory", updatedAt: old, draft: { rows: [] } });
  const removed = await store.sweepExpiredDrafts();
  assert.ok(removed >= 1);
  assert.equal((await adapter.keys()).length, 0);
});

test("schema mismatch invalidates the record", async () => {
  const adapter = createMemoryDraftAdapter();
  store.__setAdapterForTests(adapter);
  await adapter.set(store.warehouseKey(WH), { schema: 999, kind: "warehouse", updatedAt: Date.now(), draft: { items: [1] } });
  assert.equal(await store.loadWarehouseDraft(WH), null);
});

test("clearAllDrafts wipes every namespace (logout)", async () => {
  store.saveWarehouseDraft(WH, { items: [{ variant_id: 1 }] });
  store.saveInventoryDraft(INV, { rows: [{ variant_id: 2 }] });
  await store.flushPendingDraftWrites();
  await store.clearAllDrafts();
  assert.equal(await store.loadWarehouseDraft(WH), null);
  assert.equal(await store.loadInventoryDraft(INV), null);
});

test("fail-safe: read failure -> null, writes/clear never throw", async () => {
  store.__setAdapterForTests(throwingAdapter());
  assert.equal(await store.loadInventoryDraft(INV), null);
  assert.equal(await store.loadWarehouseDraft(WH), null);
  assert.doesNotThrow(() => store.saveInventoryDraft(INV, { rows: [] }));
  assert.doesNotThrow(() => store.saveWarehouseDraft(WH, { items: [] }));
  await assert.doesNotReject(store.flushPendingDraftWrites());
  await assert.doesNotReject(store.clearInventoryDraft(INV));
  await assert.doesNotReject(store.clearAllDrafts());
});

test("no-identity save is a no-op (never caches ambiguously)", async () => {
  const bad = { tenantId: 1, employeeId: 5 }; // no branch
  assert.equal(store.saveWarehouseDraft(bad, { items: [1] }), false);
  await store.flushPendingDraftWrites();
  assert.equal(await store.loadWarehouseDraft(bad), null);
});

test("reconcile: merge by variant, no duplicates, server baseline", () => {
  const server = [
    { variant_id: 1, counted_quantity: 5, updated_at: 100 },
    { variant_id: 2, counted_quantity: 3, updated_at: 100 },
  ];
  const local = [{ variant_id: 3, counted_quantity: 9, local_updated_at: 200 }];
  const merged = store.reconcileInventoryRows({ localRows: local, serverRows: server });
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((r) => r.variant_id).sort(), [1, 2, 3]);
});

test("reconcile: newer local edit is NOT overwritten by stale server row", () => {
  const server = [{ variant_id: 1, counted_quantity: 5, updated_at: 100 }];
  const local = [{ variant_id: 1, counted_quantity: 8, local_updated_at: 200 }]; // newer
  const merged = store.reconcileInventoryRows({ localRows: local, serverRows: server });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].counted_quantity, 8); // local newer wins
});

test("reconcile: stale local differing from newer server is flagged as conflict", () => {
  const server = [{ variant_id: 1, counted_quantity: 5, updated_at: 300 }]; // newer
  const local = [{ variant_id: 1, counted_quantity: 8, local_updated_at: 100 }]; // older, differs
  const merged = store.reconcileInventoryRows({ localRows: local, serverRows: server });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].counted_quantity, 5); // server retained
  assert.equal(merged[0]._conflict, true); // surfaced, not silently chosen
});
