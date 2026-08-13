import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const dashboardSource = fs.readFileSync(
  new URL("../src/modules/inventory/pages/InventoryDashboard.jsx", import.meta.url),
  "utf8"
);
const historySource = fs.readFileSync(
  new URL("../src/modules/inventory/pages/InventoryHistory.jsx", import.meta.url),
  "utf8"
);
const adjustmentsSource = fs.readFileSync(
  new URL("../src/modules/inventory/pages/StockAdjustments.jsx", import.meta.url),
  "utf8"
);

test("inventory dashboard action buttons use leaf translation keys", () => {
  const arabic = readJson("../src/locales/ar/inventory.json");
  const english = readJson("../src/locales/en/inventory.json");

  for (const locale of [arabic, english]) {
    assert.equal(typeof locale.actions.inventoryHistory, "string");
    assert.equal(typeof locale.actions.inventoryAdjustments, "string");
    assert.equal(typeof locale.history.title, "string");
    assert.equal(typeof locale.adjustments.title, "string");
  }

  assert.match(dashboardSource, /t\("inventory\.actions\.inventoryHistory"\)/);
  assert.match(dashboardSource, /t\("inventory\.actions\.inventoryAdjustments"\)/);
  assert.match(historySource, /tt\("inventory\.history\.title"\)/);
  assert.match(historySource, /tt\("inventory\.actions\.inventoryAdjustments"\)/);
  assert.match(adjustmentsSource, /tt\("inventory\.adjustments\.title"\)/);

  for (const source of [dashboardSource, historySource, adjustmentsSource]) {
    assert.doesNotMatch(source, /t{1,2}\("inventory\.(?:history|adjustments)"\)/);
  }
});
