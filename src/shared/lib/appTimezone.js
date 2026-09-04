/**
 * The store's own clock.
 *
 * Timestamps are stored and compared as absolute instants, which is right and stays right. Two
 * things went wrong around them:
 *
 * 1. Entry. `<input type="datetime-local">` yields a WALL CLOCK with no zone, and sending
 *    "2026-08-23T20:11" straight to the server meant "starts now", typed in Cairo, did not take
 *    effect for another three hours. `wallClockToInstant` / `instantToWallClock` fix that side.
 *
 * 2. Display. Every `toLocaleTimeString()` and `new Intl.DateTimeFormat(locale, {...})` without an
 *    explicit `timeZone` answers in whatever zone the DEVICE is set to. A POS PC left on UTC, a
 *    phone that roamed, a kiosk tablet that never had its clock set — each printed a different
 *    check-in time and receipt time for the same sale. The shop has one clock; the screen should
 *    show it. `installAppTimezoneDefaults()` makes the store's zone the default for every
 *    formatter that does not name one, so 288 call sites do not each have to remember.
 *
 * The zone comes from Settings → General → Timezone and falls back to Africa/Cairo. It is always a
 * zone NAME, never an offset: Egypt keeps +02 in winter and +03 in summer, and `Intl` follows the
 * change on its own.
 */

const DEFAULT_TIMEZONE = "Africa/Cairo";
const SETTING_KEY = "general.timezone";

let appTimezone = DEFAULT_TIMEZONE;

