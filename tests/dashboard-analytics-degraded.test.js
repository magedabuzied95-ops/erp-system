import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { trackDashboardFailures, __testing } from "../server/services/dashboardAnalyticsService.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const analyticsSource = read("../server/services/dashboardAnalyticsService.js");
const controllerSource = read("../server/controllers/dashboardController.js");

test("no dashboard query groups by a bare column name", () => {
  /*
   * The marketing card was rejected on every request for weeks because it said
   * `GROUP BY source` while `orders` has a real column called `source`. Postgres resolves a
   * GROUP BY name to an INPUT column before an output alias, so it grouped by the wrong thing
   * and left the selected expression neither grouped nor aggregated (SQLSTATE 42803).
   *
   * The rule that prevents the whole class: never group by a bare name. An ordinal cannot be
   * shadowed by a column that exists today or one added next month, which is the part that
   * makes the sibling queries — they worked purely because no column happened to share their
   * alias — safe rather than lucky.
   */
  const offenders = [...analyticsSource.matchAll(/GROUP BY\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)]
    .map((match) => match[1])
    .filter((name) => !/^\d+$/.test(name));
  assert.deepEqual(
    offenders,
    [],
    `group by an ordinal instead: ${offenders.join(", ")}`
  );
});

test("a query that blew up is reported, not silently drawn as a zero", async () => {
  // safeQuery returning [] is deliberate — one broken panel must not take the dashboard down.
  // What was wrong is that the caller could not afterwards tell "nothing sold" from "the query
  // was rejected", and "0 sales from marketing" is a sentence somebody acts on.
  const clean = await trackDashboardFailures(async () => "ok");
  assert.equal(clean.result, "ok");
  assert.deepEqual(clean.failures, []);

  const broken = await trackDashboardFailures(async () => {
    __testing.recordDashboardFailure({ name: "marketing", code: "42803", message: "must appear in the GROUP BY clause" });
    return { channels: [], attributedSales: 0 };
  });
  assert.deepEqual(broken.result, { channels: [], attributedSales: 0 });
  assert.equal(broken.failures.length, 1);
  assert.equal(broken.failures[0].name, "marketing");
  assert.equal(broken.failures[0].code, "42803");
});

test("two dashboards answered at once do not inherit each other's failures", async () => {
  // The reason this uses AsyncLocalStorage and not a module-level array. Several dashboard
  // endpoints are requested together on every page load; a shared list would blame whichever
  // request happened to be in flight.
  const [failing, healthy] = await Promise.all([
    trackDashboardFailures(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      __testing.recordDashboardFailure({ name: "marketing", code: "42803", message: "boom" });
      return "failing";
    }),
    trackDashboardFailures(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "healthy";
    }),
  ]);
  assert.equal(failing.failures.length, 1);
  assert.deepEqual(healthy.failures, [], "a healthy request must not report another one's failure");
});

test("a failure recorded outside a tracked request does not throw", () => {
  // Crons, scripts and tests call these services with no request around them.
  assert.doesNotThrow(() => __testing.recordDashboardFailure({ name: "orphan", code: "", message: "" }));
});

test("the order-sources card is rendered, not just computed", () => {
  /*
   * The previous marketing panel lived in `secondarySections`, which the August redesign stopped
   * rendering while leaving the computation in place — so the data was fetched on every load,
   * stored, and drawn nowhere. A panel that exists only as a definition is the exact failure to
   * guard against, so this asserts the card is USED in the page, not merely declared.
   */
  const dashboard = read("../src/pages/Dashboard.jsx");
  assert.match(dashboard, /function MarketingSourcesCard\(/);
  assert.match(dashboard, /<MarketingSourcesCard marketing=\{data\.marketing\}/);

  // Marketing numbers follow the marketing permission. A cashier can see the till total without
  // being shown which campaign brought in how much.
  assert.match(dashboard, /const canViewMarketing = hasPermission\("marketing\.view", user\)/);
  assert.match(dashboard, /\{canViewMarketing \? \(\s*<div[^>]*>\s*<MarketingSourcesCard/);

  // A summary that points at the real screen, not a second attribution page.
  assert.match(dashboard, /to="\/marketing\/attribution"/);
});

test("the dashboard route actually reports what broke", () => {
  // The tracker is useless unwired: without these two the response still looks perfectly
  // healthy while a panel is drawing a number that came from an exception.
  assert.match(controllerSource, /trackDashboardFailures\(\(\) => handler\(req\)\)/);
  assert.match(controllerSource, /degraded: failures\.map/);
});
