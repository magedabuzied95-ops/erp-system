/*
 * The Employee Portal's on-phone product catalogue.
 *
 * What these guard: the phone's answer to a product search matches what the
 * server's compact query would return (same fields, filters, stock rule, order),
 * a weak line is never made to download a catalogue that has not changed, a
 * failed refresh never costs the cache it already had, and the portal token —
 * the credential — is never written to storage.
 */
import test from "node:test";
import assert from "node:assert/strict";

// A minimal localStorage the identity hint can use under node.
const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
  },
});

const cache = await import("../src/modules/employees/services/employeeDrafts/portalCatalogCache.js");
const store = await import("../src/modules/employees/services/employeeDrafts/employeeDraftStore.js");
const { createMemoryDraftAdapter } = await import("../src/modules/employees/services/employeeDrafts/draftDb.js");

const TOKEN = "9b61fef8ca2e357cffa053d97b2641dc9c6b904144f584353b799ae4a4e5ad91";
const IDENTITY = { tenant_id: 1, employee_id: 30, branch_id: 5 };

const row = (overrides) => cache.toPortalCatalogRow({
  product_id: 10, product_variant_id: 100, product_name: "كروكس كلاسيك", color: "أسود", size: "41",
  sku: "CR-41", barcode: "111", article_code: "A-1", product_sku: "CR", product_barcode: "", stock: 3,
  gender: "men", type: "crocs", category: "original", grade: "original", product_category: "shoes",
  brand: "Crocs", manufacturer_name: "Factory A", qr_token: "qr-10", product_code: "PC-10", style: "clog",
  image_url: "/uploads/black.jpg", product_image_url: "/uploads/crocs.jpg", product_updated_at: 100,
  ...overrides,
});

const SNAPSHOT = {
  version: "v1",
  savedAt: Date.now(),
  variants: [
    row({}),
    row({ product_variant_id: 101, size: "42", sku: "CR-42", barcode: "112", stock: 0 }),
    row({ product_variant_id: 102, color: "أبيض", sku: "CR-W41", barcode: "113", article_code: "A-2", image_url: "/uploads/white.jpg", stock: 2 }),
    row({ product_id: 20, product_variant_id: 200, product_name: "Nike Air", color: "Blue", size: "43", sku: "NK-43", barcode: "999",
      article_code: "B-9", brand: "Nike", type: "sneakers", gender: "women", grade: "mirror", category: "mirror", manufacturer_name: "Factory B",
      qr_token: "qr-20", product_code: "PC-20", style: "runner", product_image_url: "/uploads/nike.jpg", image_url: "", stock: 5, product_updated_at: 200 }),
    // Entirely out of stock: findable only when the in-stock rule is off.
    row({ product_id: 30, product_variant_id: 300, product_name: "Adidas Samba", color: "Green", size: "40", sku: "AD-40", barcode: "555",
      article_code: "C-3", brand: "Adidas", stock: 0, product_updated_at: 300, qr_token: "qr-30", product_code: "PC-30" }),
  ],
};

test.beforeEach(() => { store.__setAdapterForTests(createMemoryDraftAdapter()); storage.clear(); });
test.afterEach(async () => { await store.clearAllDrafts(); store.__resetAdapterForTests(); });

// ---- Search parity ------------------------------------------------------------

test("an empty query lists in-stock products, most recently touched first", () => {
  const { products, has_more, total } = cache.searchPortalProducts(SNAPSHOT, {});
  assert.deepEqual(products.map((product) => product.name), ["Nike Air", "كروكس كلاسيك"], "Samba has no stock, so it is not listed");
  assert.equal(has_more, false);
  assert.equal(total, 2);
});

test("a listed product carries only the variants that can actually be picked", () => {
  const crocs = cache.searchPortalProducts(SNAPSHOT, { q: "كروكس" }).products[0];
  assert.deepEqual(crocs.variants.map((variant) => variant.variant_id), [100, 102], "the zero-stock 42 is dropped, like the server does");
  assert.equal(crocs.total_stock, 5);
  assert.deepEqual(crocs.colors, ["أسود", "أبيض"]);
  assert.equal(crocs.product_image_url, "/uploads/crocs.jpg");
});

