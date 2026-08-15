import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = (path) => fs.readFile(path, "utf8");

test("a stored day is never reopened by a second portal check-in", async () => {
  const service = await source("server/services/employeePayrollPortalService.js");
  const checkIn = service.slice(service.indexOf("if (action === \"check_in\")"), service.indexOf("INSERT INTO attendance_logs"));
  assert.match(checkIn, /already_checked_out_today/);
  assert.doesNotMatch(checkIn, /reopening checked-out attendance/);
  const refusal = checkIn.slice(checkIn.indexOf("if (existingHasCheckout)"));
  assert.match(refusal, /throw employeePortalError\(\s*"already_checked_out_today"/);
});

test("the portal blocks a second check-in before it reaches the API", async () => {
  const page = await source("src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(page, /const canCheckInToday = !todayCheckIn;/);
  assert.match(page, /if \(actionType === "check_in" && todayCheckIn\)/);
  assert.match(page, /canCheckInToday \? \(/);
});

test("every location failure reaches the employee in Arabic behind a blocking gate", async () => {
  const page = await source("src/modules/employees/pages/EmployeePayrollPortal.jsx");
  const getLocation = page.slice(page.indexOf("const locationBlockedError"), page.indexOf("const requestTypeLabel"));
  assert.doesNotMatch(getLocation, /[A-Za-z]{4,} [A-Za-z]{4,} [A-Za-z]{4,}/);
  assert.match(getLocation, /error\?\.code === 1/);
  assert.match(getLocation, /error\?\.code === 3/);
  assert.match(page, /setLocationGate\(\{ action: actionType/);
  // The raw browser message must not survive as the notice text.
  assert.doesNotMatch(page, /GPS is not available on this device/);
});

test("the employee always sees today, even when payroll is still on an older period", async () => {
  const service = await source("server/services/employeePayrollPortalService.js");
  const timeline = service.slice(service.indexOf("const recordedAttendanceTimeline = await getAttendanceTimeline"));
  assert.match(timeline.slice(0, 400), /periodEnd: bounds\.end > todayIsoDate \? bounds\.end : todayIsoDate/);
  // The deduction summary stays on the payroll period it is calculated for.
  const summary = service.slice(service.indexOf("const attendanceSummary = await getAttendanceSummary"));
  assert.match(summary.slice(0, 300), /periodEnd: bounds\.end,/);
});

test("the attendance center names a generated day instead of drawing a dash", async () => {
  const center = await source("src/modules/attendance/components/AttendanceCenter.jsx");
  const badge = center.slice(center.indexOf("function SourceBadge"));
  assert.doesNotMatch(badge.slice(0, badge.indexOf("}\n")), /">-<\/span>/);
  assert.match(badge, /isArabic \? "تلقائي" : "Auto"/);
  const controller = await source("server/controllers/attendanceController.js");
  assert.match(controller, /COALESCE\(NULLIF\(al\.attendance_source, ''\), 'manual'\)/);
});
