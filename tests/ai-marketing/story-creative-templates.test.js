import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createDesignedStoryTextComposites, designedStoryBackgroundSvg, resolveDesignedStoryTheme } from "../../server/services/storyImageService.js";

const previewSource = fs.readFileSync(
  new URL("../../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url),
  "utf8"
);
const marketingServiceSource = fs.readFileSync(
  new URL("../../server/services/aiMarketingCenterService.js", import.meta.url),
  "utf8"
);

test("story renderer selects a commercial theme from the content strategy", () => {
  assert.equal(resolveDesignedStoryTheme({ strategy_type: "new_arrivals" }).id, "new-arrival-emerald");
  assert.equal(resolveDesignedStoryTheme({ strategy_type: "last_size", stock: 1 }).id, "last-piece-urgency");
  assert.equal(resolveDesignedStoryTheme({ layout_type: "special_offer_story" }).id, "offer-coral");
  assert.equal(resolveDesignedStoryTheme({ strategy_type: "featured" }).id, "premium-midnight");
});

test("rendered 9:16 asset carries the selected theme and complete selling hierarchy", () => {
  const theme = resolveDesignedStoryTheme({ strategy_type: "last_size" });
  const svg = designedStoryBackgroundSvg({
    badge: "LAST SIZE",
    title: "Nike Air Max 97",
    price: "1750 EGP",
    sizes: "41 • 42 • 43",
    cta: "View details",
    brandName: "M1 Store",
    theme,
  });

  assert.match(svg, /width="1080" height="1920"/);
  assert.match(svg, /@font-face/);
  assert.match(svg, /data:font\/ttf;base64,/);
  assert.match(svg, /font-family:'M1Story'/);
  for (const value of ["LIMITED DROP", "LAST SIZE", "Nike Air Max 97", "1750 EGP", "41 • 42 • 43", "View details", "M1 Store"]) {
    assert.match(svg, new RegExp(value));
  }
  assert.match(svg, /#fb7185/i);
});

test("story preview mirrors professional strategy themes and store identity", () => {
  for (const marker of ["LIMITED DROP", "PRICE DROP", "FRESH DROP", "M1 EDIT", "store_logo_url", "theme.background", "theme.accent"]) {
    assert.match(previewSource, new RegExp(marker.replace(".", "\\.")));
  }
  assert.doesNotMatch(previewSource, />ERP<\/div>/);
  assert.match(marketingServiceSource, /ai_marketing_story_commercial_templates_v5_explicit_fontfile/);
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
  assert.equal(composites.length, 7);
  for (const composite of composites) assert.ok(Buffer.isBuffer(composite.input) && composite.input.length > 100);
});
