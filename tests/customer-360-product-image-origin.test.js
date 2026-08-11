import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/Customer360Drawer.jsx", import.meta.url),
  "utf8"
);

test("Customer 360 product cards resolve migrated server image paths", () => {
  assert.match(source, /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls\.js"/);
  assert.match(source, /const imageUrl = resolveProductImageUrl\(/);
  assert.match(source, /<img src=\{imageUrl\}/);
  assert.doesNotMatch(source, /<img src=\{product\.image_url\}/);
});
