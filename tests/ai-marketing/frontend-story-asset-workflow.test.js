import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  currentStoryAssetUrls,
  hasValidStoryAssetSnapshot,
  mergeStoryAssetResponse,
  normalizeStoryAssetSnapshot,
} from "../../src/modules/marketing/lib/storyAssetSnapshot.js";

const pageSource = fs.readFileSync(new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../../src/modules/marketing/services/marketingApi.js", import.meta.url), "utf8");

const snapshot = {
  storyId: "42",
  assetId: "story-42-abc",
  assetUrl: "https://cdn.example.com/erp/stories/story-42-abc.png",
  templateKey: "m1_story_current",
  templateVersion: "v1",
  rendererBuild: "m1-story-multi-slide-v8-2026-07-28",
  generationId: "generation-42",
  checksum: "a".repeat(64),
  generatedAt: "2026-07-23T10:00:00.000Z",
};

test("frontend normalizes the actual backend item snapshot shape", () => {
  const response = {
    queued: false,
    reused: true,
    item: { id: 42, metadata: { story_asset_snapshot: snapshot } },
  };
  assert.deepEqual(normalizeStoryAssetSnapshot(response), snapshot);
  const merged = mergeStoryAssetResponse({ id: 42 }, response);
  assert.equal(merged.final_asset_url, snapshot.assetUrl);
  assert.equal(merged.assetId, snapshot.assetId);
  assert.equal(hasValidStoryAssetSnapshot(merged), true);
});

test("old rows and another story's snapshot are invalid", () => {
  assert.equal(hasValidStoryAssetSnapshot({ id: 42, final_asset_url: snapshot.assetUrl }), false);
  assert.equal(hasValidStoryAssetSnapshot({ id: 99, metadata: { story_asset_snapshot: snapshot } }), false);
  const { rendererBuild, generationId, ...oldBuildSnapshot } = snapshot;
  assert.equal(hasValidStoryAssetSnapshot({ id: 42, metadata: { story_asset_snapshot: oldBuildSnapshot } }), false);
});

test("Preview opens immediately while final asset generation stays deduplicated", () => {
  assert.match(pageSource, /onPreview=\{previewQueueItem\}/);
  assert.match(pageSource, /const previewQueueItem = \(item\) => \{\s*setPreview\(item\)/);
  assert.match(pageSource, /storyAssetRequestsRef\.current\.get\(key\)/);
  assert.match(pageSource, /if \(existingRequest\) return existingRequest/);
  assert.match(pageSource, /if \(!hasValidStoryAssetSnapshot\(updatedItem\)\) throw new Error/);
});

test("Preview keeps every colour the generation rendered, not just the primary slide", () => {
  const siblings = [1, 2, 3].map((slide) => ({
    ...snapshot,
    assetId: `story-42-slide-${slide}`,
    assetUrl: `https://cdn.example.com/erp/stories/story-42-slide-${slide}.png`,
    checksum: String(slide).repeat(64),
  }));
  const item = {
    id: 42,
    metadata: {
      story_asset_snapshot: { ...siblings[0], assetUrl: snapshot.assetUrl },
      story_asset_snapshots: siblings,
    },
  };
  assert.deepEqual(currentStoryAssetUrls(item), [snapshot.assetUrl, ...siblings.map((row) => row.assetUrl)]);
  // A previous generation's slides must not leak into the current preview.
  const stale = { ...siblings[1], generationId: "generation-41" };
  assert.deepEqual(
    currentStoryAssetUrls({ ...item, metadata: { ...item.metadata, story_asset_snapshots: [siblings[0], stale] } }),
    [snapshot.assetUrl, siblings[0].assetUrl]
  );
  assert.deepEqual(currentStoryAssetUrls({ id: 42, metadata: { story_asset_snapshot: snapshot } }), [snapshot.assetUrl]);
});

test("Preview selects the immutable snapshot URL and offers an instant unpublished fallback", () => {
  assert.match(pageSource, /const snapshotUrls = currentStoryAssetUrls\(item\)/);
  assert.match(pageSource, /return normalizeUrlList\(snapshot\.assetUrl, sameGenerationUrls\)/);
  assert.match(pageSource, /<StoryCreativePreview\s+slides=\{storySlides\}/);
  assert.match(pageSource, /import PostEditorModal, \{ StoryCreativePreview/);
  assert.match(pageSource, /معاينة فورية/);
});

test("Publish automatically prepares a missing snapshot and waits for generation", () => {
  assert.match(pageSource, /action === "publish"[\s\S]*!hasValidStoryAssetSnapshot\(targetItem \|\| \{\}\)/);
  assert.match(pageSource, /await generateStoryAsset\(targetItem \|\| \{ id \}\)/);
  assert.match(pageSource, /targetItem = preparedItem/);
});

test("generate uses the current endpoint response without a legacy endpoint", () => {
  assert.match(apiSource, /POST|api\.post/);
  assert.match(apiSource, /\/marketing\/ai-center\/queue\/\$\{id\}\/generate-story-asset/);
  assert.doesNotMatch(pageSource + apiSource, /generateCollageStory|generateInstagramSafeStoryImage|legacy-story/);
});
