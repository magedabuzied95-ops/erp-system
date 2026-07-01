import assert from "node:assert/strict";

import { executeAiRegressionMessageTest } from "../routes/aiRegressionHarness.js";

const main = async () => {
  const conversationId = "regression-multiturn-terrex-001";

  const firstTurn = await executeAiRegressionMessageTest({
    body: {
      tenant_id: 1,
      conversationId,
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

  assert.equal(firstTurn.status, 200, "first regression turn should succeed");
  assert.equal(firstTurn.body?.analysis?.product_card_count, 2, "product_card_count should be 2");
  assert.equal(firstTurn.body?.analysis?.current_stock, 40, "current_stock should use total_stock");
  assert.ok(!firstTurn.body?.failed_types?.includes("stock-unavailable"), "stock-unavailable must not be reported");
  assert.equal(firstTurn.body?.product_cards?.length, 2, "product_cards should keep both cards");

  const secondTurn = await executeAiRegressionMessageTest({
    body: {
      tenant_id: 1,
      conversationId,
      message: "لا مش عايز ده وريني بديل",
    },
  });

  assert.equal(secondTurn.status, 200, "second regression turn should succeed");
  assert.ok(secondTurn.body?.analysis?.memory_before?.last_product_cards_count > 0, "second turn should restore last_product_cards from session state");
  assert.ok(secondTurn.body?.analysis?.product_card_count > 0, "second turn should keep product cards");
  assert.ok(!secondTurn.body?.failed_types?.includes("stock-unavailable"), "second turn must not report stock-unavailable");
  assert.ok(secondTurn.body?.product_cards?.length > 0, "second turn should keep product cards");

  console.log("AI regression harness stock priority and multi-turn state passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
