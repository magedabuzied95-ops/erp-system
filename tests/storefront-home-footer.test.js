import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("storefront home ends with a compact service strip and modern footer", async () => {
  const source = await readFile(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
  const lowerHome = source.slice(source.indexOf("function HomeWhySection"), source.indexOf("function SimpleHomeProductGrid"));

  assert.match(lowerHome, /data-testid="storefront-service-strip"/);
  assert.match(lowerHome, /grid grid-cols-2 md:grid-cols-4/);
  assert.match(lowerHome, /M1 SERVICES/);
  assert.match(lowerHome, /data-testid="storefront-modern-footer"/);
  assert.match(lowerHome, /buildWhatsAppHref/);
  assert.match(lowerHome, /© \{currentYear\} M1 STORE/);
  assert.doesNotMatch(lowerHome, /تجربة أهدأ، أوضح، وأرقى/);
  assert.doesNotMatch(lowerHome, /rounded-\[1\.4rem\] border p-4/);
});
