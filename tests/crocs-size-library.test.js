import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CROCS_C_SIZES,
  CROCS_EU_DOUBLE_SIZES,
  CROCS_J_SIZES,
  compareCrocsSizes,
  findDuplicateCrocsSize,
  normalizeCrocsSizeValue,
  sortCrocsSizes,
  uniqueCrocsSizes,
} from "../src/shared/lib/crocsSizes.js";
import { applyBulkSizesToGroups, sortProductSizes } from "../src/modules/products/lib/variantBulkSizes.js";

test("the unified library contains C4-C10, J1-J5, and every EU double size from 20/21 to 49/50", () => {
  assert.deepEqual(CROCS_C_SIZES, ["C4", "C5", "C6", "C7", "C8", "C9", "C10"]);
  assert.deepEqual(CROCS_J_SIZES, ["J1", "J2", "J3", "J4", "J5"]);
  assert.equal(CROCS_EU_DOUBLE_SIZES[0], "20/21");
  assert.equal(CROCS_EU_DOUBLE_SIZES.at(-1), "49/50");
  assert.equal(CROCS_EU_DOUBLE_SIZES.length, 30);
  assert.ok(CROCS_EU_DOUBLE_SIZES.includes("22/23"));
});

test("custom and typed Crocs sizes normalize whitespace and C/J casing without conversion", () => {
  assert.equal(normalizeCrocsSizeValue(" c6 "), "C6");
  assert.equal(normalizeCrocsSizeValue("j 3"), "J3");
  assert.equal(normalizeCrocsSizeValue(" 22 / 23 "), "22/23");
  assert.equal(normalizeCrocsSizeValue("C11"), "C11");
  assert.equal(normalizeCrocsSizeValue("M4/W6 - 23 CM"), "M4/W6 - 23 CM");
});

test("case-insensitive duplicates are rejected while unique custom sizes remain", () => {
  assert.equal(findDuplicateCrocsSize(["C6", " c6 "]), "C6");
  assert.deepEqual(uniqueCrocsSizes(["c6", "C6", "22 / 23", "22/23", "C11"]), ["C6", "22/23", "C11"]);
});

test("Crocs ordering is C, then J, then numeric EU doubles, with legacy values stable at the end", () => {
  const legacyA = "M4/W6 - 23 CM";
  const legacyB = "37";
  assert.deepEqual(
    sortCrocsSizes([legacyA, "23/24", "J5", "C10", legacyB, "22/23", "J4", "C9"]),
    ["C9", "C10", "J4", "J5", "22/23", "23/24", legacyA, legacyB]
  );
  assert.ok(compareCrocsSizes("C9", "C10") < 0);
  assert.ok(compareCrocsSizes("J4", "J5") < 0);
  assert.ok(compareCrocsSizes("22/23", "23/24") < 0);
  assert.deepEqual(sortProductSizes([{ size: "C10" }, { size: "C9" }]).map((row) => row.size), ["C9", "C10"]);
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
  assert.match(productsApiSource, /size:\s*normalizeText\(/);
  assert.doesNotMatch(posSource, /parseInt\([^\n]*(?:size|Size)/);
  assert.doesNotMatch(purchaseSource, /parseInt\([^\n]*(?:size|Size)/);
  assert.doesNotMatch(orderSource, /parseInt\([^\n]*(?:size|Size)/);
  assert.match(storefrontSource, /compareCrocsSizes/);
});

test("the selector is compact, multi-select, custom-size capable, and contains no forced conversion UI", () => {
  const source = fs.readFileSync(new URL("../src/modules/products/components/CrocsSizeSelector.jsx", import.meta.url), "utf8");
  assert.match(source, /selectedSizes/);
  assert.match(source, /مقاس آخر/);
  assert.match(source, /إضافة المقاسات المحددة/);
  assert.match(source, /لن يتم إجراء أي تحويل/);
  assert.doesNotMatch(source, /Crocs Adult|Crocs Kids|\bUS\b|\bCM\b/);
});
