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
