import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(
  new URL("../server/services/inventoryCountService.js", import.meta.url),
  "utf8"
);
const controllerSource = fs.readFileSync(
  new URL("../server/controllers/inventoryCountController.js", import.meta.url),
  "utf8"
);

test("an exact inventory-count article match expands to every variant of its product", () => {
  assert.match(
    serviceSource,
    /exactRow\?\.product_id[\s\S]*fetchInventoryCountProductVariants\(dbClient,[\s\S]*productId: exactRow\.product_id/
  );
  assert.match(serviceSource, /expandedProduct: Boolean\(exactRow\?\.product_id\)/);
  assert.match(controllerSource, /expandedProduct: Boolean\(result\?\.expandedProduct\)/);
});
