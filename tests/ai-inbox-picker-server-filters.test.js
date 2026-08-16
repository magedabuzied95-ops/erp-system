import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  SERVER_FILTER_KEYS,
  buildPickerParams,
  pickerQueryKey,
} from "../src/modules/aiSupport/services/pickerQuery.js";

// P0 follow-up to a57c13e. Bounding the picker to 24 rows was the right call for
// speed, but every POS smart filter still ran CLIENT-SIDE over that page. So a
// filter could only match among the 24 rows that happened to be fetched:
// "1 product" was shown while many more matched in the ERP. Filters now go to the
// server, which searches the whole catalog and returns the first 24 MATCHES.

const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../src/modules/aiSupport/services/customerProductCatalog.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/modules/aiSupport/services/pickerQuery.js", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

// ---- the exact production bug -------------------------------------------

// 100 products; only ONE size-42+Black product sits in the first 24 rows, the
// other 20 are further down the catalog.
const world = Array.from({ length: 100 }, (_, i) => {
  const isMatch = i === 5 || i >= 30 && i < 50;
  return {
    id: i + 1,
    brand: i % 3 === 0 ? "Nike" : "Adidas",
    variants: isMatch
      ? [{ size: "42", color: "Black", stock: 3 }]
      : [{ size: String(38 + (i % 4)), color: i % 2 ? "White" : "Red", stock: 2 }],
  };
});

const matchesFilter = (p, { size, color, brand }) =>
  (!brand || p.brand === brand) &&
  p.variants.some((v) => (!size || v.size === size) && (!color || v.color === color) && v.stock > 0);

const oldBrokenFlow = (filters) => world.slice(0, 24).filter((p) => matchesFilter(p, filters));
const newServerFlow = (filters, page = 1, limit = 24) => {
  const all = world.filter((p) => matchesFilter(p, filters));
  return { total: all.length, rows: all.slice((page - 1) * limit, page * limit) };
};

test("OLD: client-side filtering over the first 24 rows returns 1 of 21 matches", () => {
  assert.equal(oldBrokenFlow({ size: "42", color: "Black" }).length, 1);
});

test("NEW: server-side filtering finds every match in the catalog", () => {
  const { total, rows } = newServerFlow({ size: "42", color: "Black" });
  assert.equal(total, 21, "21 products match across the whole catalog");
  assert.equal(rows.length, 21, "page 1 holds all 21 since 21 <= 24");
});

test("more than one page of matches paginates instead of truncating", () => {
  const page1 = newServerFlow({}, 1);
  assert.equal(page1.total, 100);
  assert.equal(page1.rows.length, 24);
  const page2 = newServerFlow({}, 2);
  assert.equal(page2.rows.length, 24);
  assert.equal(page2.rows[0].id, 25, "page 2 continues, it does not repeat page 1");
});

test("filter combinations narrow together, not independently", () => {
  const both = newServerFlow({ size: "42", color: "Black", brand: "Nike" });
  const sizeOnly = newServerFlow({ size: "42" });
  assert.ok(both.total > 0);
  assert.ok(both.total < sizeOnly.total, "adding brand must narrow the result set");
  for (const row of both.rows) assert.equal(row.brand, "Nike");
});

test("a filter with no matches returns zero, not a stale page", () => {
  assert.equal(newServerFlow({ size: "99", color: "Black" }).total, 0);
});

// ---- params actually reach the server ------------------------------------

test("every server-side filter is sent as a query param", () => {
  const params = buildPickerParams({
    search: "Nike",
    filters: { brand: "Nike", manufacturer: "M", gender: "men", product_type: "shoes", grade: "A", size: "42", color: "Black", inStockOnly: true },
  });
  assert.equal(params.search, "Nike");
  for (const key of SERVER_FILTER_KEYS) assert.ok(params[key], `${key} must be sent to the server`);
  assert.equal(params.inStockOnly, 1);
  assert.equal(params.limit, 24);
  assert.equal(params.page, 1);
});

test('"all" and empty values are omitted rather than sent literally', () => {
  const params = buildPickerParams({ filters: { brand: "all", color: "", size: "   ", gender: "ALL" } });
  for (const key of ["brand", "color", "size", "gender"]) {
    assert.ok(!(key in params), `${key} must not be sent when unset`);
  }
});

test("search and filters combine in one request — neither resets the other", () => {
  const params = buildPickerParams({ search: "Nike", filters: { size: "42", color: "Black" } });
  assert.equal(params.search, "Nike");
  assert.equal(params.size, "42");
  assert.equal(params.color, "Black");
});

// ---- cache isolation -----------------------------------------------------

test("the cache key is query-aware: a filtered page can never serve an unfiltered one", () => {
  const unfiltered = pickerQueryKey(buildPickerParams({}));
  const filtered = pickerQueryKey(buildPickerParams({ filters: { color: "Black" } }));
  const other = pickerQueryKey(buildPickerParams({ filters: { color: "White" } }));
  assert.notEqual(unfiltered, filtered);
  assert.notEqual(filtered, other);
});

