// The analytics window — "from the 1st at 2pm to the 2nd at 2am", not just "the 1st".
//
// Every analytics predicate used to be written against `::date`, which can only express
// whole calendar days: a shop whose night crosses midnight could not ask for its own
// night. The contract now carries a pair of instants and the services compare against
// those.
//
// Two things have to stay true at once, and both are tested here:
//   1. a request with no times must produce EXACTLY the window the day form produced, or
//      every number on every existing screen moves;
//   2. a request with times must produce the window that was asked for, down to the
//      minute, including its comparison period.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseAnalyticsFilters, parseTimeOfDay, windowClause } from "../../server/services/analytics/analyticsFilters.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const parse = (query) => parseAnalyticsFilters({ query, user: { tenant_id: 1 } });

/* ------------------------------------------------------ the whole-day window */

test("a request with no times is the same window the day form produced", () => {
  const filters = parse({ from: "2026-09-01", to: "2026-09-30" });

  // `to` is INCLUSIVE when no time is given, so the window runs to the moment the 1st of
  // October begins — which is what `($to::date + INTERVAL '1 day')` meant.
  assert.equal(filters.windowStart, "2026-09-01 00:00:00");
  assert.equal(filters.windowEnd, "2026-10-01 00:00:00");
  assert.equal(filters.fromTime, null);
  assert.equal(filters.toTime, null);
  assert.equal(filters.days, 30, "the inclusive day count must not change");
});

test("the comparison window of a whole-day request is unchanged", () => {
  const filters = parse({ from: "2026-09-01", to: "2026-09-30", compare: "previous_period" });

  assert.equal(filters.comparison.from, "2026-08-02");
  assert.equal(filters.comparison.to, "2026-08-31");
  assert.equal(filters.comparison.windowStart, "2026-08-02 00:00:00");
  assert.equal(filters.comparison.windowEnd, "2026-09-01 00:00:00");
});

test("a single whole day is one day, not an empty window", () => {
  const filters = parse({ from: "2026-09-01", to: "2026-09-01" });
  assert.equal(filters.windowStart, "2026-09-01 00:00:00");
  assert.equal(filters.windowEnd, "2026-09-02 00:00:00");
  assert.equal(filters.days, 1);
});

/* --------------------------------------------------------- the timed window */

test("a time on each end is honoured to the minute, and the end is exclusive", () => {
  // The owner's own example: the 1st at midnight to the 30th at midnight. The 30th is
  // NOT included — the window ends the moment that day begins, which is what a person
  // who names a time means.
  const filters = parse({ from: "2026-09-01", to: "2026-09-30", fromTime: "00:00", toTime: "00:00" });

  assert.equal(filters.windowStart, "2026-09-01 00:00:00");
  assert.equal(filters.windowEnd, "2026-09-30 00:00:00");
  assert.equal(filters.days, 29);
});

test("a shop night that crosses midnight is one window, not two days", () => {
  const filters = parse({ from: "2026-09-01", to: "2026-09-02", fromTime: "14:00", toTime: "02:00" });

  assert.equal(filters.windowStart, "2026-09-01 14:00:00");
  assert.equal(filters.windowEnd, "2026-09-02 02:00:00");
  assert.equal(filters.fromTime, "14:00:00");
  assert.equal(filters.toTime, "02:00:00");
  // Twelve hours is still a day's worth of bucketing and counts once against the cap.
  assert.equal(filters.days, 1);
});

test("one end may carry a time while the other runs the whole day", () => {
  const openEnded = parse({ from: "2026-09-01", to: "2026-09-02", fromTime: "14:00" });
  assert.equal(openEnded.windowStart, "2026-09-01 14:00:00");
  // No end time means the 2nd is still INCLUSIVE, so the window runs to the end of it.
  // The two ends keep their own meaning rather than one silently changing the other.
  assert.equal(openEnded.windowEnd, "2026-09-03 00:00:00");
  assert.equal(openEnded.toTime, null);
});

test("the previous period of a timed window is shifted by that window's own length", () => {
  const filters = parse({
    from: "2026-09-01", to: "2026-09-02", fromTime: "14:00", toTime: "02:00", compare: "previous_period",
  });

  // 12 hours back, ending exactly where this one starts. A day-based shift would have
  // compared a 12-hour night against a whole previous day.
  assert.equal(filters.comparison.windowStart, "2026-09-01 02:00:00");
  assert.equal(filters.comparison.windowEnd, "2026-09-01 14:00:00");
});

