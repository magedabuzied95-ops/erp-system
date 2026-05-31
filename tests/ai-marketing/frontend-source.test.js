import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url), "utf8");
const queueStatus = fs.readFileSync(new URL("../../src/modules/marketing/lib/queueStatus.js", import.meta.url), "utf8");

test("AiMarketingCenter exposes required status filters", () => {
  for (const label of ["All", "Published", "Pending Approval", "Ready", "Queued", "Failed", "Archived"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
});

test("queued/generating/uploading rows disable Preview until ready or published", () => {
  assert.match(source, /const isGenerating = \["queued", "generating_copy", "generating_image", "uploading"\]/);
  assert.match(source, /disabled=\{isGenerating\}/);
  assert.match(queueStatus, /ready/);
  assert.match(queueStatus, /published/);
});

test("publish_failed rows show Retry Publish and published rows keep lifecycle actions", () => {
  assert.match(source, /Retry Publish/);
  for (const text of ["Preview", "Archive", "Duplicate", "History", "Delete"]) {
    assert.match(source, new RegExp(text));
  }
});

test("archived rows show Restore and bulk action bar appears when rows are selected", () => {
  assert.match(source, /Restore/);
  assert.match(source, /selectedCount/);
  assert.match(source, /Archive Selected/);
  assert.match(source, /Delete Selected/);
  assert.match(source, /Publish Selected/);
});

test("delete published modal includes required production warning", () => {
  assert.match(source, /This will remove the generated content from the AI Marketing Center database and media storage\./);
  assert.match(source, /It will NOT automatically delete the content from Facebook or Instagram unless platform deletion is explicitly supported\./);
});

test("recommendations panel uses insufficient-data copy instead of fake recommendations", () => {
  assert.match(source, /Not enough performance data yet\. Publish more content and sync insights to unlock recommendations\./);
  assert.match(source, /performance_insufficient_data/);
});
