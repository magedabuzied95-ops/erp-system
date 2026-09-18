/*
 * The offline half of the Employee Portal stock count.
 *
 * What these guard: a counted quantity is never lost between the tap and the
 * server, a flush never clears something the employee re-counted while it was
 * in flight, putting a colour on the sheet is not recorded as counting it, and
 * a barcode still resolves with no signal.
 */
import test from "node:test";
import assert from "node:assert/strict";

const sync = await import("../src/modules/employees/services/employeeDrafts/inventoryCountSync.js");
const store = await import("../src/modules/employees/services/employeeDrafts/employeeDraftStore.js");
const { createMemoryDraftAdapter } = await import("../src/modules/employees/services/employeeDrafts/draftDb.js");

const IDENTITY = { tenantId: 1, employeeId: 5, branchId: 2 };

test("the outbox keeps the latest quantity per size, not a log of taps", () => {
  let outbox = {};
  for (const quantity of [1, 2, 3, 2]) {
    outbox = sync.queueCountedQuantity(outbox, { variantId: 77, countedQuantity: quantity, systemQuantity: 9 });
  }
  assert.equal(sync.outboxSize(outbox), 1);
  const items = sync.outboxToItems(outbox);
  assert.equal(items.length, 1, "forty taps still cost one row on the wire");
  assert.equal(items[0].countedQuantity, 2);
  assert.equal(items[0].productVariantId, 77);
});

test("the moment the employee counted travels with the quantity", () => {
  const countedAt = "2026-09-18T07:15:00.000Z";
  const outbox = sync.queueCountedQuantity({}, { variantId: 5, countedQuantity: 4, systemQuantity: 4, countedAt });
  assert.equal(sync.outboxToItems(outbox)[0].countedAt, countedAt);
});

test("putting a colour on the sheet is not counting it", () => {
  const outbox = sync.queueCountedQuantity({}, { variantId: 8, countedQuantity: 0, systemQuantity: 3, counted: false });
  const [item] = sync.outboxToItems(outbox);
  assert.equal(item.counted, false);
  assert.equal(item.countedAt, null, "no counted-at means the server records no counter");
});

test("a flush clears only what it sent, and never a quantity counted mid-flight", () => {
  const sent = sync.queueCountedQuantity({}, { variantId: 1, countedQuantity: 2, systemQuantity: 2, countedAt: "t1" });
  const alsoSent = sync.queueCountedQuantity(sent, { variantId: 2, countedQuantity: 5, systemQuantity: 5, countedAt: "t1" });

  // While that request was in flight the employee counted variant 1 again.
  const recounted = sync.queueCountedQuantity(alsoSent, { variantId: 1, countedQuantity: 9, systemQuantity: 2, countedAt: "t2" });

  const settled = sync.settleOutbox(recounted, alsoSent);
  assert.deepEqual(Object.keys(settled), ["1"], "the re-count survives the flush");
  assert.equal(settled["1"].countedQuantity, 9);
});

test("a request that never reached a server is offline; a server refusal is not", () => {
  assert.equal(sync.isOfflineFailure(Object.assign(new Error("boom"), { status: 409 })), false);
  assert.equal(sync.isOfflineFailure(new Error("NetworkError when attempting to fetch")), true);
  assert.equal(sync.isOfflineFailure(null), false);
});

// ---- Offline catalogue ------------------------------------------------------

const CATALOG = [
  { product_id: 10, product_variant_id: 100, product_name: "كروكس كلاسيك", color: "أسود", size: "41", barcode: "111", article_code: "A-1" },
  { product_id: 10, product_variant_id: 101, product_name: "كروكس كلاسيك", color: "أسود", size: "42", barcode: "112", article_code: "A-1" },
  { product_id: 10, product_variant_id: 102, product_name: "كروكس كلاسيك", color: "أبيض", size: "41", barcode: "113", article_code: "A-2" },
  { product_id: 20, product_variant_id: 200, product_name: "نايك اير", color: "أزرق", size: "43", barcode: "999", article_code: "B-9" },
].map(sync.toCatalogRow);

test("a scanned barcode resolves offline and brings back the whole colour", () => {
  const results = sync.searchCatalogRows(CATALOG, "112");
  assert.deepEqual(
    results.map((row) => row.product_variant_id).sort(),
    [100, 101],
    "the count is taken per colour, so every size of it must come back"
  );
});

test("an offline search matches names as well as codes", () => {
  assert.equal(sync.searchCatalogRows(CATALOG, "نايك").length, 1);
  assert.equal(sync.searchCatalogRows(CATALOG, "كروكس").length, 3);
  assert.equal(sync.searchCatalogRows(CATALOG, "").length, 0);
  assert.equal(sync.searchCatalogRows(CATALOG, "لا يوجد").length, 0);
});

test("an empty or aged catalogue is refreshed; a fresh one is not", () => {
  const now = Date.now();
  assert.equal(sync.catalogIsStale(null, now), true);
  assert.equal(sync.catalogIsStale({ variants: [] }, now), true);
  assert.equal(sync.catalogIsStale({ variants: CATALOG, savedAt: now - 60_000 }, now), false);
  assert.equal(sync.catalogIsStale({ variants: CATALOG, savedAt: now - sync.CATALOG_REFRESH_MS - 1 }, now), true);
});

// ---- Persistence ------------------------------------------------------------

test.beforeEach(() => { store.__setAdapterForTests(createMemoryDraftAdapter()); });
test.afterEach(async () => { await store.clearAllDrafts(); store.__resetAdapterForTests(); });

test("the outbox survives a reload: it is persisted with the count draft", async () => {
  const identity = { ...IDENTITY, sessionId: 31 };
  const outbox = sync.queueCountedQuantity({}, { variantId: 100, countedQuantity: 7, systemQuantity: 5, countedAt: "t1" });
  store.saveInventoryDraft(identity, { rows: [{ product_variant_id: 100, counted_quantity: 7 }], outbox, savedAt: Date.now() });
  await store.flushPendingDraftWrites();

  const restored = await store.loadInventoryDraft(identity);
  assert.equal(sync.outboxSize(restored.outbox), 1);
  assert.equal(restored.outbox["100"].countedQuantity, 7);
});

test("the offline catalogue is cached per employee, not per session", async () => {
  assert.equal(store.inventoryCatalogKey(IDENTITY), "invcat:v1:t=1:e=5:b=2");
  assert.equal(store.inventoryCatalogKey({ tenantId: 1, employeeId: 5 }), "", "no identity, no cache");

  store.saveInventoryCatalog(IDENTITY, { variants: CATALOG, savedAt: Date.now() });
  await store.flushPendingDraftWrites();
  const cached = await store.loadInventoryCatalog(IDENTITY);
  assert.equal(cached.variants.length, CATALOG.length);

  // A different employee on the same device never reads it.
  assert.equal(await store.loadInventoryCatalog({ ...IDENTITY, employeeId: 6 }), null);
});
