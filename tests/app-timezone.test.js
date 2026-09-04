/*
 * The screen shows the store's clock, whatever the device's clock says.
 *
 * Check-in times and receipt times were formatted with `toLocaleTimeString()` and
 * `new Intl.DateTimeFormat(locale, {...})` — no `timeZone` — so each device answered in its own
 * zone. A POS PC on UTC printed 22:10 on a receipt for a sale rung up at 01:10 Cairo; a phone
 * that roamed showed the same check-in an hour off from the branch wall.
 *
 * The frontend now installs a default: any formatter that does not name a zone formats in the
 * store's. These tests run under a deliberately foreign process zone so that a regression to
 * device-zone formatting fails here, not in a shop.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "America/New_York";

const {
  dateKeyInAppTimezone,
  todayInAppTimezone,
  clockInAppTimezone,
  toDateKeyInAppTimezone,
  shiftDateKey,
  monthBoundsInAppTimezone,
  zonedParts,
  wallClockToInstant,
  instantToWallClock,
  formatInAppTimezone,
  installAppTimezoneDefaults,
  uninstallAppTimezoneDefaults,
  setAppTimezoneFromSettings,
  getAppTimezone,
} = await import("../src/shared/lib/appTimezone.js");

// 01:10 Cairo on 2026-09-05 (summer, +03) is 22:10 UTC on the 4th and 18:10 in New York.
const SUMMER_SALE = "2026-09-04T22:10:00.000Z";
// 01:10 Cairo on 2026-01-15 (winter, +02) is 23:10 UTC on the 14th.
const WINTER_SALE = "2026-01-14T23:10:00.000Z";

test("the process clock for these tests is not Cairo", () => {
  assert.notEqual(new Date(SUMMER_SALE).getHours(), 1, "otherwise the tests below prove nothing");
});

test("a sale at 01:10 Cairo keys on the day the cashier rang it up, summer and winter", () => {
  assert.equal(dateKeyInAppTimezone(SUMMER_SALE), "2026-09-05");
  assert.equal(clockInAppTimezone(SUMMER_SALE), "01:10");
  assert.equal(dateKeyInAppTimezone(WINTER_SALE), "2026-01-15");
  assert.equal(clockInAppTimezone(WINTER_SALE), "01:10");
});

test("zonedParts reads the Cairo wall clock, not the process one", () => {
  const parts = zonedParts(SUMMER_SALE);
  assert.deepEqual(
    { y: parts.year, m: parts.month, d: parts.day, h: parts.hour, min: parts.minute, wd: parts.weekday },
    { y: 2026, m: 9, d: 5, h: 1, min: 10, wd: 6 },
    "Saturday 5 September, 01:10"
  );
  assert.equal(zonedParts("not a date"), null);
});

test("a date-only string is taken literally; anything else is an instant", () => {
  assert.equal(toDateKeyInAppTimezone("2026-08-31"), "2026-08-31");
  assert.equal(toDateKeyInAppTimezone(SUMMER_SALE), "2026-09-05");
  assert.equal(toDateKeyInAppTimezone(""), "");
});

test("day and month arithmetic is calendar arithmetic, immune to DST and zone", () => {
  assert.equal(shiftDateKey("2026-09-05", -6), "2026-08-30");
  assert.equal(shiftDateKey("2026-04-24", 1), "2026-04-25", "across the spring DST switch");
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(monthBoundsInAppTimezone("2026-09-05"), { start: "2026-09-01", end: "2026-09-30", period: "2026-09" });
  assert.deepEqual(monthBoundsInAppTimezone("2026-01-15", -1), { start: "2025-12-01", end: "2025-12-31", period: "2025-12" });
  assert.deepEqual(monthBoundsInAppTimezone("2026-02-10"), { start: "2026-02-01", end: "2026-02-28", period: "2026-02" });
});

test("today is today in Cairo, even at 01:00 when UTC and New York still say yesterday", () => {
  // Cannot freeze the clock without a library, so assert consistency instead of a value.
  assert.equal(todayInAppTimezone(), dateKeyInAppTimezone(new Date()));
  assert.match(todayInAppTimezone(), /^\d{4}-\d{2}-\d{2}$/);
});

test("wall clock ↔ instant round-trips and follows the season", () => {
  assert.equal(wallClockToInstant("2026-09-05T01:10"), SUMMER_SALE);
  assert.equal(wallClockToInstant("2026-01-15T01:10"), WINTER_SALE);
  assert.equal(wallClockToInstant("2026-09-05"), "2026-09-04T21:00:00.000Z", "a bare day is its Cairo midnight");
  assert.equal(instantToWallClock(SUMMER_SALE), "2026-09-05T01:10");
  assert.equal(instantToWallClock(WINTER_SALE), "2026-01-15T01:10");
  assert.equal(wallClockToInstant(""), null);
});

test("formatInAppTimezone writes the Cairo clock", () => {
  assert.equal(formatInAppTimezone(SUMMER_SALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "en-GB"), "01:10");
});

test("the default-zone shim makes zone-less formatters answer in the store's zone", () => {
  const date = new Date(SUMMER_SALE);
  const nativeLocale = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  assert.notEqual(nativeLocale, "01:10", "before install, the device zone answers");

  assert.equal(installAppTimezoneDefaults(), true);
  assert.equal(installAppTimezoneDefaults(), false, "idempotent");
  try {
    assert.equal(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date), "01:10");
    assert.equal(Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date), "01:10", "called without new, as libraries do");
    assert.equal(date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), "01:10");
    assert.equal(date.toLocaleDateString("en-CA"), "2026-09-05");
    assert.match(date.toLocaleString("en-GB"), /05\/09\/2026, 01:10/);
    assert.equal(new Intl.DateTimeFormat("en-GB").resolvedOptions().timeZone, "Africa/Cairo");
    assert.equal(
      new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date),
      "22:10",
      "an explicit zone is respected"
    );
    assert.equal(date.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }), "22:10");
    assert.ok(new Intl.DateTimeFormat() instanceof Intl.DateTimeFormat, "instanceof survives");
    assert.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(["en-GB"]), ["en-GB"], "statics survive");
    assert.equal(typeof new Intl.DateTimeFormat("en-GB").formatToParts, "function");
    assert.equal((1234.5).toLocaleString("en-US"), "1,234.5", "numbers are not dates");
  } finally {
    assert.equal(uninstallAppTimezoneDefaults(), true);
  }
  assert.equal(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date), nativeLocale, "natives restored");
});

test("the shim reads the zone at format time, so settings that arrive later win", () => {
  installAppTimezoneDefaults();
  try {
    const date = new Date(SUMMER_SALE);
    setAppTimezoneFromSettings({ "general.timezone": "Asia/Dubai" });
    assert.equal(getAppTimezone(), "Asia/Dubai");
    assert.equal(date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), "02:10");
    setAppTimezoneFromSettings({ "general.timezone": "Not/AZone" });
    assert.equal(getAppTimezone(), "Africa/Cairo", "an unusable zone falls back rather than throwing at every format");
    assert.equal(date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), "01:10");
  } finally {
    uninstallAppTimezoneDefaults();
    setAppTimezoneFromSettings({});
  }
});
