// Audit group 5 (storefront SEO and ad feeds). Behavioural where the code is pure or
// injectable; source assertions only for React effects and controller wiring.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildProductSeo } from "../src/shared/lib/productSeo.js";
import {
  buildCategoryItemList,
  categoryProductImage,
  categorySeoHeadCopy,
  listingSeoHead,
  localizeSeoCategory,
  seoCategoryByPath,
  uniqueCategoryProducts,
} from "../src/shared/lib/categorySeo.js";
import {
  buildCategorySeoPayload,
  createStorefrontCategorySeoPageHandler,
  injectCategorySeoIntoHtml,
} from "../server/services/storefrontCategorySeoPageService.js";
import {
  createStorefrontProductSeoPageHandler,
  loadProductSeoExtras,
} from "../server/services/storefrontProductSeoPageService.js";
import {
  GOOGLE_FEED_MIN_REBUILD_MS,
  GOOGLE_FEED_TTL_MS,
  buildGoogleMerchantFeed,
  clearGoogleMerchantFeedCache,
  googleMerchantFeedCacheIsFresh,
} from "../server/services/googleMerchantFeedService.js";
import { createGoogleMerchantFeedHandler } from "../server/routes/googleMerchantFeed.js";
import { invalidateCachePattern } from "../server/services/cacheService.js";
import { legalHeadLinks } from "../src/storefront/pages/legalContent.js";
import { metaCatalogContentId, metaCatalogItemId } from "../shared/metaPurchaseEvent.js";
import {
  META_PUBLISHED_SKU_COUNTS_SQL,
  attachMetaContentIds,
  ensureMetaDuplicateSkuKeys,
  metaContentIdFor,
  resetMetaContentIdSnapshot,
} from "../server/services/metaCatalogContentIdService.js";
import { buildMetaCatalogItem } from "../server/services/metaCatalogFeedService.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const squash = (value = "") => String(value).replace(/\s+/g, " ").trim();
const SHELL = '<!doctype html><html lang="en-GB"><head><title>M1 Store</title></head><body><div id="root"></div></body></html>';

