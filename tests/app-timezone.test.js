import { test, expect, beforeEach } from "vitest";

import {
  APP_TIMEZONE_DEFAULT,
  getAppTimezone,
  instantToWallClock,
  setAppTimezoneFromSettings,
  wallClockToInstant,
} from "../src/shared/lib/appTimezone.js";

/**
 * The store's clock. Timestamps stay UTC on the wire and in the database; these helpers only
 * translate the wall clock an operator types into the instant it actually is.
 *
 * The bug that prompted this: a coupon campaign told to start at 20:11 in Cairo was stored as
 * 20:11Z and did not go live until 23:11 local, so every sale in between printed no voucher.
 */

beforeEach(() => {
  setAppTimezoneFromSettings({});
});

test("defaults to Cairo when the tenant has set nothing", () => {
  expect(getAppTimezone()).toBe(APP_TIMEZONE_DEFAULT);
  expect(APP_TIMEZONE_DEFAULT).toBe("Africa/Cairo");
});

test("the tenant's own zone wins, and nonsense falls back", () => {
  expect(setAppTimezoneFromSettings({ "general.timezone": "Europe/Berlin" })).toBe("Europe/Berlin");
  expect(setAppTimezoneFromSettings({ "general.timezone": "Not/AZone" })).toBe("Africa/Cairo");
  expect(setAppTimezoneFromSettings({ "general.timezone": "   " })).toBe("Africa/Cairo");
});

test("the exact case that broke: 20:11 typed in Cairo is 17:11Z", () => {
  // Egypt runs summer time in August, so the offset is +3 here.
  expect(wallClockToInstant("2026-08-23T20:11")).toBe("2026-08-23T17:11:00.000Z");
});

test("a campaign started 'now' is live immediately, not three hours later", () => {
  const startedAt = new Date(wallClockToInstant("2026-08-23T20:11"));
  const serverNow = new Date("2026-08-23T17:20:00.000Z");
  expect(startedAt <= serverNow).toBe(true);
});

test("the offset is computed, not assumed — winter is +2, summer +3", () => {
  expect(wallClockToInstant("2026-01-15T20:11")).toBe("2026-01-15T18:11:00.000Z");
  expect(wallClockToInstant("2026-08-15T20:11")).toBe("2026-08-15T17:11:00.000Z");
});

test("round trip returns the same wall clock the operator typed", () => {
  for (const typed of ["2026-08-23T20:11", "2026-01-15T09:05", "2026-12-31T23:59"]) {
    expect(instantToWallClock(wallClockToInstant(typed))).toBe(typed);
  }
});

test("an instant reads back as the store's wall clock, not the browser's", () => {
  setAppTimezoneFromSettings({ "general.timezone": "Africa/Cairo" });
  expect(instantToWallClock("2026-08-23T17:11:00.000Z")).toBe("2026-08-23T20:11");
  setAppTimezoneFromSettings({ "general.timezone": "UTC" });
  expect(instantToWallClock("2026-08-23T17:11:00.000Z")).toBe("2026-08-23T17:11");
});

test("blank and unparseable values never throw and never invent a date", () => {
  expect(wallClockToInstant("")).toBeNull();
  expect(wallClockToInstant(null)).toBeNull();
  expect(wallClockToInstant("not a date")).toBeNull();
  expect(instantToWallClock("")).toBe("");
  expect(instantToWallClock("nonsense")).toBe("");
});
