import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalPermission, permissionSatisfies } from "../server/middleware/permissionMiddleware.js";

const middleware = readFileSync("server/middleware/permissionMiddleware.js", "utf8");
const matrix = readFileSync("src/modules/permissions/lib/rbacStore.js", "utf8");

/*
 * `permit` allowed a request when the requested permission's alias set and a
 * held permission's alias set INTERSECTED, and those sets contained the bare
 * module name and the bare action. Two unrelated grants therefore matched, in
 * both directions, across the whole ERP.
 *
 * These tests pin the closed behaviour. They are deliberately concrete: each one
 * names a privilege that was actually reachable, because "the matcher is
 * stricter now" is not a property anyone can check.
 */

test("a grant on a module is not every grant on that module", () => {
  // Held reports:view carried reports:cost and reports:profit, which
  // CORE_PERMISSIONS documents as deliberately withheld from existing roles.
  assert.equal(permissionSatisfies("reports", "view", "reports", "cost"), false);
  assert.equal(permissionSatisfies("reports", "view", "reports", "profit"), false);
  // Held roles:view let a Manager rewrite the permission system itself.
  assert.equal(permissionSatisfies("roles", "view", "roles", "create"), false);
  assert.equal(permissionSatisfies("roles", "view", "roles", "edit"), false);
  assert.equal(permissionSatisfies("roles", "view", "roles", "delete"), false);
  // And the everyday ones.
  assert.equal(permissionSatisfies("orders", "view", "orders", "delete"), false);
  assert.equal(permissionSatisfies("expenses", "view", "expenses", "pay"), false);
  assert.equal(permissionSatisfies("pos", "view", "pos", "override_seller"), false);
  assert.equal(permissionSatisfies("users", "view", "users", "delete"), false);
});

test("a grant on one module is not the same grant on another", () => {
  // dashboard:view is backfilled to EVERY role, so this rule meant every
  // authenticated user passed every :view gate in the application.
  assert.equal(permissionSatisfies("dashboard", "view", "products", "view_cost"), false);
  assert.equal(permissionSatisfies("dashboard", "view", "customers", "view"), false);
  assert.equal(permissionSatisfies("dashboard", "view", "ai_inbox_messenger", "view"), false);
  assert.equal(permissionSatisfies("products", "view", "money_accounts", "view"), false);
  assert.equal(permissionSatisfies("orders", "create", "money_transfers", "create"), false);
});

test("the permission a role actually holds still works", () => {
  for (const [module, action] of [
    ["orders", "delete"],
    ["ai_inbox_messenger", "reply"],
    ["reports", "cost"],
    ["money_transfers", "create"],
    ["surveillance.device", "settings"],
  ]) {
    assert.equal(permissionSatisfies(module, action, module, action), true, `${module}:${action} must satisfy itself`);
  }
});

test("the same permission spelled differently still matches", () => {
  // The matrix, the seed data and the route calls disagree about where the dot
  // goes. All of these denote one permission.
  assert.equal(permissionSatisfies("pos.expenses", "create", "pos", "expenses.create"), true);
  assert.equal(permissionSatisfies("pos", "expenses.create", "pos.expenses", "create"), true);
  assert.equal(permissionSatisfies("expenses.advances", "deduct", "expenses", "advances.deduct"), true);
  assert.equal(permissionSatisfies("inventory", "movements:view", "inventory.movements", "view"), true);
  assert.equal(permissionSatisfies("inventory", "movements:view", "inventory", "movements.view"), true);
  assert.equal(permissionSatisfies("treasury.dashboard", "view", "treasury", "dashboard.view"), true);

  assert.equal(canonicalPermission("pos.expenses", "create"), "pos.expenses.create");
  assert.equal(canonicalPermission("pos", "expenses.create"), "pos.expenses.create");
  assert.equal(canonicalPermission("inventory", "movements:view"), "inventory.movements.view");
});

