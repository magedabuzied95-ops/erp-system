/**
 * A cashier must not reach the Reports Center.
 *
 * `reports.view` is the single key to every endpoint behind
 * `permit("reports", "view")`: company revenue, expenses, profit, payroll and
 * employee reports, customer intelligence, and the AI insights layered on them.
 * The Reports page requests all seven of those endpoints on mount.
 *
 * Three things had to line up for a cashier to see that page, and all three did:
 * the dashboard tile linked to it, the route carried no guard, and the
 * browser-side Cashier preset handed out reports.view/create/print while the
 * server-side preset granted none. Each is asserted separately below so a
 * regression names the layer that broke.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/**
 * Slice one preset's permission list out of a role-preset array literal.
 * The list nests — `allow(["a", "b"], [...])` — so the closing bracket has to be
 * matched, not searched for: stopping at the first `],` cuts the list off after
 * its first entry and every later grant escapes the assertion.
 */
const presetPermissions = (source, key) => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = withoutComments.indexOf(`"${key}"`);
  assert.notEqual(start, -1, `no ${key} preset found`);
  const open = withoutComments.indexOf("permissions: [", start);
  assert.notEqual(open, -1, `${key} preset has no permissions list`);

  let depth = 0;
  for (let index = open + "permissions: ".length; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return withoutComments.slice(open, index + 1);
    }
  }
  assert.fail(`${key} permission list is unterminated`);
};

test("the browser-side Cashier preset grants no reports permission", async () => {
  const store = await read("../src/modules/permissions/lib/rbacStore.js");
  const block = presetPermissions(store, "cashier");

  assert.doesNotMatch(block, /"reports[.:]/, "no literal reports.* grant");
  for (const call of block.matchAll(/allow\(\[([^\]]*)\]/g)) {
    assert.doesNotMatch(call[1], /"reports"/, "no reports module inside an allow() spread");
  }
});

test("the server-side Cashier preset grants no reports permission", async () => {
  const roles = await read("../server/services/rolesService.js");
  const block = presetPermissions(roles, "cashier");

  assert.doesNotMatch(block, /"reports[.:]/, "no literal reports.* grant");
});

test("the browser and server Cashier presets agree about reports", async () => {
  const store = await read("../src/modules/permissions/lib/rbacStore.js");
  const roles = await read("../server/services/rolesService.js");

  const holdsReports = (block) => /"reports[.:]/.test(block) || /allow\(\[[^\]]*"reports"/.test(block);

  assert.equal(
    holdsReports(presetPermissions(store, "cashier")),
    holdsReports(presetPermissions(roles, "cashier")),
    "a preset that diverges lets the Roles screen write a grant the server never intended"
  );
});

test("the legacy /reports route is permission gated", async () => {
  const app = await read("../src/App.jsx");
  const at = app.indexOf('path="reports"');
  assert.notEqual(at, -1, "the legacy /reports route must exist");

  const block = app.slice(at, at + 260);
  assert.match(block, /<Reports \/>/, "the route must still render the Reports page");
  assert.match(block, /ProtectedRoute[\s\S]*reports\.view/, "the route must require reports.view");
});

test("the dashboard net-sales tile only links to reports when allowed", async () => {
  const dashboard = await read("../src/pages/Dashboard.jsx");

  assert.match(dashboard, /hasPermission\(\s*"reports\.view"/, "the tile must test the permission");
  const tile = dashboard.match(/\{\s*label:\s*L\("صافي مبيعات اليوم"[^\n]*\}/)?.[0];
  assert.ok(tile, "the net-sales tile must exist");
  assert.doesNotMatch(tile, /to:\s*"\/reports"/, "the tile must not link unconditionally");
  assert.match(tile, /to:\s*canOpenReports\s*\?\s*"\/reports"\s*:\s*null/, "the link must be gated");
});

/**
 * The second half of the same hole.
 *
 * `reports.view` was revoked from Cashier, but `accounting.view` stayed on both presets
 * — and it gates /financial-reports/{summary,profit-loss,ledgers,trial-balance,
 * balance-sheet}. A cashier who could no longer open the Reports Center could still pull
 * the company profit and loss. POS never needed it: the only accounting call the POS
 * module makes is createManualMoneyAdjustment, which gates on money_transactions.adjust,
 * a permission this preset does not grant.
 */
test("neither Cashier preset grants accounting.view, which unlocks the P&L", async () => {
  for (const [label, path] of [
    ["browser", "../src/modules/permissions/lib/rbacStore.js"],
    ["server", "../server/services/rolesService.js"],
  ]) {
    const block = presetPermissions(await read(path), "cashier");
    assert.doesNotMatch(block, /"accounting\.view"/, `${label} Cashier preset still grants accounting.view`);
    for (const call of block.matchAll(/allow\(\[([^\]]*)\]/g)) {
      assert.doesNotMatch(call[1], /"accounting"/, `${label} preset grants accounting inside an allow() spread`);
    }
  }
});

test("POS still works without accounting.view, because it never used it", async () => {
  // If POS ever gains a call behind accounting.view, this fails and the removal above has
  // to be reconsidered rather than quietly breaking the till.
  const posFiles = [
    "../src/modules/pos/pages/POSPro.jsx",
    "../src/modules/pos/components/CartSidebar.jsx",
  ];
  const calls = new Set();
  for (const file of posFiles) {
    const source = await read(file);
    for (const match of source.matchAll(/accountingApi\.(\w+)/g)) calls.add(match[1]);
  }
  assert.deepEqual([...calls], ["createManualMoneyAdjustment"], "the POS accounting surface changed");

  const routes = await read("../server/routes/accounting.js");
  const block = routes.slice(routes.indexOf('"/money-adjustments"'), routes.indexOf('"/money-adjustments"') + 200);
  assert.match(block, /permit\("money_transactions", "adjust"\)/, "the POS adjustment is not gated on accounting.view");
});

test("the grant audit script covers the financial permission as well as the reporting ones", async () => {
  // Removing it from the preset does not revoke it from a role that already holds it:
  // permissions live in role_permissions, and the Roles screen wrote them there. The
  // script is the only thing that closes an existing grant.
  const script = await read("../server/scripts/auditReportsGrants.js");
  assert.match(script, /\{ module: "reports" \}/);
  assert.match(script, /\{ module: "accounting", action: "view" \}/);
  // One filter drives the report, the console labels and the DELETE, so they cannot
  // describe different sets — a revoke that is narrower than its own report is worse
  // than no revoke at all.
  assert.match(script, /const grantFilterSql = TARGET_GRANTS\.map/);
  assert.match(script, /WHERE \$\{grantFilterSql\}/);
  assert.match(script, /AND \(\$\{grantFilterSql\}\)/);
});
