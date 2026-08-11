import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CROCS_C_SIZES,
  CROCS_EU_DOUBLE_SIZES,
  CROCS_J_SIZES,
  CROCS_MW_SIZES,
  buildCrocsStorefrontSizeOptions,
  compareCrocsEuSizes,
  compareCrocsSizes,
  findDuplicateCrocsSize,
  normalizeCrocsSizeValue,
  resolveCrocsEuSize,
  sortCrocsSizes,
  uniqueCrocsSizes,
} from "../src/shared/lib/crocsSizes.js";
import { applyBulkSizesToGroups, sortProductSizes } from "../src/modules/products/lib/variantBulkSizes.js";

test("the unified library contains the approved C, J, M/W, and non-sequential EU ranges", () => {
  assert.deepEqual(CROCS_C_SIZES, ["C4", "C5", "C6", "C7", "C8", "C9", "C10"]);
  assert.deepEqual(CROCS_J_SIZES, ["J1", "J2", "J3", "J4", "J5"]);
  assert.deepEqual(CROCS_MW_SIZES.slice(2, 10), ["M4/W6", "M5/W7", "M6/W8", "M7/W9", "M8/W10", "M9/W11", "M10/W12", "M11/W13"]);
  assert.deepEqual(CROCS_MW_SIZES.slice(-6), ["M12", "M13", "M14", "M15", "M16", "M17"]);
  assert.equal(CROCS_EU_DOUBLE_SIZES[0], "19/20");
  assert.equal(CROCS_EU_DOUBLE_SIZES.at(-1), "52/53");
  assert.ok(CROCS_EU_DOUBLE_SIZES.includes("22/23"));
  assert.ok(CROCS_EU_DOUBLE_SIZES.includes("44/45"));
  assert.ok(!CROCS_EU_DOUBLE_SIZES.includes("21/22"));
});

test("custom and typed Crocs sizes normalize C, J, M/W, men-only, and EU without changing identity", () => {
  assert.equal(normalizeCrocsSizeValue(" c6 "), "C6");
  assert.equal(normalizeCrocsSizeValue("j 3"), "J3");
  assert.equal(normalizeCrocsSizeValue(" 22 / 23 "), "22/23");
  assert.equal(normalizeCrocsSizeValue(" m 6 / w 8 "), "M6/W8");
  assert.equal(normalizeCrocsSizeValue("m17"), "M17");
  assert.equal(normalizeCrocsSizeValue("C11"), "C11");
  assert.equal(normalizeCrocsSizeValue("M4/W6 - 23 CM"), "M4/W6 - 23 CM");
});

test("case-insensitive duplicates are rejected while unique custom sizes remain", () => {
  assert.equal(findDuplicateCrocsSize(["C6", " c6 "]), "C6");
  assert.deepEqual(uniqueCrocsSizes(["c6", "C6", "22 / 23", "22/23", "C11"]), ["C6", "22/23", "C11"]);
});

test("Crocs ordering is C, J, M/W, then numeric EU, with legacy values stable at the end", () => {
  const legacyA = "M4/W6 - 23 CM";
  const legacyB = "37";
  assert.deepEqual(
    sortCrocsSizes([legacyA, "23/24", "M10/W12", "J5", "C10", legacyB, "22/23", "M9/W11", "J4", "C9"]),
    ["C9", "C10", "J4", "J5", "M9/W11", "M10/W12", "22/23", "23/24", legacyA, legacyB]
  );
  assert.ok(compareCrocsSizes("C9", "C10") < 0);
  assert.ok(compareCrocsSizes("J4", "J5") < 0);
  assert.ok(compareCrocsSizes("M9/W11", "M10/W12") < 0);
  assert.ok(compareCrocsSizes("22/23", "23/24") < 0);
  assert.ok(compareCrocsEuSizes("39/40", "41/42") < 0);
  assert.deepEqual(sortProductSizes([{ size: "C10" }, { size: "C9" }]).map((row) => row.size), ["C9", "C10"]);
});

