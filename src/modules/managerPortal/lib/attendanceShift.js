import { dateKeyInAppTimezone } from "../../../shared/lib/appTimezone.js";
/**
 * The shape of one manually corrected attendance day, as the sheet is about to
 * save it.
 *
 * A manual correction sends two clocks and no dates, so the check-out date has
 * to be derived: a clock that is not after the check-in belongs to the next
 * calendar day, because that is what a night shift looks like (20:10 → 01:00).
 * The rule is right, but it is silent, and the same rule turns a mis-picked
 * meridiem into a plausible-looking record: a manager who means 01:00 ص and
 * taps 01:00 م on a 12-hour picker gets a check-out booked at 13:00 the NEXT
 * day — 16 h 50 m for a shift that lasted 4 h 50 m, with the table showing only
 * "01:00 م" beside it and nothing at all about the day it fell on.
 *
 * So the derivation lives here, returns the duration it implies, and the sheet
 * shows both before the save. Minutes are counted on the clock (a day is 24 h);
 * the server recomputes the authoritative figure across the real timezone.
 */

export const ATTENDANCE_TZ = "Africa/Cairo";

// Longer than this and the day is presumed to be a typo until the manager says
// otherwise. A 10-hour shift plus a genuine long overtime tail stays under it.
export const LONG_SHIFT_WARNING_MINUTES = 12 * 60;

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const clockMinutes = (value) => {
  const match = CLOCK_PATTERN.exec(String(value || "").trim());
  return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
};

export const toDateKey = (value) => {
  if (!value) return "";
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  // An instant is keyed on the store's calendar, not UTC's: 01:00 Cairo is still the same day.
  return dateKeyInAppTimezone(value);
};

export const nextDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

/** The attendance-timezone calendar day a stored timestamp falls on. */
export const zonedDateKey = (value, timeZone = ATTENDANCE_TZ) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

/**
 * True when a saved row's check-out landed on a later day than its check-in —
 * the fact the table's bare clock column cannot show.
 */
export const isOvernightRow = (checkIn, checkOut, timeZone = ATTENDANCE_TZ) => {
  const inKey = zonedDateKey(checkIn, timeZone);
  const outKey = zonedDateKey(checkOut, timeZone);
  return Boolean(inKey && outKey && outKey > inKey);
};

/**
 * What the form is about to send, and what it adds up to.
 *
 * @returns {null|{ checkOutDate: string, spansMidnight: boolean, minutes: number, isLong: boolean }}
 *   null while either clock is still empty or unparseable.
 */
export const describeManualShift = ({ date, checkIn, checkOut } = {}) => {
  const attendanceDate = toDateKey(date);
  const inMinutes = clockMinutes(checkIn);
  const outMinutes = clockMinutes(checkOut);
  if (!attendanceDate || inMinutes === null || outMinutes === null) return null;
  const spansMidnight = outMinutes <= inMinutes;
  const minutes = (outMinutes + (spansMidnight ? 24 * 60 : 0)) - inMinutes;
  return {
    checkOutDate: spansMidnight ? nextDateKey(attendanceDate) : attendanceDate,
    spansMidnight,
    minutes,
    isLong: minutes > LONG_SHIFT_WARNING_MINUTES,
  };
};
