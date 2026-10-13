/*
 * Approving a salary used to take every outstanding advance at once. The owner wants
 * to choose: take part of it from this month's salary and carry the rest to the next
 * month. planAdvanceDeductions decides how much of each advance one payroll takes;
 * the settlement then writes exactly that and moves what is left to the next month.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planAdvanceDeductions } from "../../server/utils/advanceDeductionPlan.js";

// Oldest first, which is the order the payroll query returns them in.
const rows = [
  { id: 95, outstanding_amount: 1000 },
  { id: 100, outstanding_amount: 500 },
];

test("no requested amount takes everything, as approval always did", () => {
  const plan = planAdvanceDeductions(rows);
  assert.equal(plan.total, 1500);
  assert.equal(plan.outstanding, 1500);
  assert.equal(plan.carried, 0);
  assert.deepEqual(plan.rows.map((row) => [row.id, row.payroll_deduction_amount, row.carried_amount]), [[95, 1000, 0], [100, 500, 0]]);
});

test("an empty input is the same as no request", () => {
  assert.equal(planAdvanceDeductions(rows, "").total, 1500);
  assert.equal(planAdvanceDeductions(rows, "  ").total, 1500);
  assert.equal(planAdvanceDeductions(rows, null).total, 1500);
});

test("a partial amount pays the oldest advance first and carries the rest", () => {
  const plan = planAdvanceDeductions(rows, 1200);
  assert.equal(plan.total, 1200);
  assert.equal(plan.carried, 300);
  assert.deepEqual(plan.rows.map((row) => [row.id, row.payroll_deduction_amount, row.carried_amount]), [[95, 1000, 0], [100, 200, 300]]);
});

test("an amount smaller than the oldest advance splits that one advance", () => {
  const plan = planAdvanceDeductions(rows, 400);
  assert.deepEqual(plan.rows.map((row) => [row.id, row.payroll_deduction_amount, row.carried_amount]), [[95, 400, 600], [100, 0, 500]]);
});

test("zero carries every advance to next month", () => {
  const plan = planAdvanceDeductions(rows, 0);
  assert.equal(plan.total, 0);
  assert.equal(plan.carried, 1500);
  assert.ok(plan.rows.every((row) => row.payroll_deduction_amount === 0));
});

test("more than is due is capped, a negative or junk amount takes nothing", () => {
  assert.equal(planAdvanceDeductions(rows, 9999).total, 1500);
  assert.equal(planAdvanceDeductions(rows, -50).total, 0);
  assert.equal(planAdvanceDeductions(rows, "abc").total, 0);
});

test("piastres do not drift", () => {
  const plan = planAdvanceDeductions([{ id: 1, outstanding_amount: 0.1 }, { id: 2, outstanding_amount: 0.2 }], 0.3);
  assert.equal(plan.total, 0.3);
  assert.deepEqual(plan.rows.map((row) => row.carried_amount), [0, 0]);
});

test("no advances, nothing to take", () => {
  const plan = planAdvanceDeductions([], 500);
  assert.equal(plan.total, 0);
  assert.equal(plan.outstanding, 0);
  assert.deepEqual(plan.rows, []);
});