test("the query searches the same fields the server does, on the product and on its sizes", () => {
  const names = (q, extra = {}) => cache.searchPortalProducts(SNAPSHOT, { q, ...extra }).products.map((product) => product.name);
  assert.deepEqual(names("nike"), ["Nike Air"], "name, case-insensitive");
  assert.deepEqual(names("qr-10"), ["كروكس كلاسيك"], "qr token");
  assert.deepEqual(names("PC-20"), ["Nike Air"], "product code");
  assert.deepEqual(names("113"), ["كروكس كلاسيك"], "a size row's barcode");
  assert.deepEqual(names("A-2"), ["كروكس كلاسيك"], "a size row's article code");
  assert.deepEqual(names("أبيض"), ["كروكس كلاسيك"], "a colour");
  assert.deepEqual(names("crocs"), ["كروكس كلاسيك"], "brand / type");
  assert.deepEqual(names("zzz"), []);
});

test("filters narrow exactly like the server's conditions", () => {
  const names = (filters, size = "all") => cache.searchPortalProducts(SNAPSHOT, { filters, size }).products.map((product) => product.name);
  assert.deepEqual(names({ brand: "nike" }), ["Nike Air"]);
  assert.deepEqual(names({ gender: "men" }), ["كروكس كلاسيك"]);
  assert.deepEqual(names({ type: "runner" }), ["Nike Air"], "type also matches the style column");
  assert.deepEqual(names({ category: "mirror" }), ["Nike Air"], "the grade chip travels as category");
  assert.deepEqual(names({ manufacturer: "Factory A" }), ["كروكس كلاسيك"]);
  assert.deepEqual(names({ brand: "all", gender: "all" }), ["Nike Air", "كروكس كلاسيك"], "`all` is no filter");
  assert.deepEqual(names({}, "41"), ["كروكس كلاسيك"]);
  assert.deepEqual(names({}, "42"), [], "a size with no stock does not match the size filter");
});

test("turning the in-stock rule off brings back sold-out products", () => {
  const { products } = cache.searchPortalProducts(SNAPSHOT, { q: "samba", inStockOnly: false });
  assert.equal(products.length, 1);
  assert.equal(products[0].variants.length, 1);
});

test("the phone pages its own answer", () => {
  const first = cache.searchPortalProducts(SNAPSHOT, { limit: 1, page: 1 });
  assert.deepEqual(first.products.map((product) => product.name), ["Nike Air"]);
  assert.equal(first.has_more, true);
  const second = cache.searchPortalProducts(SNAPSHOT, { limit: 1, page: 2 });
  assert.deepEqual(second.products.map((product) => product.name), ["كروكس كلاسيك"]);
  assert.equal(second.has_more, false);
});

// ---- Refresh politeness ---------------------------------------------------------

const snapshotResponse = (version) => ({ version, identity: IDENTITY, generated_at: "now", variants: SNAPSHOT.variants });

const countingApi = ({ version = "v1", failSnapshot = false, failVersion = false } = {}) => {
  const calls = { version: 0, snapshot: 0 };
  return {
    calls,
    getVersion: async () => { calls.version += 1; if (failVersion) throw new Error("timed out"); return { version, identity: IDENTITY }; },
    getSnapshot: async () => { calls.snapshot += 1; if (failSnapshot) throw new Error("network"); return snapshotResponse(version); },
  };
};

test("a first open downloads the catalogue, and a cold reopen finds it with no network", async () => {
  const api = countingApi();
  const first = await cache.refreshPortalCatalog({ token: TOKEN, api });
  assert.equal(first.refreshed, true);
  assert.equal(api.calls.snapshot, 1);
  await store.flushPendingDraftWrites();

  // No identity passed and no server: the token digest alone finds the cache.
  const cold = await cache.readPortalCatalog({ token: TOKEN });
  assert.equal(cold.variants.length, SNAPSHOT.variants.length);
  assert.equal(cold.version, "v1");
});

