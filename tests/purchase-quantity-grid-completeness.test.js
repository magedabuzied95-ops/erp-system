import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

// The Create Purchase grid opens on every variant carrying a purchase quantity
// saved in the product editor. Bounding the browse fetch to a page of the
// catalog silently emptied that grid of everything but the newest products,
// which reads as "my saved quantities disappeared".
test("the purchase-quantity set is fetched on its own, not scavenged from the browse page", () => {
  assert.match(page, /purchaseQtyOnly: 1/);
  assert.match(page, /const loadPurchaseQtyProducts = async \(\) => \{/);
  // merged with the browse rows rather than replacing them, so out-of-stock and
  // zero-quantity products stay reachable through the picker and the filters
  assert.match(page, /mergeProductRowsById\(rows, purchaseQtyRows\)/);
  // a failed quantity fetch must not take the browse set down with it
  assert.match(page, /Promise\.allSettled\(\[/);
  assert.match(page, /purchaseQtyRes\.status === "fulfilled"/);
});

test("the paging loop reports truncation instead of hiding it", () => {
  assert.match(page, /if \(!response\?\.has_more\) return rows;/);
  assert.match(page, /purchase-quantity-catalog-truncated/);
});

test("the server filters by saved purchase quantity and does not shrink the result to a picker page", () => {
  assert.match(controller, /req\.query\.purchaseQtyOnly \?\? req\.query\.purchase_qty_only/);
  assert.match(controller, /COALESCE\(purchase_variant\.default_purchase_qty, 0\) > 0/);
  // 48 is the picker page size; asking for this narrow slice must not be capped
  // to its first page — that cap is what made saved quantities look deleted.
  assert.match(
    controller,
    /const limitCap = \(isEmployeePortalCatalog && requestedSize\) \|\| purchaseQtyOnly \? 500 : 48;/
  );
});
