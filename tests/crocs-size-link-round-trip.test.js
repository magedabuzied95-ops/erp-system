import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildAvailableProductsMessage,
  buildAvailableProductsUrl,
} from "../src/modules/aiSupport/utils/availableProductsLink.js";
import { crocsSizeAliases, crocsSizeKey, resolveCrocsEuSize } from "../src/shared/lib/crocsSizes.js";
import { expandCrocsSizeFilter } from "../server/controllers/storefrontController.js";

const listingSource = fs.readFileSync("src/storefront/pages/StorefrontProductListingPage.jsx", "utf8");
const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");

// A Crocs variant is stored under the factory marking (C8, M7/W9) and printed
// on the storefront card as the EU label (24/25, 39/40). Every size link the
// business mints — the AI inbox picker, the guided Messenger flow, the size
// availability service — carries the marking, so the listing that receives it
// has to recognise both or the customer opens an empty page.

test("the size link keeps the factory marking the warehouse and the backend share", () => {
  const url = new URL(buildAvailableProductsUrl({ sizes: ["C8"], type: "crocs" }));
  assert.deepEqual(url.searchParams.getAll("size"), ["C8"]);
  assert.equal(url.searchParams.get("type"), "crocs");
});

test("the customer reads the marking and the EU label the site will show", () => {
  const message = buildAvailableProductsMessage({ sizes: ["C8", "M7/W9"] }, "https://m1store-egy.com/share/available");
  assert.match(message, /C8 \(24\/25\)/);
  assert.match(message, /M7\/W9 \(39\/40\)/);
  // A size that is already an EU label is not annotated with itself, and a
  // plain footwear size is left exactly as the picker showed it.
  assert.equal(buildAvailableProductsMessage({ sizes: ["24/25"] }, "x").includes("24/25 (24/25)"), false);
  assert.match(buildAvailableProductsMessage({ sizes: ["42"] }, "x"), /المقاس 42/);
});

test("a Crocs listing folds an incoming size param onto the EU label it renders", () => {
  const start = listingSource.indexOf("const isCrocsListing =");
  const end = listingSource.indexOf("const bagType =", start);
  const source = listingSource.slice(start, end);

  assert.match(source, /const selectedSizes = useMemo\(/);
  assert.match(source, /requestedSizes\.map\(\(value\) => resolveCrocsEuSize\(value\)\)/);
  assert.match(source, /: requestedSizes\)/);
  assert.match(listingSource, /import \{ crocsSizeAliases, resolveCrocsEuSize \} from "\.\.\/\.\.\/shared\/lib\/crocsSizes"/);
  // The chip the customer taps and a marking that arrived in a link have to
  // collapse to one URL entry instead of two.
  assert.match(listingSource, /const listingSizeKey = \(value\) => normalizeFilterKey\(isCrocsListing \? resolveCrocsEuSize\(value\) : value\)/);
  assert.match(listingSource, /readMultiQueryValues\(next, \["size", "sizes"\]\)\.map\(listingSizeKey\)/);
});

test("one EU label names every marking behind it", () => {
  assert.deepEqual(crocsSizeAliases("C8"), ["C8", "24/25"]);
  assert.deepEqual(crocsSizeAliases("24/25"), ["24/25", "C8"]);
  // 34/35 is J3 *and* M3/W5 — a chip that folds two markings has to filter on both.
  assert.deepEqual(crocsSizeAliases("34/35"), ["34/35", "J3", "M3/W5"]);
  assert.deepEqual(crocsSizeAliases("m7/w9"), ["M7/W9", "39/40"]);
  // A factory EU size the chart never aliased, and a plain footwear size, stand alone.
  assert.deepEqual(crocsSizeAliases("29/30"), ["29/30"]);
  assert.deepEqual(crocsSizeAliases("42"), ["42"]);
  assert.deepEqual(crocsSizeAliases(""), []);
});

test("the backend expands a Crocs size filter, and only a Crocs one", () => {
  assert.deepEqual(expandCrocsSizeFilter(["C8"], "crocs"), ["C8", "24/25"]);
  assert.deepEqual(expandCrocsSizeFilter(["24/25"], "كروكس"), ["24/25", "C8"]);
  assert.deepEqual(expandCrocsSizeFilter(["24/25", "C8"], "crocs"), ["24/25", "C8"]);
  // Off a Crocs listing "24/25" means the size written on the shoe, nothing else.
  assert.deepEqual(expandCrocsSizeFilter(["24/25"], "sneakers"), ["24/25"]);
  assert.deepEqual(expandCrocsSizeFilter(["24/25"], ""), ["24/25"]);
  assert.deepEqual(expandCrocsSizeFilter([], "crocs"), []);
});

test("a Crocs size is cut by the backend, not by a pass over an already-paginated page", () => {
  // The count in the header comes from the backend, so a size folded after
  // pagination said "1-24 of 42" over four cards and hid the rest on page 2.
  assert.match(listingSource, /const backendSizes = useMemo\(/);
  assert.match(listingSource, /selectedSizes\.flatMap\(\(value\) => \{/);
  assert.match(listingSource, /const aliases = crocsSizeAliases\(value\)/);
  assert.match(listingSource, /size: backendSizes,/);

  const start = listingSource.indexOf("const catalogFiltersWithoutGender = useMemo(");
  const end = listingSource.indexOf("const hasActiveCatalogFilters", start);
  assert.match(listingSource.slice(start, end), /sizes: \[\],/);
});

test("the size matcher accepts either Crocs alias for the same variant", () => {
  const start = storefrontSource.indexOf("const productHasAvailableSize = (product = {}, size = \"\") => {");
  const end = storefrontSource.indexOf("const compareAvailableSizeOptions", start);
  const source = storefrontSource.slice(start, end);

  assert.match(source, /const crocsTarget = crocsProduct \? crocsSizeKey\(resolveCrocsEuSize\(size\)\) : ""/);
  assert.match(source, /if \(!crocsProduct\) return originalSize === target/);
  assert.match(source, /originalSize === target \|\| crocsSizeKey\(resolveCrocsEuSize\(variant\?\.size\)\) === crocsTarget/);
  assert.match(storefrontSource, /^\s+crocsSizeKey,$/m);

  // The fold the matcher leans on: the marking and the printed label are one key.
  assert.equal(crocsSizeKey(resolveCrocsEuSize("C8")), crocsSizeKey("24/25"));
  assert.equal(crocsSizeKey(resolveCrocsEuSize("m7/w9")), crocsSizeKey("39/40"));
  assert.notEqual(crocsSizeKey(resolveCrocsEuSize("C8")), crocsSizeKey("25/26"));
});
