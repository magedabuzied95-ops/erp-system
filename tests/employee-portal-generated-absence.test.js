import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const portalSource = fs.readFileSync(new URL("../server/services/employeePayrollPortalService.js", import.meta.url), "utf8");
const attendanceSource = fs.readFileSync(new URL("../server/controllers/attendanceController.js", import.meta.url), "utf8");

test("employee portal generates elapsed absences from the configured shift calendar", () => {
  assert.match(portalSource, /const expectedWorkingDates/);
  assert.match(portalSource, /const yesterday = previousIsoDate\(localIsoDate\(new Date\(\), timeZone\)\)/);
  assert.match(portalSource, /!recordedDates\.has\(date\) && !excludedDates\.has\(date\)/);
  assert.match(portalSource, /absence_days: absenceDates\.length/);
  assert.match(portalSource, /status: "absent"/);
  assert.match(portalSource, /generatedAbsenceTimeline/);
  assert.match(portalSource, /attendanceDateKey\(right\.date \|\| right\.attendance_date\)\.localeCompare\(attendanceDateKey\(left\.date \|\| left\.attendance_date\)\)/);
});

test("approved leave, vacation and holidays do not become employee portal absences", () => {
  assert.match(portalSource, /FROM employee_leaves/);
  assert.match(portalSource, /FROM employee_vacations/);
  assert.match(portalSource, /FROM holidays/);
  assert.match(portalSource, /LOWER\(COALESCE\(status, ''\)\) = 'approved'/);
});

test("attendance center uses configured shift weekdays instead of numeric weekday order", () => {
  assert.match(attendanceSource, /COALESCE\(active_shift\.working_days, '\[\]'::jsonb\) AS working_days/);
  assert.match(attendanceSource, /centerWorkingDayCodes/);
  assert.match(attendanceSource, /configuredDays\.has\(centerWeekdayCodes\[date\.getUTCDay\(\)\]\)/);
  assert.match(attendanceSource, /centerIsExpectedWeekday\(date, employee\.working_days, employee\.working_days_per_week\)/);
});

test("employee portal late-day totals come from attendance late minutes", () => {
  const lateDayCalculation = /COUNT\(\*\) FILTER \(WHERE COALESCE\(late_minutes, 0\) > 0 OR LOWER\(COALESCE\(status, ''\)\) = 'late'\)::int AS late_days/g;
  assert.equal((portalSource.match(lateDayCalculation) || []).length, 2);
});
