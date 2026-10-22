import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildGoogleMerchantFeedFromRows, excludedFromGoogleFeed } from "../../server/services/googleMerchantFeedService.js";
import { metaItemGroupId } from "../../server/services/metaCatalogFeedService.js";

// The models Meta rejected as counterfeit goods are what got Merchant Center disapproved for
// misrepresentation; the Google feed drops them through Meta's own group id (product-colour).
const group = metaItemGroupId({ product_id: 145, color: "Navy" });

test("a Google row of a Meta-rejected model is left out, its other colours are not", () => {
  const excluded = { ids: new Set(), groups: new Set([group]) };
  assert.equal(excludedFromGoogleFeed({ product_id: 145, variant_id: 9, color: "Navy" }, excluded), true);
  assert.equal(excludedFromGoogleFeed({ product_id: 145, variant_id: 10, color: "White" }, excluded), false);
  assert.equal(excludedFromGoogleFeed({ product_id: 145, variant_id: 9, color: "Navy" }, { ids: new Set(), groups: new Set() }), false);
  assert.equal(excludedFromGoogleFeed({ product_id: 7, variant_id: 3, color: "Red" }, { ids: new Set(["7-3"]), groups: new Set() }), true);
});

test("the feed builder skips excluded rows before building them", () => {
  const rows = [{ product_id: 145, variant_id: 9, color: "Navy" }];
  const out = buildGoogleMerchantFeedFromRows(rows, { excluded: { ids: new Set(), groups: new Set([group]) } });
  assert.equal(out.items.length, 0);
});

test("the Google feed loads the Meta exclusions on every rebuild", () => {
  const source = readFileSync(new URL("../../server/services/googleMerchantFeedService.js", import.meta.url), "utf8");
  assert.match(source, /const excluded = await loadMetaFeedExclusions\(\);/);
  assert.match(source, /buildGoogleMerchantFeedFromRows\(rows, \{ saleModeSettings, excluded \}\)/);
  assert.match(source, /if \(excluded && excludedFromGoogleFeed\(row, excluded\)\) continue;/);
});
