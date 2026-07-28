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

test("recovered offer variants still use purchase sale and selling prices", () => {
  assert.match(source, /preview_purchase_price\.purchase_selling_price/);
  assert.match(source, /preview_purchase_price\.purchase_sale_price/);
  assert.match(source, /isOfferStory && storedSalePrice > 0 && storedSalePrice < regularPrice/);
});
