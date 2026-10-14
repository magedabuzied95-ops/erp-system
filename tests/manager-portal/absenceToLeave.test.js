/*
 * Owner's ask (2026-10-14): a small icon on an absent day in the الخصومات tab turns it into a leave
 * day from the employee's balance. It writes the same approved employee_vacations row a leave
 * approval writes (payroll then drops the absence and prices the day as leave), tagged so it can be
 * undone from the same tab.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import {
  ABSENCE_TO_LEAVE_TAG,
  convertManagerPortalAbsenceToLeave,
  undoManagerPortalAbsenceToLeave,
} from "../../server/services/managerPortalService.js";

const manager = { id: 37, tenant_id: 1, full_name: "مدير", branch_scope: "all" };

const withDb = async ({ attended = false, onLeave = false, undoRows = 1, usedDays = [] } = {}, run) => {
  const calls = [];
  const original = { query: db.query, connect: db.connect };
  // The attendance schema bootstrap runs on a pooled client; one branch keeps its single-branch check happy.
  db.connect = async () => ({ query: async () => ({ rows: [{ id: 1 }], rowCount: 1 }), release() {} });
  db.query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ text, params });
    if (/FROM employees e/.test(text) && /WHERE e.id = \$1/.test(text)) return { rows: [{ id: 7, tenant_id: 1, full_name: "T", salary: 6500 }] };
    if (/to_regclass\('public.employee_payroll_runs'\)/.test(text)) return { rows: [{ regclass: null }] };
    if (/FROM attendance_logs/.test(text)) return { rows: attended ? [{ "?column?": 1 }] : [] };
    // attachVacationBalances: the month's allowance and the leave days already approved.
    if (/FROM hr_attendance_settings/.test(text)) return { rows: [{ monthly_paid_leave_days: 3 }] };
    if (/generate_series/.test(text) && /AS leave_day/.test(text)) return { rows: usedDays.map((day) => ({ employee_id: "7", leave_day: day })) };
    if (/working_days_per_month FROM employees/.test(text)) return { rows: [{ employee_id: "7", salary: 5000, working_days_per_month: 26 }] };
    if (/SELECT 1 FROM employee_vacations/.test(text)) return { rows: onLeave ? [{ "?column?": 1 }] : [] };
    if (/INSERT INTO employee_vacations/.test(text)) return { rows: [{ id: 501, vacation_date: params[2] }], rowCount: 1 };
    if (/UPDATE employee_vacations/.test(text)) return { rows: Array.from({ length: undoRows }, (_, i) => ({ id: i + 1 })), rowCount: undoRows };
    return { rows: [], rowCount: 0 };
  };
  try {
    return await run(calls);
  } finally {
    db.query = original.query;
    db.connect = original.connect;
  }
};

test("an absent day becomes an approved, tagged annual leave, and its deduction edit is dropped", async () => {
  await withDb({}, async (calls) => {
    const result = await convertManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-08" });
    assert.equal(result.vacation.id, 501);
    const insert = calls.find((call) => /INSERT INTO employee_vacations/.test(call.text));
    assert.match(insert.text, /'annual'/);
    assert.match(insert.text, /'approved'/);
    assert.equal(insert.params[2], "2026-10-08");
    assert.ok(insert.params[3].startsWith(ABSENCE_TO_LEAVE_TAG));
    assert.ok(calls.some((call) => /DELETE FROM attendance_day_deduction_overrides/.test(call.text) && call.params[2] === "2026-10-08"));
  });
});

// Owner (2026-10-14): four absences became leave with a balance of three and nothing said so.
test("past the balance the server refuses until the manager confirms the day is deducted", async () => {
  const used = ["2026-10-01", "2026-10-03", "2026-10-14"];
  await withDb({ usedDays: used }, async (calls) => {
    await assert.rejects(
      convertManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-04" }),
      (error) => error.status === 409 && error.code === "leave_balance_exhausted" && error.details.paid_leave_used === 3 && error.details.paid_leave_total === 3
    );
    assert.ok(!calls.some((call) => /INSERT INTO employee_vacations/.test(call.text)));
  });
  await withDb({ usedDays: used }, async (calls) => {
    const result = await convertManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-04", confirmOverBalance: true });
    assert.equal(result.over_balance, true);
    assert.ok(calls.some((call) => /INSERT INTO employee_vacations/.test(call.text)));
  });
  await withDb({ usedDays: used.slice(0, 2) }, async () => {
    const result = await convertManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-04" });
    assert.equal(result.over_balance, false);
  });
});

test("payroll prices each leave day in date order: the balance first, a day's pay after it", async () => {
  const { getPayrollPreview } = await import("../../server/services/salesCommissionService.js");
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employees e/.test(text) && /sales_commission_type/.test(text)) {
      return { rows: [{ id: 7, tenant_id: 1, full_name: "T", salary: 5200, working_days_per_month: 26, working_days_per_week: 7, sales_commission_type: "none" }] };
    }
    if (/WITH leave_days AS/.test(text)) {
      return { rows: ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-05"].map((day) => ({ leave_day: day, leave_kind: "annual" })) };
    }
    return { rows: [] };
  };
  let payroll;
  try {
    payroll = (await getPayrollPreview({ tenantId: 1, employeeId: 7, filters: { month: "2026-10", startDate: "2026-10-01", endDate: "2026-10-06" } })).payroll;
  } finally {
    db.query = original;
  }
  assert.deepEqual(payroll.leave_day_list.map((day) => [day.date, day.paid]), [
    ["2026-10-01", true], ["2026-10-03", true], ["2026-10-04", true], ["2026-10-05", false],
  ]);
  assert.equal(payroll.leave_day_list[3].amount, 200);
  assert.equal(payroll.leave_deduction, 200);
});

test("a day with attendance is not an absence and is refused", async () => {
  await withDb({ attended: true }, async (calls) => {
    await assert.rejects(convertManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-08" }), (error) => error.status === 409);
    assert.ok(!calls.some((call) => /INSERT INTO employee_vacations/.test(call.text)));
  });
});

test("a day that is already leave is refused", async () => {
  await withDb({ onLeave: true }, async () => {
    await assert.rejects(convertManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-08" }), (error) => error.status === 409);
  });
});

test("undo cancels only the leave this tab made", async () => {
  await withDb({}, async (calls) => {
    await undoManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-08" });
    const update = calls.find((call) => /UPDATE employee_vacations/.test(call.text));
    assert.match(update.text, /status = 'cancelled'/);
    assert.equal(update.params[3], `${ABSENCE_TO_LEAVE_TAG}%`);
  });
  await withDb({ undoRows: 0 }, async () => {
    await assert.rejects(undoManagerPortalAbsenceToLeave({ manager, employeeId: 7, date: "2026-10-08" }), (error) => error.status === 404);
  });
});
