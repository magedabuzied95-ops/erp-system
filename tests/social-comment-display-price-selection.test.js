import test from "node:test";
import assert from "node:assert/strict";

import { selectPreferredSocialPriceCandidate } from "../server/utils/customerDisplayPrice.js";

const candidates = [
  { source: "product", field: "price", normalized_value: 1500 },
  { source: "productContext", field: "sale_price", normalized_value: 1500 },
  { source: "productContext", field: "selling_price", normalized_value: 1750 },
];

test("social replies use selling price while POS sale mode is disabled", () => {
  const selected = selectPreferredSocialPriceCandidate({ candidates, saleModeEnabled: false });
  assert.equal(selected?.field, "selling_price");
  assert.equal(selected?.normalized_value, 1750);
});

test("social replies use sale price while POS sale mode is enabled", () => {
  const selected = selectPreferredSocialPriceCandidate({ candidates, saleModeEnabled: true });
  assert.equal(selected?.field, "sale_price");
  assert.equal(selected?.normalized_value, 1500);
});
