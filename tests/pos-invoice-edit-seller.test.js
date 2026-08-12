import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pos = await readFile(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
const orders = await readFile(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");

test("both POS invoice edit entry points restore the saved salesperson", () => {
  const hydrations = pos.match(/const sellerId = resolveEditOrderSalespersonId\([^)]*\);\s*setSelectedSalespersonId\(sellerId \? String\(sellerId\) : ""\);/g) || [];
  assert.equal(hydrations.length, 2);
  assert.match(pos, /const editingSellerId = editingOrder\?\.id \? resolveEditOrderSalespersonId\(editingOrder\) : ""/);
  assert.match(pos, /retainingOriginalSeller/);
});

test("POS invoice edit persists salesperson on the order and rebuilt order items", () => {
  assert.match(orders, /sales_employee_id: resolvedEditSalesEmployeeId/);
  assert.match(orders, /seller_user_id = \$27/);
  assert.match(orders, /sales_employee_id = \$28/);
  assert.match(orders, /salesperson_id = \$28/);
  assert.match(orders, /seller_name = \$29/);
  assert.match(orders, /salesperson_name = \$29/);
});

test("unchanged legacy seller is preserved while changed seller must be valid", () => {
  assert.match(orders, /requestedSalesEmployeeId \|\| loadedSalesEmployeeId/);
  assert.match(orders, /if \(sellerChanged && !editSalespersonSnapshot\)/);
});
