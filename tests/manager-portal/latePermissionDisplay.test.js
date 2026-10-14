/*
 * The late time both portals show is what payroll charges: an approved late permission forgives up
 * to late_permission_max_minutes (2 hours) on its day, and only the month's first
 * monthly_late_permissions (2) count. Adham, Oct 2026: 5th late 2h28 with a permission → 28 min;
 * 7th late 4h27 with a permission → 2h27.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { lateAfterPermission, loadLatePermissionCoverForMonth, normalizeAttendancePolicy } from "../../server/utils/attendancePolicy.js";

const policy = normalizeAttendancePolicy({ late_permission_max_minutes: 120, monthly_late_permissions: 2 });

const fakeDb = (rows) => ({
  query: async (sql) => {
    if (/employee_portal_requests/.test(String(sql))) return { rows };
    return { rows: [] };
  },
});

test("a permission forgives up to its cap; the rest is still late", () => {
  assert.deepEqual(lateAfterPermission(148, 120), { late_minutes: 28, late_minutes_raw: 148, late_permission_minutes: 120, late_covered_minutes: 120 });
  assert.equal(lateAfterPermission(267, 120).late_minutes, 147);
  assert.equal(lateAfterPermission(45, 120).late_minutes, 0, "lateness under the cap is fully forgiven");
});

test("no permission leaves the lateness untouched", () => {
  assert.deepEqual(lateAfterPermission(38, null), { late_minutes: 38, late_minutes_raw: 38, late_permission_minutes: null, late_covered_minutes: 0 });
});

test("the month's cover map: blank minutes = the cap, and only the first two count", async () => {
  const db = fakeDb([
    { request_date: new Date(Date.UTC(2026, 9, 5)), allowed_minutes: "0" },
    { request_date: new Date(Date.UTC(2026, 9, 7)), allowed_minutes: "120" },
    { request_date: new Date(Date.UTC(2026, 9, 9)), allowed_minutes: "60" },
  ]);
  const cover = await loadLatePermissionCoverForMonth(db, { tenantId: 1, employeeId: 7, month: "2026-10", policy });
  assert.equal(cover.get("2026-10-05"), 120);
  assert.equal(cover.get("2026-10-07"), 120);
  assert.equal(cover.has("2026-10-09"), false, "a third approved permission is over the monthly quota");
});
