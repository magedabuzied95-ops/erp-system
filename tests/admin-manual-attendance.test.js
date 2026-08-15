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
  assert.match(routeSource, /calculateAttendanceMetrics/);
  assert.match(routeSource, /overtime_minutes = \$11/);
  assert.match(routeSource, /shift_resolution_status = \$15/);
  assert.match(routeSource, /reason.*required/s);
});

test("a correction rewrites only the row it locked and keeps one reason line", () => {
  // The update used to match every row for the employee and date, so an
  // employee with a row in a second branch had both rewritten at once.
  assert.match(routeSource, /UPDATE attendance_logs[\s\S]*WHERE tenant_id = \$1 AND id = \$2/);
  assert.doesNotMatch(routeSource, /notes = CASE WHEN COALESCE\(notes, ''\) = '' THEN \$10 ELSE notes \|\| E'\\n' \|\| \$10 END/);
  assert.match(routeSource, /const mergedNotes/);
  assert.match(routeSource, /!line\.startsWith\("Admin attendance correction:"\)/);
});

test("the attendance center reads calendar days in local time, not UTC", () => {
  const controllerSource = fs.readFileSync(new URL("../server/controllers/attendanceController.js", import.meta.url), "utf8");
  // pg materialises a `date` column at local midnight, so slicing its ISO string
  // filed every record under the previous day east of Greenwich and the day the
  // admin saved showed the employee as absent. Read just this one function —
  // a file-wide regex matches unrelated date helpers.
  const start = controllerSource.indexOf("const centerDateKey =");
  assert.notEqual(start, -1, "centerDateKey must still exist");
  const centerDateKeySource = controllerSource.slice(start, controllerSource.indexOf("\n};", start));
  assert.match(centerDateKeySource, /getFullYear\(\)/);
  assert.match(centerDateKeySource, /getMonth\(\) \+ 1/);
  assert.match(centerDateKeySource, /getDate\(\)/);
  assert.doesNotMatch(centerDateKeySource, /toISOString/);
  // Both ends of one shift have to come from one clock.
  assert.doesNotMatch(controllerSource, /check_out = NOW\(\),\s*check_out_at = NOW\(\)/);
});

test("the correction form edits the saved record instead of overwriting it with defaults", () => {
  assert.match(uiSource, /manualAttendanceFormFromRow/);
  assert.match(uiSource, /const selectManualTarget/);
  assert.match(uiSource, /onEdit=\{openManualAttendance\}/);
  // The checkout used to default to the next day, silently turning a same-day
  // correction into a 24-hour shift.
  assert.match(uiSource, /checkOutDate: attendanceDate/);
  assert.doesNotMatch(uiSource, /checkOutDate: nextDayValue\(todayValue\(\)\)/);
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

test("admin can correct check-in and checkout independently without overwriting the other timestamp", () => {
  assert.match(uiSource, /editMode: "both"/);
  assert.match(uiSource, /\["check_in", isArabic \? "الحضور فقط"/);
  assert.match(uiSource, /\["check_out", isArabic \? "الانصراف فقط"/);
  assert.match(uiSource, /correction_scope: manualForm\.editMode/);
  assert.match(routeSource, /const editsCheckIn = correctionScope !== "check_out"/);
  assert.match(routeSource, /const editsCheckOut = correctionScope !== "check_in"/);
  assert.match(routeSource, /const checkInAt = editsCheckIn \? requestedCheckInAt : previousCheckInAt/);
  assert.match(routeSource, /const checkOutAt = editsCheckOut \? requestedCheckOutAt : previousCheckOutAt/);
  assert.match(routeSource, /correction_scope: correctionScope/);
});

test("manual time entry uses simple 12-hour selectors with the requested period defaults", () => {
  assert.match(uiSource, /checkInPeriod: "PM"/);
  assert.match(uiSource, /checkOutPeriod: "AM"/);
  assert.match(uiSource, /function ManualTimeInput/);
  assert.match(uiSource, /const twelveHourTime/);
  assert.doesNotMatch(uiSource, /<NativeInput type="time" value=\{manualForm\.check/);
});
