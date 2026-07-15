import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const metaSource = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const centerSource = readFileSync(new URL("../server/services/socialCommentsCenterService.js", import.meta.url), "utf8");
const pwaSource = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");

test("Facebook post feed requests the platform comment summary", () => {
  assert.match(metaSource, /comments\.limit\(0\)\.summary\(true\)/);
  assert.match(centerSource, /post\.comments\?\.summary\?\.total_count/);
  assert.match(centerSource, /Math\.max\(importedCommentsCount, metaCommentsCount\)/);
  assert.match(centerSource, /comments_count_source: metaCommentsCount >= importedCommentsCount \? "meta_summary"/);
});

test("PWA shows the largest trustworthy count and a clear Arabic waiting status", () => {
  assert.match(pwaSource, /const commentCount = Math\.max\(/);
  assert.match(pwaSource, /selectedSocialThread\.comments\.length/);
  assert.match(pwaSource, /return "بانتظار الرد"/);
  assert.match(pwaSource, /\{commentCount\} تعليق/);
});

test("PWA post details preserve the image from the selected post", () => {
  assert.match(pwaSource, /const selectedPostImage = commentThreadPostImageUrl\(selectedPost \|\| \{\}\)/);
  assert.match(pwaSource, /const threadPostImage = commentThreadPostImageUrl\(selectedSocialThread\?\.post \|\| \{\}\)/);
  assert.match(pwaSource, /const postImage = selectedPostImage \|\| threadPostImage/);
});
