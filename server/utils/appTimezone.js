/**
 * The shop's calendar, on the server.
 *
 * Three clocks used to disagree. The database session was moved to Africa/Cairo on 2026-08-31,
 * so `CURRENT_DATE` and `created_at::date` resolve on the Cairo calendar. The attendance code
 * carried its own zone through `getAttendanceTimeZone()`. But the Node process itself stayed on
 * UTC, and everything that asked the process for "today" — `new Date().toISOString().slice(0, 10)`,
 * `date.getHours()`, `setHours(0, 0, 0, 0)`, `toLocaleString()` — answered from Greenwich. Between
 * midnight and 03:00 Cairo that is yesterday; a receipt stamped 22:10 for a sale rung up at 01:10.
 *
 * This module is the one place that knows the zone. `applyProcessTimeZone()` puts the process
 * clock on it (Node re-reads `TZ` on assignment), and the helpers below answer calendar questions
 * explicitly so nothing has to trust the process clock at all. Always a zone NAME — Egypt keeps
 * +02 in winter and +03 in summer, and a fixed offset would be an hour out for half the year.
 *
 * The `date` column trap that once made a Cairo process unsafe (node-postgres parsing a bare
 * `2026-08-31` at LOCAL midnight, so it serialised as `2026-08-30T21:00:00Z`) is closed in
 * `server/database/db.js`, which parses `date` values at UTC midnight regardless of the clock.
 */

export const DEFAULT_APP_TIMEZONE = "Africa/Cairo";

export const isUsableTimeZone = (value) => {
  const zone = String(value || "").trim();
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const resolveConfiguredZone = () => {
  const candidates = [process.env.APP_TIMEZONE, process.env.PGTIMEZONE];
  for (const candidate of candidates) {
    const zone = String(candidate || "").trim();
    if (zone && isUsableTimeZone(zone)) return zone;
  }
  return DEFAULT_APP_TIMEZONE;
};

let appTimeZone = resolveConfiguredZone();

export const getAppTimeZone = () => appTimeZone;

/** Test seam. Returns the zone actually in effect. */
export const setAppTimeZoneForTesting = (value) => {
  appTimeZone = isUsableTimeZone(value) ? String(value).trim() : resolveConfiguredZone();
  return appTimeZone;
};

const toDate = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const partsFormatterCache = new Map();
const partsFormatter = (timeZone) => {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
};

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The wall clock an instant shows in the zone, as numbers.
 * `{ year, month (1-12), day, hour (0-23), minute, second, weekday (0 = Sunday) }`, or null.
 */
export const zonedParts = (value = new Date(), timeZone = appTimeZone) => {
  const date = toDate(value);
  if (!date) return null;
  const parts = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
};

const pad2 = (value) => String(value).padStart(2, "0");

/** The calendar day an instant falls on in the zone, as `YYYY-MM-DD`. */
export const dateKeyInAppTimeZone = (value = new Date(), timeZone = appTimeZone) => {
  const parts = zonedParts(value, timeZone);
  return parts ? `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` : "";
};

/** Today, on the shop's calendar. */
export const todayInAppTimeZone = (timeZone = appTimeZone) => dateKeyInAppTimeZone(new Date(), timeZone);

/** `HH:MM` of an instant in the zone. */
export const clockInAppTimeZone = (value = new Date(), timeZone = appTimeZone) => {
  const parts = zonedParts(value, timeZone);
  return parts ? `${pad2(parts.hour)}:${pad2(parts.minute)}` : "";
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Accepts a `YYYY-MM-DD` string, a `date` column value or any instant and returns the day key.
 * A date-only string is taken literally: a calendar day has no instant to convert.
 */
export const toDateKey = (value, timeZone = appTimeZone) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    const match = DATE_KEY.exec(value.trim());
    if (match && value.trim().length === 10) return match[0];
  }
  return dateKeyInAppTimeZone(value, timeZone);
};

/** Move a `YYYY-MM-DD` key by whole days. Pure calendar arithmetic, no zone involved. */
export const shiftDateKey = (dateKey, days = 0) => {
  const match = DATE_KEY.exec(String(dateKey || "").trim());
  if (!match) return "";
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return shifted.toISOString().slice(0, 10);
};

/** First and last day of the month a day key falls in. */
export const monthBoundsOfDateKey = (dateKey) => {
  const match = DATE_KEY.exec(String(dateKey || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    start: `${year}-${pad2(month)}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    period: `${year}-${pad2(month)}`,
  };
};

/**
 * How far the zone is from UTC at that instant, in ms. Computed, never assumed, so summer time
 * is handled without a table of rules.
 */
export const zoneOffsetMs = (value = new Date(), timeZone = appTimeZone) => {
  const date = toDate(value);
  if (!date) return 0;
  const parts = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/**
 * A wall clock read in the zone → the instant it is. Accepts `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM`
 * or `YYYY-MM-DD HH:MM[:SS]`; a bare day means its midnight. Null when unparseable.
 */
export const wallClockToInstant = (value, timeZone = appTimeZone) => {
  const raw = String(value || "").trim().replace(" ", "T");
  if (!raw) return null;
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.length === 16 ? `${raw}:00` : raw;
  const pretendUtc = new Date(`${normalized}Z`);
  if (Number.isNaN(pretendUtc.getTime())) return null;
  // Two passes: the offset can differ either side of a DST boundary, and the second pass settles it.
  const firstGuess = new Date(pretendUtc.getTime() - zoneOffsetMs(pretendUtc, timeZone));
  return new Date(pretendUtc.getTime() - zoneOffsetMs(firstGuess, timeZone));
};

/** The first instant of a day key in the zone. */
export const startOfDayInAppTimeZone = (dateKey, timeZone = appTimeZone) => wallClockToInstant(toDateKey(dateKey, timeZone), timeZone);

/** An instant written the way the shop reads it. */
export const formatInAppTimeZone = (value, options = {}, locale = "ar-EG", timeZone = appTimeZone) => {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date);
};

/**
 * Put the process clock on the shop's zone.
 *
 * Node applies a new `process.env.TZ` immediately, so every `getHours()`, `setHours(0, 0, 0, 0)`,
 * `toLocaleString()` and scheduler tick after this call reads the Cairo wall clock. Idempotent.
 * Returns what is now in effect, so boot logs can prove it.
 */
export const applyProcessTimeZone = (timeZone = appTimeZone) => {
  const zone = isUsableTimeZone(timeZone) ? String(timeZone).trim() : DEFAULT_APP_TIMEZONE;
  if (process.env.TZ !== zone) process.env.TZ = zone;
  appTimeZone = zone;
  return { timeZone: zone, offsetMinutes: -new Date().getTimezoneOffset() };
};

/** True when the process clock agrees with the zone right now. */
export const processClockMatchesAppTimeZone = (timeZone = appTimeZone) => {
  const now = new Date();
  return -now.getTimezoneOffset() * 60_000 === zoneOffsetMs(now, timeZone);
};
