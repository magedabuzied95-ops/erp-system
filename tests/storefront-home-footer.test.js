import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront home ends with a compact service strip and modern footer", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const lowerHome = source.slice(source.indexOf("function HomeWhySection"), source.indexOf("function SimpleHomeProductGrid"));

  assert.match(lowerHome, /data-testid="storefront-service-strip"/);
  assert.match(lowerHome, /md:grid-cols-3/);
  assert.match(lowerHome, /divide-y divide-stone-200/);
  assert.match(lowerHome, /data-testid="storefront-modern-footer"/);
  assert.match(lowerHome, /bg-stone-950 text-white/);
  assert.match(lowerHome, /buildWhatsAppHref/);
  assert.match(lowerHome, /© \{currentYear\} M1 STORE/);
  assert.doesNotMatch(lowerHome, /M1 SERVICES/);
  assert.doesNotMatch(lowerHome, /rounded-\[1\.75rem\]/);
  assert.doesNotMatch(lowerHome, /bg-\[#128c5e\]/);
});
