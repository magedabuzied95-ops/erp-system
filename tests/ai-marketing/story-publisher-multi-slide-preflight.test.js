import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const publisherSource = fs.readFileSync(new URL("../../server/services/storyPublisherService.js", import.meta.url), "utf8");

test("multi-slide preflight validates each image against its own immutable snapshot", () => {
  const preflightStart = publisherSource.indexOf("if (shouldRequireGeneratedStoryAsset(story))", publisherSource.indexOf("export const publishStoryEverywhere"));
  const publishStart = publisherSource.indexOf("const previousInstagram", preflightStart);
  const preflightSource = publisherSource.slice(preflightStart, publishStart);

  assert.match(preflightSource, /for \(const candidate of publishCandidates\)/);
  assert.match(preflightSource, /story: storyForCandidate\(story, candidate\)/);
  assert.doesNotMatch(preflightSource, /assertGeneratedStoryAsset\(\{ story, platform: "preflight", candidate \}\)/);
});

test("Instagram slides publish sequentially and successful retry slides are reused", () => {
  assert.match(publisherSource, /for \(const \[index, candidate\] of publishCandidates\.entries\(\)\)/);
  assert.match(publisherSource, /previousSlide\?\.status === "published"/);
  assert.match(publisherSource, /await publishInstagramStory/);
  assert.match(publisherSource, /await delay\(INSTAGRAM_SLIDE_DELAY_MS\)/);
  assert.doesNotMatch(publisherSource, /Promise\.all\(publishCandidates\.map\(\(candidate\) => publishInstagramStory/);
});
