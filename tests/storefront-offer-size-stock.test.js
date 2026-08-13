import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveStorefrontInStock } from "../server/controllers/storefrontController.js";

test("offer size filters always require an available variant", () => {
  assert.equal(resolveEffectiveStorefrontInStock({ offerStory: true, size: "44" }), true);
  assert.equal(resolveEffectiveStorefrontInStock({ offerStory: true, size: "" }), false);
  assert.equal(resolveEffectiveStorefrontInStock({ offerStory: false, size: "44" }), false);
  assert.equal(resolveEffectiveStorefrontInStock({ inStock: true }), true);
});
