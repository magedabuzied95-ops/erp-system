import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("product marketing editor and social publisher share the suggested first comment builder", async () => {
  const [editor, publisher] = await Promise.all([
    read("src/modules/marketing/components/PostEditorModal.jsx"),
    read("src/modules/marketing/pages/SocialMediaPublisher.jsx"),
  ]);
  assert.match(editor, /buildSuggestedFirstComment/);
  assert.match(editor, /first_comment:\s*firstComment/);
  assert.match(publisher, /buildSuggestedFirstComment/);
});

test("catalog selection automatically applies the generated template caption", async () => {
  const publisher = await read("src/modules/marketing/pages/SocialMediaPublisher.jsx");
  assert.match(publisher, /generateNewCollectionCaption\(\{ product: nextProduct, applyToCaption: true, openPreview: false \}\)/);
  assert.match(publisher, /if \(applyToCaption\) setCaption\(nextCaption\)/);
});

test("marketing posts persist and publish the first comment", async () => {
  const [controller, schema] = await Promise.all([
    read("server/controllers/marketingController.js"),
    read("server/utils/marketingSchema.js"),
  ]);
  assert.match(schema, /first_comment TEXT NOT NULL DEFAULT ''/);
  assert.match(controller, /publishMarketingFirstComment/);
  assert.match(controller, /callMetaComment/);
});

test("catalog posts publish every color and bags keep zero-stock colors", async () => {
  const [publisher, service, marketingController] = await Promise.all([
    read("src/modules/marketing/pages/SocialMediaPublisher.jsx"),
    read("server/services/socialPublisherPostsService.js"),
    read("server/controllers/marketingController.js"),
  ]);
  assert.match(publisher, /includeAllBagColors \|\| isCatalogMediaVariantAvailable\(variant\)/);
  assert.match(publisher, /items\.length && !includeAllBagColors/);
  assert.match(publisher, /selectedCatalogMediaItems\.map\(\(item\) => item\.url\)/);
  assert.match(publisher, /setSelectedCatalogProduct\(\(current\)/);
  assert.match(service, /isBagProductForPublishing\(product\)\s*\? variants\s*:\s*variants\.filter\(isAvailableVariantForMedia\)/);
  assert.match(service, /product_type:\s*trimString\(product\.product_type/);
  assert.match(marketingController, /if \(colorMediaUrls\.length\) return colorMediaUrls/);
});
