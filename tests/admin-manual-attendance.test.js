import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const routeSource = fs.readFileSync(new URL("../server/routes/adminAttendance.js", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../src/modules/attendance/attendanceApi.js", import.meta.url), "utf8");
const uiSource = fs.readFileSync(new URL("../src/modules/attendance/components/AttendanceCenter.jsx", import.meta.url), "utf8");

test("manual attendance route is tenant scoped, audited and does not duplicate a day", () => {
  assert.match(routeSource, /router\.post\("\/manual-entry"/);
  assert.match(routeSource, /WHERE tenant_id = \$1 AND employee_id = \$2 AND attendance_date = \$3::date/);
  assert.match(routeSource, /attendance_source = 'admin_manual'/);
  assert.match(routeSource, /attendance_manual_upsert/);
  assert.match(routeSource, /reason.*required/s);
});

test("a real attendance log overrides generated weekly or monthly off status", () => {
  assert.match(routeSource, /attendance_source = 'admin_manual'/);
  const controllerSource = fs.readFileSync(new URL("../server/controllers/attendanceController.js", import.meta.url), "utf8");
  assert.match(controllerSource, /if \(log\) \{\s*if \(lateMinutes > 0\) status = "late"/s);
  assert.match(controllerSource, /\} else if \(leave\) status = "on_leave"/);
});

test("daily attendance defaults to the current month and groups results with filtered totals", () => {
  assert.match(uiSource, /startDate: monthStartValue\(\)/);
  assert.match(uiSource, /endDate: todayValue\(\)/);
  assert.match(uiSource, /groupedRows/);
  assert.match(uiSource, /إجماليات النتائج الحالية/);
  assert.match(uiSource, /totals\.payrollImpact/);
});

test("manual attendance stays visible and all attendance dates are day-first", () => {
  assert.match(uiSource, /setActiveTab\("daily"\)/);
  assert.match(uiSource, /employeeId: String\(manualForm\.employeeId\)/);
  assert.match(uiSource, /startDate: !prev\.startDate \|\| manualForm\.attendanceDate < prev\.startDate/);
  assert.match(uiSource, /function DayFirstDateInput/);
  assert.match(uiSource, /placeholder="DD\/MM\/YYYY"/);
  assert.match(uiSource, /formatDayFirstDate\(date\)/);
});

test("attendance center exposes the correction form through the admin API", () => {
  assert.match(apiSource, /saveManualAttendance/);
  assert.match(apiSource, /\/admin\/attendance\/manual-entry/);
  assert.match(uiSource, /إضافة حضور \/ انصراف/);
  assert.match(uiSource, /handleManualAttendanceSubmit/);
  assert.match(uiSource, /check_out_time/);
  assert.match(uiSource, /check_out_date/);
  assert.match(routeSource, /CHECK_OUT_BEFORE_CHECK_IN/);
  assert.doesNotMatch(uiSource, /disabled=\{!manualForm\.checkOutTime\}/);
});
