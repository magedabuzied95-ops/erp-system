import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createDesignedStoryTextComposites, designedStoryBackgroundSvg, resolveDesignedStoryTheme, storyAssetImageSources } from "../../server/services/storyImageService.js";

const previewSource = fs.readFileSync(
  new URL("../../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url),
  "utf8"
);
const marketingServiceSource = fs.readFileSync(
  new URL("../../server/services/aiMarketingCenterService.js", import.meta.url),
  "utf8"
);

test("story renderer keeps the approved crimson commercial theme for every strategy", () => {
  assert.equal(resolveDesignedStoryTheme({ strategy_type: "new_arrivals" }).id, "new-arrival-crimson");
  assert.equal(resolveDesignedStoryTheme({ strategy_type: "last_size", stock: 1 }).id, "new-arrival-crimson");
  assert.equal(resolveDesignedStoryTheme({ layout_type: "special_offer_story" }).id, "new-arrival-crimson");
  assert.equal(resolveDesignedStoryTheme({ strategy_type: "featured" }).id, "new-arrival-crimson");
});

test("story source selection excludes the product cover from old and new queues", () => {
  const cover = "https://res.cloudinary.com/demo/image/upload/product-cover.webp";
  const variantOne = "https://res.cloudinary.com/demo/image/upload/variant-one.webp";
  const variantTwo = "https://res.cloudinary.com/demo/image/upload/variant-two.webp";
  assert.deepEqual(storyAssetImageSources({
    product_cover_image_url: cover,
    variant_image_url: variantOne,
    media_urls: [variantOne, variantTwo, cover],
  }, {
    product_cover_image_url: cover,
    source_media_urls: [variantOne, variantTwo, cover],
    slides: [{ image_url: cover }, { image_url: variantOne }],
  }), [variantOne, variantTwo]);
});

test("rendered 9:16 asset uses a clean product-first selling hierarchy", () => {
  const theme = resolveDesignedStoryTheme({ strategy_type: "last_size" });
  const svg = designedStoryBackgroundSvg({
    badge: "LAST SIZE",
    title: "Nike Air Max 97",
    price: "1750 EGP",
    sizes: "41 • 42 • 43",
    cta: "View details",
    brandName: "M1 Store",
    audioTitle: "Arabic trend audio",
    theme,
  });

  assert.match(svg, /width="1080" height="1920"/);
  assert.match(svg, /@font-face/);
  assert.match(svg, /data:font\/ttf;base64,/);
  assert.match(svg, /font-family:'M1Story'/);
  for (const value of ["FRESH DROP", "LAST SIZE", "Nike Air Max 97", "1750 EGP", "41 • 42 • 43", "View details"]) {
    assert.match(svg, new RegExp(value));
  }
  assert.doesNotMatch(svg, /M1 Store/i);
  assert.doesNotMatch(svg, /Arabic trend audio/i);
  assert.match(svg, /#ef4444/i);
});

test("story preview mirrors professional themes without store or audio chrome", () => {
  for (const marker of ["LAST SIZE", "SPECIAL OFFER", "FRESH DROP", "NEW COLLECTION", "theme.background", "theme.accent"]) {
    assert.match(previewSource, new RegExp(marker.replace(".", "\\.")));
  }
  assert.doesNotMatch(previewSource, />ERP<\/div>/);
  assert.doesNotMatch(previewSource, /storeLogo/);
  assert.doesNotMatch(previewSource, /story-creative-audio/);
  assert.match(previewSource, /const copyDirection = \/\[\\u0600-\\u06ff\]\//);
  assert.match(previewSource, /dir=\{copyDirection\}/);
  assert.match(previewSource, /from-red-100 via-red-400 to-rose-600/);
  assert.match(marketingServiceSource, /m1_story_current/);
  assert.doesNotMatch(marketingServiceSource, /ai_marketing_story_commercial_template_v10_no_product_cover/);
});

test("production story text is rasterized with the bundled font file", async () => {
  const theme = resolveDesignedStoryTheme({ strategy_type: "new_arrivals" });
  const composites = await createDesignedStoryTextComposites({
    badge: "NEW COLLECTION",
    title: "Adidas Terrex حذاء جديد",
    price: "1750 EGP",
    sizes: "41, 42, 43",
    cta: "View details",
    brandName: "M1 Store",
    theme,
  });
  assert.equal(composites.length, 6);
  for (const composite of composites) assert.ok(Buffer.isBuffer(composite.input) && composite.input.length > 100);
});
