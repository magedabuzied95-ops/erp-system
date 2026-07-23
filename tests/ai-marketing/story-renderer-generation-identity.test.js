import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../../src/modules/marketing/services/marketingApi.js", import.meta.url), "utf8");

test("explicit story generation forces a fresh immutable generation", () => {
  assert.match(apiSource, /generate-story-asset`, \{ force: true \}/);
  assert.match(serviceSource, /const generationId = crypto\.randomUUID\(\)/);
  assert.match(serviceSource, /rendererBuild: STORY_RENDERER_BUILD/);
  assert.match(serviceSource, /snapshot\.rendererBuild === STORY_RENDERER_BUILD/);
});

test("snapshot diagnostics bind renderer build, generation and source URLs", () => {
  assert.match(serviceSource, /renderer: CANONICAL_STORY_RENDERER/);
  assert.match(serviceSource, /rendererBuild: STORY_RENDERER_BUILD, generationId, checksum/);
  assert.match(serviceSource, /cache: "miss", snapshotReused: false, sourceImageUrls: rawImages/);
  assert.match(serviceSource, /publicId: storyStoragePublicId\(renderedAssetUrl\)/);
});
