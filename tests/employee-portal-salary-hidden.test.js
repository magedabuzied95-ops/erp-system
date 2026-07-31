import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/employees/pages/EmployeePayrollPortal.jsx", import.meta.url),
  "utf8"
);

test("employee salary page is temporarily hidden without deleting payroll logic", () => {
  assert.match(source, /const EMPLOYEE_PORTAL_SALARY_ENABLED = false/);
  assert.match(source, /EMPLOYEE_PORTAL_SALARY_ENABLED \? \[\["salary"/);
  assert.match(source, /EMPLOYEE_PORTAL_SALARY_ENABLED && activeTab === "salary"/);
  assert.match(source, /allowedTabs\.includes\(tab\) \? tab : "home"/);
  assert.match(source, /payrollSummary/);
});
