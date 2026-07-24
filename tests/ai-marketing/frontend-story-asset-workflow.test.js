import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
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
  rendererBuild: "m1-story-new-collection-v4-sans-2026-07-24",
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

test("Preview generates missing assets, deduplicates requests, and opens only a saved asset", () => {
  assert.match(pageSource, /onPreview=\{previewQueueItem\}/);
  assert.match(pageSource, /generateStoryAsset\(item, \{ openPreview: true \}\)/);
  assert.match(pageSource, /storyAssetRequestsRef\.current\.get\(key\)/);
  assert.match(pageSource, /if \(existingRequest\) return existingRequest/);
  assert.match(pageSource, /if \(openPreview\) setPreview\(updatedItem\)/);
  assert.match(pageSource, /if \(!hasValidStoryAssetSnapshot\(updatedItem\)\) throw new Error/);
});

test("Preview selects the immutable snapshot URL and has no browser-rendered story fallback", () => {
  assert.match(pageSource, /if \(hasValidStoryAssetSnapshot\(item\)\) return \[snapshot\.assetUrl\]/);
  assert.doesNotMatch(pageSource, /<StoryCreativePreview\s+slides=\{storySlides\}/);
  assert.doesNotMatch(pageSource, /import PostEditorModal, \{ StoryCreativePreview/);
});

test("Publish is blocked client-side without a snapshot and during generation", () => {
  assert.match(pageSource, /action === "publish"[\s\S]*!hasValidStoryAssetSnapshot\(targetItem \|\| \{\}\)/);
  assert.match(pageSource, /storyAssetRequestsRef\.current\.has\(String\(id\)\)/);
  assert.match(pageSource, /أنشئ أصل القصة أولًا/);
});

test("generate uses the current endpoint response without a legacy endpoint", () => {
  assert.match(apiSource, /POST|api\.post/);
  assert.match(apiSource, /\/marketing\/ai-center\/queue\/\$\{id\}\/generate-story-asset/);
  assert.doesNotMatch(pageSource + apiSource, /generateCollageStory|generateInstagramSafeStoryImage|legacy-story/);
});
