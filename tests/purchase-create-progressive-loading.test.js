import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("purchase creation does not block its initial render on the full product catalog", async () => {
  const source = await readFile(
    new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url),
    "utf8"
  );

  const essentialLoad = source.indexOf("const [suppliersRes, warehousesRes, branchesRes] = await Promise.allSettled");
  const interactive = source.indexOf("if (!isEditMode) {", essentialLoad);
  const productCatalogLoad = source.indexOf('api.get("/products/with-variants"', essentialLoad);

  assert.ok(essentialLoad >= 0, "essential purchase setup should load first");
  assert.ok(interactive > essentialLoad, "create mode should become interactive after essential setup");
  assert.ok(productCatalogLoad > interactive, "the heavy product catalog must start after the initial form is interactive");
  assert.match(source.slice(interactive, productCatalogLoad), /setLoading\(false\)/);
  assert.match(source.slice(interactive, productCatalogLoad), /requestIdleCallback/);
});
