import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../../src/modules/marketing/components/PostEditorModal.jsx", import.meta.url),
  "utf8"
);

test("story View details button keeps strong contrast even without a link", () => {
  assert.match(source, /from-red-600 via-rose-600 to-red-800 text-white/);
  assert.match(source, /ctaUrl \? "" : "pointer-events-none"/);
  assert.doesNotMatch(source, /pointer-events-none opacity-70/);
});
