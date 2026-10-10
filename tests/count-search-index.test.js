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

// ---- The filter: the owner's classification, and every factory of a colour ----
/*
 * What these guard: the chips are the classification the OWNER configured (the
 * rows' own words offered five spellings of the same thing and matched none),
 * a factory that sits only on a COLOUR is filterable (and a colour can be made
 * in two), a snapshot taken before the factory ids still filters by name, and a
 * picked chip with an empty search box IS the list.
 */

const FILTER_SNAPSHOT = {
  variants: [
    row({
      product_id: 40, product_variant_id: 400, product_name: "Vietnam Sneaker", color: "Red", size: "42",
      sku: "VS-42", barcode: "4001", article_code: "V-1", brand: "M1", type: "sneakers", style: "runner",
      gender: "men,women", grade: "mirror_original", category: "Uncategorized", stock: 4,
      // The factory lives on the COLOUR, and this colour is made in two.
      manufacturer_name: "", manufacturer_ids: ["8", "36"], product_updated_at: 400,
    }),
    row({
      product_id: 41, product_variant_id: 410, product_name: "Local Slipper", color: "Blue", size: "40",
      sku: "LS-40", barcode: "4101", article_code: "L-1", brand: "M1", type: "slippers", style: "slide",
      gender: "men", grade: "local", category: "Uncategorized", stock: 0,
      manufacturer_name: "Cavo", manufacturer_ids: ["8"], product_updated_at: 410,
    }),
    row({
      product_id: 42, product_variant_id: 420, product_name: "Old Shoe", color: "Grey", size: "41",
      sku: "OS-41", barcode: "4201", article_code: "O-1", brand: "M1", type: "sneakers", style: "runner",
      gender: "men", grade: "local", category: "Uncategorized", stock: 2,
      // A snapshot older than the ids: the legacy name is all it has.
      manufacturer_name: "Factory Z", product_updated_at: 420,
    }),
    row({
      product_id: 43, product_variant_id: 430, product_name: "Label Shoe", color: "Pink", size: "39",
      sku: "LB-39", barcode: "4301", article_code: "B-1", brand: "M1", type: "sneakers", style: "runner",
      // The product was filed under the owner's LABEL, not the value stored
      // behind it — the words on a product and the words in the filter are not
      // the same strings, which is the whole reason the mapping exists.
      gender: "حريمي", grade: "Mirror", category: "", stock: 1,
      manufacturer_name: "", manufacturer_ids: ["36"], product_updated_at: 430,
    }),
  ],
};

const label = (value) => value;
const DICTIONARIES = {
  manufacturers: [
    { id: "8", name: "Cavo" },
    { id: "36", name: label("مستورد فيتنامى") },
  ],
  classifications: [
    {
      key: "grade",
      options: [
        { value: "mirror_original", label_ar: label("مرايا"), label_en: "Mirror", sort_order: 1, is_active: true },
        { value: "local", label_ar: label("محلي"), label_en: "Local", sort_order: 2, is_active: true },
        { value: "second_copy", label_ar: label("نسخة"), label_en: "Copy", sort_order: 3, is_active: true },
      ],
    },
    {
      key: "gender",
      options: [
        { value: "men", label_ar: label("رجالي"), label_en: "Men", sort_order: 1, is_active: true },
        { value: "women", label_ar: label("حريمي"), label_en: "Women", sort_order: 2, is_active: true },
      ],
    },
  ],
};

const filterIndex = idx.getCountSearchIndex(FILTER_SNAPSHOT);
const browse = (filters, options = {}) =>
  idx.searchCountIndex(filterIndex, "", { filters, dictionaries: DICTIONARIES, ...options });
const browsed = (filters, options) => browse(filters, options).groups.map((group) => group.product_name);

test("the chips are the classification the owner configured, not the product's own words", () => {
  const facets = idx.countIndexFacets(filterIndex, DICTIONARIES);
  assert.deepEqual(
    facets.grade.map((option) => [option.id, option.name, option.count]),
    [["mirror_original", label("مرايا"), 2], ["local", label("محلي"), 2]],
    "the owner's labels, in the owner's order; an option nothing is filed under is not offered"
  );
  assert.deepEqual(facets.gender.map((option) => [option.id, option.count]), [["men", 3], ["women", 2]], "a capitalised Women is the same chip as women");
  // The raw data said "mirror_original" and "Uncategorized"; picking the
  // configured value is what finds the product.
  assert.deepEqual(browsed({ category: "mirror_original" }), ["Label Shoe", "Vietnam Sneaker"], "the one filed under the label belongs to the same chip");
  assert.deepEqual(browsed({ category: "local" }), ["Local Slipper", "Old Shoe"]);
  assert.deepEqual(browsed({ gender: "women" }), ["Label Shoe", "Vietnam Sneaker"], "a product made for both carries both");
});

test("a factory that sits only on the colour is filterable, including the second one", () => {
  const facets = idx.countIndexFacets(filterIndex, DICTIONARIES);
  const factories = new Map(facets.manufacturer.map((option) => [option.id, [option.name, option.count]]));
  assert.equal(facets.manufacturer.length, 3, "one chip per factory, named from the snapshot's dictionary");
  assert.deepEqual(factories.get("8"), ["Cavo", 2]);
  assert.deepEqual(factories.get("36"), [label("مستورد فيتنامى"), 2]);
  assert.deepEqual(factories.get("name:factory z"), ["Factory Z", 1], "folded key, so two spellings are one chip");
  assert.deepEqual(browsed({ manufacturer: "36" }), ["Label Shoe", "Vietnam Sneaker"], "the colour's SECOND factory matches");
  assert.deepEqual(browsed({ manufacturer: "8" }), ["Local Slipper", "Vietnam Sneaker"]);
  assert.deepEqual(browsed({ manufacturer: "name:Factory Z" }), ["Old Shoe"], "a pre-ids snapshot still filters by name, however it is spelled");
  assert.deepEqual(browsed({ manufacturer: "999" }), [], "a factory nothing is made in matches nothing");
});

