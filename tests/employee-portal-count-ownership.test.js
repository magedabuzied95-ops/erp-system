/*
 * A stock count belongs to the employee who started it.
 *
 * What these guard: the portal lists and opens only its own employee's counts
 * (it used to scope by BRANCH alone, so the screen auto-opened whichever count
 * the branch had open — a colleague's — and two people counted into one
 * sheet); the ownership is recorded in a column of its own, because the id the
 * portal was writing into `created_by` is an EMPLOYEE id in a column that
 * references users, i.e. a different person; and counts started before that
 * column existed are still found by their owner.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const service = read("../server/services/inventoryCountService.js");
const routes = read("../server/routes/employeePortal.js");
const page = read("../src/modules/employees/pages/EmployeePortalInventory.jsx");
const approvals = read("../src/modules/managerPortal/pages/InventoryApprovals.jsx");

test("the count records WHICH EMPLOYEE started it, in its own column", () => {
  assert.match(service, /ensureColumn\(client, "inventory_count_sessions", "created_by_employee_id BIGINT NULL"\)/);
  assert.match(service, /idx_inventory_count_sessions_created_by_employee_id/);
  assert.match(service, /created_by_employee_id,\s*\n\s*created_at,/, "the create has to persist it");
  assert.match(service, /normalizeNullableId\(data\.createdByEmployeeId \?\? data\.created_by_employee_id\)/);
});

test("the portal never writes an employee id into a users column again", () => {
  // created_by references users(id). The portal was passing employee.id, which
  // names a different person there — or fails the foreign key outright.
  assert.doesNotMatch(
    routes,
    /createdBy: employee\.id/,
    "an employee id in created_by put a stranger's name on the count"
  );
  assert.match(routes, /createdBy: null,\s*\n\s*createdByEmployeeId: employee\.id \|\| null,/);
});

test("a phone lists its own counts, never the branch's", () => {
  assert.match(routes, /createdByEmployeeId: employee\.id \?\? null,/, "the sessions list has to be scoped to the employee");
  assert.match(service, /const ownedByEmployeeClause = \(alias, placeholder\)/);
  // Both arms: the new column, and the legacy rows that carry the employee id
  // in created_by. Dropping the second arm hides every count in flight today.
  assert.match(service, /\$\{alias\}\.created_by_employee_id = \$\{placeholder\}::bigint/);
  assert.match(service, /\$\{alias\}\.created_by_employee_id IS NULL AND \$\{alias\}\.created_by = \$\{placeholder\}::bigint/);
  // The manager portal and the ERP pass nothing and keep the whole branch.
  assert.match(service, /if \(createdByEmployeeId !== null && createdByEmployeeId !== undefined && createdByEmployeeId !== ""\) \{/);
});

test("opening a colleague's count by id is a 404, not a shared sheet", () => {
  assert.match(routes, /const ownerEmployeeId = inventoryCountSessionOwnerEmployeeId\(result\.session\);/);
  assert.match(
    routes,
    /if \(ownerEmployeeId !== null && ownerEmployeeId !== undefined && normalizeId\(ownerEmployeeId\) !== normalizeId\(employee\.id\)\) \{/,
    "branch alone was not a scope"
  );
  // A session nobody owns (created in the ERP) stays reachable.
  assert.match(service, /export const inventoryCountSessionOwnerEmployeeId = \(session = \{\}\) => \{/);
});

test("one count's rows can never be read as another's", () => {
  // `WHERE a = $1 OR b = $1 AND tenant_ok` binds AND first, so the tenant check
  // guarded only the second arm.
  assert.match(service, /WHERE \(i\.inventory_count_session_id = \$1 OR i\.inventory_count_id = \$1\)/);
  assert.doesNotMatch(service, /WHERE i\.inventory_count_session_id = \$1\s*\n\s*OR i\.inventory_count_id = \$1\s*\n\s*\$\{tenantClause\}/);
});

test("the manager sees who actually ran the count", () => {
  assert.match(service, /ce\.full_name AS created_by_employee_name/);
  assert.match(service, /LEFT JOIN employees ce ON ce\.id = s\.created_by_employee_id/);
  assert.match(approvals, /session\.created_by_employee_name \|\| session\.created_by_name/);
  assert.match(approvals, /selectedSession\.created_by_employee_name \|\| selectedSession\.created_by_name/);
});

test("the screen no longer promises the branch's counts", () => {
  assert.match(page, /employeePortal\.stockCount\.scopeHint/);
  const ar = JSON.parse(read("../src/locales/ar/employeePortal.json"));
  const en = JSON.parse(read("../src/locales/en/employeePortal.json"));
  assert.doesNotMatch(ar.stockCount.scopeHint, /فرعك/, "the list is no longer the branch's");
  assert.doesNotMatch(en.stockCount.scopeHint, /branch/i);
});
