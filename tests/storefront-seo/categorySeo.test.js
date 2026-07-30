import test from "node:test";
import assert from "node:assert/strict";
import {
  SEO_CATEGORY_DEFINITIONS,
  buildCategoryBreadcrumb,
  buildCategoryItemList,
  productHasLargeAvailableSize,
  seoCategoryByPath,
} from "../../src/shared/lib/categorySeo.js";
import {
  buildCategorySeoPayload,
  injectCategorySeoIntoHtml,
  loadStorefrontCategoryHtmlShell,
} from "../../server/services/storefrontCategorySeoPageService.js";
import { buildSitemapEntries } from "../../server/services/storefrontSeoService.js";

const shell = '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>';
const products = [
  { id: 1, slug: "men-one", name: "Men One", cover_image: "https://example.com/one.jpg", variants: [{ size: "47", stock: 2 }] },
  { id: 2, slug: "sold-large", name: "Sold Large", variants: [{ size: "48", stock: 0 }] },
];

test("all eight category routes map to the real API filter vocabulary", () => {
  assert.equal(SEO_CATEGORY_DEFINITIONS.length, 8);
  assert.deepEqual(
    SEO_CATEGORY_DEFINITIONS.map(({ path }) => path),
    ["/men", "/women", "/kids", "/bags", "/crocs", "/slippers", "/offers", "/men/large-sizes"]
  );
  assert.equal(seoCategoryByPath("/men").apiFilters.gender, "men");
  assert.equal(seoCategoryByPath("/bags").apiFilters.product_type, "bags");
  assert.equal(seoCategoryByPath("/offers").apiFilters.offer_story, 1);
});

test("large sizes require an actually sellable men variant from 47 through 50", () => {
  const range = seoCategoryByPath("/men/large-sizes").largeSizes;
  assert.equal(productHasLargeAvailableSize(products[0], range), true);
  assert.equal(productHasLargeAvailableSize(products[1], range), false);
  assert.equal(productHasLargeAvailableSize({ variants: [{ size: 51, stock: 2 }] }, range), false);
});

test("category initial HTML contains unique metadata, one H1, products, pagination and schemas", () => {
  const definition = seoCategoryByPath("/men");
  const html = injectCategorySeoIntoHtml(shell, definition, products, { page: 2, total: 50, indexable: true });
  assert.match(html, /<title>[^<]*M1 Store<\/title>/);
  assert.match(html, /property="og:site_name" content="M1 Store"/);
  assert.match(html, /rel="canonical" href="https:\/\/m1store-egy.com\/men\?page=2"/);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.match(html, /href="\/product\/men-one"/);
  assert.match(html, /href="\/men\?page=3"/);
  assert.equal((html.match(/data-m1-category-seo="breadcrumb"/g) || []).length, 1);
  assert.equal((html.match(/data-m1-category-seo="item-list"/g) || []).length, 1);
});

test("non-SEO filter combinations are noindex and canonicalize to the section", () => {
  const definition = seoCategoryByPath("/women");
  const html = injectCategorySeoIntoHtml(shell, definition, products, { page: 4, total: 2, indexable: false });
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(html, /rel="canonical" href="https:\/\/m1store-egy.com\/women"/);
});

test("BreadcrumbList and ItemList reflect only visible products", () => {
  const definition = seoCategoryByPath("/kids");
  const breadcrumb = buildCategoryBreadcrumb(definition);
  const itemList = buildCategoryItemList(definition, [products[0]], 2, 24);
  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.equal(breadcrumb.itemListElement.at(-1).item, "https://m1store-egy.com/kids");
  assert.equal(itemList["@type"], "ItemList");
  assert.equal(itemList.numberOfItems, 1);
  assert.equal(itemList.itemListElement[0].position, 25);
});

test("sitemap contains static category URLs only and no query combinations", () => {
  const entries = buildSitemapEntries([{ id: 1, slug: "shoe", updated_at: "2026-07-26T00:00:00Z" }]);
  for (const definition of SEO_CATEGORY_DEFINITIONS) {
    assert.ok(entries.some((entry) => entry.loc === `https://m1store-egy.com${definition.path}`));
  }
  assert.equal(entries.some((entry) => entry.loc.includes("?")), false);
  assert.equal(entries.filter((entry) => SEO_CATEGORY_DEFINITIONS.some((definition) => entry.loc.endsWith(definition.path))).every((entry) => entry.lastmod), true);
});

test("payload has canonical page metadata and valid structured data", () => {
  const payload = buildCategorySeoPayload(seoCategoryByPath("/crocs"), products, { page: 1, total: 25 });
  assert.equal(payload.canonical, "https://m1store-egy.com/crocs");
  assert.equal(payload.totalPages, 2);
  assert.equal(payload.breadcrumbJsonLd["@type"], "BreadcrumbList");
  assert.equal(payload.itemListJsonLd["@type"], "ItemList");
});

test("category SEO shell always bypasses stale deployment caches", async () => {
  let requestUrl = "";
  let requestOptions = {};
  const html = await loadStorefrontCategoryHtmlShell(async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return { ok: true, text: async () => "<html>fresh</html>" };
  });
  assert.equal(html, "<html>fresh</html>");
  assert.match(requestUrl, /\/index\.html\?seo-shell=\d+$/);
  assert.equal(requestOptions.cache, "no-store");
  assert.match(requestOptions.headers["Cache-Control"], /no-store/);
});
