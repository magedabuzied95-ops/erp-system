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

const withDb = async ({ attended = false, onLeave = false, undoRows = 1 } = {}, run) => {
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