const isUsableTimeZone = (value) => {
  const zone = String(value || "").trim();
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** Called once at bootstrap with the tenant's settings; falls back to Cairo. */
export const setAppTimezoneFromSettings = (settings = {}) => {
  const configured = settings?.[SETTING_KEY];
  appTimezone = isUsableTimeZone(configured) ? String(configured).trim() : DEFAULT_TIMEZONE;
  return appTimezone;
};

export const getAppTimezone = () => appTimezone;

const toDate = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/*
 * The native constructors, captured before `installAppTimezoneDefaults` wraps them. Everything in
 * this module formats through these so the helpers here stay explicit about their zone and never
 * depend on the shim being installed (tests import this file without it).
 */
const NativeDateTimeFormat = Intl.DateTimeFormat;

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The wall clock an instant shows in the zone, as numbers:
 * `{ year, month (1-12), day, hour (0-23), minute, second, weekday (0 = Sunday) }`, or null.
 */
export const zonedParts = (value = new Date(), timeZone = appTimezone) => {
  const date = toDate(value);
  if (!date) return null;
  const parts = {};
  const formatted = new NativeDateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  for (const part of formatted) {
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

/** The calendar day an instant falls on in the store's zone, as `YYYY-MM-DD`. */
export const dateKeyInAppTimezone = (value = new Date(), timeZone = appTimezone) => {
  const parts = zonedParts(value, timeZone);
  return parts ? `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` : "";
};

/** Today, on the store's calendar. Shaped for a `<input type="date">`. */
export const todayInAppTimezone = (timeZone = appTimezone) => dateKeyInAppTimezone(new Date(), timeZone);

/** `HH:MM` (24-hour) of an instant in the store's zone. */
export const clockInAppTimezone = (value = new Date(), timeZone = appTimezone) => {
  const parts = zonedParts(value, timeZone);
  return parts ? `${pad2(parts.hour)}:${pad2(parts.minute)}` : "";
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` string is taken literally (a calendar day has no instant to convert); anything
 * else is treated as an instant and keyed on the store's calendar.
 */
export const toDateKeyInAppTimezone = (value, timeZone = appTimezone) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_KEY.test(trimmed)) return trimmed;
  }
  return dateKeyInAppTimezone(value, timeZone);
};

/** Move a `YYYY-MM-DD` key by whole days. Pure calendar arithmetic. */
export const shiftDateKey = (dateKey, days = 0) => {
  const match = DATE_KEY.exec(String(dateKey || "").trim().slice(0, 10));
  if (!match) return "";
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)))
    .toISOString()
    .slice(0, 10);
};

/**
 * An instant re-expressed as a Date whose LOCAL fields read the store's wall clock. For code that
 * does calendar arithmetic with `getDate()` / `setDate()` / `new Date(y, m, d)` and cannot be
 * rewritten around day keys: feed it this instead of `new Date()` and every local getter answers
 * on the store's calendar. Never send the result to the server — it is a wall clock, not an instant.
 */
export const asAppWallClock = (value = new Date(), timeZone = appTimezone) => {
  const parts = zonedParts(value, timeZone);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
};

export const nowAsAppWallClock = (timeZone = appTimezone) => asAppWallClock(new Date(), timeZone);

/** First and last day of the month a day key falls in (default: this month, store's calendar). */
export const monthBoundsInAppTimezone = (dateKey = todayInAppTimezone(), monthOffset = 0) => {
  const match = DATE_KEY.exec(String(dateKey || "").trim().slice(0, 10));
  if (!match) return null;
  const first = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(monthOffset || 0), 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth() + 1;
  return {
    start: `${year}-${pad2(month)}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    period: `${year}-${pad2(month)}`,
  };
};

/**
 * How far the zone is from UTC at that instant — computed, never assumed, so summer time is
 * handled without a table of rules.
 */
const zoneOffsetMs = (date, timeZone) => {
  const parts = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/**
 * "2026-08-23T20:11" as read on the shop wall → the ISO instant it really is.
 * Returns null for an empty or unparseable value so a blank field stays blank.
 */
export const wallClockToInstant = (value, timeZone = appTimezone) => {
  const raw = String(value || "").trim().replace(" ", "T");
  if (!raw) return null;
  const normalized = raw.length === 10 ? `${raw}T00:00:00` : raw.length === 16 ? `${raw}:00` : raw;
  const pretendUtc = new Date(`${normalized}Z`);
  if (Number.isNaN(pretendUtc.getTime())) return null;
  // Two passes: the offset can differ either side of a DST boundary, and the second pass settles it.
  const firstGuess = new Date(pretendUtc.getTime() - zoneOffsetMs(pretendUtc, timeZone));
  const settled = new Date(pretendUtc.getTime() - zoneOffsetMs(firstGuess, timeZone));
  return settled.toISOString();
};

/** An instant → the wall clock it shows in the store's zone, shaped for a datetime-local input. */
export const instantToWallClock = (value, timeZone = appTimezone) => {
  const date = toDate(value);
  if (!date) return "";
  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
};

/** Display helper: the same instant, written the way the shop reads it. */
export const formatInAppTimezone = (value, options = {}, locale = "ar-EG") => {
  const date = toDate(value);
  if (!date) return "";
  return new NativeDateTimeFormat(locale, { timeZone: appTimezone, ...options }).format(date);
};

/* ------------------------------------------------------------------------------------------
 * The default-zone shim.
 *
 * Wraps `Intl.DateTimeFormat` and the three `Date.prototype.toLocale*String` methods so that a
 * call without a `timeZone` option formats in the store's zone instead of the device's. A call
 * that names its zone is passed through untouched. `Number.prototype.toLocaleString` is not a
 * date and is not touched. Idempotent; safe to call before the settings arrive because the zone
 * is read at format time, not at install time.
 * ---------------------------------------------------------------------------------------- */

const SHIM_FLAG = "__m1AppTimezoneDefaults";

const withDefaultZone = (options) => {
  if (options && typeof options === "object" && options.timeZone !== undefined) return options;
  return { ...(options || {}), timeZone: appTimezone };
};

export const installAppTimezoneDefaults = () => {
  if (globalThis[SHIM_FLAG]) return false;
  const Native = Intl.DateTimeFormat;

  function AppDateTimeFormat(locales, options) {
    return new Native(locales, withDefaultZone(options));
  }
  AppDateTimeFormat.prototype = Native.prototype;
  Object.setPrototypeOf(AppDateTimeFormat, Native); // keeps supportedLocalesOf
  Object.defineProperty(AppDateTimeFormat, "name", { value: "DateTimeFormat" });
  Intl.DateTimeFormat = AppDateTimeFormat;

  const nativeToLocaleString = Date.prototype.toLocaleString;
  const nativeToLocaleDateString = Date.prototype.toLocaleDateString;
  const nativeToLocaleTimeString = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleString = function toLocaleString(locales, options) {
    return nativeToLocaleString.call(this, locales, withDefaultZone(options));
  };
  Date.prototype.toLocaleDateString = function toLocaleDateString(locales, options) {
    return nativeToLocaleDateString.call(this, locales, withDefaultZone(options));
  };
  Date.prototype.toLocaleTimeString = function toLocaleTimeString(locales, options) {
    return nativeToLocaleTimeString.call(this, locales, withDefaultZone(options));
  };

  globalThis[SHIM_FLAG] = {
    Native,
    nativeToLocaleString,
    nativeToLocaleDateString,
    nativeToLocaleTimeString,
  };
  return true;
};

/** Test seam: puts the natives back. */
export const uninstallAppTimezoneDefaults = () => {
  const saved = globalThis[SHIM_FLAG];
  if (!saved) return false;
  Intl.DateTimeFormat = saved.Native;
  Date.prototype.toLocaleString = saved.nativeToLocaleString;
  Date.prototype.toLocaleDateString = saved.nativeToLocaleDateString;
  Date.prototype.toLocaleTimeString = saved.nativeToLocaleTimeString;
  delete globalThis[SHIM_FLAG];
  return true;
};

export const APP_TIMEZONE_SETTING_KEY = SETTING_KEY;
export const APP_TIMEZONE_DEFAULT = DEFAULT_TIMEZONE;
