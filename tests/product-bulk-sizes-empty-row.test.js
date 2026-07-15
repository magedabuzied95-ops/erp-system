import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBulkSizesToGroups,
  createVariantRow,
} from "../src/modules/products/lib/variantBulkSizes.js";

test("bulk sizes replaces the default empty row even after it inherits the color image and an automatic barcode", () => {
  const starterRow = createVariantRow({
    price: 1200,
    image_url: "/products/black.webp",
  });

  const result = applyBulkSizesToGroups({
    groups: [{
      id: "black",
      color: "Black",
      image_url: "/products/black.webp",
      sizes: [starterRow],
    }],
    sizes: ["41", "42", "43"],
    price: 1200,
  });

  assert.equal(result.groups[0].sizes.length, 3);
  assert.deepEqual(result.groups[0].sizes.map((row) => row.size), ["41", "42", "43"]);
  assert.equal(result.groups[0].sizes.some((row) => !String(row.size || "").trim()), false);
});

test("bulk sizes removes every untouched empty row instead of leaving a default blank size", () => {
  const result = applyBulkSizesToGroups({
    groups: [{
      id: "green",
      color: "Green",
      image_url: "/products/green.webp",
      sizes: [
        createVariantRow({ image_url: "/products/green.webp" }),
        createVariantRow({ image_url: "/products/green.webp", isStarter: false }),
      ],
    }],
    sizes: ["40", "41"],
  });

  assert.deepEqual(result.groups[0].sizes.map((row) => row.size), ["40", "41"]);
  assert.equal(result.groups[0].sizes.some((row) => !String(row.size || "").trim()), false);
});

test("bulk sizes preserves a blank row when it contains a manually entered barcode", () => {
  const manualRow = createVariantRow({
    barcode: "MANUAL-100",
    barcodeManualOverride: true,
  });

  const result = applyBulkSizesToGroups({
    groups: [{ id: "navy", color: "Navy", sizes: [manualRow] }],
    sizes: ["42"],
  });

  assert.equal(result.groups[0].sizes.length, 2);
  assert.equal(result.groups[0].sizes[0].barcode, "MANUAL-100");
  assert.equal(result.groups[0].sizes[1].size, "42");
});
