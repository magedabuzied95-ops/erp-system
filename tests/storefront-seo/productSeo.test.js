import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_SCHEMA_COLOR_MAX,
  PRODUCT_SCHEMA_IMAGE_MAX,
  buildProductSeo,
  isValidGtin,
} from "../../src/shared/lib/productSeo.js";
import { listingSeoHead, seoCategoryByKey } from "../../src/shared/lib/categorySeo.js";
import {
  injectProductSeoIntoHtml,
  makeProductSeoImagesAbsolute,
  loadStorefrontHtmlShell,
} from "../../server/services/storefrontProductSeoPageService.js";

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
  assert.match(html, /property="og:site_name" content="M1 Store"/);
  assert.equal((html.match(/data-m1-product-seo="product"/g) || []).length, 1);
  assert.equal((html.match(/data-m1-product-seo="breadcrumb"/g) || []).length, 1);
  assert.match(html, /Nike &lt;Air&gt; &quot;Force&quot;/);
  assert.doesNotMatch(html, /"review"/);
  assert.doesNotMatch(html, /"aggregateRating"/);
});

test("product SEO shell always bypasses stale deployment caches", async () => {
  let requestUrl = "";
  let requestOptions = {};
  const html = await loadStorefrontHtmlShell(async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, text: async () => "<html>fresh</html>" };
  });
  assert.equal(html, "<html>fresh</html>");
  assert.match(requestUrl, /\/index\.html\?seo-shell=\d+$/);
  assert.equal(requestOptions.cache, "no-store");
  assert.match(requestOptions.headers["Cache-Control"], /no-store/);
});

test("gallery rows stored as objects become real image urls in the Product schema", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    gallery_images: [
      { url: "https://images.example/one.jpg" },
      { image_url: "https://images.example/two.jpg" },
      "https://images.example/three.jpg",
      { caption: "no url on this row" },
    ],
  });

  assert.deepEqual(seo.productJsonLd.image, [
    "https://images.example/nike.webp",
    "https://images.example/one.jpg",
    "https://images.example/two.jpg",
    "https://images.example/three.jpg",
  ]);
  assert.equal(JSON.stringify(seo.productJsonLd).includes("[object Object]"), false);
});

test("a relative and an absolute row for the same file become one image", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    image_url: "/uploads/products/nike.jpg",
    gallery_images: ["https://api.m1store-egy.com/uploads/products/nike.jpg", "/uploads/products/other.jpg"],
  });
  const absolute = makeProductSeoImagesAbsolute(seo);
  assert.deepEqual(absolute.productJsonLd.image, [
    "https://api.m1store-egy.com/uploads/products/nike.jpg",
    "https://api.m1store-egy.com/uploads/products/other.jpg",
  ]);
});

// Product 293 in production: the product row says 400, its Mint sizes sell at 650, and the ad
// for Mint links with ?color=Mint.
const multiPriceProduct = {
  ...baseProduct,
  final_price: 400,
  image_url: "https://images.example/default.jpg",
  variants: [
    { id: 1, color: "Mint", size: "40", stock: 2, final_price: 650, image_url: "https://images.example/mint.jpg" },
    { id: 2, color: "Mint", size: "41", stock: 0, final_price: 650 },
    { id: 3, color: "Pink", size: "40", stock: 0, final_price: 400, image_url: "https://images.example/pink.jpg" },
  ],
};

test("a colour named in the link makes the offer speak for that colour", () => {
  const seo = buildProductSeo(multiPriceProduct, { color: "mint" });
  assert.equal(seo.productJsonLd.offers.price, "650.00");
  assert.equal(seo.productJsonLd.offers.availability, "https://schema.org/InStock");
  assert.equal(seo.productJsonLd.offers.url, "https://m1store-egy.com/product/nike-air-force-1-sneakers?color=Mint");
  assert.equal(seo.productJsonLd.color, "Mint");
  assert.equal(seo.productJsonLd.image[0], "https://images.example/mint.jpg");
  // The canonical never carries the colour: one indexed page per product.
  assert.equal(seo.canonical, "https://m1store-egy.com/product/nike-air-force-1-sneakers");
});

