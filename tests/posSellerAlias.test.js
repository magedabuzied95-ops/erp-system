import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const posControllerSource = read("../server/controllers/posController.js");
const posSource = read("../src/modules/pos/pages/POSPro.jsx");
const cartSource = read("../src/modules/pos/components/CartSidebar.jsx");
const recentOperationsSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");

test("POS seller API exposes the configured short alias as its display name", () => {
  assert.match(
    posControllerSource,
    /name: employee\.pos_alias \|\| employee\.name \|\| employee\.full_name/
  );
});

test("POS seller selection and checkout prefer the short alias", () => {
  assert.match(posSource, /activeSalesperson\.pos_alias \|\|\s*activeSalesperson\.full_name/);
  assert.equal(
    (posSource.match(/selectedSeller\?\.pos_alias \|\| selectedSeller\?\.name \|\| selectedSeller\?\.full_name/g) || []).length,
    2
  );
  assert.match(cartSource, /const displayName = salespersonAlias\(employee\)/);
});

test("recent POS operations prefer the persisted seller alias", () => {
  assert.match(
    recentOperationsSource,
    /\[order\.seller_name, order\.sales_employee_name, order\.salesperson_name/
  );
});
