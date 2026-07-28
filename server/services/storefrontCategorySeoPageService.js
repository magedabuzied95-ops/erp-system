import {
  SEO_CATEGORY_DEFINITIONS,
  buildCategoryBreadcrumb,
  buildCategoryItemList,
  categoryCanonical,
  productHasLargeAvailableSize,
  seoCategoryByKey,
} from "../../src/shared/lib/categorySeo.js";

const API_ORIGIN = String(process.env.PUBLIC_API_URL || process.env.API_BASE_URL || "https://api.m1store-egy.com").replace(/\/+$/, "");
const STOREFRONT_ORIGIN = "https://m1store-egy.com";
const PAGE_SIZE = 24;

const escapeHtml = (value = "") => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const positivePage = (value) => Math.max(1, Number.parseInt(String(value || "1"), 10) || 1);
const productIdentifier = (product = {}) => product.slug || product.canonical_slug || product.id;
const productImage = (product = {}) => product.cover_image || product.coverImage || product.image || product.images?.[0]?.url || "";

export const buildCategorySeoPayload = (definition, products = [], { page = 1, total = products.length, indexable = true } = {}) => {
  const canonical = categoryCanonical(definition, indexable ? page : 1);
  return {
    title: definition.title,
    description: definition.description,
    canonical,
    robots: indexable ? "index,follow" : "noindex,follow",
    image: productImage(products[0]),
    breadcrumbJsonLd: buildCategoryBreadcrumb(definition),
    itemListJsonLd: buildCategoryItemList(definition, products, page, PAGE_SIZE),
    page,
    total,
    totalPages: Math.max(1, Math.ceil(Number(total || 0) / PAGE_SIZE)),
  };
};

const renderProducts = (products = []) => products.map((product) => {
  const identifier = productIdentifier(product);
  if (!identifier) return "";
  const href = `/product/${encodeURIComponent(identifier)}`;
  const image = productImage(product);
  return [
    `<article class="m1-seo-category-product">`,
    `<a href="${escapeHtml(href)}">`,
    image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name || product.title || "")}" loading="lazy" />` : "",
    `<h2>${escapeHtml(product.name || product.title || "")}</h2>`,
    `</a>`,
    `</article>`,
  ].join("");
}).join("");

const renderPagination = (definition, page, totalPages) => {
  if (totalPages <= 1) return "";
  const links = Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => {
    const href = `${definition.path}${number > 1 ? `?page=${number}` : ""}`;
    return `<a href="${escapeHtml(href)}"${number === page ? ' aria-current="page"' : ""}>${number}</a>`;
  }).join("");
  return `<nav aria-label="صفحات المنتجات">${links}</nav>`;
};

const renderInitialContent = (definition, products, seo) => {
  const related = definition.related.map((path) => {
    const item = SEO_CATEGORY_DEFINITIONS.find((entry) => entry.path === path);
    return item ? `<a href="${escapeHtml(item.path)}">${escapeHtml(item.h1)}</a>` : "";
  }).join("");
  return [
    `<main data-m1-category-initial="${escapeHtml(definition.key)}" dir="rtl">`,
    `<nav aria-label="مسار التنقل"><a href="/">الرئيسية</a><span> / </span><span>${escapeHtml(definition.h1)}</span></nav>`,
    `<h1>${escapeHtml(definition.h1)}</h1>`,
    `<p>${escapeHtml(definition.intro)}</p>`,
    `<section aria-label="${escapeHtml(definition.h1)}">${renderProducts(products)}</section>`,
    renderPagination(definition, seo.page, seo.totalPages),
    `<nav aria-label="أقسام مرتبطة">${related}</nav>`,
    `</main>`,
  ].join("");
};

export const injectCategorySeoIntoHtml = (html = "", definition, products = [], options = {}) => {
  const seo = buildCategorySeoPayload(definition, products, options);
  const cleaned = String(html)
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<script[^>]+data-m1-category-seo=["'](?:breadcrumb|item-list)["'][^>]*>[\s\S]*?<\/script>/gi, "");
  const tags = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="robots" content="${escapeHtml(seo.robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    ...(seo.image ? [`<meta property="og:image" content="${escapeHtml(seo.image)}" />`] : []),
    `<meta property="og:url" content="${escapeHtml(seo.canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    ...(seo.image ? [`<meta name="twitter:image" content="${escapeHtml(seo.image)}" />`] : []),
    `<script type="application/ld+json" data-m1-category-seo="breadcrumb">${safeJson(seo.breadcrumbJsonLd)}</script>`,
    `<script type="application/ld+json" data-m1-category-seo="item-list">${safeJson(seo.itemListJsonLd)}</script>`,
  ].join("\n    ");
  return cleaned
    .replace("</head>", `    ${tags}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${renderInitialContent(definition, products, seo)}</div>`);
};

export const loadStorefrontCategoryHtmlShell = async (fetchImpl = fetch) => {
  const response = await fetchImpl(`${STOREFRONT_ORIGIN}/index.html?seo-shell=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "User-Agent": "M1-SEO-Renderer/1.0",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) throw new Error(`storefront_shell_${response.status}`);
  return response.text();
};

export const loadCategoryProducts = async (definition, page = 1, fetchImpl = fetch) => {
  const query = new URLSearchParams();
  Object.entries(definition.apiFilters || {}).forEach(([key, value]) => query.set(key, String(value)));
  query.set("sort", "newest");
  query.set("limit", String(PAGE_SIZE));
  query.set("offset", String((page - 1) * PAGE_SIZE));
  const response = await fetchImpl(`${API_ORIGIN}/api/storefront/products?${query}`, {
    headers: { "X-Tenant-Id": String(process.env.STOREFRONT_TENANT_ID || 1) },
  });
  if (!response.ok) throw new Error(`category_products_${response.status}`);
  const payload = await response.json();
  let products = payload?.products || payload?.items || [];
  let total = Number(payload?.total ?? payload?.total_count ?? products.length);
  if (definition.largeSizes) {
    products = products.filter((product) => productHasLargeAvailableSize(product, definition.largeSizes));
  }
  return { products, total };
};

export const createStorefrontCategorySeoPageHandler = ({
  loadProducts = loadCategoryProducts,
  loadShell = loadStorefrontCategoryHtmlShell,
} = {}) => async (req, res, next) => {
  try {
    const definition = seoCategoryByKey(req.params.categoryKey);
    if (!definition) return res.status(404).send("Category not found");
    const page = positivePage(req.query.page);
    const indexable = Object.keys(req.query || {}).every((key) => key === "page");
    const { products, total } = await loadProducts(definition, page);
    const html = injectCategorySeoIntoHtml(await loadShell(), definition, products, { page, total, indexable });
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.status(200).send(html);
  } catch (error) {
    return next(error);
  }
};

export const storefrontCategorySeoPageHandler = createStorefrontCategorySeoPageHandler();