test("a colour that is out of stock is reported out of stock, not the product's other colours", () => {
  const seo = buildProductSeo(multiPriceProduct, { color: "Pink" });
  assert.equal(seo.productJsonLd.offers.price, "400.00");
  assert.equal(seo.productJsonLd.offers.availability, "https://schema.org/OutOfStock");
});

test("no colour, or a colour the product does not have, keeps the product-wide offer", () => {
  for (const color of ["", "Purple"]) {
    const seo = buildProductSeo(multiPriceProduct, { color });
    // The page opens on the only in-stock size (Mint 40 at 650), so the offer quotes it rather
    // than the product row's 400 (audit g5 #59).
    assert.equal(seo.productJsonLd.offers.price, "650.00");
    assert.equal(seo.productJsonLd.offers.url, "https://m1store-egy.com/product/nike-air-force-1-sneakers");
    assert.equal(seo.productJsonLd.color, "Mint, Pink");
  }
});

test("the page handler passes ?color= through to the schema", async () => {
  const { createStorefrontProductSeoPageHandler } = await import("../../server/services/storefrontProductSeoPageService.js");
  const handler = createStorefrontProductSeoPageHandler({
    loadProduct: async () => ({ status: 200, product: multiPriceProduct }),
    loadShell: async () => "<html><head><title>x</title></head><body></body></html>",
    loadExtras: async () => ({}),
  });
  let sent = "";
  const res = { set() { return this; }, status() { return this; }, send(body) { sent = body; return this; } };
  await handler({ params: { identifier: "nike-air-force-1-sneakers" }, query: { color: "Mint" } }, res, (error) => { throw error; });
  assert.match(sent, /"price":"650\.00"/);
  assert.match(sent, /\?color=Mint/);
});

test("?variant= narrows the offer to that exact size", () => {
  // Within Mint the sizes are priced alike here, so give one size its own price, as Skechers
  // Max Run's 46-48 carry 1,450 in a colour that opens on 1,350.
  const product = {
    ...multiPriceProduct,
    variants: [
      { id: 1, color: "Mint", size: "40", stock: 2, final_price: 650 },
      { id: 4, color: "Mint", size: "46", stock: 1, final_price: 1450 },
    ],
  };
  const seo = buildProductSeo(product, { color: "Mint", variant: "4" });
  assert.equal(seo.productJsonLd.offers.price, "1450.00");
  assert.equal(seo.productJsonLd.offers.availability, "https://schema.org/InStock");
  assert.equal(seo.productJsonLd.offers.url, "https://m1store-egy.com/product/nike-air-force-1-sneakers?color=Mint&variant=4");
  assert.equal(seo.canonical, "https://m1store-egy.com/product/nike-air-force-1-sneakers");

  // An id the product does not have falls back to the colour.
  const unknown = buildProductSeo(product, { color: "Mint", variant: "999" });
  assert.equal(unknown.productJsonLd.offers.price, "650.00");
  assert.equal(unknown.productJsonLd.offers.url, "https://m1store-egy.com/product/nike-air-force-1-sneakers?color=Mint");
});

// --- what the crawler was actually being handed (production, nike-air-jordan-1-low) ---

test("the drawn share card stays the og:image and never becomes the product's photograph", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    og_image_url: "https://api.m1store-egy.com/uploads/og/products/25-card.jpg",
    gallery_images: ["https://images.example/two.jpg"],
  });
  assert.equal(seo.image, "https://api.m1store-egy.com/uploads/og/products/25-card.jpg");
  assert.deepEqual(seo.productJsonLd.image, [
    "https://images.example/nike.webp",
    "https://images.example/two.jpg",
  ]);
});

test("a product whose only picture is the share card still shows Google something", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    image_url: "",
    gallery_images: [],
    og_image_url: "https://api.m1store-egy.com/uploads/og/products/25-card.jpg",
  });
  assert.deepEqual(seo.productJsonLd.image, ["https://api.m1store-egy.com/uploads/og/products/25-card.jpg"]);
});

test("twenty-five photographs are published as the first ten", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    gallery_images: Array.from({ length: 25 }, (unused, index) => `https://images.example/g${index}.jpg`),
  });
  assert.equal(seo.productJsonLd.image.length, PRODUCT_SCHEMA_IMAGE_MAX);
  assert.equal(seo.productJsonLd.image[0], "https://images.example/nike.webp");
});

