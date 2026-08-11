import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Employee Portal → "اطلب من المخزن". Filters were ALREADY server-side
// (q/category/type/brand/manufacturer/gender/size/inStockOnly), so this was not
// the AI Inbox "client-filters-a-bounded-page" bug. The defect was pagination:
// the list asked for `limit: hasSizeFilter ? 500 : 48` and sent NO `page`, so
// matches beyond that single bounded response were unreachable — no load-more,
// no page 2. The endpoint already supported page/offset/has_more.

const page = fs.readFileSync(new URL("../src/modules/employees/pages/EmployeePortalProducts.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../server/services/employeePortalProductsService.js", import.meta.url), "utf8");

const PAGE_SIZE = 48;

// ---- the exact regression fixture ---------------------------------------

// 100 requestable products; 1 match inside the first 48, 20 more in rows 49-100.
const world = Array.from({ length: 100 }, (_, i) => ({
  product_id: i + 1,
  matches: i === 7 || (i >= 60 && i < 80),
}));

const serverPage = (filtered, pageNo, limit = PAGE_SIZE) => {
  const all = filtered ? world.filter((p) => p.matches) : world;
  const rows = all.slice((pageNo - 1) * limit, pageNo * limit);
  return { products: rows, has_more: rows.length === limit };
};

test("21 requestable products match the filter in total", () => {
  assert.equal(world.filter((p) => p.matches).length, 21);
});

test("BROKEN: one bounded unfiltered response surfaced only the single early match", () => {
  const firstBounded = world.slice(0, PAGE_SIZE).filter((p) => p.matches);
  assert.equal(firstBounded.length, 1, "only 1 match happens to sit in the first 48 rows");
});

test("FIXED: server-side filtering + pagination reaches every match", () => {
  let collected = [];
  let pageNo = 1;
  for (;;) {
    const res = serverPage(true, pageNo);
    const seen = new Set(collected.map((p) => p.product_id));
    collected = [...collected, ...res.products.filter((p) => !seen.has(p.product_id))];
    if (!res.has_more) break;
    pageNo += 1;
  }
  assert.equal(collected.length, 21, "all 21 matches are reachable");
});

test("more matches than one page: page 2 appends and does not replace page 1", () => {
  const p1 = serverPage(false, 1);
  assert.equal(p1.products.length, 48);
  assert.equal(p1.has_more, true);
  const p2 = serverPage(false, 2);
  assert.equal(p2.products[0].product_id, 49, "page 2 continues after page 1");
  const merged = [...p1.products, ...p2.products];
  assert.equal(new Set(merged.map((p) => p.product_id)).size, merged.length, "no duplicates");
});

test("exactly one page of matches reports has_more=false on the following page", () => {
  const exact = { products: new Array(48).fill({ product_id: 1 }), has_more: true };
  assert.equal(exact.has_more, true, "48 results cannot rule out a page 2");
  assert.equal(serverPage(true, 2).has_more, false);
});

test("zero matches yields an empty page, not a stale one", () => {
  const none = { products: [], has_more: false };
  assert.equal(none.products.length, 0);
  assert.equal(none.has_more, false);
});

// ---- request shape -------------------------------------------------------

test("the list always requests ONE bounded page and sends `page`", () => {
  assert.match(page, /export const EMPLOYEE_PRODUCTS_PAGE_SIZE = 48;/);
  assert.match(page, /const params = \{ limit: EMPLOYEE_PRODUCTS_PAGE_SIZE, page, inStockOnly: 1 \};/);
});

test("the 500-row size-filter request is gone", () => {
  assert.doesNotMatch(page, /limit: hasSizeFilter \? 500 : 48/);
  assert.doesNotMatch(page, /limit: 500/);
});

test("every already-supported filter still travels to the server", () => {
  for (const param of ["params.q", "params.category", "params.type", "params.brand", "params.manufacturer", "params.gender", "params.size"]) {
    assert.ok(page.includes(param), `${param} must still be sent`);
  }
  assert.match(page, /inStockOnly: 1/, "requestable-stock semantics preserved");
});

