import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ordersController = read("../server/controllers/ordersController.js");
const ordersStore = read("../src/modules/orders/lib/ordersStore.js");

const getOrders = ordersController.slice(
  ordersController.indexOf("export const getOrders = async"),
  ordersController.indexOf("const BLOCKED_OPERATION_STATUSES")
);

// The list response carried every line of every order: one wide row per line,
// joined to variants, products and the returns aggregate, for rows whose only
// item-derived reading is a quantity badge. The dashboard and the reports ask for
// them to be left out; nothing else does.
test("the line items are only dropped when the caller opts out", () => {
  assert.match(getOrders, /include_items/);
  assert.match(getOrders, /const includeItems = !\["0", "false", "no"\]/);
  assert.match(getOrders, /let leanList = !includeItems;/);
});

test("the lean list still answers the quantity badge and the client search", () => {
  assert.match(getOrders, /COALESCE\(SUM\(oi\.quantity\), 0\)::integer AS total_quantity/);
  assert.match(getOrders, /STRING_AGG\(/);
  assert.match(getOrders, /AS items_search/);
  // The search text the server pre-joins has to carry the same fields the client
  // used to assemble from the lines it no longer receives.
  for (const field of ["oi.product_name", "oi.sku", "oi.barcode", "pv.color", "pv.size"]) {
    assert.ok(getOrders.includes(field), `${field} must be part of the searchable text`);
  }
  assert.match(ordersStore, /order\.items_search,/);
});

test("a failed summary falls back to the full lines instead of failing the page", () => {
  assert.match(getOrders, /catch \(error\) \{[\s\S]{0,200}leanList = false;/);
  assert.match(getOrders, /if \(!leanList\) \{\s*\n\s*const itemsResult = await db\.query\(/);
});

test("the quantity a lean row reports comes from the summary, not from no items", () => {
  assert.match(getOrders, /const totalQuantity = leanList\s*\n\s*\? Number\(summary\?\.total_quantity \|\| 0\)/);
});
