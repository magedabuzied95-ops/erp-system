import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/orders/pages/OrdersDashboard.jsx", import.meta.url),
  "utf8"
);

test("orders bulk actions are supplied to the filters row instead of a separate toolbar", () => {
  const dashboard = source.slice(
    source.indexOf("function OrdersDashboard"),
    source.indexOf("function BulkActions")
  );

  assert.match(dashboard, /<Filters[\s\S]*?actions=\{\([\s\S]*?<BulkActions/);
  assert.doesNotMatch(dashboard, /<main[\s\S]*?<div className="mb-3 flex flex-col[\s\S]*?<BulkActions/);
});

test("filters render all order actions directly beside the today shortcut", () => {
  const filters = source.slice(
    source.indexOf("function Filters"),
    source.indexOf("function TableView")
  );

  assert.match(filters, /<QuickFilterButton[\s\S]*?orders\.filters\.today[\s\S]*?\{actions\}/);
  assert.match(filters, /mt-2\.5 flex flex-wrap items-center gap-2/);
});