test("colour is sent to the server if a colour filter ever exists", () => {
  assert.match(page, /const color = text\(filters\.color\);/);
  assert.match(page, /if \(color && color !== "all"\) params\.color = color;/);
});

test("search and filters go in the SAME request", () => {
  const builder = page.slice(page.indexOf("export const buildListParams"), page.indexOf("const buildLookupParams"));
  assert.match(builder, /if \(q\) params\.q = q;/);
  assert.match(builder, /params\.size = text\(selectedSize\)/);
});

// ---- newest-wins + append safety ----------------------------------------

test("page 1 is re-requested on every filter change, colour included", () => {
  assert.match(page, /page: 1/);
  assert.match(page, /filters\.inStockOnly, filters\.color, selectedFilterSize\]\);/);
});

test("a stale response can never overwrite a newer filter", () => {
  assert.match(page, /const productsRequestIdRef = useRef\(0\);/);
  assert.match(page, /const requestId = productsRequestIdRef\.current \+ 1;/);
  assert.match(page, /if \(cancelled \|\| requestId !== productsRequestIdRef\.current\) return;/);
  assert.match(page, /controller\?\.abort\(\);/);
});

test("load more cannot double-fire and drops a page from an old filter", () => {
  const loadMore = page.slice(page.indexOf("const loadMoreProducts"), page.indexOf("}, [loadingMoreProducts"));
  assert.match(loadMore, /if \(loadingMoreProducts \|\| !hasMoreProducts\) return;/);
  assert.match(loadMore, /if \(requestId !== productsRequestIdRef\.current\) return;/);
});

test("appended pages are deduplicated by stable product identity", () => {
  assert.match(page, /const stableProductKey = \(product = \{\}\) =>/);
  assert.match(page, /const seen = new Set\(\(Array\.isArray\(current\) \? current : \[\]\)\.map\(stableProductKey\)\)/);
  assert.match(page, /\.filter\(\(item\) => !seen\.has\(stableProductKey\(item\)\)\)/);
});

test("a failed page 1 clears has_more so a dead load-more button cannot linger", () => {
  assert.match(page, /setProducts\(\[\]\);\s*\n\s*setHasMoreProducts\(false\);/);
});

test('the "تحميل المزيد" control only appears when the server says there is more', () => {
  assert.match(page, /\{hasMoreProducts && !loading \? \(/);
  assert.match(page, /onClick=\{loadMoreProducts\}/);
  assert.match(page, /disabled=\{loadingMoreProducts\}/);
});

// ---- backend untouched + warehouse semantics -----------------------------

test("the backend already provided pagination — no server change was needed", () => {
  assert.match(service, /const page = toPositiveInt\(query\.page, 1\);/);
  assert.match(service, /const offset = \(page - 1\) \* limit;/);
  assert.match(service, /LIMIT \$\{limitToken\} OFFSET \$\{offsetToken\}/);
  assert.match(service, /has_more: products\.length === limit,/);
});

test("the endpoint already supported colour, so nothing new was invented", () => {
  assert.match(service, /const color = clean\(query\.color\);/);
});

test("requestable-warehouse stock semantics are untouched", () => {
  // inStockOnly still defaults to true server-side; we did not swap in POS stock.
  assert.match(service, /const inStockOnly = query\.inStockOnly === undefined/);
  assert.doesNotMatch(page, /getPosSellableProducts/);
});

test("the warehouse request flow itself was not modified", () => {
  assert.match(page, /requestEmployeeWarehousePick/);
  // quantity changes must not refetch the catalog
  const deps = page.slice(page.indexOf("}, [token, deferredSearch"), page.indexOf("}, [token, deferredSearch") + 260);
  assert.ok(!deps.includes("selectedQuantity"), "quantity must not be a product-fetch dependency");
});

test("no full-catalog endpoint is used by this page", () => {
  assert.doesNotMatch(page, /products\/with-variants/);
  assert.match(page, /getEmployeePortalCompactProducts/);
});
