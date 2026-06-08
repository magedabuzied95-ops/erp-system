import assert from "node:assert/strict";

import { normalizeArabicIntentPayload } from "../utils/arabicTextNormalizer.js";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";
import {
  buildAiBrainUnificationContext,
  scoreAiBrainUnificationBoost,
} from "../services/aiSimilarProductsService.js";
import { buildConversationMemoryV2 } from "../utils/aiConversationMemoryV2.js";

const makeProduct = (id, name, extra = {}) => ({
  id,
  product_id: id,
  name,
  brand: extra.brand || "",
  model: extra.model || "",
  category: extra.category || "shoes",
  product_type: extra.product_type || "sneaker",
  seo_keywords: extra.seo_keywords || "",
  total_stock: extra.total_stock ?? 3,
  variants: Array.isArray(extra.variants) ? extra.variants : [{ id: `${id}-v1`, color: extra.color || "white", size: extra.size || "42", stock: extra.total_stock ?? 3 }],
});

const buildContext = ({ text, memoryV2 = null, usedInAlternatives = true } = {}) => {
  const intentPayload = normalizeArabicIntentPayload(text);
  const aliasResult = resolveProductAlias(text);
  const searchHints = buildAliasAwareSearchHints({ text, aliasResult });
  return buildAiBrainUnificationContext({
    messageText: text,
    normalizedPayload: intentPayload,
    intentPayload,
    aliasResult,
    searchHints,
    memoryV2,
    usedInAlternatives,
    channel: "unit-test",
  });
};

const nikeShox = makeProduct(101, "Nike Shox TL", {
  brand: "Nike",
  model: "Shox TL",
  seo_keywords: "nike shox tl shox",
});
const nikeAir = makeProduct(102, "Nike Air Force 1", {
  brand: "Nike",
  model: "Air Force 1",
  seo_keywords: "nike air force",
});
const jordan4 = makeProduct(103, "Air Jordan 4", {
  brand: "Jordan",
  model: "4",
  seo_keywords: "jordan 4 aj4",
});
const jordan1 = makeProduct(104, "Air Jordan 1", {
  brand: "Jordan",
  model: "1",
  seo_keywords: "jordan 1",
});
const skechers = makeProduct(105, "Skechers Go Walk", {
  brand: "Skechers",
  model: "Go Walk",
  seo_keywords: "skechers walk",
});
const runningShoe = makeProduct(106, "Running Shoe", {
  brand: "Generic",
  model: "Runner",
  seo_keywords: "running shoe",
});

const shoxContext = buildContext({ text: "عايز شوكس" });
assert.equal(shoxContext.canonicalProduct, "nike_shox");
assert.ok(shoxContext.searchTerms.length > 0);
assert.ok(shoxContext.searchTerms.some((term) => /shox|شوكس/i.test(term)));
assert.ok(scoreAiBrainUnificationBoost({ product: nikeShox, brainContext: shoxContext }).boost > scoreAiBrainUnificationBoost({ product: nikeAir, brainContext: shoxContext }).boost);

const shoxMemory = buildConversationMemoryV2({
  existingMemory: null,
  messageText: "عايز شوكس",
  normalizedPayload: normalizeArabicIntentPayload("عايز شوكس"),
  intentPayload: normalizeArabicIntentPayload("عايز شوكس"),
  aliasResult: resolveProductAlias("عايز شوكس"),
  searchHints: buildAliasAwareSearchHints({ text: "عايز شوكس", aliasResult: resolveProductAlias("عايز شوكس") }),
  shownProducts: [nikeShox],
  selectedProduct: nikeShox,
  selectedColor: "white",
  selectedSize: "42",
});

const alternativeContext = buildContext({ text: "بديل", memoryV2: shoxMemory });
assert.equal(alternativeContext.canonicalProduct, "nike_shox");
assert.equal(alternativeContext.memoryProductId, "101");
assert.ok(scoreAiBrainUnificationBoost({ product: nikeShox, brainContext: alternativeContext }).boost >= scoreAiBrainUnificationBoost({ product: nikeAir, brainContext: alternativeContext }).boost);

const colorMemory = buildConversationMemoryV2({
  existingMemory: shoxMemory,
  messageText: "الأبيض",
  normalizedPayload: normalizeArabicIntentPayload("الأبيض"),
  intentPayload: normalizeArabicIntentPayload("الأبيض"),
  aliasResult: resolveProductAlias("الأبيض"),
  searchHints: buildAliasAwareSearchHints({ text: "الأبيض", aliasResult: resolveProductAlias("الأبيض") }),
  shownProducts: [nikeShox],
  selectedProduct: nikeShox,
  selectedColor: "white",
  selectedSize: "42",
});

const colorFollowupContext = buildContext({ text: "لون تاني", memoryV2: colorMemory });
assert.equal(colorFollowupContext.memoryProductId, "101");
assert.equal(colorFollowupContext.canonicalProduct, "nike_shox");

const sizeMemory = buildConversationMemoryV2({
  existingMemory: shoxMemory,
  messageText: "مقاس ٤٢",
  normalizedPayload: normalizeArabicIntentPayload("مقاس ٤٢"),
  intentPayload: normalizeArabicIntentPayload("مقاس ٤٢"),
  aliasResult: resolveProductAlias("مقاس ٤٢"),
  searchHints: buildAliasAwareSearchHints({ text: "مقاس ٤٢", aliasResult: resolveProductAlias("مقاس ٤٢") }),
  shownProducts: [nikeShox],
  selectedProduct: nikeShox,
  selectedColor: "white",
  selectedSize: "42",
});

const sizeFollowupContext = buildContext({ text: "42", memoryV2: sizeMemory });
assert.equal(sizeFollowupContext.memoryProductId, "101");

const jordanContext = buildContext({ text: "جوردن فور" });
assert.equal(jordanContext.canonicalProduct, "jordan4");
assert.ok(scoreAiBrainUnificationBoost({ product: jordan4, brainContext: jordanContext }).boost > scoreAiBrainUnificationBoost({ product: jordan1, brainContext: jordanContext }).boost);

const skechersContext = buildContext({ text: "اسكتشر" });
assert.equal(skechersContext.canonicalProduct, "skechers");
assert.ok(scoreAiBrainUnificationBoost({ product: skechers, brainContext: skechersContext }).boost > scoreAiBrainUnificationBoost({ product: runningShoe, brainContext: skechersContext }).boost);

const unknownContext = buildContext({ text: "qwerty zzz", usedInAlternatives: true });
assert.equal(unknownContext.canonicalProduct, null);
assert.equal(unknownContext.searchTerms.length, 0);
assert.equal(scoreAiBrainUnificationBoost({ product: nikeShox, brainContext: null }).boost, 0);
assert.equal(scoreAiBrainUnificationBoost({ product: nikeShox, brainContext: unknownContext }).boost, 0);

console.log("[verifyAiBrainUnification] ok");
