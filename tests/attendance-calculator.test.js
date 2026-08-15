import assert from "node:assert/strict";
import test from "node:test";

import { calculateAttendanceMetrics } from "../server/utils/attendanceCalculator.js";

test("overnight shifts end on the following business day", () => {
  const result = calculateAttendanceMetrics({
    attendanceDate: "2026-08-01",
    checkIn: new Date("2026-08-01T12:00:00.000Z"),
    checkOut: new Date("2026-08-01T22:00:00.000Z"),
    shift: { start_time: "15:00:00", end_time: "01:00:00", allowed_late_minutes: 15 },
  });
  assert.equal(result.early_leave_minutes, 0);
});

test("a Date attendance date anchors the shift to its own calendar day", () => {
  // `attendance_date` reaches the calculator as the Date pg builds for a `date`
  // column: local midnight. Reading that day back in UTC shifted the shift
  // window a day east of Greenwich and turned late minutes into a whole day.
  const localMidnight = new Date(2026, 7, 1, 0, 0, 0);
  const fromDate = calculateAttendanceMetrics({
    attendanceDate: localMidnight,
    checkIn: new Date(2026, 7, 1, 15, 30, 0),
    checkOut: new Date(2026, 7, 1, 23, 0, 0),
    shift: { start_time: "15:00:00", end_time: "23:00:00", allowed_late_minutes: 15 },
  });
  const fromString = calculateAttendanceMetrics({
    attendanceDate: "2026-08-01",
    checkIn: new Date(2026, 7, 1, 15, 30, 0),
    checkOut: new Date(2026, 7, 1, 23, 0, 0),
    shift: { start_time: "15:00:00", end_time: "23:00:00", allowed_late_minutes: 15 },
  });
  assert.deepEqual(fromDate, fromString);
  assert.equal(fromDate.late_minutes, 15);
  assert.equal(fromDate.early_leave_minutes, 0);
});

test("overtime threshold is measured from worked duration", () => {
  const result = calculateAttendanceMetrics({
    attendanceDate: "2026-08-01",
    checkIn: new Date("2026-08-01T09:10:00.000Z"),
    checkOut: new Date("2026-08-01T22:00:00.000Z"),
    shift: { start_time: "15:00:00", end_time: "01:00:00", allowed_late_minutes: 15, overtime_after_minutes: 600 },
  });
  assert.equal(result.work_minutes, 770);
  assert.equal(result.early_leave_minutes, 0);
  assert.equal(result.overtime_minutes, 170);
});
