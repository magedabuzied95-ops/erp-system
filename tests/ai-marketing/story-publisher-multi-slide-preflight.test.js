import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const publisherSource = fs.readFileSync(new URL("../../server/services/storyPublisherService.js", import.meta.url), "utf8");

test("multi-slide preflight validates each image against its own immutable snapshot", () => {
  const preflightStart = publisherSource.indexOf("if (shouldRequireGeneratedStoryAsset(story))", publisherSource.indexOf("export const publishStoryEverywhere"));
  const publishStart = publisherSource.indexOf("const [instagramSlides", preflightStart);
  const preflightSource = publisherSource.slice(preflightStart, publishStart);

  assert.match(preflightSource, /for \(const candidate of publishCandidates\)/);
  assert.match(preflightSource, /story: storyForCandidate\(story, candidate\)/);
  assert.doesNotMatch(preflightSource, /assertGeneratedStoryAsset\(\{ story, platform: "preflight", candidate \}\)/);
});
