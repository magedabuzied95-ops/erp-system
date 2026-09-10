import { buildProductSeo, STOREFRONT_ORIGIN } from "../../src/shared/lib/productSeo.js";

const API_ORIGIN = String(process.env.PUBLIC_API_URL || process.env.API_BASE_URL || "https://api.m1store-egy.com").replace(/\/+$/, "");

const absoluteSeoImageUrl = (value = "") => {
  const source = String(value || "").trim();
  if (!source || source.startsWith("data:") || source.startsWith("blob:")) return "";
  if (/^https?:\/\//i.test(source)) return source.replace(/^http:\/\//i, "https://");
  const base = source.startsWith("/uploads/") ? API_ORIGIN : STOREFRONT_ORIGIN;
  try {
    return new URL(source.startsWith("/") ? source : `/${source}`, `${base}/`).toString();
  } catch {
    return "";
  }
};

export const makeProductSeoImagesAbsolute = (seo = {}) => {
  const image = absoluteSeoImageUrl(seo.image);
  // Deduped AFTER absolutising: a relative and an absolute row for the same file
  // are two distinct strings upstream and one identical url here.
  const productImages = Array.isArray(seo.productJsonLd?.image)
    ? [...new Set(seo.productJsonLd.image.map(absoluteSeoImageUrl).filter(Boolean))]
    : [];
  return {
    ...seo,
    image,
    productJsonLd: {
      ...(seo.productJsonLd || {}),
      image: productImages,
    },
  };
};

const escapeHtml = (value = "") => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/* The shell ships with lang="en-GB" because the SPA flips it at boot from the
 * visitor's saved language. A crawler never runs that code, and the product
 * metadata is Arabic-first, so the server-rendered product page declares the
 * language the crawler is actually reading. */
const declareArabicDocument = (html = "") =>
  String(html).replace(/<html\b([^>]*)>/i, (match, attributes) => {
    const cleaned = String(attributes || "")
      .replace(/\s+lang=["'][^"']*["']/i, "")
      .replace(/\s+dir=["'][^"']*["']/i, "");
    return `<html${cleaned} lang="ar" dir="rtl">`;
  });

export const injectProductSeoIntoHtml = (html = "", seo = {}) => {
  const cleaned = declareArabicDocument(html)
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+(?:name|property)=["'](?:description|keywords|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<script[^>]+data-m1-product-seo=["'](?:product|breadcrumb)["'][^>]*>[\s\S]*?<\/script>/gi, "");
  const keywords = Array.isArray(seo.keywords) ? seo.keywords.filter(Boolean) : [];
  const tags = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    ...(keywords.length ? [`<meta name="keywords" content="${escapeHtml(keywords.join(", "))}" />`] : []),
    `<meta name="robots" content="${escapeHtml(seo.robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
    `<meta property="og:type" content="product" />`,
    `<meta property="og:site_name" content="M1 Store" />`,
    `<meta property="og:locale" content="${escapeHtml(seo.locale || "ar_EG")}" />`,
    `<meta property="og:locale:alternate" content="${escapeHtml(seo.localeAlternate || "en_US")}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:image" content="${escapeHtml(seo.image)}" />`,
    ...(seo.imageAlt ? [`<meta property="og:image:alt" content="${escapeHtml(seo.imageAlt)}" />`] : []),
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

/*
  Every product and category page used to fetch the storefront's own index.html over the network
  — through Cloudflare, no timeout — on EVERY request. Once each ad link carried its own
  ?color=&variant= (2026-09-10) Meta and Google re-crawled thousands of new URLs at once, those
  round trips stalled into Cloudflare 524s, and 2 of 5 product pages hung past 60s.

  The shell only changes on a deploy, so it is held for 30s, concurrent requests share one fetch,
  a fetch that has not answered in 8s is abandoned, and a failed refresh serves the last good
  shell. The fetch itself still bypasses HTTP caches (see loadStorefrontHtmlShell), so a deploy is
  picked up within the TTL.
*/
const SHELL_TTL_MS = 30 * 1000;
const SHELL_FETCH_TIMEOUT_MS = 8 * 1000;
// With nothing cached there is no fallback. Measured after a deploy: ONE connection to the
// storefront got stuck — every request sharing that fetch failed together at the cut-off,
// whether the cut-off was 8s or 25s — while the very next fresh fetch answered in ~0.5s. So a
// cold fetch is retried on a fresh connection in short attempts rather than waited on longer.
const SHELL_COLD_ATTEMPT_TIMEOUT_MS = 5 * 1000;
const SHELL_COLD_ATTEMPTS = 4;

export const createCachedShellLoader = (
  load,
  {
    ttlMs = SHELL_TTL_MS,
    timeoutMs = SHELL_FETCH_TIMEOUT_MS,
    coldAttemptTimeoutMs = SHELL_COLD_ATTEMPT_TIMEOUT_MS,
    coldAttempts = SHELL_COLD_ATTEMPTS,
    now = () => Date.now(),
    fetchImpl = fetch,
    signalFor = (ms) => AbortSignal.timeout(ms),
  } = {}
) => {
  let html = "";
  let fetchedAt = 0;
  let inflight = null;
  const fetchShell = async () => {
    // A warm refresh gets one attempt: the last good shell is the fallback.
    const cold = !html;
    const attempts = cold ? Math.max(1, coldAttempts) : 1;
    const ms = cold ? coldAttemptTimeoutMs : timeoutMs;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await load((url, options = {}) => fetchImpl(url, { ...options, signal: signalFor(ms) }));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
  const loader = async () => {
    if (html && now() - fetchedAt < ttlMs) return html;
    if (!inflight) {
      inflight = Promise.resolve()
        .then(fetchShell)
        .then((fresh) => {
          html = fresh;
          fetchedAt = now();
          return fresh;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      return await inflight;
    } catch (error) {
      if (html) {
        console.warn("[storefront-seo] shell refresh failed; serving the last good shell", {
          error: error?.message || String(error),
          age_ms: now() - fetchedAt,
        });
        return html;
      }
      throw error;
    }
  };
  // Called once the server listens, so the first crawler after a deploy finds the shell ready.
  loader.warm = () => loader().then(() => true, () => false);
  return loader;
};

const cachedStorefrontHtmlShell = createCachedShellLoader(loadStorefrontHtmlShell);
export const warmStorefrontHtmlShell = () => cachedStorefrontHtmlShell.warm();

export const createStorefrontProductSeoPageHandler = ({
  loadProduct = loadProductSeoData,
  loadShell = cachedStorefrontHtmlShell,
} = {}) => async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || "").trim();
    const { status, product } = await loadProduct(identifier);
    if (!product) return res.status(status === 404 ? 404 : 503).send("Product not found");
    // The ad feeds link each colourway with ?color=; the schema must quote that colour's offer.
    const color = String(req.query?.color || "").trim().slice(0, 120);
    const variant = String(req.query?.variant || "").trim().slice(0, 40);
    const html = injectProductSeoIntoHtml(
      await loadShell(),
      makeProductSeoImagesAbsolute(buildProductSeo(product, { color, variant }))
    );
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.status(200).send(html);
  } catch (error) {
    // A request-timeout middleware may already have answered; a second response throws
    // ERR_HTTP_HEADERS_SENT (seen in production during the 524 storm).
    if (res.headersSent) return undefined;
    return next(error);
  }
};

export const storefrontProductSeoPageHandler = createStorefrontProductSeoPageHandler();