test("canonical storefront mapping resolves factory markings to EU and leaves unknown/direct EU safe", () => {
  assert.equal(resolveCrocsEuSize("C6"), "22/23");
  assert.equal(resolveCrocsEuSize("J5"), "37/38");
  assert.equal(resolveCrocsEuSize("M6/W8"), "38/39");
  assert.equal(resolveCrocsEuSize("M17"), "52/53");
  assert.equal(resolveCrocsEuSize("38/39"), "38/39");
  assert.equal(resolveCrocsEuSize("Factory X"), "Factory X");
});

test("storefront collisions remain separate real variants and retain their identifiers", () => {
  const variants = [
    { id: 917, size: "M6/W8", stock: 4, barcode: "ABC123" },
    { id: 918, size: "38/39", stock: 2, barcode: "XYZ789" },
  ];
  const options = buildCrocsStorefrontSizeOptions(variants);
  assert.equal(options.length, 2);
  assert.deepEqual(options.map((option) => option.displaySize), ["38/39", "38/39"]);
  assert.deepEqual(options.map((option) => option.variant.id), [917, 918]);
  assert.ok(options.every((option) => option.collision));
  assert.equal(options[0].variant.stock, 4);
  assert.equal(options[0].variant.barcode, "ABC123");
});

test("multi-select adds only missing sizes to the requested color and preserves existing variant identity", () => {
  const existing = {
    id: "saved-row",
    variantId: 901,
    size: "C6",
    stock: "7",
    barcode: "KEEP-BARCODE",
    sku: "KEEP-SKU",
  };
  const otherColor = {
    id: "white",
    sizes: [{ id: "white-c6", variantId: 902, size: "C6", stock: "4", barcode: "WHITE-BARCODE" }],
  };
  const result = applyBulkSizesToGroups({
    groups: [{ id: "black", image_url: "/black.jpg", sizes: [existing] }, otherColor],
    sizes: ["c6", "C7", "C8", "22 / 23"].map(normalizeCrocsSizeValue),
    targetGroupId: "black",
  });

  assert.equal(result.addedCount, 3);
  assert.deepEqual(result.groups[0].sizes.map((row) => row.size), ["C6", "C7", "C8", "22/23"]);
  assert.equal(result.groups[0].sizes[0], existing);
  assert.equal(result.groups[0].sizes[0].variantId, 901);
  assert.equal(result.groups[0].sizes[0].stock, "7");
  assert.equal(result.groups[0].sizes[0].barcode, "KEEP-BARCODE");
  assert.equal(result.groups[1], otherColor);
});

test("variant, POS, purchase, order, and storefront contracts keep Crocs sizes as strings", () => {
  const productsApiSource = fs.readFileSync(new URL("../src/modules/products/services/productsApi.js", import.meta.url), "utf8");
  const posSource = fs.readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  const purchaseSource = fs.readFileSync(new URL("../server/routes/purchases.js", import.meta.url), "utf8");
  const orderSource = fs.readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");
  const storefrontSource = fs.readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const checkoutSource = fs.readFileSync(new URL("../src/storefront/components/StorefrontCheckoutSummary.jsx", import.meta.url), "utf8");
  assert.match(productsApiSource, /size:\s*normalizeText\(/);
  assert.doesNotMatch(posSource, /parseInt\([^\n]*(?:size|Size)/);
  assert.doesNotMatch(purchaseSource, /parseInt\([^\n]*(?:size|Size)/);
  assert.doesNotMatch(orderSource, /parseInt\([^\n]*(?:size|Size)/);
  assert.match(storefrontSource, /compareCrocsSizes/);
  assert.match(storefrontSource, /variant_id:\s*variant\.id/);
  assert.match(storefrontSource, /size:\s*originalSize/);
  assert.match(storefrontSource, /display_size:\s*displaySize/);
  assert.match(checkoutSource, /item\.display_size, item\.size/);
});

test("the selector is compact, multi-select, custom-size capable, and contains no forced conversion UI", () => {
  const source = fs.readFileSync(new URL("../src/modules/products/components/CrocsSizeSelector.jsx", import.meta.url), "utf8");
  assert.match(source, /selectedSizes/);
  assert.match(source, /مقاس آخر/);
  assert.match(source, /إضافة المقاسات المحددة/);
  assert.match(source, /CROCS_SIZE_GROUPS/);
  assert.match(source, /لن يتم إجراء أي تحويل/);
  assert.doesNotMatch(source, /Crocs Adult|Crocs Kids|\bUS\b|\bCM\b/);
});
