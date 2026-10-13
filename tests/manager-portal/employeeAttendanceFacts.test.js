/*
 * The employee sheet's absent days and leave line come from payroll. An approved run nests them
 * under attendance_deductions; the live preview of the current month carries them flat. Reading
 * only the nested shape showed no absences at all for any month still open.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { attendanceFactsOf } from "../../server/services/managerPortalService.js";

test("the live preview's flat payroll is read", () => {
  const facts = attendanceFactsOf({ net_pay: 5000, absence_days: 1, missing_attendance_dates: ["2026-10-08"], leave_dates: ["2026-10-04"] });
  assert.deepEqual(facts.missing_attendance_dates, ["2026-10-08"]);
  assert.deepEqual(facts.leave_dates, ["2026-10-04"]);
});

test("an approved run's nested snapshot is read", () => {
  const facts = attendanceFactsOf({ net_pay: 5000, attendance_deductions: { missing_attendance_dates: ["2026-09-10"] } });
  assert.deepEqual(facts.missing_attendance_dates, ["2026-09-10"]);
});

test("a snapshot with no attendance figures gives none", () => {
  assert.equal(attendanceFactsOf({ net_pay: 5000 }), null);
  assert.equal(attendanceFactsOf(null), null);
});
