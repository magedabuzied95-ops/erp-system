import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/orders/pages/OrdersDashboard.jsx", import.meta.url),
  "utf8"
);

test("orders dashboard opens directly on the orders table without the workspace switcher", () => {
  const dashboard = source.slice(
    source.indexOf("function OrdersDashboard"),
    source.indexOf("function BulkActions")
  );

  assert.doesNotMatch(dashboard, /<WorkspaceTabs\b/);
  assert.match(dashboard, /const \[workspace\] = useState\("table"\)/);
  assert.doesNotMatch(source, /function WorkspaceTabs/);
});
