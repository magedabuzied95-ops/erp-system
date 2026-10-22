import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { rejectionRowsFromProducts, reviewStatusCounts } from "../../server/modules/metaAds/metaAdsCatalogRejections.js";
import { excludedFromMetaFeed } from "../../server/services/metaCatalogFeedService.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// The catalogue had 291 items rejected as counterfeit goods (2026-10-22); left in the feed they
// were re-reviewed and re-emailed on every daily fetch.
test("only rejected products become exclusions", () => {
  const rows = rejectionRowsFromProducts([
    { retailer_id: "LAC-M-MIR-NAV-41", retailer_product_group_id: "145-navy", name: "Lacoste - Navy", review_status: "REJECTED" },
    { retailer_id: "ADS-1", retailer_product_group_id: "780-beige", name: "ADIDAS - Beige", review_status: "approved" },
    { retailer_id: "", review_status: "rejected" },
  ]);
  assert.deepEqual(rows, [{ retailer_id: "LAC-M-MIR-NAV-41", group_id: "145-navy", name: "Lacoste - Navy" }]);
});

test("the feed drops an excluded item and every size of a rejected group", () => {
  const excluded = { ids: new Set(["LAC-M-MIR-NAV-41"]), groups: new Set(["145-navy"]) };
  assert.equal(excludedFromMetaFeed({ id: "LAC-M-MIR-NAV-41", item_group_id: "145-navy" }, excluded), true);
  assert.equal(excludedFromMetaFeed({ id: "LAC-M-MIR-NAV-42", item_group_id: "145-navy" }, excluded), true);
  assert.equal(excludedFromMetaFeed({ id: "ADS-1", item_group_id: "780-beige" }, excluded), false);
  assert.equal(excludedFromMetaFeed({ id: "X", item_group_id: "" }, { ids: new Set(), groups: new Set([""]) }), false);
});

// Mutation guards: the feed filters on the exclusions, the sync is wired into "مزامنة" and the
// daily job, and the exclusion is sticky (no delete of rows Meta stopped reporting).
test("exclusions are applied to the feed and kept up to date", () => {
  const feed = read("../../server/services/metaCatalogFeedService.js");
  assert.match(feed, /\.filter\(\(item\) => !excludedFromMetaFeed\(item, excluded\)\)/);
  const routes = read("../../server/modules/metaAds/manager/list/list.routes.js");
  assert.match(routes, /\["catalog_rejections", syncCatalogRejections\]/);
  const jobs = read("../../server/modules/metaAds/integrations/integrations.jobs.js");
  assert.match(jobs, /syncAccounts\("job-insights-backfill", \{ days: 0, structure: false, rejections: true \}\)/);
  const sync = read("../../server/modules/metaAds/metaAdsCatalogRejections.js");
  // Graph's review_status filter returned nothing on the live catalogue: read all, filter here.
  assert.match(sync, /fields: "id,retailer_id,retailer_product_group_id,name,review_status"/);
  assert.doesNotMatch(sync, /filter: \{ review_status/);
  assert.match(sync, /catalog_review_statuses: statuses/);
  assert.doesNotMatch(sync, /DELETE FROM meta_catalog_feed_exclusions/);
});

test("the sync reports how many products sit in each review status", () => {
  assert.deepEqual(reviewStatusCounts([{ review_status: "approved" }, { review_status: "REJECTED" }, { review_status: "rejected" }, {}]), { approved: 1, rejected: 2, none: 1 });
});
