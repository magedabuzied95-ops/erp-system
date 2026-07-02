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
  assert.equal(firstTurn.body?.analysis?.brain_intent, "product_search", "first turn brain_intent should use product search context");
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
  assert.notEqual(String(secondTurn.body?.intent || "").toLowerCase(), "general", "second turn intent should not be general");
  assert.equal(secondTurn.body?.analysis?.brain_intent, "product_search", "second turn brain intent should use product search context");
  assert.notEqual(secondTurn.body?.reply, "أيوه متاح حاليًا.", "second turn should not fall back to the generic availability reply");
  assert.ok(/بديل|أقرب|المتاحة|شبيهه/i.test(secondTurn.body?.reply || ""), "second turn should read as a follow-up alternative reply");
  assert.ok(!secondTurn.body?.failed_types?.includes("stock-unavailable"), "second turn must not report stock-unavailable");
  assert.ok(secondTurn.body?.product_cards?.length > 0, "second turn should keep product cards");

  const generalTurn = await executeAiRegressionMessageTest({
    body: {
      tenant_id: 1,
      conversationId: `${conversationId}-general`,
      message: "ممكن توضحلي",
    },
  });

  assert.equal(generalTurn.status, 200, "general regression turn should succeed");
  assert.equal(generalTurn.body?.analysis?.brain_intent, "general", "general message without product context should stay general");
  assert.equal(generalTurn.body?.intent, "general", "general message without product context should keep general intent");
  assert.equal(generalTurn.body?.analysis?.product_card_count, 0, "general message without product context should not return product cards");

  const typoTurn = await executeAiRegressionMessageTest({
    body: {
      tenant_id: 1,
      conversationId: `${conversationId}-typo`,
      message: "عايز Adidss Terrex",
      product_query: "Terrex",
    },
  });

  assert.equal(typoTurn.status, 200, "typo regression turn should succeed");
  assert.equal(typoTurn.body?.analysis?.brain_intent, "product_search", "typo message with product context should use product search");
  assert.equal(typoTurn.body?.intent, "product_search", "typo message with product context should keep product search intent");

  console.log("AI regression harness stock priority and multi-turn state passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
