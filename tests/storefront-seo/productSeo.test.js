import test from "node:test";
import assert from "node:assert/strict";
import { buildProductSeo } from "../../src/shared/lib/productSeo.js";
import { injectProductSeoIntoHtml } from "../../server/services/storefrontProductSeoPageService.js";

const baseProduct = {
  id: 25,
  slug: "nike-air-force-1-sneakers",
  name: "Nike Air Force 1 Sneakers",
  brand: "Nike",
  category: "Sneakers",
  category_id: 8,
  sku: "NK-AF-M-LOC",
  description: "Classic Nike Air Force 1 sneakers.",
  image_url: "https://images.example/nike.webp",
  final_price: 650,
  variants: [
    { id: 1, color: "White", size: "41", stock: 3, final_price: 650 },
    { id: 2, color: "Black", size: "42", stock: 2, final_price: 650 },
  ],
};

test("available product emits Product, Offer and BreadcrumbList using real fields", () => {
  const seo = buildProductSeo(baseProduct);
  assert.equal(seo.productJsonLd["@type"], "Product");
  assert.equal(seo.productJsonLd.offers["@type"], "Offer");
  assert.equal(seo.productJsonLd.offers.price, "650.00");
  assert.equal(seo.productJsonLd.offers.priceCurrency, "EGP");
  assert.equal(seo.productJsonLd.offers.availability, "https://schema.org/InStock");
  assert.equal(seo.breadcrumbJsonLd["@type"], "BreadcrumbList");
  assert.equal(seo.breadcrumbJsonLd.itemListElement.length, 3);
  assert.match(seo.title, /Nike Air Force 1 Sneakers/);
  assert.match(seo.title, /M1 Store/);
  assert.doesNotMatch(seo.title, /M1 ERP/);
  assert.equal("review" in seo.productJsonLd, false);
  assert.equal("aggregateRating" in seo.productJsonLd, false);
});

test("out of stock product emits OutOfStock", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    total_stock: 0,
    variants: baseProduct.variants.map((variant) => ({ ...variant, stock: 0 })),
  });
  assert.equal(seo.productJsonLd.offers.availability, "https://schema.org/OutOfStock");
});

test("discounted product uses the current visible final price", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    selling_price: 650,
    sale_price: 550,
    final_price: 550,
    variants: baseProduct.variants.map((variant) => ({ ...variant, final_price: 550 })),
  });
  assert.equal(seo.productJsonLd.offers.price, "550.00");
});

test("multiple colors, sizes and prices retain a merchant-listing Offer", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    variants: [
      { color: "White", size: "40", stock: 2, final_price: 650 },
      { color: "White", size: "41", stock: 1, final_price: 650 },
      { color: "Black", size: "42", stock: 4, final_price: 700 },
    ],
  });
  assert.equal(seo.productJsonLd.color, "White, Black");
  assert.equal(seo.productJsonLd.offers["@type"], "Offer");
  assert.equal(seo.productJsonLd.offers.price, "650.00");
});

test("server HTML contains one Product and one Breadcrumb JSON-LD with safe escaping", () => {
  const seo = buildProductSeo({ ...baseProduct, name: 'Nike <Air> "Force"' });
  const html = injectProductSeoIntoHtml(
    "<!doctype html><html><head><title>M1 ERP</title></head><body><div id=\"root\"></div></body></html>",
    seo
  );
  assert.doesNotMatch(html, /<title>M1 ERP<\/title>/);
  assert.equal((html.match(/data-m1-product-seo="product"/g) || []).length, 1);
  assert.equal((html.match(/data-m1-product-seo="breadcrumb"/g) || []).length, 1);
  assert.match(html, /Nike &lt;Air&gt; &quot;Force&quot;/);
  assert.doesNotMatch(html, /"review"/);
  assert.doesNotMatch(html, /"aggregateRating"/);
});
