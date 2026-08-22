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
