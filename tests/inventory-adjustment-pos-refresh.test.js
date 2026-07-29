import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adjustmentPage = readFileSync(
  new URL("../src/modules/inventory/pages/StockAdjustments.jsx", import.meta.url),
  "utf8",
);
const posPage = readFileSync(
  new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url),
  "utf8",
);
const refreshSignal = readFileSync(
  new URL("../src/shared/lib/productRefreshSignal.js", import.meta.url),
  "utf8",
);

test("inventory adjustment notifies every open product consumer", () => {
  assert.match(adjustmentPage, /notifyProductRefresh\("inventory-adjustment"/);
  assert.match(refreshSignal, /window\.dispatchEvent\(new CustomEvent\(PRODUCT_REFRESH_EVENT/);
  assert.match(refreshSignal, /window\.localStorage\.setItem\(PRODUCT_REFRESH_STORAGE_KEY/);
  assert.match(refreshSignal, /new BroadcastChannel\(PRODUCT_REFRESH_CHANNEL\)/);
});

test("POS refreshes live stock and its offline snapshot after an adjustment", () => {
  assert.match(posPage, /window\.addEventListener\(PRODUCT_REFRESH_EVENT,\s*handleProductRefresh\)/);
  assert.match(posPage, /window\.addEventListener\("storage",\s*handleStorageRefresh\)/);
  assert.match(posPage, /new BroadcastChannel\(PRODUCT_REFRESH_CHANNEL\)/);
  assert.match(posPage, /persistSnapshot\s*=\s*search === undefined/);
  assert.match(posPage, /const catalog = await refreshCatalogProducts\(\{[\s\S]*?saleModeSettings/);
  assert.match(posPage, /cache:\s*"no-store"[\s\S]*?"Cache-Control":\s*"no-cache"/);
  assert.match(posPage, /reconcileCartWithCatalog\(current,\s*catalog\)\.nextCart/);
});