test("hand-typed colour names are cleaned and spelt once", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    variants: [
      { id: 1, color: "White & #Black", size: "41", stock: 2, final_price: 650 },
      { id: 2, color: "Black & White* Warke", size: "42", stock: 2, final_price: 650 },
      { id: 3, color: "WHite & Colors", size: "43", stock: 2, final_price: 650 },
      { id: 4, color: "white & black", size: "44", stock: 2, final_price: 650 },
    ],
  });
  assert.equal(seo.productJsonLd.color, "White & Black, Black & White Warke, White & Colors");
});

test("a product sold in more colours than the schema carries is capped, not dumped", () => {
  const seo = buildProductSeo({
    ...baseProduct,
    variants: Array.from({ length: 23 }, (unused, index) => ({
      id: index + 1,
      color: `Colour ${index}`,
      size: "41",
      stock: 2,
      final_price: 650,
    })),
  });
  assert.equal(seo.productJsonLd.color.split(", ").length, PRODUCT_SCHEMA_COLOR_MAX);
});

test("only a barcode that passes the GTIN checksum is published as one", () => {
  // The Air Jordan's barcode in production: twelve digits, generated in house, check digit 3
  // where a real UPC would carry 6.
  assert.equal(isValidGtin("606577986623"), false);
  assert.equal("gtin" in buildProductSeo({ ...baseProduct, barcode: "606577986623" }).productJsonLd, false);
  assert.equal(buildProductSeo({ ...baseProduct, barcode: "4006381333931" }).productJsonLd.gtin, "4006381333931");
});

test("a named colour's own barcode is the one the offer publishes", () => {
  const product = {
    ...baseProduct,
    barcode: "4006381333931",
    variants: [
      { id: 1, color: "Mint", size: "40", stock: 2, final_price: 650, barcode: "5060337502115" },
      { id: 2, color: "Pink", size: "41", stock: 2, final_price: 650 },
    ],
  };
  assert.equal(buildProductSeo(product, { color: "Mint" }).productJsonLd.gtin, "5060337502115");
  assert.equal(buildProductSeo(product, { color: "Pink" }).productJsonLd.gtin, "4006381333931");
});

test("priceValidUntil is a real sale end or nothing at all", () => {
  assert.equal("priceValidUntil" in buildProductSeo(baseProduct).productJsonLd.offers, false);
  assert.equal(
    buildProductSeo({ ...baseProduct, sale_end_at: "2026-09-30" }).productJsonLd.offers.priceValidUntil,
    "2026-09-30"
  );
  // 22:00 UTC is already the small hours of the next day in Cairo, where the sale is running:
  // dating it off the UTC calendar would end the price a day early.
  assert.equal(
    buildProductSeo({ ...baseProduct, sale_end_at: "2026-09-30T22:00:00.000Z" }).productJsonLd.offers.priceValidUntil,
    "2026-10-01"
  );
});

test("the breadcrumb climbs through a section page Google is allowed to index", () => {
  const bag = buildProductSeo({ ...baseProduct, gender: "women", product_type: "bags" });
  assert.equal(bag.breadcrumbJsonLd.itemListElement[1].item, "https://m1store-egy.com/bags");
  assert.equal(bag.breadcrumbJsonLd.itemListElement[1].name, seoCategoryByKey("bags").h1);

  // Sneakers have no section of their own, so the shopper's own aisle is the rung.
  const sneaker = buildProductSeo({ ...baseProduct, gender: "men", product_type: "sneakers" });
  assert.equal(sneaker.breadcrumbJsonLd.itemListElement[1].item, "https://m1store-egy.com/men");
  assert.equal(sneaker.breadcrumbJsonLd.itemListElement[1].name, seoCategoryByKey("men").h1);

  // Neither, and the rung is the bare listing -- never the ?category= facet this product's
  // category_id used to build, which the storefront itself marks noindex.
  const bare = buildProductSeo({ ...baseProduct, gender: "", product_type: "" });
  assert.equal(bare.breadcrumbJsonLd.itemListElement[1].item, "https://m1store-egy.com/products");
  assert.equal(listingSeoHead({ path: "/products", params: { category: "8" } }).robots, "noindex,follow");
});
