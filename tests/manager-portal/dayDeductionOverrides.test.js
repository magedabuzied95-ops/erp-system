/*
 * Owner's ask (2026-10-14): the manager portal's الخصومات tab edits or removes one day's
 * attendance deduction (two days for an absence, half a day for lateness). The edit is stored per
 * day and the payroll engine prices that day with it, so the salary and the employee portal follow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { getPayrollPreview } from "../../server/services/salesCommissionService.js";

const DAILY = 6000 / 26;

const runPreview = async (overrides = []) => {
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employees e/.test(text) && /sales_commission_type/.test(text)) {
      return { rows: [{ id: 7, tenant_id: 1, full_name: "T", salary: 6000, working_days_per_month: 26, working_days_per_week: 7, sales_commission_type: "none" }] };
    }
    if (/FROM attendance_day_deduction_overrides/.test(text)) {
      return { rows: overrides.map((row, index) => ({ id: index + 1, note: "", updated_by_name: "Manager", ...row })) };
    }
    if (/FROM attendance_logs/.test(text) && /GROUP BY attendance_date/.test(text)) {
      // 2 October: checked in 44 minutes late, a half-day under the policy. Every other day absent.
      return {
        rows: [{
          attendance_date: "2026-10-02",
          attendance_records_count: 1,
          work_minutes: 480,
          late_minutes: 44,
          late_from_start_minutes: 44,
          early_leave_minutes: 0,
          first_check_in: null,
          last_check_out: null,
        }],
      };
    }
    return { rows: [] };
  };
  try {
    return (await getPayrollPreview({ tenantId: 1, employeeId: 7, filters: { month: "2026-10", startDate: "2026-10-01", endDate: "2026-10-04" } })).payroll;
  } finally {
    db.query = original;
  }
};

const day = (payroll, date, type) => payroll.day_deductions.find((row) => row.date === date && row.type === type);

test("without edits every day costs what the rule says", async () => {
  const payroll = await runPreview();
  assert.equal(day(payroll, "2026-10-01", "absence").penalty_days, 2);
  assert.equal(day(payroll, "2026-10-02", "late").penalty_days, 0.5);
  assert.equal(payroll.absence_deduction, Number((6 * DAILY).toFixed(2)));
  assert.equal(payroll.late_deduction, Number((0.5 * DAILY).toFixed(2)));
});

test("a waived absence costs nothing and a lowered one costs what the manager set", async () => {
  const payroll = await runPreview([
    { deduction_date: "2026-10-01", deduction_type: "absence", penalty_days: "0" },
    { deduction_date: "2026-10-03", deduction_type: "absence", penalty_days: "0.5", note: "ظرف" },
  ]);
  const waived = day(payroll, "2026-10-01", "absence");
  assert.equal(waived.penalty_days, 0);
  assert.equal(waived.amount, 0);
  assert.equal(waived.overridden, true);
  assert.equal(waived.rule_penalty_days, 2);
  assert.equal(day(payroll, "2026-10-03", "absence").override_note, "ظرف");
  assert.equal(day(payroll, "2026-10-04", "absence").overridden, undefined);
  // Still three absent days; only the money changes.
  assert.equal(payroll.absence_days, 3);
  assert.equal(payroll.absence_deduction, Number((2.5 * DAILY).toFixed(2)));
});

test("a waived late day drops out of the late deduction", async () => {
  const payroll = await runPreview([{ deduction_date: "2026-10-02", deduction_type: "late", penalty_days: "0" }]);
  const late = day(payroll, "2026-10-02", "late");
  assert.equal(late.penalty_days, 0);
  assert.equal(late.rule_penalty_days, 0.5);
  assert.equal(payroll.late_deduction, 0);
});

test("an override for the wrong type does not touch the day", async () => {
  const payroll = await runPreview([{ deduction_date: "2026-10-02", deduction_type: "absence", penalty_days: "0" }]);
  assert.equal(day(payroll, "2026-10-02", "late").penalty_days, 0.5);
});
