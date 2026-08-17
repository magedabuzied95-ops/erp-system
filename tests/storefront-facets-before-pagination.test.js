import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { storefrontCardHasAvailableSize } from "../server/controllers/storefrontController.js";

const source = fs.readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8"
);

const card = (sizes = []) => ({
  variants: sizes.map(([size, stock]) => ({ size, stock })),
});

test("a card matches when any one of the selected sizes is in stock", () => {
  const bag = card([["16-inch", 0], ["18-inch", 2]]);
  assert.equal(storefrontCardHasAvailableSize(bag, ["16-inch", "18-inch"]), true);
  assert.equal(storefrontCardHasAvailableSize(bag, ["16-inch"]), false);
  assert.equal(storefrontCardHasAvailableSize(bag, "18-inch"), true);
  assert.equal(storefrontCardHasAvailableSize(bag, "16-inch,18-inch"), true);
  assert.equal(storefrontCardHasAvailableSize(bag, []), true);
});

test("repeated query values survive normalization instead of collapsing to the first", () => {
  assert.match(source, /const queryTextList = \(\.\.\.values\) =>/);
  assert.match(source, /sizes: queryTextList\(query\.size, query\.sizes\)/);
  assert.match(source, /colors: queryTextList\(query\.color, query\.colors\)/);
  assert.match(source, /bagType: queryTextList\(query\.bag_type, query\.bagType\)/);
});

test("the SQL size predicate accepts a list of sizes", () => {
  assert.match(source, /LOWER\(TRIM\(COALESCE\(pv_size\.size, ''\)\)\) = ANY\(\$10::text\[\]\)/);
  assert.match(source, /LOWER\(TRIM\(COALESCE\(p\.bag_type, ''\)\)\) = ANY\(\$15::text\[\]\)/);
});

test("every card facet is applied before the page is cut, so a page is never short", () => {
  const facetsAt = source.indexOf("const facetFilteredProducts");
  const sizeGateAt = source.indexOf("const sizeAvailableProducts");
  const sliceAt = source.indexOf("categoryProducts.slice(offset, offset + limit)");
  const totalAt = source.indexOf("const total = categoryProducts.length");

  assert.ok(sizeGateAt > 0 && facetsAt > sizeGateAt, "size gate then card facets");
  assert.ok(sliceAt > facetsAt, "facets must run before pagination");
  assert.ok(totalAt > facetsAt, "the reported total must count the filtered set");
});
