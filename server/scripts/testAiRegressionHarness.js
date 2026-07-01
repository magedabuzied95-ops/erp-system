import assert from "node:assert/strict";

import { buildRegressionSeedProductCards } from "../routes/aiRegressionHarness.js";

const main = async () => {
  const cards = await buildRegressionSeedProductCards({
    tenantId: 1,
    message: "Adidas Terrex",
    productQuery: "Adidas Terrex",
    rawSeedProductCards: [],
    intent: "product_search",
  });

  assert.ok(Array.isArray(cards), "cards should be an array");
  assert.ok(cards.length > 0, "product_query should seed product cards");
  assert.ok(Number(cards[0].total_stock) > 0, "top seeded card should be sellable");
  assert.notEqual(Number(cards[0].id), 25, "zero-stock product must not outrank sellable result");

  console.log("AI regression harness search fallback passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
