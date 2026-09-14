import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEO_PAGE_CACHE_CONTROL,
  createStorefrontProductSeoPageHandler,
  loadProductSeoData,
} from "../../server/services/storefrontProductSeoPageService.js";
import {
  createStorefrontCategorySeoPageHandler,
  loadCategoryProducts,
} from "../../server/services/storefrontCategorySeoPageService.js";
import { seoCategoryByPath } from "../../src/shared/lib/categorySeo.js";

// Shoppers reach these handlers through Vercel's rewrites, so a slow data lookup must never cost
// them the app, and the page data must not loop out through our own public API.

const SHELL = '<html lang="en-GB"><head><title>M1 Store</title></head><body><div id="root"></div></body></html>';

const fakeRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    send(body) { res.body = body; res.headersSent = true; return res; },
  };
  return res;
};

const neverResolves = () => new Promise(() => {});
const product = { id: 7, slug: "air-7", name: "Air 7", variants: [{ id: 1, color: "Black", size: "42", stock: 2, final_price: 900 }] };

test("the product page answers from the in-process controller, never an HTTP fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("SEO data must not use fetch"); };
  try {
    let seen = null;
    const result = await loadProductSeoData("air-7", {
      getProduct: async (req, res) => {
        seen = { params: req.params, tenant: req.headers["x-tenant-id"] };
        res.set("Cache-Control", "private");
        res.json({ success: true, product });
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.product.slug, "air-7");
    assert.deepEqual(seen.params, { identifier: "air-7" });
    assert.ok(seen.tenant);

    const missing = await loadProductSeoData("nope", {
      getProduct: async (req, res) => res.status(404).json({ success: false }),
    });
    assert.deepEqual(missing, { status: 404, product: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("neither SEO service fetches page data from a public API origin", () => {
  for (const file of ["storefrontProductSeoPageService.js", "storefrontCategorySeoPageService.js"]) {
    const source = readFileSync(new URL(`../../server/services/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetchImpl\(`\$\{API_ORIGIN\}\/api\/storefront\/products/, `${file} loops through the public API`);
  }
});

test("a product lookup that hangs is cut off at the cap", async () => {
  const started = Date.now();
  await assert.rejects(loadProductSeoData("air-7", { getProduct: neverResolves, timeoutMs: 30 }), /timeout/);
  assert.ok(Date.now() - started < 1000);
});

test("a timed-out or failing product lookup still serves the app shell, uncached", async () => {
  for (const loadProduct of [
    () => loadProductSeoData("air-7", { getProduct: neverResolves, timeoutMs: 20 }),
    async () => ({ status: 500, product: null }),
    async () => { throw new Error("boom"); },
  ]) {
    const handler = createStorefrontProductSeoPageHandler({ loadProduct, loadShell: async () => SHELL });
    const res = fakeRes();
    await handler({ params: { identifier: "air-7" }, query: {} }, res, (error) => { throw error; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, SHELL);
    assert.match(res.headers["Cache-Control"], /no-store/);
    assert.equal(res.headers["Content-Type"], "text/html; charset=utf-8");
  }
});

test("a missing product is a 404 that still carries the app, marked noindex", async () => {
  const handler = createStorefrontProductSeoPageHandler({
    loadProduct: async () => ({ status: 404, product: null }),
    loadShell: async () => SHELL,
  });
  const res = fakeRes();
  await handler({ params: { identifier: "gone" }, query: {} }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /<div id="root"><\/div>/);
  assert.match(res.body, /<meta name="robots" content="noindex,follow" \/>/);
  assert.match(res.headers["Cache-Control"], /no-store/);
});

test("a rendered product page is shared-cacheable for a short while", async () => {
  const handler = createStorefrontProductSeoPageHandler({
    loadProduct: async () => ({ status: 200, product }),
    loadShell: async () => SHELL,
  });
  const res = fakeRes();
  await handler({ params: { identifier: "air-7" }, query: {} }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Air 7/);
  assert.equal(res.headers["Cache-Control"], SEO_PAGE_CACHE_CONTROL);
  assert.match(SEO_PAGE_CACHE_CONTROL, /^public, max-age=0, s-maxage=\d+/);
  assert.equal(res.headers.Expires, undefined);
});

test("the category page lists in-process with the same filters the API call used", async () => {
  const definition = seoCategoryByPath("/crocs");
  let seenQuery = null;
  const { products, total } = await loadCategoryProducts(definition, 2, {
    listProducts: async (req, res) => {
      seenQuery = req.query;
      res.json({ success: true, products: [product], total: 30 });
    },
  });
  assert.equal(products.length, 1);
  assert.equal(total, 30);
  assert.equal(seenQuery.sort, "newest");
  assert.equal(seenQuery.limit, "24");
  assert.equal(seenQuery.offset, "24");
  for (const [key, value] of Object.entries(definition.apiFilters || {})) assert.equal(seenQuery[key], String(value));

  await assert.rejects(
    loadCategoryProducts(definition, 1, { listProducts: async (req, res) => res.status(500).json({ success: false }) }),
    /category_products_500/
  );
  await assert.rejects(loadCategoryProducts(definition, 1, { listProducts: neverResolves, timeoutMs: 20 }), /timeout/);
});

test("a timed-out category listing serves the app shell uncached; a rendered one is cacheable", async () => {
  const fallback = createStorefrontCategorySeoPageHandler({
    loadProducts: (definition, page) => loadCategoryProducts(definition, page, { listProducts: neverResolves, timeoutMs: 20 }),
    loadShell: async () => SHELL,
  });
  const res = fakeRes();
  await fallback({ params: { categoryKey: "crocs" }, query: {} }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, SHELL);
  assert.match(res.headers["Cache-Control"], /no-store/);

  const rendered = createStorefrontCategorySeoPageHandler({
    loadProducts: async () => ({ products: [product], total: 1 }),
    loadShell: async () => SHELL,
  });
  const ok = fakeRes();
  await rendered({ params: { categoryKey: "crocs" }, query: {} }, ok, (error) => { throw error; });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, /data-m1-category-initial="crocs"/);
  assert.equal(ok.headers["Cache-Control"], SEO_PAGE_CACHE_CONTROL);
});
