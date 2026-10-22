import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BREAKDOWNS, breakdownValueOf } from "../../server/modules/metaAds/metaAdsCatalog.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a composite breakdown joins its parts, an hour keeps only the clock", () => {
  assert.equal(breakdownValueOf({ publisher_platform: "instagram", platform_position: "instagram_reels" }, "placement"), "instagram / instagram_reels");
  assert.equal(breakdownValueOf({ publisher_platform: "facebook" }, "platform"), "facebook");
  assert.equal(breakdownValueOf({ device_platform: "mobile_app" }, "device"), "mobile_app");
  assert.equal(breakdownValueOf({ region: "Cairo Governorate" }, "region"), "Cairo Governorate");
  assert.equal(breakdownValueOf({ hourly_stats_aggregated_by_advertiser_time_zone: "21:00:00 - 21:59:59" }, "hour"), "21:00");
  assert.equal(breakdownValueOf({}, "age"), "unknown");
  assert.equal(breakdownValueOf({ age: "25-34" }, "nope"), "unknown");
});

test("every chart breakdown the drawer offers is a Graph breakdown the sync can ask for", () => {
  const drawer = read("../../src/modules/metaAds/manager/list/ChartsDrawer.jsx");
  const offered = drawer.match(/const BREAKDOWNS = \[([^\]]+)\]/)[1].match(/"([a-z_]+)"/g).map((item) => item.replace(/"/g, ""));
  assert.deepEqual(offered.sort(), Object.keys(BREAKDOWNS).sort());
  for (const key of Object.keys(BREAKDOWNS)) {
    assert.ok(Array.isArray(BREAKDOWNS[key]) && BREAKDOWNS[key].length, key);
    for (const locale of ["ar", "en"]) {
      const labels = JSON.parse(read(`../../src/locales/${locale}/metaAdsManager.json`)).charts.breakdowns;
      assert.ok(labels[key], `${locale} label for ${key}`);
    }
  }
  const core = read("../../server/modules/metaAds/metaAdsCore.js");
  assert.match(core, /breakdowns: apiFields\.join\(","\)/);
  assert.match(core, /const value = breakdownValueOf\(row, breakdown\)/);
});

// The hourly pass keeps the last days fresh; the daily pass pulls the whole history so a day
// the hourly pass never saw is filled in. Both are mutation guards on the job file.
test("insights are refreshed hourly and backfilled daily over the whole history", () => {
  const jobs = read("../../server/modules/metaAds/integrations/integrations.jobs.js");
  assert.match(jobs, /name: "meta-ads-insights-refresh", everyMinutes: 60/);
  assert.match(jobs, /name: "meta-ads-insights-backfill", everyMinutes: 1440/);
  assert.match(jobs, /syncAccounts\("job-insights", \{ days: 3, structure: true \}\)/);
  assert.match(jobs, /syncAccounts\("job-insights-backfill", \{ days: 0, structure: false \}\)/);
  const core = read("../../server/modules/metaAds/metaAdsCore.js");
  assert.match(core, /: \{ date_preset: "maximum" \}/, "days = 0 asks Meta for the whole history");
  assert.match(core, /time_increment: 1/);
});
