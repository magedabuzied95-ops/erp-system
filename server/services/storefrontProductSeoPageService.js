import { buildProductSeo, STOREFRONT_ORIGIN } from "../../src/shared/lib/productSeo.js";

const API_ORIGIN = String(process.env.PUBLIC_API_URL || process.env.API_BASE_URL || "https://api.m1store-egy.com").replace(/\/+$/, "");

const escapeHtml = (value = "") => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

export const injectProductSeoIntoHtml = (html = "", seo = {}) => {
  const cleaned = String(html)
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<script[^>]+data-m1-product-seo=["'](?:product|breadcrumb)["'][^>]*>[\s\S]*?<\/script>/gi, "");
  const tags = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="robots" content="${escapeHtml(seo.robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:type" content="product" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:image" content="${escapeHtml(seo.image)}" />`,
    `<meta property="og:url" content="${escapeHtml(seo.url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(seo.image)}" />`,
    `<script type="application/ld+json" data-m1-product-seo="product">${safeJson(seo.productJsonLd)}</script>`,
    `<script type="application/ld+json" data-m1-product-seo="breadcrumb">${safeJson(seo.breadcrumbJsonLd)}</script>`,
  ].join("\n    ");
  return cleaned.replace("</head>", `    ${tags}\n  </head>`);
};

export const loadProductSeoData = async (identifier, fetchImpl = fetch) => {
  const response = await fetchImpl(`${API_ORIGIN}/api/storefront/products/${encodeURIComponent(identifier)}`, {
    headers: { "X-Tenant-Id": String(process.env.STOREFRONT_TENANT_ID || 1) },
  });
  if (!response.ok) return { status: response.status, product: null };
  const payload = await response.json();
  return { status: 200, product: payload?.product || payload?.data?.product || null };
};

export const loadStorefrontHtmlShell = async (fetchImpl = fetch) => {
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

export const createStorefrontProductSeoPageHandler = ({
  loadProduct = loadProductSeoData,
  loadShell = loadStorefrontHtmlShell,
} = {}) => async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || "").trim();
    const { status, product } = await loadProduct(identifier);
    if (!product) return res.status(status === 404 ? 404 : 503).send("Product not found");
    const html = injectProductSeoIntoHtml(await loadShell(), buildProductSeo(product));
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.status(200).send(html);
  } catch (error) {
    return next(error);
  }
};

export const storefrontProductSeoPageHandler = createStorefrontProductSeoPageHandler();