test("the previous month of a timed window keeps the same clock reading", () => {
  const filters = parse({
    from: "2026-09-10", to: "2026-09-11", fromTime: "14:00", toTime: "02:00", compare: "previous_month",
  });

  assert.equal(filters.comparison.windowStart, "2026-08-10 14:00:00");
  assert.equal(filters.comparison.windowEnd, "2026-08-11 02:00:00");
});

test("no comparison asked for means no comparison window, timed or not", () => {
  assert.equal(parse({ from: "2026-09-01", to: "2026-09-30" }).comparison, null);
  assert.equal(parse({ from: "2026-09-01", to: "2026-09-30", fromTime: "14:00" }).comparison, null);
});

/* ------------------------------------------------------------- what is refused */

test("a time that is not a time is refused rather than guessed at", () => {
  for (const value of ["25:00", "12:60", "noon", "14", "-1:00"]) {
    assert.equal(parseTimeOfDay(value), null, `${value} is not a time of day`);
    assert.throws(
      () => parse({ from: "2026-09-01", to: "2026-09-30", fromTime: value }),
      /TIME_INVALID|valid time/i,
      `${value} must be refused`
    );
  }
});

test("a time that is a time is normalised, not re-spelled downstream", () => {
  assert.equal(parseTimeOfDay("2:30"), "02:30:00");
  assert.equal(parseTimeOfDay("14:00"), "14:00:00");
  assert.equal(parseTimeOfDay("23:59:59"), "23:59:59");
  assert.equal(parseTimeOfDay(""), null);
  assert.equal(parseTimeOfDay(undefined), null);
});

test("a window that ends before it starts is refused, including a same-day one", () => {
  assert.throws(() => parse({ from: "2026-09-02", to: "2026-09-01" }), /DATE_RANGE_INVALID|after/i);
  assert.throws(
    () => parse({ from: "2026-09-01", to: "2026-09-01", fromTime: "14:00", toTime: "02:00" }),
    /DATE_RANGE_INVALID|end after/i,
    "2pm to 2am on the SAME day is an empty window, not a night"
  );
  assert.throws(
    () => parse({ from: "2026-09-01", to: "2026-09-01", fromTime: "10:00", toTime: "10:00" }),
    /DATE_RANGE_INVALID|end after/i,
    "a window of zero length holds nothing"
  );
});

test("a timed window still counts against the range cap", () => {
  assert.throws(
    () => parse({ from: "2024-01-01", to: "2026-09-30", fromTime: "14:00" }),
    (error) => error.code === "RANGE_TOO_LARGE"
  );
});

/* ------------------------------------------------- the services use the window */

test("the predicate helper is a half-open interval on both ends it is given", () => {
  assert.equal(
    windowClause("o.created_at", "$2", "$3"),
    "o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz"
  );
});

test("no analytics service still scopes a window by calendar day", async () => {
  // THE guard for this whole change. A service that goes back to `$from::date` silently
  // stops honouring the times: the request would be accepted, the screen would print the
  // hours it was asked for, and the numbers underneath would be whole days.
  const dir = new URL("../../server/services/analytics/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 10, `expected the analytics services, found ${files.length}`);

  for (const file of files) {
    const source = await read(`../../server/services/analytics/${file}`);
    // The contract's own file documents the old form in prose; everything else must not
    // contain it as code.
    if (file === "analyticsFilters.js") continue;
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\}::date\b/.test(code), `${file} still casts a bound window parameter to ::date`);
    // Not every `INTERVAL '1 day'` is a window: the velocity rule measures an age in
    // days and is none of this test's business. Only the window form is.
    assert.ok(!/::date \+ INTERVAL '1 day'/.test(code), `${file} still extends a window end by a whole day`);
  }
});

test("every service binds the window, never the day strings", async () => {
  for (const file of [
    "analyticsOverviewService.js",
    "analyticsSalesService.js",
    "analyticsCustomersService.js",
    "analyticsEmployeesService.js",
    "analyticsPurchasingService.js",
    "analyticsInventoryService.js",
    "analyticsFilterOptionsService.js",
  ]) {
    const source = await read(`../../server/services/analytics/${file}`);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/bind\(filters\.from\)|bind\(filters\.to\)|push\(filters\.from\)|push\(filters\.to\)|bind\(comparison\.from\)|bind\(comparison\.to\)/.test(code),
      `${file} binds a day string where the window belongs`
    );
  }
});
