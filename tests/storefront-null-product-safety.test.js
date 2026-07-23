import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("storefront image helpers tolerate null product and variant records", async () => {
  const source = await readFile(
    new URL("../src/storefront/Storefront.jsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /const safeStorefrontRecord = \(value\) => \(value && typeof value === "object" \? value : \{\}\)/);
  assert.match(source, /const variantPrimaryImage = \(variant = \{\}\) => \{\s*const safeVariant = safeStorefrontRecord\(variant\)/);
  assert.match(source, /const resolveProductImage = \(item = \{\}, product = \{\}, variant = \{\}\) => \{\s*const safeItem = safeStorefrontRecord\(item\)/);
  assert.doesNotMatch(source, /firstArrayItem\(item\.images\)/);
});
