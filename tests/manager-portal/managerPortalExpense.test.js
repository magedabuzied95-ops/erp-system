import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const posSource = fs.readFileSync(new URL("../../server/controllers/posController.js", import.meta.url), "utf8");
const moduleSource = fs.readFileSync(new URL("../../server/modules/managerPortal/managerPortalExpense.js", import.meta.url), "utf8");
const routesSource = fs.readFileSync(new URL("../../server/routes/managerPortal.js", import.meta.url), "utf8");

const core = posSource.slice(posSource.indexOf("export const bookQuickPosExpense"), posSource.indexOf("export const createQuickPosExpense"));

test("the till and the manager portal book an expense through the same core", () => {
  assert.ok(core.length > 0);
  assert.match(posSource, /export const createQuickPosExpense = async \(req, res\) => \{[\s\S]*?await bookQuickPosExpense\(\{/);
  assert.match(moduleSource, /bookQuickPosExpense\(\{/);
  assert.match(routesSource, /router\.post\("\/:token\/expenses", verifyManagerPortalToken,/);
});

test("a manager may use another cashier's drawer, but only inside their own branch", () => {
  assert.match(core, /if \(manager\) \{\s*if \(manager\.branchId && String\(shift\.branch_id\) !== String\(manager\.branchId\)\) \{[\s\S]*?reply\(403/);
  assert.match(core, /\} else if \(String\(shift\.opened_by\) !== String\(actorUserId \|\| ""\)\) \{/);
  assert.match(moduleSource, /manager: \{ branchId: scopeBranchId\(manager\)/);
});

test("the manager's employees id never lands in a users column", () => {
  assert.match(moduleSource, /actorUserId: numberOrNull\(manager\.user_id\)/);
  assert.doesNotMatch(moduleSource, /actorUserId: numberOrNull\(manager\.id\)/);
});

test("a manager expense never takes the offline replay path", () => {
  assert.match(core, /const offlineOrigin = !manager && Boolean\(/);
});
