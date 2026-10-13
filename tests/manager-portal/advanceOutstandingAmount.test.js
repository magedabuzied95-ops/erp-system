/*
 * The employee portal's السلف card is what the employee still owes. Payroll sets remaining_amount
 * to 0 once an advance is fully deducted; reading that as `remaining_amount || amount` showed every
 * deducted advance at its full value again.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { advanceOutstandingAmount } from "../../server/services/employeePayrollPortalService.js";

test("a fully deducted advance owes nothing (pg returns numerics as strings)", () => {
  assert.equal(advanceOutstandingAmount({ amount: "3000.00", deducted_amount: "3000.00", remaining_amount: "0.00", deduction_status: "deducted" }), 0);
  assert.equal(advanceOutstandingAmount({ amount: 3000, deducted_amount: 3000, remaining_amount: 0 }), 0);
});

test("a partly deducted advance owes the remainder", () => {
  assert.equal(advanceOutstandingAmount({ amount: "3000.00", deducted_amount: "1000.00", remaining_amount: "2000.00" }), 2000);
});

test("a cancelled advance owes nothing", () => {
  assert.equal(advanceOutstandingAmount({ amount: 500, remaining_amount: 500, status: "cancelled" }), 0);
  assert.equal(advanceOutstandingAmount({ amount: 500, remaining_amount: 500, deduction_status: "cancelled" }), 0);
});

test("a row older than remaining_amount falls back to amount minus deducted", () => {
  assert.equal(advanceOutstandingAmount({ amount: 800, deducted_amount: 300, remaining_amount: null }), 500);
});

test("the السلف sheet lists this month's advances and earlier ones still owed, not settled old ones", async () => {
  const { default: db } = await import("../../server/database/db.js");
  const { buildEmployeePayrollPortalPayload } = await import("../../server/services/employeePayrollPortalService.js");
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employee_advances/.test(text) && /taken_on/.test(text)) {
      return {
        rows: [
          { id: 1, amount: "500", deducted_amount: "0", remaining_amount: "500", status: "active", taken_on: `${month}-03` },
          { id: 2, amount: "3000", deducted_amount: "3000", remaining_amount: "0", status: "deducted", taken_on: "2020-01-05" },
          { id: 3, amount: "1000", deducted_amount: "400", remaining_amount: "600", status: "partial", taken_on: "2020-02-05" },
          { id: 4, amount: "200", remaining_amount: "200", status: "cancelled", taken_on: `${month}-04` },
        ],
      };
    }
    return { rows: [] };
  };
  let payload;
  try {
    payload = await buildEmployeePayrollPortalPayload({ employee: { id: 7, tenant_id: 1, full_name: "T", salary: 0 } });
  } finally {
    db.query = original;
  }
  const ids = payload.wallet_summary.advances_breakdown.map((row) => row.id).sort();
  assert.deepEqual(ids, [1, 3], "this month's + earlier still owed; settled and cancelled left out");
  assert.equal(payload.wallet_summary.total_advances, 1100);
});
