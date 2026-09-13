import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The comparison list lives in localStorage; give the module a window to find it.
const memory = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
  addEventListener: () => {},
};

const store = await import("../src/storefront/lib/compareStore.js");
const {
  COMPARE_MAX_ITEMS,
  COMPARE_STORAGE_KEY,
  __resetCompareStoreForTests,
  clearCompareItems,
  comparePagePath,
  compareFamilyOf,
  getCompareItems,
  parseCompareQuery,
  serializeCompareQuery,
  toggleCompareItem,
  updateCompareItem,
} = store;

const sneaker = (id, extra = {}) => ({ id: String(id), slug: `model-${id}`, name: `Model ${id}`, productType: "sneakers", ...extra });

beforeEach(() => {
  clearCompareItems();
  memory.clear();
  __resetCompareStoreForTests();
});

test("a listing card's product:colour id collapses to the model, so one model is one column", () => {
  assert.deepEqual(toggleCompareItem(sneaker("785:6d7c-navy", { colorKey: "navy" })), { ok: true, action: "added" });
  // another colour card of the same model toggles the same entry off
  assert.deepEqual(toggleCompareItem(sneaker("785:53a7-black", { colorKey: "black" })), { ok: true, action: "removed" });
  assert.equal(getCompareItems().length, 0);
});

test("the list stops at three and says so instead of dropping the oldest", () => {
  for (let index = 1; index <= COMPARE_MAX_ITEMS; index += 1) assert.equal(toggleCompareItem(sneaker(index)).ok, true);
  assert.deepEqual(toggleCompareItem(sneaker(99)), { ok: false, reason: "full" });
  assert.deepEqual(getCompareItems().map((item) => item.id), ["1", "2", "3"]);
});

test("a bag cannot join a list of shoes", () => {
  toggleCompareItem(sneaker(1));
  assert.deepEqual(toggleCompareItem({ id: "7", slug: "bag", productType: "bags" }), { ok: false, reason: "family" });
  assert.equal(compareFamilyOf("school_bags"), "bags");
  assert.equal(compareFamilyOf("\u0634\u0646\u0637"), "bags");
  assert.equal(compareFamilyOf("slippers"), "footwear");
});

test("the list survives a reload through localStorage and ignores junk", () => {
  toggleCompareItem(sneaker(1, { colorKey: "Navy" }));
  __resetCompareStoreForTests();
  assert.equal(getCompareItems()[0].colorKey, "navy");
  memory.set(COMPARE_STORAGE_KEY, "{not json");
  __resetCompareStoreForTests();
  assert.deepEqual(getCompareItems(), []);
});

test("a shared link round-trips slugs and colours, capped at three", () => {
  toggleCompareItem(sneaker(1, { colorKey: "navy" }));
  toggleCompareItem(sneaker(2));
  const query = serializeCompareQuery(getCompareItems());
  assert.equal(query, "model-1~navy,model-2");
  assert.equal(comparePagePath(getCompareItems()), `/compare?items=${encodeURIComponent(query)}`);
  assert.deepEqual(parseCompareQuery("a~x, b ,c~Y,d"), [
    { slug: "a", colorKey: "x" },
    { slug: "b", colorKey: "" },
    { slug: "c", colorKey: "y" },
  ]);
  assert.equal(comparePagePath([]), "/compare");
});

test("a slug-only entry from a link learns its real id without duplicating", () => {
  toggleCompareItem({ id: "model-1", slug: "model-1" });
  toggleCompareItem(sneaker(2));
  updateCompareItem("model-1", { id: "1", name: "Model 1" });
  assert.deepEqual(getCompareItems().map((item) => [item.id, item.slug]), [["1", "model-1"], ["2", "model-2"]]);
});

test("/compare is a storefront route on the SPA and in App.jsx", async () => {
  const { isStorefrontPath, ROOT_PATHS } = await import("../src/storefront/lib/paths.js");
  assert.equal(ROOT_PATHS.compare, "/compare");
  assert.equal(isStorefrontPath("/compare"), true);
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /<Route path="\/compare" element=\{<Suspense fallback=\{<RouteSkeleton \/>\}><Storefront \/><\/Suspense>\} \/>/);
});

test("every compare key exists in both languages", () => {
  const read = (lang) => JSON.parse(readFileSync(new URL(`../src/locales/${lang}/storefront.json`, import.meta.url), "utf8")).compare;
  const flatten = (object, prefix = "") => Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
  const ar = flatten(read("ar")).sort();
  const en = flatten(read("en")).sort();
  assert.deepEqual(ar, en);
  const sources = ["src/storefront/pages/StorefrontComparePage.jsx", "src/storefront/components/StorefrontCompare.jsx"]
    .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");
  const used = [...sources.matchAll(/storefront\.compare\.([a-zA-Z.]+)/g)].map((match) => match[1]);
  for (const key of new Set(used)) assert.ok(ar.includes(key), `missing storefront.compare.${key}`);
});
