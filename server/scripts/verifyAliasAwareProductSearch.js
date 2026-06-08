import assert from "node:assert/strict";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";

const cases = [
  { input: "عايز شوكس", canonicalProduct: "nike_shox" },
  { input: "شوكس نايك مقاس ٤٢", canonicalProduct: "nike_shox", expectSize: true },
  { input: "ابعت صور اسكتشر", canonicalProduct: "skechers" },
  { input: "فيه جوردن فور؟", canonicalProduct: "jordan4" },
];

for (const testCase of cases) {
  const aliasResult = resolveProductAlias(testCase.input);
  const hints = buildAliasAwareSearchHints({ text: testCase.input, aliasResult });
  assert.equal(aliasResult.canonicalProduct, testCase.canonicalProduct, `Expected ${testCase.input} to resolve to ${testCase.canonicalProduct}`);
  assert.equal(hints.canonicalProduct, testCase.canonicalProduct, `Expected hints for ${testCase.input} to carry ${testCase.canonicalProduct}`);
  assert.equal(hints.hasAliasHint, true, `Expected ${testCase.input} to have alias hint`);
  assert.ok(Array.isArray(hints.searchTerms), "searchTerms should be an array");
  assert.ok(Array.isArray(hints.productQueryHints), "productQueryHints should be an array");
  assert.ok(hints.productQueryHints.length > 0, "productQueryHints should not be empty");
  if (testCase.expectSize) {
    assert.ok(/42/.test(hints.productQueryHints.join(" ")), "Expected size 42 to remain in query hints");
  }
  console.log(JSON.stringify({
    input: testCase.input,
    canonicalProduct: hints.canonicalProduct,
    searchTerms: hints.searchTerms,
    productQueryHints: hints.productQueryHints,
    hasAliasHint: hints.hasAliasHint,
  }));
}

const miss = buildAliasAwareSearchHints({ text: "unknown product", aliasResult: resolveProductAlias("unknown product") });
assert.equal(miss.hasAliasHint, false);
assert.deepEqual(miss.searchTerms, []);

console.log(`Verified ${cases.length} alias-aware product search cases.`);
