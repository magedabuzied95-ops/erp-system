/**
 * The store's own clock.
 *
 * Timestamps are stored and compared in UTC, which is right and stays right. What was wrong was
 * the entry side: `<input type="datetime-local">` yields a WALL CLOCK with no zone, and sending
 * "2026-08-23T20:11" straight to a server whose NOW() is UTC means "starts now", typed in Cairo,
 * does not take effect for another three hours. A coupon campaign lost a whole evening to it.
 *
 * So nothing here changes what the server stores. These helpers only translate between the wall
 * clock the operator reads off the shop wall and the instant that clock actually is, using the
 * store's configured zone (Settings → General → Timezone) rather than whatever zone the cashier's
 * laptop happens to be set to — a machine with a wrong clock no longer skews the data.
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

/**
 * How far the zone is from UTC at that instant — computed, never assumed, so summer time is
 * handled without a table of rules.
 */
const zoneOffsetMs = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, part) => (part.type === "literal" ? acc : { ...acc, [part.type]: part.value }), {});
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asIfUtc - date.getTime();
};

/**
 * "2026-08-23T20:11" as read on the shop wall → the ISO instant it really is.
 * Returns null for an empty or unparseable value so a blank field stays blank.
 */
export const wallClockToInstant = (value, timeZone = appTimezone) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
  const pretendUtc = new Date(`${withSeconds}Z`);
  if (Number.isNaN(pretendUtc.getTime())) return null;
  // Two passes: the offset can differ either side of a DST boundary, and the second pass settles it.
  const firstGuess = new Date(pretendUtc.getTime() - zoneOffsetMs(pretendUtc, timeZone));
  const settled = new Date(pretendUtc.getTime() - zoneOffsetMs(firstGuess, timeZone));
  return settled.toISOString();
};

/** An instant → the wall clock it shows in the store's zone, shaped for a datetime-local input. */
export const instantToWallClock = (value, timeZone = appTimezone) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
};

/** Display helper: the same instant, written the way the shop reads it. */
export const formatInAppTimezone = (value, options = {}, locale = "ar-EG") => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: appTimezone, ...options }).format(date);
};

export const APP_TIMEZONE_SETTING_KEY = SETTING_KEY;
export const APP_TIMEZONE_DEFAULT = DEFAULT_TIMEZONE;
