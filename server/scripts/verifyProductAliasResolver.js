import assert from "node:assert/strict";
import { resolveProductAlias } from "../utils/productAliasResolver.js";

const cases = [
  { input: "جوردن فور", canonicalProduct: "jordan4" },
  { input: "جوردن 4", canonicalProduct: "jordan4" },
  { input: "AJ4", canonicalProduct: "jordan4" },
  { input: "شوكس", canonicalProduct: "nike_shox" },
  { input: "شوكس نايك", canonicalProduct: "nike_shox" },
  { input: "Nike Shox", canonicalProduct: "nike_shox" },
  { input: "اسكتشر", canonicalProduct: "skechers" },
  { input: "سكيتشر", canonicalProduct: "skechers" },
  { input: "سكتشر", canonicalProduct: "skechers" },
  { input: "Skechers", canonicalProduct: "skechers" },
  { input: "عايز شوكس", canonicalProduct: "nike_shox" },
  { input: "فيه جوردن فور؟", canonicalProduct: "jordan4" },
  { input: "ابعت صور اسكتشر", canonicalProduct: "skechers" },
];

for (const testCase of cases) {
  const result = resolveProductAlias(testCase.input);
  assert.equal(
    result.canonicalProduct,
    testCase.canonicalProduct,
    `Expected "${testCase.input}" to resolve to ${testCase.canonicalProduct}, got ${result.canonicalProduct || "null"}`
  );
  assert.ok(result.matchedAlias, `Expected "${testCase.input}" to produce a matched alias`);
  assert.ok(result.confidence >= 0.9, `Expected "${testCase.input}" to have confidence >= 0.9`);
  assert.ok(Array.isArray(result.searchTerms), `Expected "${testCase.input}" to include search terms`);
  assert.ok(result.searchTerms.length > 0, `Expected "${testCase.input}" to include search terms`);
  console.log(JSON.stringify({
    input: testCase.input,
    canonicalProduct: result.canonicalProduct,
    matchedAlias: result.matchedAlias,
    confidence: result.confidence,
    searchTerms: result.searchTerms,
  }));
}

const miss = resolveProductAlias("no match");
assert.equal(miss.canonicalProduct, null);
assert.equal(miss.matchedAlias, null);
assert.equal(miss.confidence, 0);

console.log(`Verified ${cases.length} Arabic product alias cases.`);
