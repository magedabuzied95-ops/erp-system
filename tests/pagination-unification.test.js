import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Resolves a dotted key through the composed dictionaries, for both locales. */
const dictionaryValue = (key, locale) => {
  const bundles = JSON.parse(readFileSync(new URL(`../src/locales/${locale}/common.json`, import.meta.url), "utf8"));
  const [, ...rest] = key.split(".");
  let node = bundles.common;
  for (const part of rest) node = node?.[part];
  return typeof node === "string" ? node : undefined;
};

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the shared pagination exposes standard sizes, numeric pages and ellipsis", () => {
  const source = read("src/shared/ui/M1UI.jsx");
  assert.match(source, /DEFAULT_PAGE_SIZES = \[10, 25, 50, 100, 200, 500, 1000, "all"\]/);
  assert.match(source, /paginationWindow\(safePage, safePages\)/);
  assert.match(source, /m1-pagination__ellipsis/);
  assert.match(source, /aria-current=\{item === safePage \? "page"/);
  assert.match(source, /event\.target\.value === "all" \? Math\.max\(1, safeTotal\)/);
  assert.match(source, /option === "all" \? text\.all/);
  // The range template moved into the dictionary; assert the call AND the wording.
  assert.match(source, /t\("common\.m1\.pagination\.range", \{ start, end, count \}\)/);
  assert.equal(dictionaryValue("common.m1.pagination.range", "ar"), "عرض {{start}}–{{end}} من أصل {{count}}");
  assert.match(dictionaryValue("common.m1.pagination.range", "en"), /\{\{start\}\}.*\{\{end\}\}.*\{\{count\}\}/);
});

test("main ERP list screens use the shared pagination", () => {
  const screens = [
    "src/modules/sales/pages/Customers.jsx",
    "src/modules/products/pages/ProductsList.jsx",
    "src/modules/orders/pages/OrdersDashboard.jsx",
    "src/modules/purchases/pages/PurchasesDashboard.jsx",
    "src/modules/purchases/pages/SuppliersDashboard.jsx",
    "src/modules/reports/pages/Reports.jsx",
    "src/modules/managerPortal/pages/InventoryApprovals.jsx",
    "src/modules/inventory/pages/InventoryHistory.jsx",
    "src/modules/accounting/pages/JournalEntries.jsx",
    "src/modules/products/pages/Units.jsx",
    "src/modules/products/pages/Manufacturers.jsx",
    "src/modules/employees/pages/Branches.jsx",
  ];

  screens.forEach((screen) => {
    const source = read(screen);
    assert.match(source, /import \{ Pagination \} from "\.\.\/.*shared\/ui";/, screen);
    assert.match(source, /<Pagination\b/, screen);
  });
});

test("server-side history tables send limit and offset to their APIs", () => {
  const inventory = read("src/modules/inventory/pages/InventoryHistory.jsx");
  const journal = read("src/modules/accounting/pages/JournalEntries.jsx");
  const approvals = read("src/modules/managerPortal/pages/InventoryApprovals.jsx");

  assert.match(inventory, /params\.set\("limit", String\(pageSize\)\)/);
  assert.match(inventory, /params\.set\("offset", String\(\(page - 1\) \* pageSize\)\)/);
  assert.match(journal, /offset: \(page - 1\) \* pageSize/);
  assert.match(approvals, /managerPortalApi\.inventoryApprovals\(token, \{/);
  assert.match(approvals, /limit: overrides\.limit/);
});

test("the shared pagination stays responsive and RTL", () => {
  const component = read("src/shared/ui/M1UI.jsx");
  const styles = read("src/shared/ui/m1-ui.css");
  // RTL is still honoured, but from the ACTIVE language rather than pinned, so
  // the same control is correct in English too.
  assert.doesNotMatch(component, /dir="rtl"/);
  assert.match(component, /dir=\{i18n\.dir\(\)\}/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /m1-pagination__numbers/);
});
