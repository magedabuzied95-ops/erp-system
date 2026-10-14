/*
 * The employee portal's الخصومات / الإضافات cards list every item behind the month's salary,
 * built only from payroll's own figures, so: net = base + additions.total - deductions.total.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildEmployeeMoneyBreakdown } from "../../server/services/employeePayrollPortalService.js";

// A live preview (getPayrollPreview().payroll is flat): day 260/day, policy prices lateness per day.
const preview = {
  base_salary: 6760,
  commissions: 300,
  bonuses: 250,
  approved_overtime_pay: 97.5,
  approved_overtime_hours: 3,
  advance_deductions: 500,
  penalties_total: 100,
  manual_deductions: 0,
  absence_deduction: 520,
  late_deduction: 130,
  missing_hours_deduction: 0,
  early_leave_deduction: 0,
  leave_deduction: 0,
  deductions: 1250,
  net_pay: 6760 + 300 + 250 + 97.5 - 1250,
  late_threshold_minutes: 30,
  day_deductions: [
    { date: "2026-10-05", type: "late", late_minutes: 148, covered_minutes: 120, penalty_days: 0, amount: 0 },
    { date: "2026-10-07", type: "late", late_minutes: 267, covered_minutes: 120, penalty_days: 0.5, amount: 130 },
    { date: "2026-10-08", type: "absence", penalty_days: 2, amount: 520 },
  ],
  penalty_rows: [{ id: 9, amount: 100, penalty_date: "2026-10-10", reason: "كسر شماعة" }],
  bonus_rows: [{ id: 4, amount: 200, bonus_date: "2026-10-03", reason: "أفضل بائع" }],
};

test("a live preview lists every day and every row, and the totals reconcile with net pay", () => {
  const breakdown = buildEmployeeMoneyBreakdown({ figures: preview, facts: preview, snapshot: preview });
  const kinds = breakdown.deductions.items.map((item) => `${item.kind}:${item.date || ""}:${item.amount}`);
  assert.deepEqual(kinds, [
    "late:2026-10-05:0",
    "late:2026-10-07:130",
    "absence:2026-10-08:520",
    "penalty:2026-10-10:100",
    "advances::500",
  ]);
  assert.equal(breakdown.deductions.items.reduce((sum, item) => sum + item.amount, 0), breakdown.deductions.total);
  assert.deepEqual(breakdown.additions.items.map((item) => `${item.kind}:${item.amount}`), ["commission:300", "bonus:200", "bonus:50", "overtime:97.5"]);
  assert.equal(preview.base_salary + breakdown.additions.total - breakdown.deductions.total, preview.net_pay);
});

test("a run approved before the day list existed shows its totals instead", () => {
  const run = { commissions: 0, bonuses: 0, advance_deductions: 0, penalties_total: 0, manual_deductions: 0, total_deductions: 780 };
  const snapshot = { attendance_deductions: { absence_deduction: 520, absence_days: 1, late_deduction: 260 } };
  const breakdown = buildEmployeeMoneyBreakdown({ figures: run, facts: snapshot.attendance_deductions, snapshot });
  assert.deepEqual(breakdown.deductions.items.map((item) => item.kind), ["absence_total", "late_total"]);
  assert.equal(breakdown.deductions.total, 780);
});

test("no payroll figures, no breakdown (the card shows its fallback, not zeros pretending to be real)", () => {
  assert.equal(buildEmployeeMoneyBreakdown({ figures: null }), null);
});
