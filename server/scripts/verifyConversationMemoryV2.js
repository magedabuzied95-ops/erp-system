import assert from "node:assert/strict";

import { buildConversationMemoryV2, resolveFollowupContext } from "../utils/aiConversationMemoryV2.js";
import { normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";

const baseCards = Array.from({ length: 10 }, (_, index) => ({
  productId: `p-${index + 1}`,
  productName: `Product ${index + 1}`,
  color: index % 2 === 0 ? "white" : "black",
  sizeOptions: ["42", "43"],
  imageUrl: `https://example.com/${index + 1}.jpg`,
  price: 1000 + index,
}));

const productAlias = {
  canonicalProduct: "nike_shox",
  matchedAlias: "شوكس",
  confidence: 0.98,
  searchTerms: ["nike shox", "shox"],
};

const initialPayload = normalizeArabicIntentPayload("عايز شوكس");
const memoryAfterAlias = buildConversationMemoryV2({
  existingMemory: null,
  messageText: "عايز شوكس",
  normalizedPayload: initialPayload,
  intentPayload: initialPayload,
  aliasResult: productAlias,
  shownProducts: baseCards,
  selectedProduct: baseCards[0],
});

assert.equal(memoryAfterAlias.lastMentionedCanonicalProduct, "nike_shox");
assert.equal(memoryAfterAlias.lastMentionedProductId, "p-1");
assert.equal(memoryAfterAlias.lastShownProductCards.length, 8);

const followupCases = [
  ["الأبيض", "color_followup", { color: "white" }],
  ["ابيض", "color_followup", { color: "white" }],
  ["مقاس ٤٢", "size_followup", { size: "42" }],
  ["42", "size_followup", { size: "42" }],
  ["صور تاني", "more_images_followup", { cards: 8 }],
  ["لون تاني", "alternative_followup", {}],
  ["هاخده", "buying_followup", {}],
];

for (const [message, expectedType, expectations] of followupCases) {
  const result = resolveFollowupContext({
    memory: memoryAfterAlias,
    messageText: message,
    normalizedPayload: normalizeArabicIntentPayload(message),
    intentPayload: normalizeArabicIntentPayload(message),
  });
  assert.equal(result.type, expectedType, `Unexpected follow-up for "${message}"`);
  if (expectations.color) assert.equal(result.color, expectations.color);
  if (expectations.size) assert.equal(result.size, expectations.size);
  if (expectations.cards !== undefined) assert.equal(Array.isArray(result.cards) ? result.cards.length : 0, expectations.cards);
}

const unknownResult = resolveFollowupContext({
  memory: null,
  messageText: "hello",
  normalizedPayload: normalizeArabicIntentPayload("hello"),
  intentPayload: normalizeArabicIntentPayload("hello"),
});
assert.equal(unknownResult.type, "none");

console.log("verifyConversationMemoryV2: ok");
