import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8"
);

test("storefront SQL orders regular products before offer-story products", () => {
  assert.match(source, /ORDER BY\s+CASE\s+WHEN \$6::boolean = TRUE THEN 0\s+WHEN COALESCE\(array_length\(\$10::text\[\], 1\), 0\) > 0 THEN 0\s+WHEN COALESCE\(p\.is_offer_story, FALSE\) = TRUE THEN 1\s+ELSE 0\s+END ASC,\s+p\.id DESC/);
});

test("the offers-only page keeps its existing order", () => {
  assert.match(source, /WHEN \$6::boolean = TRUE THEN 0/);
  assert.match(source, /keepOfferCardsAfterRegularCards\(sortedExpandedProducts, effectiveOfferStoryOnly \|\| sizes\.length > 0\)/);
  assert.match(source, /if \(offerStoryOnly\) return rows/);
});

test("size filtering keeps offer products mixed in the selected storefront sort", () => {
  assert.match(source, /WHEN COALESCE\(array_length\(\$10::text\[\], 1\), 0\) > 0 THEN 0/);
  assert.match(source, /effectiveOfferStoryOnly \|\| sizes\.length > 0/);
});

test("backend color-card expansion cannot move offers ahead before pagination", () => {
  assert.match(source, /const keepOfferCardsAfterRegularCards =/);
  assert.match(source, /return \[\.\.\.regular, \.\.\.offers\]/);
  assert.match(source, /const orderedExpandedProducts = perf\.sync\("offer_ordering", \(\) => keepOfferCardsAfterRegularCards/);
  assert.match(source, /categoryProducts\.slice\(offset, offset \+ limit\)/);
  assert.ok(source.indexOf("keepOfferCardsAfterRegularCards(sortedExpandedProducts") < source.indexOf("categoryProducts.slice(offset, offset + limit)"));
});

test("normalization preserves the database offer-story flag for expanded cards", () => {
  assert.match(source, /is_offer_story:\s*row\.is_offer_story === true \|\|\s*String\(row\.is_offer_story \|\| ""\)\.toLowerCase\(\) === "true"/);
  assert.match(source, /cards\.push\(\{\s*\.\.\.product,/);
});
