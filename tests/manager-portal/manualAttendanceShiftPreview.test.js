/*
 * The manager portal booked a POS cashier 16.83 hours for one day.
 *
 * The row read "08:10 م → 01:00 م": a check-in at 20:10 and a check-out clock of
 * 13:00. Because 13:00 is not after 20:10, the sheet's night-shift rule moved the
 * check-out to the NEXT calendar day, and 20:10 → 13:00 the following afternoon is
 * 16 h 50 m — 1010 minutes, 16.83 hours, with 410 of them booked as overtime past
 * the 10-hour threshold. The shift had actually ended at 01:00 ص, 4 h 50 m: one
 * mis-tapped meridiem on a 12-hour picker, silently doubled by a correct rule.
 *
 * Nothing on screen could have caught it — the form showed two clocks and no total,
 * and the table's check-out column shows a clock with no date. So the derivation is
 * asserted here alongside the length it implies, the day it lands on, and the
 * threshold that makes the sheet stop and ask.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LONG_SHIFT_WARNING_MINUTES,
  describeManualShift,
  isOvernightRow,
  nextDateKey,
} from "../../src/modules/managerPortal/lib/attendanceShift.js";

const CAIRO_OFFSET = "+03:00";
const cairo = (day, clock) => `2026-09-${String(day).padStart(2, "0")}T${clock}:00${CAIRO_OFFSET}`;

test("the reported day: 20:10 → 13:00 is booked on the next day and flagged as long", () => {
  const shift = describeManualShift({ date: "2026-09-01", checkIn: "20:10", checkOut: "13:00" });
  assert.equal(shift.spansMidnight, true);
  assert.equal(shift.checkOutDate, "2026-09-02");
  assert.equal(shift.minutes, 1010, "20:10 → 13:00 next day is 16 h 50 m");
  assert.equal(Number((shift.minutes / 60).toFixed(2)), 16.83, "the 16.83 the sheet showed");
  assert.equal(shift.isLong, true, "the manager has to confirm before this can be saved");
});

test("what the manager meant: 20:10 → 01:00 is the same night shift, 4 h 50 m", () => {
  const shift = describeManualShift({ date: "2026-09-01", checkIn: "20:10", checkOut: "01:00" });
  assert.equal(shift.spansMidnight, true, "01:00 still belongs to the next calendar day");
  assert.equal(shift.checkOutDate, "2026-09-02");
  assert.equal(shift.minutes, 290);
  assert.equal(shift.isLong, false, "a real night shift saves without a confirmation");
});

test("a same-day shift keeps its own date", () => {
  const shift = describeManualShift({ date: "2026-09-01", checkIn: "08:10", checkOut: "13:00" });
  assert.equal(shift.spansMidnight, false);
  assert.equal(shift.checkOutDate, "2026-09-01");
  assert.equal(shift.minutes, 290);
  assert.equal(shift.isLong, false);
});

test("the long-shift threshold is the boundary, not a rounded guess", () => {
  const atLimit = describeManualShift({ date: "2026-09-01", checkIn: "10:00", checkOut: "22:00" });
  assert.equal(atLimit.minutes, LONG_SHIFT_WARNING_MINUTES);
  assert.equal(atLimit.isLong, false, "exactly twelve hours is still allowed through");
  const overLimit = describeManualShift({ date: "2026-09-01", checkIn: "10:00", checkOut: "22:01" });
  assert.equal(overLimit.isLong, true);
});

test("an incomplete or unparseable correction has no derived shift", () => {
  assert.equal(describeManualShift({ date: "2026-09-01", checkIn: "20:10", checkOut: "" }), null);
  assert.equal(describeManualShift({ date: "2026-09-01", checkIn: "", checkOut: "01:00" }), null);
  assert.equal(describeManualShift({ date: "", checkIn: "20:10", checkOut: "01:00" }), null);
  assert.equal(describeManualShift({ date: "2026-09-01", checkIn: "8:10", checkOut: "01:00" }), null);
  assert.equal(describeManualShift({ date: "2026-09-01", checkIn: "24:10", checkOut: "01:00" }), null);
});

test("nextDateKey crosses a month end", () => {
  assert.equal(nextDateKey("2026-08-31"), "2026-09-01");
  assert.equal(nextDateKey("2026-09-01"), "2026-09-02");
});

test("a saved row is marked overnight on the attendance calendar, not the reader's", () => {
  // The stored timestamps of the reported row: both are afternoon/evening UTC
  // instants, and only Cairo's calendar tells them apart.
  assert.equal(isOvernightRow(cairo(1, "20:10"), cairo(2, "13:00")), true);
  assert.equal(isOvernightRow(cairo(1, "20:10"), cairo(2, "01:00")), true);
  assert.equal(isOvernightRow(cairo(1, "08:10"), cairo(1, "13:00")), false);
  // 23:50 → 00:10 crosses midnight by twenty minutes; UTC would still call it one day.
  assert.equal(isOvernightRow(cairo(1, "23:50"), cairo(2, "00:10")), true);
  assert.equal(isOvernightRow(cairo(1, "08:10"), null), false, "an open day is not overnight");
});

/* The repository has no React test runner, so the sheet's own wiring is held by
 * source-level guarantees: the derivation it sends, the save it refuses, and the
 * two places a next-day check-out has to be visible. */
const sheetSource = () => readFile(
  new URL("../../src/modules/managerPortal/components/EmployeeDetailsSheet.jsx", import.meta.url),
  "utf8"
);

test("the sheet sends the derived check-out date rather than re-deriving it inline", async () => {
  const source = await sheetSource();
  assert.match(source, /describeManualShift\(\{\s*date: attForm\?\.date/);
  assert.match(source, /check_out_date: attShift\?\.checkOutDate \|\| attForm\.date/);
  assert.doesNotMatch(source, /attForm\.check_out <= attForm\.check_in/, "the silent inline rule is gone");
});

test("the sheet refuses to save an unconfirmed long day", async () => {
  const source = await sheetSource();
  assert.match(
    source,
    /if \(attShift\?\.isLong && !attForm\.confirm_long\) \{ setAttNotice\(tt\("managerPortal\.employeeDetails\.longShiftBlocked"\)\); return; \}/
  );
  assert.match(source, /checked=\{Boolean\(attForm\.confirm_long\)\}/, "and offers the confirmation it demands");
});

test("a next-day check-out is legible in both the form and the table", async () => {
  const source = await sheetSource();
  assert.match(source, /employeeDetails\.shiftLength/, "the form totals the day it is about to save");
  assert.match(source, /attShift\.spansMidnight \? ` · \$\{tt\("managerPortal\.employeeDetails\.checkOutNextDay"\)\}/);
  assert.match(source, /isOvernightRow\(row\.check_in, row\.check_out\)/, "the table marks the saved row");
});

test("the table's clock is read on the attendance calendar, not the device's", async () => {
  const source = await sheetSource();
  const formatClock = /const formatClock = \(value\) => \{[\s\S]*?\n\};/.exec(source);
  assert.ok(formatClock, "formatClock still exists");
  assert.match(formatClock[0], /timeZone: ATTENDANCE_TZ/);
});
