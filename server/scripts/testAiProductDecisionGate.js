import assert from "node:assert/strict";

import { evaluateProductDecisionGate } from "../services/aiProductDecisionGate.js";

const card = (overrides = {}) => ({
  product_id: overrides.product_id || overrides.id || Math.random(),
  name: overrides.name || "Product",
  brand: overrides.brand || "",
  category: overrides.category || "sneaker",
  image_url: overrides.image_url || "/image.jpg",
  visual_confidence_score: overrides.visual_confidence_score ?? 0.7,
  visual_score_breakdown: overrides.visual_score_breakdown || {},
  ...overrides,
});

const names = (result) => result.products.map((product) => product.name);

{
  const result = evaluateProductDecisionGate({
    detectedIntent: "visual_search",
    metadata: {
      visual_query: "air jordan 4 black white sneaker",
      visual_pipeline: { raw_vision_response: { detected: { likely_model: "Air Jordan 4", brand_guess: "Jordan" } } },
    },
    productCards: [
      card({ product_id: 1, name: "Nike Air Jordan 4 Black Cat", visual_confidence_score: 0.9 }),
      card({ product_id: 2, name: "Nike Air Jordan 4 Military Black", visual_confidence_score: 0.86 }),
      card({ product_id: 3, name: "Nike Shox Black White", visual_confidence_score: 0.8 }),
    ],
  });
  assert.deepEqual(names(result), ["Nike Air Jordan 4 Black Cat", "Nike Air Jordan 4 Military Black"]);
}

{
  const result = evaluateProductDecisionGate({
    detectedIntent: "product_search",
    messageText: "Shox text",
    productCards: [
      card({ product_id: 1, name: "Nike Shox TL Black", visual_confidence_score: 0.82 }),
      card({ product_id: 2, name: "Nike Air Jordan 4", visual_confidence_score: 0.9 }),
    ],
  });
  assert.deepEqual(names(result), ["Nike Shox TL Black"]);
}

{
  const result = evaluateProductDecisionGate({
    detectedIntent: "visual_search",
    metadata: { visual_query: "black white low casual skate sneaker graphic side printed side dunk style" },
    productCards: [
      card({ product_id: 1, name: "Nike Dunk Low Graphic Black White", visual_confidence_score: 0.74 }),
      card({ product_id: 2, name: "Adidas Terrex Goretex Running Black White", visual_confidence_score: 0.84 }),
      card({ product_id: 3, name: "Nike Air Jordan 4 Black White", visual_confidence_score: 0.6 }),
    ],
  });
  assert.deepEqual(names(result), ["Nike Dunk Low Graphic Black White"]);
}

{
  const result = evaluateProductDecisionGate({
    detectedIntent: "product_search",
    messageText: "عايز جوردن فور",
    productCards: [
      card({ product_id: 1, name: "Nike Air Jordan 4", visual_confidence_score: 0.8 }),
      card({ product_id: 2, name: "Nike Shox", visual_confidence_score: 0.95 }),
    ],
  });
  assert.deepEqual(names(result), ["Nike Air Jordan 4"]);
}

{
  const result = evaluateProductDecisionGate({
    detectedIntent: "visual_search",
    metadata: { visual_query: "black white low sneaker" },
    memory: { rejectedProductIds: ["1"], rejectedModelNames: ["Nike Dunk"] },
    productCards: [
      card({ product_id: 1, name: "Nike Dunk Low Black White", visual_confidence_score: 0.9 }),
      card({ product_id: 2, name: "Nike Dunk Low Panda", visual_confidence_score: 0.88 }),
      card({ product_id: 3, name: "Vans Low Black White", visual_confidence_score: 0.72 }),
    ],
  });
  assert.deepEqual(names(result), ["Vans Low Black White"]);
  assert.equal(result.shouldSend, true);
}

console.log("AI product decision gate regression tests passed");
