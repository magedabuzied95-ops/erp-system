import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
const getProductSource = source.slice(
  source.indexOf("export const getProduct = async"),
  source.indexOf("export const getProductByToken = async")
);
const resolveProductSource = source.slice(
  source.indexOf("export const resolveProductLink = async"),
  source.indexOf("export const getProduct = async")
);

test("interactive product details do not block on social image generation", () => {
  assert.doesNotMatch(getProductSource, /await attachSocialMetadata/);
  assert.match(getProductSource, /res\.json\(\{ success: true, product, price_debug: productPricePayload \}\)/);
});

test("interactive product details allow a short private browser cache", () => {
  assert.match(getProductSource, /private, max-age=15, stale-while-revalidate=45/);
  assert.match(getProductSource, /res\.set\("Vary", "X-Tenant-Id"\)/);
});

test("product details resolve a lightweight id before running the heavy catalog query", () => {
  assert.match(source, /const findStorefrontProductId = async/);
  assert.match(source, /const loadStorefrontProductRowById = async/);
  assert.match(source, /\$\{catalogQuery\} AND p\.id = \$2/);
  assert.match(getProductSource, /await findStorefrontProductId\(matchedTenantId, identifiers\)/);
  assert.match(getProductSource, /await loadStorefrontProductRowById\(matchedTenantId, productId\)/);
  assert.doesNotMatch(getProductSource, /\$\{catalogQuery\} \$\{productIdentifierClause/);
});

test("read-only product routes never run schema migrations during a customer request", () => {
  assert.doesNotMatch(getProductSource, /ensureStorefrontSchema|ensureProductVariantImagesSchema/);
  assert.doesNotMatch(resolveProductSource, /ensureStorefrontSchema|ensureProductVariantImagesSchema/);
});
