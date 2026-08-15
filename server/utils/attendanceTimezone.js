import { getSetting } from "../services/settingsService.js";

export const ATTENDANCE_TIMEZONE_SETTING_KEY = "employees.default_attendance_timezone";
export const DEFAULT_ATTENDANCE_TIMEZONE = "Africa/Cairo";

// The setting is read by synchronous date helpers all over the attendance code,
// so the resolved value is held in memory and refreshed rather than awaited at
// each call. Saving the setting refreshes it immediately; the interval is only
// a safety net.
const REFRESH_INTERVAL_MS = 60_000;

export const isValidTimeZone = (value) => {
  const candidate = String(value || "").trim();
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
};

// `process.env.TZ` is deliberately NOT part of this chain. It describes the
// clock the container happens to run on, not the calendar the shop books
// attendance against. Leaving it in meant a routine `TZ=UTC` on the host would
// silently move the attendance business day to 03:00 Cairo, closing the night
// shift on the wrong day.
const envTimeZone = () => {
  const candidate = String(process.env.ATTENDANCE_TIMEZONE || process.env.APP_TIMEZONE || "").trim();
  return isValidTimeZone(candidate) ? candidate : "";
};

const fallbackTimeZone = () => envTimeZone() || DEFAULT_ATTENDANCE_TIMEZONE;

let resolvedTimeZone = fallbackTimeZone();
let loadedAt = 0;
let inFlight = null;

export const refreshAttendanceTimeZone = async () => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const stored = await getSetting(ATTENDANCE_TIMEZONE_SETTING_KEY, "");
      const candidate = String(stored || "").trim();
      if (candidate && !isValidTimeZone(candidate)) {
        console.warn("[attendance] ignoring unusable attendance timezone setting", {
          value: candidate,
          using: fallbackTimeZone(),
        });
      }
      resolvedTimeZone = isValidTimeZone(candidate) ? candidate : fallbackTimeZone();
    } catch (error) {
      // A settings outage must not change how attendance days are booked.
      console.warn("[attendance] attendance timezone refresh failed, keeping current value", {
        message: error?.message || String(error),
        using: resolvedTimeZone,
      });
    } finally {
      loadedAt = Date.now();
      inFlight = null;
    }
    return resolvedTimeZone;
  })();
  return inFlight;
};

export const getAttendanceTimeZone = () => {
  if (Date.now() - loadedAt > REFRESH_INTERVAL_MS) void refreshAttendanceTimeZone();
  return resolvedTimeZone;
};

// Test seam: lets a caller pin the value without touching the database.
export const setAttendanceTimeZoneForTesting = (value) => {
  resolvedTimeZone = isValidTimeZone(value) ? String(value).trim() : fallbackTimeZone();
  loadedAt = Date.now();
  return resolvedTimeZone;
};
