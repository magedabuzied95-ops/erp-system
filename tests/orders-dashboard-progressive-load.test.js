import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/orders/pages/OrdersDashboard.jsx", import.meta.url),
  "utf8"
);

const loadOrders = source.slice(
  source.indexOf("const loadOrders = useCallback"),
  source.indexOf("useEffect(() => {", source.indexOf("const loadOrders = useCallback"))
);

// The callback body alone: a setLoading(false) in the finally block, which runs
// only after the last page, is exactly the behaviour these tests exist to reject.
const onPageBody = loadOrders.slice(
  loadOrders.indexOf("onPage: (rows) => {"),
  loadOrders.indexOf("      });")
);

test("the list paints its first page instead of waiting for the whole history", () => {
  // A 1,145-order history is three pages of the slowest query the API has. Holding
  // the table until the last one landed is what made this page feel broken.
  assert.match(loadOrders, /onPage:/, "the walk must hand pages over as they land");
  assert.ok(onPageBody.length > 0 && onPageBody.length < loadOrders.length, "the onPage callback body must be readable");
  assert.match(onPageBody, /setOrders\(/, "each page must reach the table as it lands");
  assert.match(onPageBody, /setLoading\(false\);/, "the spinner must end on the first page, not after the walk");
});

test("later pages are appended by id, never concatenated blindly", () => {
  // A socket can push a new order in between two pages, and offset paging repeats
  // a row when one is inserted mid-walk.
  assert.match(onPageBody, /isFirstPage \? enriched : appendOrders\(prev, enriched\)/);
  assert.match(source, /const appendOrders[\s\S]{0,400}known\.has\(String\(order\.id\)\)/);
});

test("a refresh started mid-walk cannot be overwritten by the walk it replaced", () => {
  assert.match(loadOrders, /loadRequestRef\.current = requestId;/);
  assert.match(onPageBody, /if \(!isCurrent\(\)\) return;/);
});

test("the list asks for rows without their line items", () => {
  // Every path that opens, prints or edits an order hydrates it from /orders/:id
  // first, so the lines were downloaded for all 1,145 rows and read for none.
  assert.match(loadOrders, /includeItems: false/);
});
