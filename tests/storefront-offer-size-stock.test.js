import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveEffectiveStorefrontInStock,
  storefrontCardHasAvailableSize,
} from "../server/controllers/storefrontController.js";

test("offer size filters always require an available variant", () => {
  assert.equal(resolveEffectiveStorefrontInStock({ offerStory: true, size: "44" }), true);
  assert.equal(resolveEffectiveStorefrontInStock({ offerStory: true, size: "" }), false);
  assert.equal(resolveEffectiveStorefrontInStock({ offerStory: false, size: "44" }), false);
  assert.equal(resolveEffectiveStorefrontInStock({ inStock: true }), true);
});

test("offer color cards only match an in-stock variant of the selected size", () => {
  const card = {
    variants: [
      { size: "44", stock: 0 },
      { size: "43", stock: 2 },
    ],
  };

  assert.equal(storefrontCardHasAvailableSize(card, "44"), false);
  assert.equal(storefrontCardHasAvailableSize(card, "43"), true);
});
