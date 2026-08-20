import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildAvailableProductsMessage,
  buildAvailableProductsUrl,
} from "../src/modules/aiSupport/utils/availableProductsLink.js";
import {
  buildShareAvailableStorefrontFilters,
  buildShareAvailableTargetUrl,
} from "../server/controllers/publicProductsController.js";

// "مستورد فيتنامي" / "ميرور" / "محلي" are grade classification options
// (mirror_original / imported_from_vietnam / local). The picker sends the slug as
// ?quality=, which is the param /share/available forwards to the catalog.
test("available-by-size link carries the grade the picker chose", () => {
  const url = new URL(buildAvailableProductsUrl({
    sizes: [42],
    gender: "men",
    quality: "imported_from_vietnam",
  }));
  assert.equal(url.pathname, "/share/available");
  assert.equal(url.searchParams.get("size"), "42");
  assert.equal(url.searchParams.get("gender"), "men");
  assert.equal(url.searchParams.get("quality"), "imported_from_vietnam");
  assert.equal(url.searchParams.get("inStock"), "1");
});

test("available-by-size link omits the grade when no grade is selected", () => {
  const all = new URL(buildAvailableProductsUrl({ sizes: [42], quality: "all" }));
  const none = new URL(buildAvailableProductsUrl({ sizes: [42] }));
  assert.equal(all.searchParams.get("quality"), null);
  assert.equal(none.searchParams.get("quality"), null);
});

test("the sent message names the grade and audience the way the picker showed them", () => {
  const message = buildAvailableProductsMessage({
    sizes: [42],
    gender: "men",
    genderLabel: "رجالي",
    quality: "imported_from_vietnam",
    qualityLabel: "مستورد فيتنامي",
  }, "https://m1store-egy.com/share/available?size=42");
  assert.match(message, /رجالي/);
  assert.match(message, /مستورد فيتنامي/);
  assert.doesNotMatch(message, /imported_from_vietnam/);
  assert.doesNotMatch(message, /\bmen\b/);
});

test("grade + audience chips scope the size list and the match count, not just the link", () => {
  const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
  const pickerApi = fs.readFileSync(new URL("../src/modules/aiSupport/services/pickerSizesApi.js", import.meta.url), "utf8");
  const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

  // Both size endpoints receive the grade...
  assert.equal(picker.match(/grade: selectedLinkGrade,/g)?.length, 2);
  assert.match(pickerApi, /params\.grade = gradeValue/);
  // ...and the backend applies it to the products the sizes are derived from.
  assert.match(controller, /grade: req\.query\.grade,/);

  // Both chip rows are rendered, and the grade labels come from the shared
  // classification registry rather than a hard-coded list.
  assert.match(picker, /available-by-size-quality-/);
  assert.match(picker, /available-by-size-gender-/);
  assert.match(picker, /smartClassificationOptions\.grade/);
});

test("the link preview counts the same grade the shopper will land on", () => {
  assert.deepEqual(buildShareAvailableStorefrontFilters({
    filters: { quality: "mirror_original", inStock: true },
    normalizedSizes: ["42"],
  }), {
    brand: "",
    gender: "",
    productType: "",
    grade: "",
    quality: ["mirror", "mirror_original", "mirror original", "original_mirror", "original mirror"],
    size: "42",
    inStock: true,
    offerStory: false,
  });

  const target = new URL(buildShareAvailableTargetUrl({}, {
    sizes: ["42"],
    quality: "mirror_original",
    inStock: true,
  }));
  assert.equal(target.pathname, "/shop/products");
  assert.equal(target.searchParams.get("quality"), "mirror_original");
});
