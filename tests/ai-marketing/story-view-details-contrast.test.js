import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url),
  "utf8"
);
const previewSource = fs.readFileSync(
  new URL("../../src/modules/marketing/components/StoryPreview.jsx", import.meta.url),
  "utf8"
);
const rendererSource = fs.readFileSync(
  new URL("../../server/services/storyImageService.js", import.meta.url),
  "utf8"
);

test("story View details button keeps strong contrast even without a link", () => {
  assert.match(source, /from-red-600 via-rose-600 to-red-800 text-white/);
  assert.match(source, /ctaUrl \? "" : "pointer-events-none"/);
  assert.doesNotMatch(source, /pointer-events-none opacity-70/);
});

test("every interactive story template uses the same high contrast details button", () => {
  assert.match(previewSource, /from-red-600 via-rose-600 to-red-800/);
  assert.match(previewSource, /text-white shadow-\[0_0_26px/);
  assert.doesNotMatch(previewSource, /StoryCTA[\s\S]{0,900}accentClasses\[template\.accent\]/);
});

test("final rendered story assets use a dark red CTA with white text", () => {
  assert.match(rendererSource, /<stop offset="0" stop-color="#dc2626"\/>/);
  assert.match(rendererSource, /<stop offset="1" stop-color="#991b1b"\/>/);
  assert.match(rendererSource, /text: ctaText[\s\S]{0,180}color: "#ffffff"/);
  assert.doesNotMatch(rendererSource, /text: ctaText[\s\S]{0,180}color: theme\.accentDark/);
});
