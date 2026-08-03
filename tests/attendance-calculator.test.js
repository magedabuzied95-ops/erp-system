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

test("overtime threshold is measured from worked duration", () => {
  const result = calculateAttendanceMetrics({
    attendanceDate: "2026-08-01",
    checkIn: new Date("2026-08-01T09:10:00.000Z"),
    checkOut: new Date("2026-08-01T22:00:00.000Z"),
    shift: { start_time: "15:00:00", end_time: "01:00:00", allowed_late_minutes: 15, overtime_after_minutes: 600 },
  });
  assert.equal(result.work_minutes, 770);
  assert.equal(result.overtime_minutes, 170);
});
