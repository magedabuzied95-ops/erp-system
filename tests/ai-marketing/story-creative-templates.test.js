import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";

import {
  createDesignedStoryTextComposites,
  designedStoryBackgroundSvg,
  resolveDesignedStoryTheme,
  STORY_RENDERER_BUILD,
  STORY_RENDERER_NAME,
  storyAssetImageSources,
} from "../../server/services/storyImageService.js";

const rendererSource = fs.readFileSync(
  new URL("../../server/services/storyImageService.js", import.meta.url),
  "utf8"
);

test("story renderer uses one new collection implementation for every strategy", () => {
  assert.equal(STORY_RENDERER_NAME, "m1_story_new_collection");
  assert.equal(STORY_RENDERER_BUILD, "m1-story-new-collection-v5-english-sans-2026-07-24");
  for (const strategy of ["new_arrivals", "last_size", "special_offer", "featured"]) {
    assert.equal(resolveDesignedStoryTheme({ strategy_type: strategy }).id, "m1-new-collection-v3");
  }
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

test("rendered 9:16 markup is the new collection product layout", () => {
  const svg = designedStoryBackgroundSvg({
    title: "Nike Air Max 97",
    price: "1750 EGP",
    sizes: "41, 42, 43",
    theme: resolveDesignedStoryTheme(),
  });
  assert.match(svg, /width="1080" height="1920"/);
  assert.match(svg, /@font-face/);
  assert.match(svg, /Nike Air Max 97/);
  assert.match(svg, /1750 EGP/);
  assert.match(svg, /NEW COLLECTION/);
  assert.match(svg, /View details/);
  assert.match(svg, /#ef4444|#dc2626/i);
  assert.doesNotMatch(svg, /m1-clean-product-v2|#0f766e/i);
});

test("renderer source permanently excludes the removed white clean-product template", () => {
  assert.match(rendererSource, /NEW COLLECTION/);
  assert.doesNotMatch(rendererSource, /m1_story_clean_product|m1-clean-product-v2|#0f766e/i);
});

test("production story text is rasterized with the canonical sans font", async () => {
  const composites = await createDesignedStoryTextComposites({
    title: "Adidas Terrex حذاء جديد",
    price: "1750 EGP",
    sizes: "41, 42, 43",
    theme: resolveDesignedStoryTheme(),
  });
  assert.equal(composites.length, 6);
  for (const composite of composites) {
    assert.ok(Buffer.isBuffer(composite.input) && composite.input.length > 100);
  }
  assert.match(rendererSource, /font: "Arial, DejaVu Sans, sans-serif"/);
});

test("canonical story converts Arabic AI copy to the required English labels", async () => {
  const composites = await createDesignedStoryTextComposites({
    badge: "\u0645\u062c\u0645\u0648\u0639\u0629 \u062c\u062f\u064a\u062f\u0629",
    title: "\u0646\u064a\u0648 \u0628\u0627\u0644\u0627\u0646\u0633 \u062d\u0630\u0627\u0621 \u0631\u064a\u0627\u0636\u064a",
    price: "\u0627\u0644\u0633\u0639\u0631 1750 \u062c\u0646\u064a\u0647",
    sizes: "37, 38, 39, 40",
    cta: "\u0639\u0631\u0636 \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644",
    theme: resolveDesignedStoryTheme(),
  });
  assert.equal(composites.length, 6);
  assert.match(rendererSource, /englishStoryText\(badge, "NEW COLLECTION"\)/);
  assert.match(rendererSource, /englishStoryText\(title, "Sneakers"\)/);
  assert.match(rendererSource, /englishStoryText\(cta, "View details"\)/);
});

test("current renderer produces real 1080x1920 pixels and content-sensitive checksums", async () => {
  const render = async (title) => {
    const input = { title, price: "1750 EGP", sizes: "41, 42, 43", theme: resolveDesignedStoryTheme() };
    const composites = await createDesignedStoryTextComposites(input);
    const buffer = await sharp(Buffer.from(designedStoryBackgroundSvg({ ...input, renderText: false })))
      .composite(composites)
      .png()
      .toBuffer();
    const metadata = await sharp(buffer).metadata();
    return {
      checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
      metadata,
    };
  };
  const first = await render("Nike Air Max 97");
  const second = await render("Nike Air Max 95");
  assert.equal(first.metadata.width, 1080);
  assert.equal(first.metadata.height, 1920);
  assert.equal(first.metadata.format, "png");
  assert.notEqual(first.checksum, second.checksum);
});