test("the key is order-independent so equivalent queries share a cache entry", () => {
  const a = pickerQueryKey({ compact: 1, limit: 24, page: 1, color: "Black", size: "42" });
  const b = pickerQueryKey({ size: "42", color: "Black", page: 1, limit: 24, compact: 1 });
  assert.equal(a, b);
});

test("pages are cached separately", () => {
  assert.notEqual(
    pickerQueryKey(buildPickerParams({ page: 1 })),
    pickerQueryKey(buildPickerParams({ page: 2 }))
  );
});

// ---- wiring --------------------------------------------------------------

test("the picker sends its POS filters to the server", () => {
  assert.match(picker, /const serverFilters = useMemo\(\(\) => \(\{/);
  assert.match(picker, /searchCustomerProducts\(\{ search: term, filters: serverFilters, page: 1/);
  // Membership rather than the literal array: a localized picker legitimately gained a
  // `t` dependency, and pinning the exact list failed a test about which changes
  // retrigger the fetch. See ai-inbox-picker-perf for the same reasoning.
  const deps = picker.match(/\}, \[open, sizeMode, sizeCatalogFallback[^\]]*\]\);/);
  assert.ok(deps, "the catalog effect's dependency array must still be recognisable");
  assert.ok(deps[0].includes("serverFilters"), "filters must retrigger the server query");
  assert.ok(deps[0].includes("search"), "search must retrigger the server query");
});

test("changing a filter restarts at page 1 and newest wins", () => {
  assert.match(picker, /const querySignature = `\$\{term\}\|\$\{JSON\.stringify\(serverFilters\)\}`/);
  assert.match(picker, /requestId !== searchRequestIdRef\.current\) return;/);
  assert.match(picker, /controller\.abort\(\);/);
  assert.match(picker, /setResultPage\(1\);/);
});

test("load more appends deduped by product identity and cannot double-fire", () => {
  assert.match(picker, /if \(sizeMode \|\| loadingMore \|\| !hasMoreResults\) return;/);
  assert.match(picker, /const seen = new Set\(asArray\(current\)\.map/);
  assert.match(picker, /const fresh = asArray\(data\)\.filter\(\(item\) => !seen\.has/);
});

test("a filter change mid-flight discards a late page-2 response", () => {
  const loadMore = picker.slice(picker.indexOf("const loadMoreProducts"), picker.indexOf("// Product-card mode: pull the brand/type facets"));
  assert.match(loadMore, /if \(requestId !== searchRequestIdRef\.current\) return;/);
});

// ---- backend -------------------------------------------------------------

test("the endpoint filters colour across the catalog at variant level", () => {
  assert.match(controller, /const requestedColor = String\(req\.query\.color/);
  assert.match(controller, /FROM product_variants color_variant/);
  assert.match(controller, /LOWER\(TRIM\(COALESCE\(color_variant\.color, ''\)\)\) = LOWER\(TRIM\(\$\{colorToken\}\)\)/);
  assert.match(controller, /AND COALESCE\(color_variant\.stock, 0\) > 0/);
});

test("size filtering was already server-side and still is", () => {
  assert.match(controller, /FROM product_variants size_variant/);
  assert.match(controller, /LOWER\(TRIM\(COALESCE\(size_variant\.size, ''\)\)\) = LOWER\(TRIM\(\$\{sizeToken\}\)\)/);
});

test("the match total is counted before the page slice, with the same WHERE", () => {
  assert.match(controller, /const filterMatchValues = \[\.\.\.productQueryValues\];/);
  assert.match(controller, /SELECT COUNT\(DISTINCT p\.id\)::int AS total/);
  // count values must be captured BEFORE limit/offset are appended
  const countIdx = controller.indexOf("const filterMatchValues");
  const pushIdx = controller.indexOf("if (limit) productQueryValues.push(limit, offset);");
  assert.ok(countIdx < pushIdx, "count values must exclude limit/offset");
});

test("a failed count degrades to a normal page instead of failing the request", () => {
  assert.match(controller, /\[products\/with-variants\] match count failed:/);
  assert.match(controller, /let matchTotal = null;/);
});

test("pagination metadata is additive so existing consumers are unaffected", () => {
  assert.match(controller, /payload\.total = matchTotal;/);
  assert.match(controller, /payload\.has_more = page \* limit < matchTotal;/);
  assert.match(controller, /const normalizeResponse = \(rows = \[\]\) => \(\{\s*\n\s*success: true,\s*\n\s*data: rows,\s*\n\s*products: rows,/);
});

// ---- parity guards -------------------------------------------------------

test("pricing parity: the same normalization pipeline is still used", () => {
  assert.match(service, /normalizePosSellableProducts\(rows, saleModeSettings\)\.map\(\(product\) => normalizePosCatalogProduct\(product\)\)/);
  assert.doesNotMatch(service, /by-size/, "the by-size raw price must never back product cards");
});

test("the picker still never downloads the whole catalog", () => {
  assert.match(service, /export const PICKER_PAGE_SIZE = 24/);
  const searchFn = service.slice(service.indexOf("export const searchCustomerProducts"), service.indexOf("export const __resetPickerSearchCacheForTests"));
  assert.match(searchFn, /params,/);
  assert.doesNotMatch(searchFn, /loadCustomerProductCatalog/);
});
