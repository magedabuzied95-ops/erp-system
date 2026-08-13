import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildAvailableProductsMessage,
  buildAvailableProductsUrl,
} from "../src/modules/aiSupport/utils/availableProductsLink.js";

test("offers-by-size link opens the website catalog with both offer and size filters", () => {
  const url = new URL(buildAvailableProductsUrl({ sizes: [43], offerStory: true }));
  assert.equal(url.pathname, "/share/available");
  assert.equal(url.searchParams.get("size"), "43");
  assert.equal(url.searchParams.get("offer_story"), "1");
  assert.equal(url.searchParams.get("inStock"), "1");
  assert.match(buildAvailableProductsMessage({ sizes: [43], offerStory: true, url: url.toString() }), /العروض/);
});

test("available-by-size picker exposes an independent offers chip and scopes both size APIs", () => {
  const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
  const pickerApi = fs.readFileSync(new URL("../src/modules/aiSupport/services/pickerSizesApi.js", import.meta.url), "utf8");
  const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  assert.match(picker, /selectedLinkOffers/);
  assert.match(picker, />\s*العروض\s*<\/button>/);
  assert.match(pickerApi, /params\.offer_story = 1/);
  assert.match(controller, /COALESCE\(p\.is_offer_story, FALSE\) = TRUE/);
});
