import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const inventoryCountSource = fs.readFileSync(
  new URL("../src/modules/inventory/pages/InventoryCount.jsx", import.meta.url),
  "utf8"
);

test("inventory count keeps the canonical inventory navigation order", () => {
  const inventoryIndex = inventoryCountSource.indexOf('{ to: "/inventory",');
  const movementsIndex = inventoryCountSource.indexOf('{ to: "/inventory/movements",');
  const adjustmentsIndex = inventoryCountSource.indexOf('{ to: "/inventory/adjustments",');
  const countIndex = inventoryCountSource.indexOf('{ to: "/inventory/count",');
  const transfersIndex = inventoryCountSource.indexOf('{ to: "/stock-transfers",');
  const warehousesIndex = inventoryCountSource.indexOf('{ to: "/warehouses",');

  assert.ok(
    inventoryIndex < movementsIndex &&
      movementsIndex < adjustmentsIndex &&
      adjustmentsIndex < countIndex &&
      countIndex < transfersIndex &&
      transfersIndex < warehousesIndex,
    "inventory tabs must stay ordered as inventory, movements, adjustments, count, transfers, warehouses"
  );
});
