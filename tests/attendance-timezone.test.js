import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { calculateAttendanceMetrics } from "../server/utils/attendanceCalculator.js";
import { getSettingDefinition } from "../shared/settingsRegistry.js";

const resolverSource = fs.readFileSync(new URL("../server/utils/attendanceTimezone.js", import.meta.url), "utf8");

test("the attendance timezone is an editable system setting, not free text", () => {
  const definition = getSettingDefinition("employees.default_attendance_timezone");
  assert.ok(definition, "the setting must stay registered so it renders in System Settings");
  assert.equal(definition.category, "employees");
  assert.equal(definition.type, "select");
  assert.equal(definition.defaultValue, "Africa/Cairo");
  const values = (definition.options || []).map((option) => option.value);
  assert.ok(values.includes("Africa/Cairo"));
  assert.ok(values.includes("UTC"));
  // A typo here would silently move the attendance business day, which is the
  // whole reason this is a list.
  values.forEach((value) => {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: value }), `${value} must be a real IANA zone`);
  });
});

test("the process clock is not allowed to decide the attendance day", () => {
  // TZ describes the container's clock, not the calendar the shop books
  // attendance against. Letting it through meant a routine TZ=UTC on the host
  // moved the business day to 03:00 Cairo and closed night shifts a day late.
  assert.doesNotMatch(resolverSource, /process\.env\.TZ\s*\|\|/);
  assert.match(resolverSource, /process\.env\.ATTENDANCE_TIMEZONE \|\| process\.env\.APP_TIMEZONE/);
});

test("attendance sources read the timezone through the resolver, not a frozen constant", () => {
  const files = [
    "../server/controllers/attendanceController.js",
    "../server/routes/adminAttendance.js",
    "../server/services/staffTasksService.js",
    "../server/services/salesCommissionService.js",
    "../server/services/openingShiftService.js",
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /getAttendanceTimeZone/, `${file} must resolve the timezone at call time`);
    assert.doesNotMatch(
      source,
      /^const \w*TIMEZONE\w* = String\(process\.env\.(ATTENDANCE_TIMEZONE|APP_TIMEZONE)/m,
      `${file} must not freeze the timezone at import time`
    );
  });
});

test("saving the employees category re-reads the timezone so it applies without a restart", () => {
  const routeSource = fs.readFileSync(new URL("../server/routes/settings.js", import.meta.url), "utf8");
  assert.match(routeSource, /if \(category === "employees"\) await refreshAttendanceTimeZone\(\)/);
});

test("the configured zone decides the shift window a booking is measured against", () => {
  const args = {
    attendanceDate: "2026-08-20",
    checkIn: new Date("2026-08-20T09:20:00.000Z"),
    checkOut: new Date("2026-08-20T17:00:00.000Z"),
    shift: { start_time: "12:00:00", end_time: "20:00:00" },
  };
  // 09:20Z is 12:20 in Cairo (+3) — twenty minutes late against a 12:00 shift.
  assert.equal(calculateAttendanceMetrics({ ...args, timeZone: "Africa/Cairo" }).late_minutes, 20);
  // The same instant is 09:20 under UTC, nearly three hours before that shift.
  assert.equal(calculateAttendanceMetrics({ ...args, timeZone: "UTC" }).late_minutes, 0);
});