test("a picked chip with an empty search box is the list", () => {
  const result = browse({ type: "sneakers" });
  assert.equal(result.browsing, true);
  assert.deepEqual(result.groups.map((group) => group.product_name), ["Label Shoe", "Old Shoe", "Vietnam Sneaker"]);
  assert.equal(result.total, 3);
  // Nothing picked lists nothing: the whole catalogue is not an answer.
  const idle = browse({});
  assert.deepEqual([idle.total, idle.browsing], [0, false]);
  // The cap still reports the real total, so "add every colour" works off it.
  const capped = browse({ brand: "M1" }, { limit: 1 });
  assert.deepEqual([capped.groups.length, capped.all.length, capped.total], [1, 4, 4]);
  // A size narrows the same way, and a zero-stock colour stays visible.
  assert.deepEqual(browsed({ brand: "M1" }, { size: "40" }), ["Local Slipper"]);
  assert.deepEqual(browsed({ brand: "M1", inStockOnly: true }), ["Label Shoe", "Old Shoe", "Vietnam Sneaker"]);
});

test("a typed name is filtered by the configured value too", () => {
  const hit = idx.searchCountIndex(filterIndex, "sneaker", { filters: { category: "local" }, dictionaries: DICTIONARIES });
  assert.deepEqual(hit.groups.map((group) => group.product_name), ["Old Shoe"], "the mirror sneaker is not filed under local");
  const found = idx.searchCountIndex(filterIndex, "sneaker", { filters: { category: "mirror_original" }, dictionaries: DICTIONARIES });
  assert.deepEqual(found.groups.map((group) => group.product_name), ["Vietnam Sneaker", "Label Shoe"], "a typed search ranks, a browse sorts by name");
  // An exact code still beats every chip.
  const scanned = idx.searchCountIndex(filterIndex, "4201", { filters: { manufacturer: "36" }, dictionaries: DICTIONARIES });
  assert.deepEqual([scanned.exact, scanned.groups.map((group) => group.product_name)], [true, ["Old Shoe"]]);
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

test("every match is reachable even when the visible list is capped", () => {
  const manyColours = idx.getCountSearchIndex({ variants: [0, 1, 2, 3, 4].map((n) => row({
    product_id: 7, product_variant_id: 700 + n, product_name: "Nike Air Force 1", color: `C${n}`,
    sku: `AF-${n}`, barcode: `70${n}`, article_code: `AF-${n}`, qr_token: "", product_code: "", product_sku: "",
  })) });
  const result = idx.searchCountIndex(manyColours, "air force", { limit: 2 });
  assert.equal(result.groups.length, 2, "the list stays capped");
  assert.equal(result.all.length, 5, "`all` holds the model's whole colour run — what 'add all colours' adds");
  assert.equal(result.total, 5);
  // An exact code answers with one colour, and `all` must agree with it.
  const exact = idx.searchCountIndex(manyColours, "703", { limit: 2 });
  assert.equal(exact.exact, true);
  assert.deepEqual(exact.all.map((group) => group.color), ["C3"]);
  assert.deepEqual(idx.searchCountIndex(manyColours, "").all, []);
});

test("adding a colour leaves the result list open; only a commit empties the box", () => {
  // The employee counts a model colour by colour: the list closing itself after
  // each add was the bug — they had to retype the model every time.
  assert.match(search, /const pick = useCallback\(async \(group, state, commit = false\)/);
  assert.match(search, /\{ scroll: commit \}\);\s*if \(commit\) setQuery\(""\);/, "the box empties only on a commit");
  assert.match(search, /closeResults/, "closing the list is the employee's own button");
  // …and the sheet must not scroll out from under the open list.
  assert.match(page, /const revealGroup = useCallback\(\(variantLike, \{ scroll = true \} = \{\}\)/);
  assert.match(page, /if \(scroll\) node\.scrollIntoView/);
  assert.match(page, /revealGroup\(added\[0\], \{ scroll \}\)/);
});

test("the size tiles are two to a row on every phone, not one", () => {
  // A flat 168px floor needed ~424px of viewport before a second tile fit, so
  // an ordinary 360-400px phone counted one size per screenful. The floor is
  // half the row, which fits two by construction at any width.
  assert.doesNotMatch(page, /minmax\(168px/, "a fixed floor is a width the phone has to be wide enough for");
  assert.match(page, /grid-template-columns: repeat\(auto-fill, minmax\(min\(50% - 4px, 150px\), 1fr\)\);/);
  // The stepper has to give width back as the tile narrows, or the quantity is
  // squeezed out of a 320px phone's tile.
  assert.doesNotMatch(page, /grid-cols-\[44px_minmax\(0,1fr\)_44px\]/, "fixed 44px buttons overflowed a half-width tile");
  assert.match(page, /\.inventory-step-row \{[\s\S]*?minmax\(0, 2\.75rem\) minmax\(2\.25rem, 1fr\) minmax\(0, 2\.75rem\)/);
  assert.match(page, /className="inventory-step-row mt-1\.5"/);
});

test("one tap adds a model's whole colour run, including colours below the cap", () => {
  assert.match(search, /const allMatches = local\.groups\.length \? local\.all : groups;/);
  assert.match(search, /for \(const group of model\.groups\)/, "add-all walks the model's full run");
  assert.match(search, /addAllColors/);
  assert.doesNotMatch(search, /for \(const group of model\.rows\)[\s\S]{0,200}onAdd/, "rows are the capped page, not the run");
});
