import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/modules/settings/pages/SettingsCenter.jsx", import.meta.url),
  "utf8",
);

test("site branding previews resolve uploaded images through the API asset origin", () => {
  assert.match(
    source,
    /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls"/,
  );
  assert.match(source, /const previewUrl = resolveProductImageUrl\(safeValue\)/);
  assert.match(source, /<img src=\{previewUrl\}/);
  assert.match(source, /const resolvedSrc = resolveProductImageUrl\(src\)/);
  assert.match(source, /<img src=\{resolvedSrc\}/);
});
