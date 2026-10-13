/*
 * Approving a leave request must write the vacation, or it never reaches the paid-leave balance
 * or payroll. pg returns DATE columns as a Date at UTC midnight, and stringifying that
 * ("Tue Oct 20 …") used to fail the date parse, so every approval silently wrote nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { reviewEmployeePortalRequest } from "../../server/services/employeePayrollPortalService.js";

test("an approved leave request with pg Date columns inserts the vacation for those days", async () => {
  const original = db.query;
  const inserts = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/UPDATE employee_portal_requests/.test(text) && /SET status = \$3/.test(text)) {
      return {
        rows: [{
          id: 41,
          tenant_id: 1,
          employee_id: 7,
          request_type: "vacation",
          status: "approved",
          request_date: new Date(Date.UTC(2026, 9, 20)),
          end_date: new Date(Date.UTC(2026, 9, 22)),
          created_at: new Date(Date.UTC(2026, 9, 14, 9)),
          message: "",
          admin_note: "",
        }],
      };
    }
    if (/hr_attendance_settings/.test(text) && /forbidden_leave_weekdays/.test(text) && /SELECT/.test(text)) {
      return { rows: [{ monthly_paid_leave_days: 3, forbidden_leave_weekdays: [] }] };
    }
    if (/INSERT INTO employee_vacations/.test(text)) {
      inserts.push(params);
      return { rows: [{ id: 99 }] };
    }
    return { rows: [] };
  };
  try {
    await reviewEmployeePortalRequest({ tenantId: 1, requestId: 41, status: "approved" });
  } finally {
    db.query = original;
  }
  assert.equal(inserts.length, 1, "the vacation must be written");
  assert.equal(inserts[0][2], "2026-10-20");
  assert.equal(inserts[0][3], "2026-10-22");
});
