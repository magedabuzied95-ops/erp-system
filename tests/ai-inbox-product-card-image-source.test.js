import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageSource = readFileSync("src/modules/aiSupport/components/ProductCardMessage.jsx", "utf8");
const pickerSource = readFileSync("src/modules/aiSupport/components/ProductCardPicker.jsx", "utf8");

test("AI Inbox resolves server-hosted image paths when rendering existing product cards", () => {
  assert.match(messageSource, /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls"/);
  assert.match(messageSource, /const imageUrl = resolveProductImageUrl\(firstImageValue\(/);
  assert.match(messageSource, /const cardImage = \(card = \{\}\) =>\s*resolveProductImageUrl\(firstImageValue\(/);
});

test("AI Inbox stores resolved server image URLs in newly sent product cards", () => {
  assert.match(pickerSource, /import \{ resolveProductImageUrl \} from "\.\.\/\.\.\/\.\.\/shared\/lib\/imageUrls"/);
  assert.match(pickerSource, /const productImage = \(product = \{\}, variant = null\) =>\s*resolveProductImageUrl\(clean\(/);
  assert.match(pickerSource, /return resolveProductImageUrl\(selectedImage \|\| productImage\(/);
});
