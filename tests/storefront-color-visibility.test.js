import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const products = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
const storefront = fs.readFileSync(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");

// The editor hides a COLOUR; the database stores the flag on every size row. A
// row the form never sent kept the old value and quietly put the colour back on
// the storefront, so the toggle looked like it did nothing.
test("a colour's storefront decision reaches every row it owns, not just the submitted ones", () => {
  assert.match(products, /const syncColorGroupStorefrontVisibility = async \(client, \{ productId, tenantId, variants = \[\] \}\) => \{/);
  assert.match(products, /await syncColorGroupStorefrontVisibility\(client, \{\s*productId,\s*tenantId,\s*variants: normalizedVariants,\s*\}\);/);
  // matched by colour group first, falling back to the colour name only for rows
  // that carry no group key — never across two groups that share a colour name
  assert.match(products, /LOWER\(TRIM\(COALESCE\(color_group_key, ''\)\)\) = \$4/);
  assert.match(products, /AND \(NULLIF\(\$4, ''\) IS NULL OR COALESCE\(TRIM\(color_group_key\), ''\) = ''\)/);
  // the snapshot has to carry the flag for the sync and the inheritance below
  assert.match(products, /SELECT id, color_group_key, color_sort_order, color, size, audience, stock, default_purchase_qty, is_storefront_visible,/);
});

test("a size added to a hidden colour stays hidden", () => {
  assert.match(products, /const inheritedStorefrontVisible = colorKeyForVisibility/);
  assert.match(products, /is_storefront_visible: is_storefront_visible \?\? inheritedStorefrontVisible/);
});

// Hiding a product from the products list writes to the database and returns,
// but the storefront kept serving its cached payload — the same "the toggle does
// nothing" symptom, from the other end.
test("every write that changes what the storefront shows drops the cached payload", () => {
  const statusHandler = products.slice(products.indexOf("export const updateProductStatus"));
  assert.match(statusHandler, /invalidateProductStorefrontCache\(tenantId\)/);
  for (const label of ["variant:create", "variant:update", "variant:delete"]) {
    assert.match(products, new RegExp(`\\[${label}\\] storefront cache invalidation skipped`));
  }
});

test("the browser/CDN copy cannot outlive the invalidation by minutes", () => {
  assert.match(storefront, /res\.set\("Cache-Control", "public, max-age=15, stale-while-revalidate=30"\);/);
  assert.doesNotMatch(storefront, /max-age=30, stale-while-revalidate=120/);
});
