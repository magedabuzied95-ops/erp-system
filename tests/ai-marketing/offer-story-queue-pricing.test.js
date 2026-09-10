import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../../server/services/aiMarketingCenterService.js", import.meta.url),
  "utf8"
);

test("offer story queue pricing recovers the variant from saved story data", () => {
  assert.match(source, /q\.design_json->>'variant_id'/);
  assert.match(source, /q\.design_json->'slides'->0->>'variant_id'/);
  assert.match(source, /q\.design_json->'slides'->0->>'color_name'/);
  assert.match(source, /LEFT JOIN LATERAL \(\s*SELECT candidate\.\*/);
});

test("recovered offer variants are priced from the recovered size's invoice line", () => {
  const list = source.slice(source.indexOf("export const listAiMarketingQueue"), source.indexOf("const hydrateQueueStoryMetadata"));
  assert.match(list, /WITH \$\{AD_FEED_PURCHASE_CTES\}/);
  assert.match(list, /\) pv ON TRUE\s*\$\{AD_FEED_PURCHASE_JOINS\}/);
  assert.match(list, /pv\.id AS story_price_variant_id/);
  assert.match(list, /rawRow\.story_price_variant_id\s*\?\s*\{ id: rawRow\.story_price_variant_id, \.\.\.storyVariantPriceFields\(rawRow\) \}/);
  assert.match(list, /sale_mode_settings: saleModeSettings/);
});
