import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const controllerSource = fs.readFileSync(new URL("../../server/controllers/marketingController.js", import.meta.url), "utf8");
const routesSource = fs.readFileSync(new URL("../../server/routes/marketing.js", import.meta.url), "utf8");
const aiCenterRoutesSource = fs.readFileSync(new URL("../../server/routes/aiMarketingCenter.js", import.meta.url), "utf8");
const aiCenterControllerSource = fs.readFileSync(new URL("../../server/controllers/aiMarketingCenterController.js", import.meta.url), "utf8");
const aiCenterServiceSource = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");
const rendererSource = fs.readFileSync(new URL("../../server/services/storyImageService.js", import.meta.url), "utf8");
const schemaSource = fs.readFileSync(new URL("../../server/utils/marketingSchema.js", import.meta.url), "utf8");

test("all registered raster story generation endpoints use the canonical renderer", () => {
  assert.match(routesSource, /\/story\/publish-product\/:productId[\s\S]*publishStoryForProduct/);
  assert.match(routesSource, /\/story\/schedule-product\/:productId[\s\S]*scheduleStoryForProduct/);
  assert.match(routesSource, /\/ai-center\/queue\/:id\/generate-story-asset[\s\S]*generateAutonomousAiMarketingQueueStoryAsset/);
  assert.match(aiCenterRoutesSource, /\/queue\/:id\/generate-story-asset[\s\S]*generateAutonomousAiMarketingQueueStoryAsset/);
  assert.match(aiCenterControllerSource, /enqueueAiMarketingQueueStoryAssetGeneration/);
  assert.match(aiCenterServiceSource, /ensureQueueStoryRenderedAsset[\s\S]*generateDesignedAiMarketingStoryImages/);
  assert.match(aiCenterServiceSource, /CANONICAL_STORY_TEMPLATE_KEY = "m1_story_current"/);
  assert.match(aiCenterServiceSource, /CANONICAL_STORY_TEMPLATE_VERSION = "v1"/);
  assert.match(controllerSource, /generateDesignedAiMarketingStoryImages/);
  assert.match(controllerSource, /CANONICAL_STORY_TEMPLATE_KEY = "m1_story_current"/);
  assert.match(controllerSource, /CANONICAL_STORY_TEMPLATE_VERSION = "v1"/);
  assert.doesNotMatch(controllerSource, /generateCollageStory|generateSingleProductStory|generateInstagramSafeStoryImage/);
});

test("scheduled product stories persist and reuse immutable canonical snapshots", () => {
  assert.match(schemaSource, /story_asset_snapshot JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(controllerSource, /savedSnapshot\.templateKey === CANONICAL_STORY_TEMPLATE_KEY/);
  assert.match(controllerSource, /savedSnapshot\.checksum/);
  const publishStart = controllerSource.indexOf("const publishStoryForRow");
  const publishEnd = controllerSource.indexOf("const publishStoryJob", publishStart);
  assert.doesNotMatch(controllerSource.slice(publishStart, publishEnd), /generateDesignedAiMarketingStoryImages/);
});

test("legacy raster story templates and fallbacks are permanently absent", () => {
  const combined = `${controllerSource}\n${aiCenterServiceSource}\n${rendererSource}`;
  assert.doesNotMatch(combined, /storyTemplates|FIXED_FAST_STORY_TEMPLATE|templateBackgroundSvg/);
  assert.doesNotMatch(combined, /generateCollageStory|generateSingleProductStory|generateInstagramSafeStoryImage/);
  assert.doesNotMatch(rendererSource, /dark-premium|minimal-white|soft-shadow-cards/);
  assert.doesNotMatch(rendererSource, />NEW<\/text>[\s\S]*>COLLECTION<\/text>/);
  assert.doesNotMatch(aiCenterServiceSource, /contentType === "story" \? "NEW COLLECTION"/);
  assert.doesNotMatch(aiCenterServiceSource, /contentType === "story" \? "View details"/);
  assert.doesNotMatch(aiCenterServiceSource, /contentType === "story" \? "Available now"/);
});

test("custom stories remain outside generated-product snapshot enforcement", () => {
  assert.match(controllerSource, /String\(post\.story_type \|\| ""\)\.toLowerCase\(\) === "custom"/);
  assert.match(controllerSource, /require_generated_story_asset: false/);
});
