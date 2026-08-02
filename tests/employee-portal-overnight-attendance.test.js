import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = (path) => fs.readFile(path, "utf8");

test("employee portal keeps a recent open attendance active after midnight", async () => {
  const page = await source("src/modules/employees/pages/EmployeePayrollPortal.jsx");
  assert.match(page, /recentOpenAttendance/);
  assert.match(page, /minutesBetween\(checkIn, nowTick\) <= 36 \* 60/);
  assert.match(page, /exactTodayAttendance \|\| recentOpenAttendance/);
  assert.match(page, /attendance_log_id: actionType === "check_out" \? \(todayAttendance/);
});

test("checkout API safely falls back to a recent open attendance", async () => {
  const service = await source("server/services/employeePayrollPortalService.js");
  assert.match(service, /NOW\(\) - INTERVAL '36 hours'/);
  assert.match(service, /COALESCE\(check_out_at, check_out\) IS NULL/);
  assert.match(service, /COALESCE\(check_in_at, check_in\) DESC/);
});

test("checkout by id is not blocked by a midnight date change and requires an updated row", async () => {
  const service = await source("server/services/employeePayrollPortalService.js");
  const updateById = service.slice(service.indexOf('"checkout_update_by_id"'), service.indexOf('"checkout_update_by_date"'));
  assert.doesNotMatch(updateById, /attendance_date = \$3::date/);
  assert.match(updateById, /COALESCE\(check_out_at, check_out\) IS NULL/);
  assert.match(service, /const updatedAttendanceRow = result\?\.rows\?\.\[0\] \|\| null;\s*if \(!updatedAttendanceRow\)/);
});
