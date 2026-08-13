import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const drawerSource = read("../src/modules/pos/components/RecentOperationsDrawer.jsx");
const clientRolesSource = read("../src/modules/permissions/lib/rbacStore.js");
const serverRolesSource = read("../server/services/rolesService.js");
const permissionMiddlewareSource = read("../server/middleware/permissionMiddleware.js");
const ordersControllerSource = read("../server/controllers/ordersController.js");

test("cashier can edit and permanently delete invoices from recent POS operations", () => {
  assert.match(drawerSource, /const canEditInvoices = \(user = \{\}\) => isCashierUser\(user\)/);
  assert.match(drawerSource, /const canDeleteInvoices = \(user = \{\}\) => isCashierUser\(user\)/);
  assert.match(drawerSource, /const canEditOldInvoices = \(user = \{\}\) => isCashierUser\(user\)/);
  // The label was localized, so this pins the KEY next to the permission gate
  // and then proves the key resolves in both dictionaries.
  assert.match(
    drawerSource,
    /label=\{t\("pos\.recentOps\.actions\.permanentDelete"\)\}[\s\S]*?disabled=\{deleteLoading \|\| !canDeleteInvoices\(currentUser\)\}/
  );
  for (const locale of ["en", "ar"]) {
    const bundle = JSON.parse(read(`../src/locales/${locale}/pos.json`));
    const label = bundle?.recentOps?.actions?.permanentDelete;
    assert.equal(typeof label, "string", `pos.recentOps.actions.permanentDelete missing in ${locale}`);
    assert.ok(label.trim().length > 0, `pos.recentOps.actions.permanentDelete empty in ${locale}`);
  }
});

test("cashier role definitions include invoice edit and delete permissions", () => {
  for (const source of [clientRolesSource, serverRolesSource]) {
    const cashierBlock = source.slice(source.indexOf('key: "cashier"') >= 0 ? source.indexOf('key: "cashier"') : source.indexOf('id: "cashier"'));
    assert.match(cashierBlock, /"orders\.edit"/);
    assert.match(cashierBlock, /"orders\.delete"/);
  }
});

test("existing cashier database roles receive invoice permissions and pass hard-delete guard", () => {
  assert.match(permissionMiddlewareSource, /p\.module = 'orders'[\s\S]*?p\.action IN \('edit', 'delete'\)/);
  assert.match(ordersControllerSource, /"owner", "cashier", "pos cashier", "pos_cashier"/);
});
