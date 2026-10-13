/*
 * The employee portal's أيام الحضور sheet lists the month day by day: attended days from the
 * timeline, absent and leave days from payroll. A leave day is never absent, a day with a
 * check-in is never absent, and nothing after today is listed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthDays } from "../src/modules/employees/lib/employeeMonthDays.js";

const timeline = [
  { date: "2026-10-13", check_in: "2026-10-13T12:23:00Z", check_out: "2026-10-13T22:05:00Z", late_minutes: 9 },
  { date: "2026-10-12", check_in: "2026-10-12T12:37:00Z" },
  { date: "2026-10-08", status: "absent", check_in: null },
  { date: "2026-09-30", check_in: "2026-09-30T12:00:00Z" },
];

test("attended, absent and leave days, newest first", () => {
  const { rows, counts } = buildMonthDays({
    timeline,
    monthDays: { month: "2026-10", absent_dates: ["2026-10-08"], leave_dates: ["2026-10-04", "2026-10-11"] },
    today: "2026-10-14",
  });
  assert.deepEqual(rows.map((row) => `${row.key}:${row.kind}`), [
    "2026-10-13:present",
    "2026-10-12:present",
    "2026-10-11:leave",
    "2026-10-08:absent",
    "2026-10-04:leave",
  ]);
  assert.deepEqual(counts, { present: 2, absent: 1, leave: 2 });
});

test("a leave day or a checked-in day is never shown as absent", () => {
  const { rows } = buildMonthDays({
    timeline,
    monthDays: { month: "2026-10", absent_dates: ["2026-10-04", "2026-10-13"], leave_dates: ["2026-10-04"] },
    today: "2026-10-14",
  });
  assert.equal(rows.find((row) => row.key === "2026-10-04").kind, "leave");
  assert.equal(rows.find((row) => row.key === "2026-10-13").kind, "present");
  assert.equal(rows.filter((row) => row.kind === "absent").length, 0);
});

test("other months and days after today are left out", () => {
  const { rows } = buildMonthDays({
    timeline,
    monthDays: { month: "2026-10", absent_dates: ["2026-10-20"], leave_dates: ["2026-10-25"] },
    today: "2026-10-14",
  });
  assert.ok(!rows.some((row) => row.key.startsWith("2026-09")));
  assert.ok(!rows.some((row) => row.key > "2026-10-14"));
});