const fakeRes = () => {
  const res = { statusCode: 200, headers: {}, body: "", redirectedTo: null };
  res.set = (name, value) => { res.headers[name] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.redirect = (code, url) => { res.statusCode = code; res.redirectedTo = url; return res; };
  return res;
};

// ---------------------------------------------------------------------------
// #54 Google Merchant feed freshness
// ---------------------------------------------------------------------------

test("#54 the Google feed copy lives an hour at most and a stale mark retires it after the rebuild floor", () => {
  assert.ok(GOOGLE_FEED_TTL_MS <= 60 * 60 * 1000);
  const built = { generatedAt: 1_000_000 };
  assert.equal(googleMerchantFeedCacheIsFresh(null, 1_000_000), false);
  assert.equal(googleMerchantFeedCacheIsFresh(built, 1_000_000 + GOOGLE_FEED_TTL_MS - 1), true);
  assert.equal(googleMerchantFeedCacheIsFresh(built, 1_000_000 + GOOGLE_FEED_TTL_MS), false);
  const stale = { ...built, stale: true };
  // Inside the floor a burst of till sales does not rebuild the 12s query each time.
  assert.equal(googleMerchantFeedCacheIsFresh(stale, 1_000_000 + GOOGLE_FEED_MIN_REBUILD_MS - 1), true);
  assert.equal(googleMerchantFeedCacheIsFresh(stale, 1_000_000 + GOOGLE_FEED_MIN_REBUILD_MS), false);
});

test("#54 a storefront cache invalidation makes the next Google feed request rebuild", async (t) => {
  const dbModule = await import("../server/database/db.js");
  const db = dbModule.default;
  const realQuery = db.query;
  let builds = 0;
  let price = 1000;
  db.query = async (sql) => {
    if (/LIMIT \$1 OFFSET \$2/.test(String(sql))) {
      builds += 1;
      return { rows: [{
        product_id: 100, variant_id: 501, product_name: "Runner Pro", slug: "runner-pro", color: "Black", size: "42",
        product_type: "sneakers", brand_name: "M1", product_image_url: "/uploads/r.webp",
        product_selling_price: price, product_regular_price: price, product_price: price, product_stock: 3,
        variant_stock: 3, variant_selling_price: price, variant_regular_price: price, variant_price: price,
      }] };
    }
    return { rows: [] };
  };
  let now = 10_000_000;
  t.mock.method(Date, "now", () => now);
  t.after(() => {
    db.query = realQuery;
    clearGoogleMerchantFeedCache();
  });

  clearGoogleMerchantFeedCache();
  const first = await buildGoogleMerchantFeed();
  assert.equal(builds, 1);
  price = 800;
  now += GOOGLE_FEED_MIN_REBUILD_MS + 1;
  assert.equal(await buildGoogleMerchantFeed(), first, "no change: the cached copy is served");
  assert.equal(builds, 1);

  await invalidateCachePattern("storefront:tenant:1:*");
  const second = await buildGoogleMerchantFeed();
  assert.equal(builds, 2, "the invalidation retired the cached copy");
  assert.notEqual(second.xml, first.xml);
});

test("#54 the Google feed route no longer lets a CDN keep a day-old copy", async () => {
  const handler = createGoogleMerchantFeedHandler({ loadFeed: async () => ({ xml: "<?xml?>", etag: '"e"', generatedAt: Date.now() }) });
  const res = fakeRes();
  await handler({ headers: {} }, res);
  const header = res.headers["Cache-Control"];
  const sMaxAge = Number(/s-maxage=(\d+)/.exec(header)?.[1]);
  const maxAge = Number(/max-age=(\d+)/.exec(header)?.[1]);
  assert.ok(sMaxAge > 0 && sMaxAge <= 900, header);
  assert.ok(maxAge <= 900, header);
});

// ---------------------------------------------------------------------------
// #55 merchant policies + share card on the server-rendered product page
// #59 the default offer is the size the page opens on
// ---------------------------------------------------------------------------

const colourPricedProduct = {
  id: 7,
  slug: "air-force-1",
  name: "Air Force 1",
  // normalizeProduct's product-level price: the cheapest in-stock size.
  final_price: 900,
  image_url: "https://images.example/af1.jpg",
  variants: [
    { id: 11, color: "Triple White", size: "42", stock: 0, final_price: 900 },
    { id: 12, color: "Panda", size: "42", stock: 2, final_price: 1850 },
    { id: 13, color: "Triple White", size: "43", stock: 4, final_price: 900 },
  ],
};

test("#59 without a colour the offer quotes the first in-stock size in response order, as the page opens", () => {
  const seo = buildProductSeo(colourPricedProduct);
  assert.equal(seo.productJsonLd.offers.price, "1850.00");
  // A named colour still speaks for itself.
  assert.equal(buildProductSeo(colourPricedProduct, { color: "Triple White" }).productJsonLd.offers.price, "900.00");
  // Nothing in stock: the first listed size.
  const soldOut = { ...colourPricedProduct, variants: colourPricedProduct.variants.map((v) => ({ ...v, stock: 0 })) };
  assert.equal(buildProductSeo(soldOut).productJsonLd.offers.price, "900.00");
});

const policies = {
  shippingDetails: [{ "@type": "OfferShippingDetails", shippingRate: { value: 60, currency: "EGP" } }],
  returnPolicy: { "@type": "MerchantReturnPolicy", merchantReturnDays: 14 },
};

test("#55 the product page handler merges merchant policies and the share card into the schema", async () => {
  let pricedWith = null;
  const handler = createStorefrontProductSeoPageHandler({
    loadProduct: async () => ({ status: 200, product: colourPricedProduct }),
    loadShell: async () => SHELL,
    loadExtras: async (product, { productPrice }) => {
      pricedWith = productPrice;
      return { merchant_policies: policies, og_image_url: "/uploads/og/products/7-abc.jpg" };
    },
  });
  const res = fakeRes();
  await handler({ params: { identifier: "air-force-1" }, query: { color: "Triple White" } }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 200);
  assert.equal(pricedWith, 900, "policies are priced with the offer this page quotes");
  const jsonLd = JSON.parse(/data-m1-product-seo="product">([\s\S]*?)<\/script>/.exec(res.body)[1]);
  assert.deepEqual(jsonLd.offers.shippingDetails, policies.shippingDetails);
  assert.deepEqual(jsonLd.offers.hasMerchantReturnPolicy, policies.returnPolicy);
  // The card the extras drew is what a pasted link shows. It is a composite with the price and
  // the store name rendered over the photo, so it is the og:image and NOT Product.image, which
  // Google presents as the product itself.
  assert.match(res.body, /property="og:image" content="https:\/\/api\.m1store-egy\.com\/uploads\/og\/products\/7-abc\.jpg"/);
  assert.equal(jsonLd.image.includes("https://api.m1store-egy.com/uploads/og/products/7-abc.jpg"), false);
  assert.ok(jsonLd.image.length > 0, "the schema still carries the shop's own photographs");
});

test("#55 a failing or slow extra drops only that piece", async () => {
  const slow = await loadProductSeoExtras(colourPricedProduct, {
    productPrice: 900,
    loadMerchantPolicies: async () => policies,
    loadOgImage: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.deepEqual(slow, { merchant_policies: policies });
  const failing = await loadProductSeoExtras(colourPricedProduct, {
    loadMerchantPolicies: async () => { throw new Error("settings down"); },
    loadOgImage: async () => ({ url: "https://api.m1store-egy.com/uploads/og/products/7.jpg" }),
    timeoutMs: 50,
  });
  assert.deepEqual(failing, { og_image_url: "https://api.m1store-egy.com/uploads/og/products/7.jpg" });
});

// ---------------------------------------------------------------------------
// #56 past the last category page
// ---------------------------------------------------------------------------

const menDefinition = seoCategoryByPath("/men");

test("#56 a category page past the last one redirects to the last page instead of a 200 duplicate", async () => {
  const handler = createStorefrontCategorySeoPageHandler({
    loadProducts: async () => ({ products: [{ id: 1, slug: "a", name: "A" }], total: 50, totalKnown: true }),
    loadShell: async () => SHELL,
  });
  const res = fakeRes();
  await handler({ params: { categoryKey: "men" }, query: { page: "51" } }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectedTo, "/men?page=3");
  assert.match(res.headers["Cache-Control"], /no-store/);

  const single = fakeRes();
  const handlerOnePage = createStorefrontCategorySeoPageHandler({
    loadProducts: async () => ({ products: [], total: 3 }),
    loadShell: async () => SHELL,
  });
  await handlerOnePage({ params: { categoryKey: "men" }, query: { page: "4" } }, single, (error) => { throw error; });
  assert.equal(single.redirectedTo, "/men");

  // The real last page still renders, and an unknown total never redirects.
  for (const loaded of [{ products: [{ id: 1, slug: "a", name: "A" }], total: 50 }, { products: [], total: 0, totalKnown: false }]) {
    const ok = fakeRes();
    const h = createStorefrontCategorySeoPageHandler({ loadProducts: async () => loaded, loadShell: async () => SHELL });
    await h({ params: { categoryKey: "men" }, query: { page: loaded.total ? "3" : "9" } }, ok, (error) => { throw error; });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.redirectedTo, null);
  }
});

// ---------------------------------------------------------------------------
// #57 filtered /products and /sale; shared listing head rule
// ---------------------------------------------------------------------------

test("#57 listing head: only ?page= is indexable, every other parameter canonicalises to the bare listing", () => {
  assert.deepEqual(
    [listingSeoHead({ path: "/products", params: new URLSearchParams("") }).robots, listingSeoHead({ path: "/products", params: new URLSearchParams("") }).canonical],
    ["index,follow", "https://m1store-egy.com/products"]
  );
  const paged = listingSeoHead({ path: "/sale", params: new URLSearchParams("page=3"), page: 3, totalPages: 5 });
  assert.equal(paged.robots, "index,follow");
  assert.equal(paged.canonical, "https://m1store-egy.com/sale?page=3");
  for (const search of ["brand=Nike", "sort=price_asc&page=2", "per_page=48", "q=air", "quality=mirror_original"]) {
    const head = listingSeoHead({ path: "/products", params: new URLSearchParams(search), page: 2 });
    assert.equal(head.robots, "noindex,follow", search);
    assert.equal(head.canonical, "https://m1store-egy.com/products", search);
  }
  const past = listingSeoHead({ path: "/men", params: new URLSearchParams("page=9"), page: 9, totalPages: 3 });
  assert.equal(past.robots, "noindex,follow");
  assert.equal(past.canonical, "https://m1store-egy.com/men");
  // An unloaded total (0) never calls a page "past the end".
  assert.equal(listingSeoHead({ path: "/men", params: new URLSearchParams("page=9"), page: 9, totalPages: 0 }).robots, "index,follow");
});

const listingSource = read("../src/storefront/pages/StorefrontProductListingPage.jsx");

const effectAfter = (marker) => {
  const start = listingSource.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  return listingSource.slice(start, listingSource.indexOf("}, [", start));
};

test("#57 the /products and /sale effect sets canonical and robots from the shared rule", () => {
  const effect = effectAfter("if (seoCategory || typeof document === \"undefined\") return undefined;");
  assert.match(effect, /listingSeoHead\(\{ path: filterBasePath, params, page/);
  assert.match(effect, /robots\.setAttribute\("content", head\.robots\)/);
  assert.match(effect, /canonical\.setAttribute\("href", head\.canonical\)/);
  assert.doesNotMatch(effect, /if \(q\)/, "the canonical is no longer set only for a search");
});

// ---------------------------------------------------------------------------
// #58 Arabic head copy on section pages
// ---------------------------------------------------------------------------

test("#58 section head copy stays Arabic when the reader's language is English", () => {
  const english = localizeSeoCategory(menDefinition, "en");
  assert.equal(english.title, "Original men's shoes | M1 Store");
  const head = categorySeoHeadCopy(english);
  assert.equal(head.title, menDefinition.title);
  assert.equal(head.description, menDefinition.description);
  assert.equal(head.h1, menDefinition.h1);
});

test("#58 the section effect writes the head from the Arabic copy, not the localized definition", () => {
  const effect = effectAfter("if (!seoCategory || typeof document === \"undefined\") return undefined;");
  assert.match(effect, /const headCopy = categorySeoHeadCopy\(seoCategory\)/);
  assert.match(effect, /document\.title = headCopy\.title/);
  assert.doesNotMatch(effect, /seoCategory\.(title|description)/);
  assert.match(effect, /buildCategoryItemList\(headCopy,/);
  assert.match(effect, /listingSeoHead\(\{/);
});

// ---------------------------------------------------------------------------
// #96 images from the listing projection; #97 one entry per product
// ---------------------------------------------------------------------------

const colourCards = [
  { id: 5, card_id: "5:black", parent_product_id: 5, slug: "v2k", name: "Nike V2K", image_url: "/uploads/products/v2k-black.webp" },
  { id: 5, card_id: "5:white", parent_product_id: 5, slug: "v2k", name: "Nike V2K", image_url: "/uploads/products/v2k-white.webp" },
  { id: 6, card_id: "6:red", parent_product_id: 6, slug: "crocs", name: "Crocs", product_image_url: "https://cdn.example/crocs.jpg" },
];

test("#96 category images read the fields the listing cards carry, absolute against the API origin", () => {
  assert.equal(categoryProductImage({ gallery_images: [{ url: "https://cdn.example/g.jpg" }] }), "https://cdn.example/g.jpg");
  assert.equal(categoryProductImage(colourCards[2]), "https://cdn.example/crocs.jpg");
  const payload = buildCategorySeoPayload(menDefinition, colourCards);
  assert.equal(payload.image, "https://api.m1store-egy.com/uploads/products/v2k-black.webp");
  const html = injectCategorySeoIntoHtml(SHELL, menDefinition, colourCards);
  assert.match(html, /<meta property="og:image" content="https:\/\/api\.m1store-egy\.com\/uploads\/products\/v2k-black\.webp" \/>/);
  assert.match(html, /<img src="https:\/\/api\.m1store-egy\.com\/uploads\/products\/v2k-black\.webp"/);
});

test("#96 the client section effect resolves the card image through the same field list", () => {
  const effect = effectAfter("if (!seoCategory || typeof document === \"undefined\") return undefined;");
  assert.match(effect, /resolveProductImageUrl\(categoryProductImage\(orderedFilteredProducts\[0\]\)\)/);
});

test("#97 the ItemList and the crawlable links name each product once, not once per colour card", () => {
  assert.equal(uniqueCategoryProducts(colourCards).length, 2);
  const list = buildCategoryItemList(menDefinition, colourCards, 1, 24);
  assert.equal(list.numberOfItems, 2);
  assert.deepEqual(list.itemListElement.map((item) => item.url), [
    "https://m1store-egy.com/product/v2k",
    "https://m1store-egy.com/product/crocs",
  ]);
  const html = injectCategorySeoIntoHtml(SHELL, menDefinition, colourCards);
  assert.equal(html.match(/href="\/product\/v2k"/g).length, 1);
  assert.equal(html.match(/<h2>Nike V2K<\/h2>/g).length, 1);
});

// ---------------------------------------------------------------------------
// #98 legal pages hreflang
// ---------------------------------------------------------------------------

test("#98 each legal language URL is its own canonical, with the bare URL as x-default", () => {
  assert.equal(legalHeadLinks("privacy", "en").canonical, "https://m1store-egy.com/privacy?lang=en");
  assert.equal(legalHeadLinks("terms", "ar").canonical, "https://m1store-egy.com/terms?lang=ar");
  assert.equal(legalHeadLinks("data-deletion", "").canonical, "https://m1store-egy.com/data-deletion");
  assert.equal(legalHeadLinks("privacy", "de").canonical, "https://m1store-egy.com/privacy");
  const alternates = Object.fromEntries(legalHeadLinks("privacy", "en").alternates.map((link) => [link.hreflang, link.href]));
  assert.deepEqual(alternates, {
    ar: "https://m1store-egy.com/privacy?lang=ar",
    en: "https://m1store-egy.com/privacy?lang=en",
    "x-default": "https://m1store-egy.com/privacy",
  });
  // Every hreflang target is a canonical URL of its own page.
  for (const lang of ["ar", "en"]) assert.equal(alternates[lang], legalHeadLinks("privacy", lang).canonical);
  assert.equal(alternates["x-default"], legalHeadLinks("privacy", "").canonical);
  assert.equal(legalHeadLinks("nope", "en"), null);
});

// ---------------------------------------------------------------------------
// #109 pixel content ids equal the Meta feed ids
// ---------------------------------------------------------------------------

test("#109 the event id honours the feed id the server stamped, SKU otherwise", () => {
  assert.equal(metaCatalogContentId({ id: 391 }, { id: 6818, sku: "ADS-LOC-8-WHT-41", meta_content_id: "391-6818" }), "391-6818");
  // A cart or order line carries it on the line itself.
  assert.equal(metaCatalogContentId({ product_id: 391, variant_id: 6818, sku: "DUP", meta_content_id: "391-6818" }, { product_id: 391, variant_id: 6818, sku: "DUP", meta_content_id: "391-6818" }), "391-6818");
  assert.equal(metaCatalogContentId({ id: 1 }, { id: 2, sku: "UNIQUE-1" }), "UNIQUE-1");
  assert.equal(metaCatalogItemId({ productId: 1, variantId: 2, sku: "S", skuUnique: true }), "S");
  assert.equal(metaCatalogItemId({ productId: 1, variantId: 2, sku: "S", skuUnique: false }), "1-2");
  assert.equal(metaCatalogItemId({ productId: 1, variantId: 2, sku: "", skuUnique: true }), "1-2");
});

test("#109 the storefront id and the feed id agree for a duplicated and a unique SKU", () => {
  const keys = new Set(["dup-sku"]);
  const feedRow = (overrides) => ({
    product_id: 391, variant_id: 6818, variant_sku: "DUP-SKU", sku_count: 2,
    product_name: "Adidas Loc", product_type: "Sneakers", color: "White", size: "41",
    variant_stock: 3, product_selling_price: 500, ...overrides,
  });
  const duplicated = buildMetaCatalogItem(feedRow({}));
  assert.equal(duplicated.id, "391-6818");
  assert.equal(metaContentIdFor({ productId: 391, variantId: 6818, sku: " dup-SKU " }, keys), duplicated.id);
  const unique = buildMetaCatalogItem(feedRow({ variant_id: 6819, variant_sku: "UNIQUE-41", sku_count: 1 }));
  assert.equal(unique.id, "UNIQUE-41");
  assert.equal(metaContentIdFor({ productId: 391, variantId: 6819, sku: "UNIQUE-41" }, keys), unique.id);
  // No set loaded: no stamp, so the events keep the SKU instead of guessing.
  assert.equal(metaContentIdFor({ productId: 391, variantId: 6818, sku: "DUP-SKU" }, null), "");
  const product = attachMetaContentIds({ id: 391, variants: [{ id: 6818, sku: "DUP-SKU" }, { id: 6819, sku: "UNIQUE-41" }] }, keys);
  assert.deepEqual(product.variants.map((v) => v.meta_content_id), ["391-6818", "UNIQUE-41"]);
});

test("#109 the duplicate-SKU read counts exactly the rows the feed counts", () => {
  const feed = read("../server/services/metaCatalogFeedService.js");
  const cte = /variant_sku_counts AS \(([\s\S]*?)\n    \),/.exec(feed)?.[1] || "";
  assert.ok(cte, "feed CTE not found");
  assert.equal(squash(cte), squash(META_PUBLISHED_SKU_COUNTS_SQL));
});

test("#109 the duplicate-SKU set is cached, and a failed read backs off instead of querying every request", async (t) => {
  t.after(() => resetMetaContentIdSnapshot());
  let now = 1_000_000;
  let calls = 0;
  resetMetaContentIdSnapshot();
  const failing = async () => { calls += 1; throw new Error("db down"); };
  assert.equal(await ensureMetaDuplicateSkuKeys({ query: failing, now: () => now }), null);
  assert.equal(await ensureMetaDuplicateSkuKeys({ query: failing, now: () => now }), null);
  assert.equal(calls, 1);
  now += 61_000;
  const keys = await ensureMetaDuplicateSkuKeys({ query: async () => { calls += 1; return { rows: [{ sku_key: "DUP-SKU" }] }; }, now: () => now });
  assert.equal(calls, 2);
  assert.ok(keys.has("dup-sku"));
  await ensureMetaDuplicateSkuKeys({ query: failing, now: () => now + 1000 });
  assert.equal(calls, 2, "a fresh set is not re-read");
});

test("#109 every storefront path that feeds an event carries meta_content_id", () => {
  const controller = read("../server/controllers/storefrontController.js");
  const slim = controller.slice(controller.indexOf("const slimVariantForList"), controller.indexOf("const slimProductForList"));
  assert.match(slim, /meta_content_id: variant\.meta_content_id \|\| metaContentIdFor\(/);
  const getProduct = controller.slice(controller.indexOf("export const getProduct = async"), controller.indexOf("export const getProductPair"));
  assert.match(getProduct, /ensureMetaDuplicateSkuKeys\(\)/);
  assert.match(getProduct, /attachMetaContentIds\(hydratedProduct, duplicateSkuKeys\)/);
  const section = controller.slice(controller.indexOf("const buildStorefrontProductSection"), controller.indexOf("slim_cards"));
  assert.match(section, /ensureMetaDuplicateSkuKeys\(\)/);
  assert.match(controller, /normalizedItems\.push\(\{[\s\S]{0,600}meta_content_id: metaContentIdFor\(\{ productId: variant\.product_id, variantId: variant\.id, sku: variant\.sku \}\)/);
  const storefront = read("../src/storefront/Storefront.jsx");
  const cartLine = storefront.slice(storefront.indexOf("const normalizeCartLine"), storefront.indexOf("const normalizeCartCollection"));
  assert.match(cartLine, /variant\.meta_content_id \? \{ meta_content_id: variant\.meta_content_id \}/);
  assert.match(read("../.gitignore"), /^!server\/services\/metaCatalogContentIdService\.js$/m);
});
