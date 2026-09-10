import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { __aiMarketingCenterTestHooks } from "../../server/services/aiMarketingCenterService.js";

const { makeFocusedCreative, priceStorySlides, storyItemPriceStamp, storyDesignSlideForSource } = __aiMarketingCenterTestHooks;

// Product 61 (Nike Air Force 1) went out as six stories, one per colour, every one of them at the
// first colour's 1,200 although the colours are priced differently.
const airForce = () => ({
  id: 61,
  name: "Nike Air Force 1",
  price: 1200,
  selling_price: 1200,
  variants: [
    { id: 1792, color: "Black", size: "41", stock: 2, selling_price: 1200, price: 1200, primary_image_url: "https://res.cloudinary.com/demo/image/upload/black.webp" },
    { id: 1832, color: "Brown", size: "42", stock: 1, selling_price: 1450, price: 1450, primary_image_url: "https://res.cloudinary.com/demo/image/upload/brown.webp" },
    { id: 1886, color: "Green", size: "45", stock: 3, selling_price: 1350, price: 1350, sale_price: 1100, sale_price_enabled: true, primary_image_url: "https://res.cloudinary.com/demo/image/upload/green.webp" },
  ],
});

test("a multi-colour story prices every colour's slide from that colour", () => {
  const product = airForce();
  const item = makeFocusedCreative({
    product,
    variant: product.variants[0],
    contentType: "story",
    strategy: "catalog_coverage",
    layoutType: "catalog_product_story",
  });
  const byColour = Object.fromEntries(item.design_json.slides.map((slide) => [slide.color_name, slide]));
  assert.equal(byColour.Black.current_price, 1200);
  assert.equal(byColour.Brown.current_price, 1450);
  assert.equal(byColour.Black.old_crossed_price, null);
  assert.equal(byColour.Brown.old_crossed_price, null);
  // The story itself still reads the primary colour.
  assert.equal(item.design_json.current_price, 1200);
});

test("hydration re-prices each slide by its own variant and clears a borrowed strike price", () => {
  const slides = [
    { variant_id: 1792, color_name: "Black", price: 1200, current_price: 1200, old_crossed_price: 1500 },
    { variant_id: 1832, color_name: "Brown", price: 1200, current_price: 1200, old_crossed_price: 1500 },
    { variant_id: 9999, color_name: "Gone", price: 1200, current_price: 1200 },
  ];
  const pricing = new Map([
    ["1792", { current_price: 1200, old_crossed_price: 1500 }],
    ["1832", { current_price: 1450, old_crossed_price: 0 }],
  ]);
  const priced = priceStorySlides(slides, pricing, { current_price: 1200, old_crossed_price: 1500 });
  assert.deepEqual(priced.map((slide) => slide.current_price), [1200, 1450, 1200]);
  assert.deepEqual(priced.map((slide) => slide.old_crossed_price), [1500, null, 1500]);
  assert.equal(priced[1].compare_at_price, null);
});

test("the rendered-price stamp carries every colour, so a one-price image is re-rendered", () => {
  const story = (slides) => ({ current_price: 1200, design_json: { current_price: 1200, slides } });

  // Every slide at the story's price keeps the one-price stamp: nothing to re-render.
  const uniform = story([{ current_price: 1200 }, { current_price: 1200 }]);
  assert.equal(storyItemPriceStamp(uniform), "1200|0");

  // The image already queued printed 1200 on Brown; once Brown is priced 1450 the stamp moves.
  const perColour = story([{ current_price: 1200 }, { current_price: 1450 }]);
  assert.notEqual(storyItemPriceStamp(perColour), storyItemPriceStamp(uniform));
  assert.notEqual(
    storyItemPriceStamp(perColour),
    storyItemPriceStamp(story([{ current_price: 1200 }, { current_price: 1300 }]))
  );

  // A colour's own discount is part of its stamp, and the story's discount does not leak onto it.
  const discounted = story([{ current_price: 1200 }, { current_price: 1100, old_crossed_price: 1450 }]);
  assert.match(storyItemPriceStamp(discounted), /1100\|1450/);
  const storyDiscount = { current_price: 1200, old_crossed_price: 1500, design_json: { slides: [{ current_price: 1450, old_crossed_price: null }] } };
  assert.match(storyItemPriceStamp(storyDiscount), /;1450\|0$/);
});

test("the renderer and the editor preview never lend the first colour's strike price to another", () => {
  const renderer = fs.readFileSync(new URL("../../server/services/storyImageService.js", import.meta.url), "utf8");
  const editor = fs.readFileSync(new URL("../../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url), "utf8");
  assert.match(renderer, /const originalPrice = slideOwnsPrice \? slideOriginalPrice : slideOriginalPrice \|\| storyOriginalPrice;/);
  assert.match(renderer, /\.\.\.\(slideOwnsPrice \? \{ old_price: "", original_price: "", regular_price: "" \} : \{\}\)/);
  assert.match(editor, /\(\(slide\.current_price \|\| slide\.price\) \? "" : base\.old_crossed_price\)/);
});

test("a rendered slide keeps the colour it was drawn from when the cover dropped out", () => {
  const slides = [
    { image_url: "https://res.cloudinary.com/demo/image/upload/cover.webp", variant_id: 1792, current_price: 1200 },
    { image_url: "https://res.cloudinary.com/demo/image/upload/brown.webp", variant_id: 1832, current_price: 1450 },
  ];
  // The renderer drew brown.webp as its first image; the saved slide must be Brown's, not index 0's.
  assert.equal(storyDesignSlideForSource(slides, "https://res.cloudinary.com/demo/image/upload/brown.webp", 0).variant_id, 1832);
  assert.equal(storyDesignSlideForSource(slides, "https://res.cloudinary.com/demo/image/upload/unknown.webp", 1).variant_id, 1832);
});
