/*
 * The server keeps the shop's clock.
 *
 * The database session went to Africa/Cairo on 2026-08-31, but the Node process stayed on UTC,
 * so every "today" the server derived on its own — attendance defaults, expense dates, report
 * presets, the staff-task digest key — was Greenwich's day: yesterday, between midnight and
 * 03:00 Cairo. `server/utils/appTimezone.js` is the one authority now, and
 * `server/utils/bootstrapTimezone.js` puts the process clock on the same zone and pins the `date`
 * column parser to UTC midnight so a Cairo process cannot read attendance days a day early.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, new URL("../", import.meta.url)), "utf8");

// Start foreign on purpose; the bootstrap module must correct it.
process.env.TZ = "America/New_York";
const bootstrap = await import("../server/utils/bootstrapTimezone.js");
const tz = await import("../server/utils/appTimezone.js");

const SUMMER_SALE = "2026-09-04T22:10:00.000Z"; // 01:10 Cairo, 5 September (+03)
const WINTER_SALE = "2026-01-14T23:10:00.000Z"; // 01:10 Cairo, 15 January (+02)

test("importing the bootstrap module puts the process clock on the shop's zone", () => {
  assert.equal(process.env.TZ, "Africa/Cairo");
  assert.equal(bootstrap.processTimeZone.timeZone, "Africa/Cairo");
  assert.equal(new Date(SUMMER_SALE).getHours(), 1, "getHours() now answers on the Cairo wall clock");
  assert.equal(new Date(WINTER_SALE).getHours(), 1, "in winter too — a zone name, not an offset");
  assert.equal(tz.processClockMatchesAppTimeZone(), true);
});

test("a date column is parsed at UTC midnight regardless of the process clock", () => {
  // node-postgres' default would give local midnight: 2026-08-30T21:00:00Z on a Cairo process,
  // and every attendance_date in the API would read a day early.
  const parsed = bootstrap.parseDateColumnAtUtcMidnight("2026-08-31");
  assert.equal(parsed.toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(parsed.toISOString().slice(0, 10), "2026-08-31", "the wire format the frontend has always received");
  assert.equal(tz.dateKeyInAppTimeZone(parsed), "2026-08-31", "and the Cairo calendar agrees");
  assert.equal(bootstrap.parseDateColumnAtUtcMidnight(null), null);
  assert.equal(bootstrap.parseDateColumnAtUtcMidnight("infinity"), Infinity);
});

test("the installed pg parser is the UTC-midnight one", async () => {
  const pg = (await import("pg")).default;
  const parse = pg.types.getTypeParser(1082);
  assert.equal(parse("2026-08-31").toISOString(), "2026-08-31T00:00:00.000Z");
  const parseArray = pg.types.getTypeParser(1182);
  assert.deepEqual(parseArray("{2026-08-31,2026-09-01}").map((d) => d.toISOString()), ["2026-08-31T00:00:00.000Z", "2026-09-01T00:00:00.000Z"]);
});

test("today and day keys come from the shop's calendar", () => {
  assert.equal(tz.dateKeyInAppTimeZone(SUMMER_SALE), "2026-09-05");
  assert.equal(tz.dateKeyInAppTimeZone(WINTER_SALE), "2026-01-15");
  assert.equal(tz.clockInAppTimeZone(SUMMER_SALE), "01:10");
  assert.equal(tz.toDateKey("2026-08-31"), "2026-08-31", "a bare day is literal");
  assert.equal(tz.toDateKey(new Date(SUMMER_SALE)), "2026-09-05");
  assert.equal(tz.toDateKey(""), "");
  assert.match(tz.todayInAppTimeZone(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(tz.todayInAppTimeZone(), tz.dateKeyInAppTimeZone(new Date()));
});

test("calendar arithmetic never touches a zone", () => {
  assert.equal(tz.shiftDateKey("2026-09-05", -29), "2026-08-07");
  assert.equal(tz.shiftDateKey("2026-04-24", 1), "2026-04-25", "across the DST switch");
  assert.deepEqual(tz.monthBoundsOfDateKey("2026-02-10"), { start: "2026-02-01", end: "2026-02-28", period: "2026-02" });
});

test("wall clock ↔ instant follows the season", () => {
  assert.equal(tz.wallClockToInstant("2026-09-05T01:10").toISOString(), SUMMER_SALE);
  assert.equal(tz.wallClockToInstant("2026-01-15 01:10").toISOString(), WINTER_SALE);
  assert.equal(tz.startOfDayInAppTimeZone("2026-09-05").toISOString(), "2026-09-04T21:00:00.000Z");
  assert.equal(tz.startOfDayInAppTimeZone("2026-01-15").toISOString(), "2026-01-14T22:00:00.000Z");
  assert.equal(tz.wallClockToInstant(""), null);
});

test("an unusable configured zone falls back to Cairo instead of crashing boot", () => {
  assert.equal(tz.setAppTimeZoneForTesting("Not/AZone"), "Africa/Cairo");
  assert.equal(tz.setAppTimeZoneForTesting("Asia/Dubai"), "Asia/Dubai");
  assert.equal(tz.dateKeyInAppTimeZone(SUMMER_SALE), "2026-09-05");
  assert.equal(tz.clockInAppTimeZone(SUMMER_SALE), "02:10");
  tz.setAppTimeZoneForTesting("Africa/Cairo");
});

test("report presets are built from day keys, not from local-midnight Dates", async () => {
  // A local-midnight Date run through toISOString() lands on the previous day east of Greenwich.
  const source = read("server/services/reportsService.js");
  assert.doesNotMatch(source, /start\.setDate\(today\.getDate\(\)/, "the old preset arithmetic is gone");
  assert.doesNotMatch(source, /previousEnd\.setDate/, "and so is the previous-period one");
  assert.match(source, /shiftDateKey\(today, -6\)/);
  assert.match(source, /shiftDateKey\(today, -29\)/);
});

test("the server has no process-UTC 'today' left in request handlers", () => {
  const files = [
    "server/controllers/attendanceController.js",
    "server/routes/expenses.js",
    "server/services/salesCommissionService.js",
    "server/services/staffTaskEmailNotificationService.js",
    "server/services/reportsService.js",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/, `${file} still asks UTC what day it is`);
    assert.doesNotMatch(read(file), /Date\.now\(\) - 29 \* 86400000\)\.toISOString\(\)\.slice/, `${file} still builds ranges on UTC`);
  }
});

test("server.js and db.js import the bootstrap first", () => {
  assert.match(read("server/server.js").split("\n")[0], /import "\.\/utils\/bootstrapTimezone\.js";/);
  assert.match(read("server/database/db.js").split("\n")[0], /import "\.\.\/utils\/bootstrapTimezone\.js";/);
});

test("the frontend installs the default-zone shim before the first render", () => {
  const main = read("src/main.jsx");
  assert.match(main, /installAppTimezoneDefaults\(\);/);
  assert.ok(main.indexOf("installAppTimezoneDefaults();") < main.indexOf("createRoot"), "before React mounts");
});
