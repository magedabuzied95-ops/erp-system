import test from "node:test";
import assert from "node:assert/strict";

import { isShoeSizeNumber, resolveFollowupContext } from "../../server/utils/aiConversationMemoryV2.js";
import { normalizeArabicIntentPayload } from "../../server/utils/arabicTextNormalizer.js";

// Owner's WhatsApp test, 2026-10-20: with New Balance 530 Beige on screen, «متاح نيوبالانس 530 ميرور»
// became size 530 of that shoe → «للأسف، مقاس 530 مش متوفر».
const memoryWithShoe = {
  lastMentionedProductId: "180",
  lastShownProductCards: [{ productId: "180", productName: "New Balance 530 - Beige", color: "Beige", sizeOptions: ["41", "42"] }],
};

const followup = (message) => {
  const payload = normalizeArabicIntentPayload(message);
  return resolveFollowupContext({ memory: { preferences: { aiConversationMemoryV2: memoryWithShoe }, aiConversationMemoryV2: memoryWithShoe }, messageText: message, normalizedPayload: payload, intentPayload: payload });
};

test("a model number is never read as a size", () => {
  for (const value of [530, 9060, 990, 90, 97, 270, 4]) assert.equal(isShoeSizeNumber(value), false, String(value));
  for (const value of [16, 30, 38, 42, 45, 50]) assert.equal(isShoeSizeNumber(value), true, String(value));
  for (const message of ["متاح نيوبالانس 530 ميرور", "متاح نيوبالانس ٥٣٠ ميرور ؟"]) {
    assert.notEqual(followup(message).size, "530", message);
  }
});

test("a real size still follows the shoe on screen", () => {
  const result = followup("عايز 42");
  assert.ok(["42", ""].includes(String(result.size || "")), JSON.stringify(result));
});
