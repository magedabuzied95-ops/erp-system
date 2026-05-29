import assert from "node:assert/strict";

process.env.STORE_FRONT_URL = process.env.STORE_FRONT_URL || "https://store.example.com";

const db = (await import("../database/db.js")).default;
const {
  buildStorefrontProductUrl,
  resolveProductCardLinks,
  resolveStorefrontProductLink,
} = await import("../services/storefrontProductUrlService.js");
const { normalizeProductCards } = await import("../services/aiProductCards.js");
const {
  buildSizeAvailabilityStorefrontUrl,
  detectSizeAvailabilityIntent,
} = await import("../services/aiSizeAvailabilityLinkService.js");

try {
  const productResult = await db.query(
    `
    SELECT id, name, slug, canonical_slug, is_active, status
    FROM products
    WHERE is_active IS DISTINCT FROM FALSE
      AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `
  );
  const product = productResult.rows[0] || null;
  if (!product) {
    console.warn("AI product link DB test skipped: no active products found");
  } else {
    const detailUrl = buildStorefrontProductUrl(product);
    assert.match(detailUrl, /\/shop\/product\//);
    assert.doesNotMatch(detailUrl, /\/shop\/products\//);

    const resolved = await resolveStorefrontProductLink({
      tenantId: null,
      product: { ...product, product_id: product.id, slug: "nike-white-black-sneakers-men" },
    });
    assert.equal(resolved.resolve_success, true);
    assert.match(resolved.product_url, /\/shop\/product\//);
    assert.doesNotMatch(resolved.product_url, /nike-white-black-sneakers-men$/);

    const cards = normalizeProductCards([{ ...product, product_id: product.id, slug: "nike-white-black-sneakers-men" }], { limit: 1 });
    const resolvedCards = await resolveProductCardLinks(cards, { tenantId: null });
    assert.equal(resolvedCards.length, 1);
    assert.equal(resolvedCards[0].resolve_success, true);
    assert.match(resolvedCards[0].product_url, /\/shop\/product\//);
  }

  const missing = await resolveStorefrontProductLink({
    tenantId: null,
    product: { product_id: 999999999, name: "Missing Product For Link Test", slug: "missing-product-for-link-test" },
  });
  assert.equal(missing.resolve_success, false);
  assert.equal(missing.fallback_used, true);
  assert.match(missing.product_url, /\/shop\/products\?q=Missing%20Product%20For%20Link%20Test/);

  const sizeIntent = detectSizeAvailabilityIntent("مقاس 45 رجالي");
  assert.equal(sizeIntent.detected, true);
  assert.equal(buildSizeAvailabilityStorefrontUrl(sizeIntent), `${process.env.STORE_FRONT_URL}/shop/products?gender=men&size=45&inStock=1`);

  console.log("AI product link tests passed");
} finally {
  await db.end();
}

