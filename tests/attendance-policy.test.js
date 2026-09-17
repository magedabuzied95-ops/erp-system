import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  DEFAULT_ATTENDANCE_POLICY,
  countedLatePermissions,
  latePermissionCoverMinutes,
  normalizeAttendancePolicy,
  resolveLateDay,
} from "../server/utils/attendancePolicy.js";
import { buildAttendanceRules } from "../src/modules/employees/lib/attendanceRules.js";

const policy = normalizeAttendancePolicy();

test("the owner's defaults: 30 min grace, half day, 2 permissions of 2 hours, absence 2 days", () => {
  assert.equal(policy.late_threshold_minutes, 30);
  assert.equal(policy.late_penalty_days, 0.5);
  assert.equal(policy.monthly_late_permissions, 2);
  assert.equal(policy.late_permission_max_minutes, 120);
  assert.equal(policy.absence_penalty_days, 2);
  assert.equal(policy.monthly_paid_leave_days, 3);
  assert.deepEqual(DEFAULT_ATTENDANCE_POLICY.forbidden_leave_weekdays, [4, 5, 6]);
});

test("late up to the grace costs nothing, one minute more costs half a day", () => {
  assert.equal(resolveLateDay({ lateMinutes: 0, policy }).penalty_days, 0);
  assert.equal(resolveLateDay({ lateMinutes: 30, policy }).penalty_days, 0);
  assert.equal(resolveLateDay({ lateMinutes: 31, policy }).penalty_days, 0.5);
  assert.equal(resolveLateDay({ lateMinutes: 240, policy }).penalty_days, 0.5);
});

test("a permission covers up to two hours; lateness beyond that is judged by the grace again", () => {
  const cover = latePermissionCoverMinutes(0, policy);
  assert.equal(cover, 120);
  assert.equal(latePermissionCoverMinutes(45, policy), 45);
  assert.equal(latePermissionCoverMinutes(500, policy), 120);
  assert.equal(resolveLateDay({ lateMinutes: 120, permissionMinutes: cover, policy }).penalty_days, 0);
  assert.equal(resolveLateDay({ lateMinutes: 150, permissionMinutes: cover, policy }).penalty_days, 0);
  assert.equal(resolveLateDay({ lateMinutes: 151, permissionMinutes: cover, policy }).penalty_days, 0.5);
  assert.equal(resolveLateDay({ lateMinutes: 100, permissionMinutes: 45, policy }).penalty_days, 0.5);
});

test("only the first two approved permissions of the month count", () => {
  const counted = countedLatePermissions([
    { date: "2026-09-02", minutes: 0 },
    { date: "2026-09-02", minutes: 30 },
    { date: "2026-09-10", minutes: 60 },
    { date: "2026-09-20", minutes: 0 },
  ], policy);
  assert.deepEqual([...counted.entries()], [["2026-09-02", 120], ["2026-09-10", 60]]);
});

test("settings rows are clamped and fall back to the defaults", () => {
  const custom = normalizeAttendancePolicy({ late_threshold_minutes: "15", absence_penalty_days: "1", monthly_late_permissions: -3, late_penalty_days: null });
  assert.equal(custom.late_threshold_minutes, 15);
  assert.equal(custom.absence_penalty_days, 1);
  assert.equal(custom.monthly_late_permissions, 0);
  assert.equal(custom.late_penalty_days, 0.5);
});

test("the portal panel states the same rules and the balances", () => {
  const { rights, duties } = buildAttendanceRules({
    rules: policy,
    balances: { late_permissions_left: 1, late_permissions_total: 2, paid_leave_left: 3, paid_leave_total: 3 },
  }, true);
  const all = [...rights, ...duties].map((item) => `${item.text} ${item.balance || ""}`).join("\n");
  assert.match(all, /3 أيام إجازة مدفوعة/);
  assert.match(all, /2 إذن تأخير كل شهر، والإذن الواحد يغطي لحد ساعتين/);
  assert.match(all, /باقيلك 1 من 2/);
  assert.match(all, /التأخير أكتر من نص ساعة يتخصم عليه نص يوم/);
  assert.match(all, /يتخصم عليه يومين/);
  assert.match(all, /مفيش إجازات أيام الخميس والجمعة والسبت/);
  assert.match(all, /بيفتح الفرع الساعة 12 ممنوع ياخد إذن تأخير/);
});

test("payroll prices lateness and absence through the policy", () => {
  const source = fs.readFileSync(new URL("../server/services/salesCommissionService.js", import.meta.url), "utf8");
  assert.match(source, /const lateDeduction = latePenaltyDays \* dailyRate;/);
  assert.match(source, /const absencePenaltyDays = absenceDays \* policy\.absence_penalty_days;/);
  assert.match(source, /countedLatePermissions\(approvedLatePermissions, policy\)/);
  assert.match(source, /ss\.shift_type = 'opening'/);
});

test("the portal refuses a third permission and any permission on the opener's day", () => {
  const source = fs.readFileSync(new URL("../server/services/employeePayrollPortalService.js", import.meta.url), "utf8");
  assert.match(source, /LATE_PERMISSION_QUOTA_USED/);
  assert.match(source, /LATE_PERMISSION_OPENER/);
});
