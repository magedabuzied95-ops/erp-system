import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const dashboardSource = fs.readFileSync(
  new URL("../src/modules/inventory/pages/InventoryDashboard.jsx", import.meta.url),
  "utf8"
);

test("inventory dashboard action buttons use leaf translation keys", () => {
  const arabic = readJson("../src/locales/ar/inventory.json");
  const english = readJson("../src/locales/en/inventory.json");

  for (const locale of [arabic, english]) {
    assert.equal(typeof locale.actions.inventoryHistory, "string");
    assert.equal(typeof locale.actions.inventoryAdjustments, "string");
  }

  assert.match(dashboardSource, /t\("inventory\.actions\.inventoryHistory"\)/);
  assert.match(dashboardSource, /t\("inventory\.actions\.inventoryAdjustments"\)/);
  assert.doesNotMatch(dashboardSource, /\{t\("inventory\.(?:history|adjustments)"\)\}/);
});
