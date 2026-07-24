import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  interleaveStoryTemplateVariants,
  productStoryAudience,
  productStoryTemplateVariant,
} from "../../server/services/aiMarketingCenterService.js";

const serviceSource = fs.readFileSync(
  new URL("../../server/services/aiMarketingCenterService.js", import.meta.url),
  "utf8"
);

test("story audience routing recognizes men, women, and kids product classifications", () => {
  assert.equal(productStoryAudience({ gender: "men" }), "men");
  assert.equal(productStoryAudience({ gender: "حريمي" }), "women");
  assert.equal(productStoryAudience({ category_name: "Kids Sneakers" }), "kids");
});

test("offers template is selected only from the product offers section flag", () => {
  assert.equal(productStoryTemplateVariant({ is_offer_story: true, gender: "women" }), "offers");
  assert.equal(productStoryTemplateVariant({ is_offer_story: false, sale_price: 500, gender: "women" }), "women");
  assert.equal(productStoryTemplateVariant({ sale_price_enabled: true, sale_price: 500, gender: "men" }), "men");
  assert.match(serviceSource, /COALESCE\(p\.is_offer_story, FALSE\) AS is_offer_story/);
  assert.match(serviceSource, /product\.is_offer_story === true && usableVariants\(product\)/);
  assert.doesNotMatch(serviceSource, /productStoryTemplateVariant[\s\S]{0,300}sale_price/);
});

test("story candidates are interleaved across audience and offers templates", () => {
  const item = (variant, id) => ({ product_id: id, design_json: { story_template_variant: variant } });
  const result = interleaveStoryTemplateVariants([
    item("men", 1),
    item("men", 2),
    item("women", 3),
    item("women", 4),
    item("kids", 5),
    item("offers", 6),
  ]);
  assert.deepEqual(
    result.map((row) => row.design_json.story_template_variant),
    ["men", "women", "kids", "offers", "men", "women"]
  );
});
