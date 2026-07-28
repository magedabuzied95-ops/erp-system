import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
const getProductSource = source.slice(
  source.indexOf("export const getProduct = async"),
  source.indexOf("export const getProductByToken = async")
);

test("interactive product details do not block on social image generation", () => {
  assert.doesNotMatch(getProductSource, /await attachSocialMetadata/);
  assert.match(getProductSource, /res\.json\(\{ success: true, product, price_debug: productPricePayload \}\)/);
});

test("interactive product details allow a short private browser cache", () => {
  assert.match(getProductSource, /private, max-age=15, stale-while-revalidate=45/);
  assert.match(getProductSource, /res\.set\("Vary", "X-Tenant-Id"\)/);
});