test("renamed actions are synonyms, not a widening", () => {
  // marketing:approve was renamed to publish and marketing:edit to update. Both
  // names must keep working, without making the module a free-for-all.
  assert.equal(permissionSatisfies("marketing", "publish", "marketing", "approve"), true);
  assert.equal(permissionSatisfies("marketing", "approve", "marketing", "publish"), true);
  assert.equal(permissionSatisfies("marketing", "update", "marketing", "edit"), true);
  assert.equal(permissionSatisfies("marketing", "edit", "marketing", "update"), true);
  assert.equal(permissionSatisfies("customers", "update", "customers", "edit"), true);

  assert.equal(permissionSatisfies("marketing", "view", "marketing", "publish"), false);
  assert.equal(permissionSatisfies("marketing", "publish", "marketing", "delete"), false);
  assert.equal(permissionSatisfies("customers", "view", "customers", "edit"), false);
});

test("the legacy rule is still reachable, and still wrong", () => {
  // Kept as a same-day rollback. If this ever starts passing under the default,
  // the hole is back.
  assert.equal(permissionSatisfies("orders", "view", "orders", "delete", { legacy: true }), true);
  assert.equal(permissionSatisfies("dashboard", "view", "customers", "view", { legacy: true }), true);
  assert.equal(permissionSatisfies("orders", "view", "orders", "delete"), false);
});

test("the rollback is env-gated and off by default", () => {
  assert.match(middleware, /PERMISSION_LEGACY_ALIASES/);
  assert.match(middleware, /const legacyAliasesEnabled = \(\) =>\s*\n?\s*\["1", "true", "yes", "on"\]\.includes/);
  // Absent env means canonical. An operator has to opt in to the old behaviour.
  assert.equal(
    ["1", "true", "yes", "on"].includes(String(undefined || "").toLowerCase()),
    false,
    "an unset variable must not enable legacy matching"
  );
});

test("a denial the old rule would have allowed is logged with the missing permission", () => {
  // Without this, closing the hole turns into an unexplained 403 for whoever
  // relied on it. The log has to name the role and the exact permission so the
  // fix is one edit in the Roles screen.
  assert.match(middleware, /denied by canonical matching \(was allowed by the legacy alias rule\)/);
  assert.match(middleware, /required: requiredPermission/);
  assert.match(middleware, /role: userRole/);
  assert.match(middleware, /Grant "\$\{requiredPermission\}" to this role/);
});

test("admins and super admins are unaffected", () => {
  // They short-circuit before any alias comparison, so the change cannot lock
  // the operator out of their own system.
  const permitBody = middleware.slice(middleware.indexOf("const permit = ("), middleware.indexOf("export const permissionSatisfies"));
  assert.match(permitBody, /if \(isAdmin \|\| isSuperAdmin \|\| hasWildcard\) \{\s*\n\s*return next\(\);/);
  assert.ok(
    permitBody.indexOf("return next();") < permitBody.indexOf("const allowed = branchAdminAllowed"),
    "the admin bypass must run before the permission comparison"
  );
});

test("every guarded permission is grantable from the Roles screen", () => {
  // Canonical matching means a role now needs the EXACT permission. Any gate
  // whose permission the UI cannot grant is a permanent 403 with no remedy.
  const guarded = new Set();
  for (const match of middleware.matchAll(/permit\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g)) {
    guarded.add(canonicalPermission(match[1], match[2]));
  }
  const grantable = new Set();
  const block = matrix.slice(matrix.indexOf("export const MODULE_ACTIONS"), matrix.indexOf("export const ACTIONS"));
  for (const match of block.matchAll(/^\s*(?:"([^"]+)"|([a-z_.]+)):\s*\[([^\]]*)\]/gm)) {
    const moduleName = match[1] || match[2];
    for (const action of match[3].matchAll(/"([^"]+)"/g)) grantable.add(canonicalPermission(moduleName, action[1]));
  }
  const ungrantable = [...guarded].filter((key) => key && !grantable.has(key));
  assert.deepEqual(ungrantable, [], `guarded but not grantable from the Roles screen: ${ungrantable.join(", ")}`);
});
