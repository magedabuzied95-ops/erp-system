/*
 * The stock count's product search index.
 *
 * What these guard: a search finds what a person means (Arabic letter variants,
 * Arabic-Indic digits, several words), a code read off the box beats everything
 * and is never hidden by a forgotten filter, the unit of a result is the colour
 * with its whole size run, and the index is built once per snapshot — the whole
 * reason typing no longer stutters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const idx = await import("../src/modules/employees/services/employeeDrafts/countSearchIndex.js");

const row = (overrides) => ({
  product_id: 10, product_variant_id: 100, product_name: "كروكس كلاسيك أسود", color: "أسود", size: "41",
  sku: "CR-41", barcode: "111", article_code: "A-1", product_sku: "CR", product_barcode: "", qr_token: "qr-10", product_code: "PC-10",
  stock: 3, gender: "men", type: "crocs", style: "clog", category: "original", grade: "original", brand: "Crocs",
  manufacturer_name: "Factory A", image_url: "/u/black.jpg", product_image_url: "/u/crocs.jpg", product_updated_at: 100,
  ...overrides,
});

const SNAPSHOT = {
  variants: [
    row({}),
    row({ product_variant_id: 101, size: "42", sku: "CR-42", barcode: "112", stock: 0 }),
    row({ product_variant_id: 102, color: "أبيض", size: "41", sku: "CR-W41", barcode: "113", article_code: "A-2", image_url: "/u/white.jpg" }),
    row({ product_id: 20, product_variant_id: 200, product_name: "Nike Air Max", color: "Blue", size: "43", sku: "NK-43", barcode: "999",
      article_code: "B-9", brand: "Nike", type: "sneakers", style: "runner", gender: "women", grade: "mirror", category: "mirror",
      manufacturer_name: "Factory B", qr_token: "qr-20", product_code: "PC-20", stock: 5, product_updated_at: 200 }),
    row({ product_id: 30, product_variant_id: 300, product_name: "Adidas Samba", color: "Green", size: "40", sku: "AD-40", barcode: "555",
      article_code: "C-3", brand: "Adidas", type: "sneakers", stock: 0, product_updated_at: 300, qr_token: "qr-30", product_code: "PC-30" }),
  ],
};

const index = idx.getCountSearchIndex(SNAPSHOT);
const names = (query, options) => idx.searchCountIndex(index, query, options).groups.map((group) => `${group.product_name} / ${group.color}`);

test("the unit of a result is a colour with its whole size run", () => {
  assert.equal(index.length, 4, "كروكس has two colours; each is its own group");
  const black = index.find((group) => group.color === "أسود");
  assert.deepEqual(black.sizes, ["41", "42"]);
  assert.deepEqual(black.variantIds, ["100", "101"], "the zero-stock 42 is part of the colour: a count must see it");
  assert.equal(black.stock, 3);
});

test("the index is built once per snapshot", () => {
  assert.equal(idx.getCountSearchIndex(SNAPSHOT), index, "same snapshot object, same index — no rebuild per keystroke");
  assert.deepEqual(idx.getCountSearchIndex(null), []);
  assert.deepEqual(idx.getCountSearchIndex({ variants: [] }), []);
});

test("Arabic is matched the way people type it", () => {
  assert.equal(idx.foldSearchText("أَسْوَد"), "اسود");
  assert.deepEqual(names("ابيض"), ["كروكس كلاسيك أسود / أبيض"], "ا finds أ");
  assert.deepEqual(names("٩٩٩"), ["Nike Air Max / Blue"], "Arabic-Indic digits find a Latin barcode");
  assert.deepEqual(names("NIKE"), ["Nike Air Max / Blue"], "case");
});

test("every word must match, so more words narrow the list", () => {
  assert.equal(names("كروكس").length, 2);
  assert.deepEqual(names("كروكس ابيض"), ["كروكس كلاسيك أسود / أبيض"]);
  assert.deepEqual(names("nike crocs"), []);
});

test("a code read off the box wins outright, and no filter can hide it", () => {
  const hit = idx.searchCountIndex(index, "113", { filters: { brand: "Nike", gender: "women" }, size: "45" });
  assert.equal(hit.exact, true);
  assert.deepEqual(hit.groups.map((group) => group.color), ["أبيض"]);
});

test("a zero-stock colour is findable: that is what a count is for", () => {
  assert.deepEqual(names("samba"), ["Adidas Samba / Green"]);
});

test("names that START with the query rank above names that merely contain it", () => {
  const ranked = idx.getCountSearchIndex({ variants: [
    row({ product_id: 1, product_variant_id: 1, product_name: "Super Air Runner", color: "A", barcode: "", sku: "", article_code: "", qr_token: "", product_code: "", product_sku: "" }),
    row({ product_id: 2, product_variant_id: 2, product_name: "Air Force", color: "B", barcode: "", sku: "", article_code: "", qr_token: "", product_code: "", product_sku: "" }),
  ] });
  assert.deepEqual(idx.searchCountIndex(ranked, "air").groups.map((group) => group.product_name), ["Air Force", "Super Air Runner"]);
});

test("filters narrow a text search", () => {
  assert.deepEqual(names("s", { filters: { brand: "Adidas" } }), ["Adidas Samba / Green"]);
  assert.deepEqual(names("كروكس", { size: "42" }), ["كروكس كلاسيك أسود / أسود"]);
  assert.deepEqual(names("كروكس", { filters: { type: "clog" } }).length, 2, "type also matches style");
  assert.deepEqual(names("كروكس", { filters: { gender: "all", brand: "all" } }).length, 2, "`all` is no filter");
});

test("the list is capped but says how many matched", () => {
  const result = idx.searchCountIndex(index, "a", { limit: 1 });
  assert.equal(result.groups.length, 1);
  assert.ok(result.total > 1);
});

test("a scan resolves to the colour that owns the code, not the first colour of the product", () => {
  assert.equal(idx.findCountGroupByCode(index, "113").color, "أبيض");
  assert.equal(idx.findCountGroupByCode(index, "A-1").color, "أسود");
  assert.equal(idx.findCountGroupByCode(index, "PC-20").product_name, "Nike Air Max", "a product-level code still resolves");
  assert.equal(idx.findCountGroupByCode(index, "nope"), null);
});

test("filter options come with real counts", () => {
  const facets = idx.countIndexFacets(index);
  assert.deepEqual(facets.brand.map((option) => [option.name, option.count]), [["Adidas", 1], ["Crocs", 2], ["Nike", 1]]);
  assert.deepEqual(facets.size.map((option) => option.name), ["40", "41", "42", "43"], "sizes sort numerically");
});

test("the match is highlighted where the employee's letters landed", () => {
  assert.deepEqual(idx.highlightParts("كروكس كلاسيك أسود", "اسود"), ["كروكس كلاسيك ", "أسود", ""]);
  assert.deepEqual(idx.highlightParts("Nike Air Max", "air"), ["Nike ", "Air", " Max"]);
  assert.deepEqual(idx.highlightParts("Nike", "zzz"), ["Nike", "", ""]);
});

// ---- Wiring guards --------------------------------------------------------------

const page = readFileSync(new URL("../src/modules/employees/pages/EmployeePortalInventory.jsx", import.meta.url), "utf8");
const search = readFileSync(new URL("../src/modules/employees/components/CountProductSearch.jsx", import.meta.url), "utf8");

test("the search text lives in the search box, not in the count screen", () => {
  assert.doesNotMatch(page, /useState\(\s*""\s*\);?\s*\/\/ lookupQuery|setLookupQuery/, "lifting the query re-rendered every stepper per letter");
  assert.match(search, /const \[query, setQuery\] = useState\(""\)/);
  assert.match(search, /useDeferredValue\(query\)/);
});

test("a colour from the phone's index goes on the sheet with no round trip", () => {
  assert.match(page, /if \(online && group\.complete !== true\)/);
});

test("a session link opened cold loads its session", () => {
  assert.match(page, /const \[selectedSessionId, setSelectedSessionId\] = useState\(""\);/);
  assert.doesNotMatch(page, /useState\(routeSessionId \|\| ""\)/);
});