test("a fresh cache asks the server nothing at all", async () => {
  const api = countingApi();
  await cache.refreshPortalCatalog({ token: TOKEN, api });
  await store.flushPendingDraftWrites();
  const again = await cache.refreshPortalCatalog({ token: TOKEN, api });
  assert.equal(again.refreshed, false);
  assert.deepEqual(api.calls, { version: 1, snapshot: 1 }, "inside the recheck window: not even the version ask");
});

test("an unchanged catalogue costs a few bytes, never a second download", async () => {
  const api = countingApi();
  const t0 = Date.now();
  await cache.refreshPortalCatalog({ token: TOKEN, api, now: t0 });
  await store.flushPendingDraftWrites();
  const later = await cache.refreshPortalCatalog({ token: TOKEN, api, now: t0 + cache.CATALOG_RECHECK_MS + 1 });
  assert.equal(later.refreshed, false);
  assert.deepEqual(api.calls, { version: 2, snapshot: 1 });
});

test("a changed catalogue is downloaded again", async () => {
  const t0 = Date.now();
  await cache.refreshPortalCatalog({ token: TOKEN, api: countingApi({ version: "v1" }), now: t0 });
  await store.flushPendingDraftWrites();
  const api = countingApi({ version: "v2" });
  const later = await cache.refreshPortalCatalog({ token: TOKEN, api, now: t0 + cache.CATALOG_RECHECK_MS + 1 });
  assert.equal(later.refreshed, true);
  assert.equal(later.snapshot.version, "v2");
});

test("a refresh that fails keeps the catalogue the phone already had", async () => {
  const t0 = Date.now();
  await cache.refreshPortalCatalog({ token: TOKEN, api: countingApi(), now: t0 });
  await store.flushPendingDraftWrites();
  const broken = countingApi({ version: "v2", failSnapshot: true });
  const result = await cache.refreshPortalCatalog({ token: TOKEN, api: broken, now: t0 + cache.CATALOG_RECHECK_MS + 1 });
  assert.equal(result.refreshed, false);
  assert.equal(result.snapshot.version, "v1", "never trade a working cache for a failed download");
});

test("two screens opening together share one download", async () => {
  const api = countingApi();
  const [a, b] = await Promise.all([
    cache.refreshPortalCatalog({ token: TOKEN, api }),
    cache.refreshPortalCatalog({ token: TOKEN, api }),
  ]);
  assert.equal(api.calls.snapshot, 1);
  assert.equal(a.snapshot.version, b.snapshot.version);
});

// ---- The credential stays out of storage ---------------------------------------

test("the portal token is never written to storage, in any form that contains it", async () => {
  await cache.refreshPortalCatalog({ token: TOKEN, api: countingApi() });
  await store.flushPendingDraftWrites();
  assert.ok(storage.size >= 1, "the identity hint was written");
  for (const [key, value] of storage) {
    assert.equal(key.includes(TOKEN), false, "token in a storage key");
    assert.equal(String(value).includes(TOKEN), false, "token in a storage value");
  }
  assert.equal(store.inventoryCatalogKey({ tenantId: 1, employeeId: 30, branchId: 5 }).includes(TOKEN), false);
});

// ---- Pictures --------------------------------------------------------------------

test("every distinct picture is listed once, through the URL resolver", () => {
  const urls = cache.extractCatalogImageUrls(SNAPSHOT, (url) => (url ? `https://api.example${url}` : ""));
  assert.deepEqual(urls.sort(), [
    "https://api.example/uploads/black.jpg",
    "https://api.example/uploads/crocs.jpg",
    "https://api.example/uploads/nike.jpg",
    "https://api.example/uploads/white.jpg",
  ]);
});

test("pictures are not pulled over the very line this exists for", () => {
  assert.equal(cache.connectionAllowsImageWarm({ effectiveType: "4g", saveData: false }), true);
  assert.equal(cache.connectionAllowsImageWarm({ effectiveType: "2g", saveData: false }), false);
  assert.equal(cache.connectionAllowsImageWarm({ effectiveType: "slow-2g" }), false);
  assert.equal(cache.connectionAllowsImageWarm({ effectiveType: "4g", saveData: true }), false, "data saver is a no");
  assert.equal(cache.connectionAllowsImageWarm(null), true, "no Network Information API: assume fine");
});
