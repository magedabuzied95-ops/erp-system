/*
 * The employee portal is about the month the employee is living in. It used to follow the last
 * approved payroll run, so all of October showed September's attendance and September's net
 * salary. A run is only used when it is THIS month's; otherwise the month is payroll's live preview.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { buildEmployeePayrollPortalPayload } from "../../server/services/employeePayrollPortalService.js";

const cairoMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const previousMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

const withRun = async (run, fn) => {
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employee_payroll_runs/.test(text) && /ORDER BY/.test(text) && run) return { rows: [run] };
    return { rows: [] };
  };
  try {
    return await fn();
  } finally {
    db.query = original;
  }
};

const employee = { id: 7, tenant_id: 1, full_name: "Test", salary: 6000, employee_code: "E7" };

test("last month's approved run no longer stands in for this month", async () => {
  const month = cairoMonth();
  const payload = await withRun(
    { id: 1, payroll_period: previousMonth(month), net_pay: 411.04, status: "approved", snapshot: { attended_days: 27 } },
    () => buildEmployeePayrollPortalPayload({ employee })
  );
  assert.equal(payload.current_payroll_period, month);
  assert.notEqual(payload.net_salary, 411.04, "last month's net must not be shown as this month's");
  assert.equal(payload.payroll_generated, false);
});

test("this month's approved run is shown as approved", async () => {
  const month = cairoMonth();
  const payload = await withRun(
    { id: 2, payroll_period: month, net_pay: 5200, status: "approved", snapshot: {} },
    () => buildEmployeePayrollPortalPayload({ employee })
  );
  assert.equal(payload.current_payroll_period, month);
  assert.equal(payload.net_salary, 5200);
  assert.equal(payload.payroll_generated, true);
});
