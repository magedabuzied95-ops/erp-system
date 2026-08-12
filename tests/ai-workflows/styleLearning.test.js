// Phase 11.2 — bounded style learning: corrections must be injected as STYLE EXAMPLES (tone/phrasing), never
// as reusable factual answer memory. The grounding gate stays last + authoritative (asserted elsewhere).

import test from "node:test";
import assert from "node:assert/strict";
import { buildReplyCorrectionContextSource } from "../../server/services/aiCorrectionMemoryService.js";

const CORRECTION = {
  id: 2,
  customer_question: "عندكم جوردن فور مقاس 45؟",
  ai_wrong_answer: "أيوه 👍 المنتج مقاس 45 متوفر حاليًا (3 قطع بس). تحب أجهزلك الطلب؟",
  employee_correct_answer: "أيوه متاح إن شاء الله 🌹",
  correction_type: "incomplete_answer",
  product_id: 39,
  conversation_id: "facebook_messenger:5036593356360590",
};

test("correction is framed as a STYLE EXAMPLE, not factual answer memory", () => {
  const [block] = buildReplyCorrectionContextSource([CORRECTION], "عندكم نايك اير ماكس مقاس 44؟");
  assert.match(block.title, /STYLE EXAMPLE/);
  assert.match(block.content, /Imitate ONLY the tone/i);
  assert.match(block.content, /phrasing/i);
  // explicitly forbids reusing facts from the example
  assert.match(block.content, /NEVER copy the specific stock count, price, size availability, product/);
  // the preferred phrasing (the style signal) is present
  assert.match(block.content, /أيوه متاح إن شاء الله/);
});

test("STYLE EXAMPLE does NOT present the old stock count as a fact to reuse", () => {
  const [block] = buildReplyCorrectionContextSource([CORRECTION], "q");
  // the old '3 قطع' appears only inside the 'style to avoid' phrasing line, never as a standalone fact label
  assert.doesNotMatch(block.content, /Available: |In stock: |Stock: 3|السعر:|المتاح:/);
  // and it is labelled as style-to-avoid, not authoritative
  assert.match(block.content, /style to avoid/);
});
