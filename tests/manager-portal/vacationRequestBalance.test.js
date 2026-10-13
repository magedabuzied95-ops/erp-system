/*
 * A leave request in the manager portal shows what approving it costs, counted the way payroll
 * counts it: the month's first monthly_paid_leave_days approved leave days are paid, every day
 * after that is a day's pay (salary / working_days_per_month).
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { attachVacationBalances } from "../../server/services/managerPortalService.js";

const mockDb = ({ allowance = 3, usedDays = [], salary = 2600, failUsed = false } = {}) => {
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/hr_attendance_settings/.test(text)) return { rows: [{ monthly_paid_leave_days: allowance }] };
    if (/FROM employee_vacations v/.test(text)) {
      if (failUsed) throw new Error("boom");
      return { rows: usedDays.map((leave_day) => ({ employee_id: "7", leave_day })) };
    }
    if (/FROM employees WHERE/.test(text)) return { rows: [{ employee_id: "7", salary, working_days_per_month: 26 }] };
    return { rows: [] };
  };
  return () => { db.query = original; };
};

const request = (from, to = from) => ({ id: 1, employee_id: 7, request_date: from, end_date: to });

test("days inside the monthly balance are not deducted", async () => {
  const restore = mockDb({ usedDays: ["2026-10-02"] });
  try {
    const [row] = await attachVacationBalances({ tenantId: 1, requests: [request("2026-10-20", "2026-10-21")] });
    assert.equal(row.paid_leave_left, 2);
    assert.equal(row.days_from_balance, 2);
    assert.equal(row.days_deducted, 0);
    assert.equal(row.deduction_estimate, 0);
  } finally {
    restore();
  }
});

test("days beyond the balance cost a day's pay each", async () => {
  const restore = mockDb({ usedDays: ["2026-10-02", "2026-10-05"] });
  try {
    const [row] = await attachVacationBalances({ tenantId: 1, requests: [request("2026-10-20", "2026-10-22")] });
    assert.equal(row.paid_leave_left, 1);
    assert.equal(row.days_from_balance, 1);
    assert.equal(row.days_deducted, 2);
    assert.equal(row.deduction_estimate, 200); // 2 × 2600 / 26
  } finally {
    restore();
  }
});

test("each month has its own balance", async () => {
  const restore = mockDb({ usedDays: ["2026-10-01", "2026-10-02", "2026-10-03"] });
  try {
    const [row] = await attachVacationBalances({ tenantId: 1, requests: [request("2026-10-31", "2026-11-01")] });
    assert.equal(row.days_deducted, 1, "31 Oct is past October's 3");
    assert.equal(row.days_from_balance, 1, "1 Nov starts November's balance");
  } finally {
    restore();
  }
});

test("a day already approved is not counted twice", async () => {
  const restore = mockDb({ usedDays: ["2026-10-20"] });
  try {
    const [row] = await attachVacationBalances({ tenantId: 1, requests: [request("2026-10-20")] });
    assert.equal(row.days_from_balance, 0);
    assert.equal(row.days_deducted, 0);
  } finally {
    restore();
  }
});

test("if the used days cannot be read, no balance is shown rather than a full one", async () => {
  const restore = mockDb({ failUsed: true });
  try {
    const [row] = await attachVacationBalances({ tenantId: 1, requests: [request("2026-10-20")] });
    assert.equal(row.paid_leave_total, undefined);
    assert.equal(row.days_deducted, undefined);
  } finally {
    restore();
  }
});
