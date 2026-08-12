import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
const controller = await readFile(new URL("../server/controllers/dashboardController.js", import.meta.url), "utf8");

test("cashier dashboard is fixed to today in the UI", () => {
  assert.match(dashboard, /const isCashier = role === "cashier"/);
  assert.match(dashboard, /const effectiveRange = isCashier \? "today" : filters\.range/);
  assert.match(dashboard, /isCashier \? \(\s*<span aria-label=\{copy\.today\}/);
  assert.match(dashboard, /!isCashier && filters\.range === "custom"/);
});

test("cashier dashboard API ignores requested historical ranges", () => {
  assert.match(controller, /range: cashierOnlyToday \? "today" : req\.query\.range \|\| "today"/);
  assert.match(controller, /dateFrom: cashierOnlyToday \? ""/);
  assert.match(controller, /dateTo: cashierOnlyToday \? ""/);
  assert.match(controller, /days: isCashier\(req\.user\) \? 1 : req\.query\.days/);
});
