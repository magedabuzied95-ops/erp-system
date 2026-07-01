import assert from "node:assert/strict";

import { executeAiRegressionMessageTest } from "../routes/aiRegressionHarness.js";

const main = async () => {
  const result = await executeAiRegressionMessageTest({
    body: {
      tenant_id: 1,
      message: "Nike Dunk",
      product_query: "Nike Dunk",
      intent: "product_search",
      product_cards: [
        {
          id: 101,
          product_id: 101,
          name: "Nike Dunk Low Black",
          title: "Nike Dunk Low Black",
          stock: 0,
          total_stock: 40,
          availability: "available",
          product_url: "https://example.com/products/nike-dunk-low-black",
        },
        {
          id: 102,
          product_id: 102,
          name: "Nike Dunk Low White",
          title: "Nike Dunk Low White",
          stock: 0,
          total_stock: 17,
          availability: "available",
          product_url: "https://example.com/products/nike-dunk-low-white",
        },
      ],
    },
  });

  assert.equal(result.status, 200, "regression harness should succeed");
  assert.equal(result.body?.analysis?.product_card_count, 2, "product_card_count should be 2");
  assert.equal(result.body?.analysis?.current_stock, 40, "current_stock should use total_stock");
  assert.ok(!result.body?.failed_types?.includes("stock-unavailable"), "stock-unavailable must not be reported");
  assert.equal(result.body?.product_cards?.length, 2, "product_cards should keep both cards");

  console.log("AI regression harness stock priority passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
