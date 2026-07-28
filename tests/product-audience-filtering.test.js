import assert from "node:assert/strict";
import test from "node:test";

import { getProductAudienceValues, productMatchesAudience } from "../src/shared/lib/productAudiences.js";

test("a product assigned to men and women matches either filter", () => {
  const product = { gender: "men", audiences: ["men", "women"] };
  assert.deepEqual(getProductAudienceValues(product), ["men", "women"]);
  assert.equal(productMatchesAudience(product, "men"), true);
  assert.equal(productMatchesAudience(product, "women"), true);
  assert.equal(productMatchesAudience(product, "kids"), false);
});

test("combined labels and variant audiences are merged with product audiences", () => {
  const product = {
    product_audiences: ["women"],
    variants: [{ variant_audience: "men + women" }, { variant_gender: "أطفال" }],
  };
  assert.deepEqual(getProductAudienceValues(product), ["men", "women", "kids"]);
});
