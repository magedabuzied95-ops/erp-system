import { buildProductSeo, STOREFRONT_ORIGIN } from "../../src/shared/lib/productSeo.js";

const API_ORIGIN = String(process.env.PUBLIC_API_URL || process.env.API_BASE_URL || "https://api.m1store-egy.com").replace(/\/+$/, "");

export const absoluteSeoImageUrl = (value = "") => {
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

/*
  Vercel sends every shopper's document request for a product or category page here, not just
  crawlers. The data behind those pages used to be fetched from our own public API URL — out
  through Cloudflare and back into this same process, with no timeout — so one slow round trip
  held a shopper's page open with nothing on screen. The storefront controllers are now called
  in-process through a tiny req/res stand-in, and the wait is capped: past the cap the shopper
  gets the plain app shell and the app loads the data itself.
*/
export const SEO_DATA_TIMEOUT_MS = 5 * 1000;

const storefrontTenantHeaders = () => ({ "x-tenant-id": String(process.env.STOREFRONT_TENANT_ID || 1) });

export const callStorefrontJsonController = (controller, { params = {}, query = {}, headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: "GET",
      params,
      query,
      headers,
      body: {},
      url: "",
      originalUrl: "",
      get: (name) => headers[String(name || "").toLowerCase()],
    };
    const finish = (body) => {
      res.headersSent = true;
      resolve({ status: statusCode, body });
      return res;
    };
    const res = {
      headersSent: false,
      set: () => res,
      setHeader: () => res,
      header: () => res,
      status: (code) => {
        statusCode = Number(code) || statusCode;
        return res;
      },
      json: finish,
      send: finish,
      end: () => finish(null),
    };
    Promise.resolve()
      .then(() => controller(req, res, (error) => (error ? reject(error) : finish(null))))
      .then(() => {
        if (!res.headersSent) finish(null);
      }, reject);
  });

// The data work is not cancelled at the cap — it finishes and warms the controller caches for
// the next visitor; this page just stops waiting for it.
export const withSeoDataTimeout = (promise, ms = SEO_DATA_TIMEOUT_MS, label = "seo_data") => {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// Imported on first use so the many tests that only need the HTML helpers here do not load the
// controller and its database pool.
const loadStorefrontController = () => import("../controllers/storefrontController.js");

export const loadProductSeoData = async (
  identifier,
  { getProduct = null, timeoutMs = SEO_DATA_TIMEOUT_MS } = {}
) => {
  const controller = getProduct || (await loadStorefrontController()).getProduct;
  const { status, body } = await withSeoDataTimeout(
    callStorefrontJsonController(controller, { params: { identifier }, headers: storefrontTenantHeaders() }),
    timeoutMs,
    "product_seo_data"
  );
  const product = status >= 200 && status < 300 ? body?.product || body?.data?.product || null : null;
  return { status: product ? 200 : status, product };
};

/*
  getProduct deliberately skips the shipping/return policies and the 1200x630 share card: the
  interactive page must not wait on them. This page is where they belong -- without them every
  Offer lacked shippingDetails and hasMerchantReturnPolicy and og:image fell back to the raw
  photo. Each piece has its own short cap and failure is not fatal: the page renders without
  that piece rather than falling back to the bare shell. A card still being drawn when the cap
  passes keeps going and is on disk for the next request.
*/
export const SEO_EXTRAS_TIMEOUT_MS = 2 * 1000;

const defaultLoadMerchantPolicies = async ({ productPrice }) =>
  (await import("./storefrontMerchantPolicyService.js")).loadStorefrontMerchantPolicyData({ productPrice });

const defaultLoadOgImage = async ({ product }) => {
  const { generateProductOgImage } = await import("./productOgImageService.js");
  // No request here: the card is an /uploads file, served by the API origin.
  const apiHost = new URL(API_ORIGIN).host;
  const req = { protocol: "https", get: (name) => (String(name || "").toLowerCase() === "host" ? apiHost : "") };
  return generateProductOgImage({ product, req });
};

export const loadProductSeoExtras = async (
  product = {},
  {
    productPrice = 0,
    loadMerchantPolicies = defaultLoadMerchantPolicies,
    loadOgImage = defaultLoadOgImage,
    timeoutMs = SEO_EXTRAS_TIMEOUT_MS,
  } = {}
) => {
  const [policies, ogImage] = await Promise.allSettled([
    withSeoDataTimeout(Promise.resolve().then(() => loadMerchantPolicies({ product, productPrice })), timeoutMs, "merchant_policies"),
    withSeoDataTimeout(Promise.resolve().then(() => loadOgImage({ product })), timeoutMs, "og_image"),
  ]);
  const extras = {};
  if (policies.status === "fulfilled" && policies.value) extras.merchant_policies = policies.value;
  if (ogImage.status === "fulfilled" && ogImage.value?.url) extras.og_image_url = ogImage.value.url;
  [policies, ogImage].forEach((result) => {
    if (result.status === "rejected") {
      console.warn("[storefront-seo] product extras unavailable", {
        product_id: product?.id,
        error: result.reason?.message || String(result.reason),
      });
    }
  });
  return extras;
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

/*
  A rendered page holds only public catalogue data and the static shell — nothing about the
  visitor — so a shared cache may keep it briefly. The stale window is kept short on purpose:
  the shell names the build's hashed bundles, and a copy served long after a deploy points at
  bundles that no longer exist. Failures and not-found pages are never cached.
*/
export const SEO_PAGE_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=120";
export const SEO_PAGE_NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

export const sendSeoHtml = (res, html, { status = 200, cacheable = false } = {}) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  if (cacheable) {
    res.set("Cache-Control", SEO_PAGE_CACHE_CONTROL);
  } else {
    res.set("Cache-Control", SEO_PAGE_NO_STORE);
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  return res.status(status).send(html);
};

// A missing product still gets the app (it shows its own not-found screen), but a crawler must
// not index the shell's generic storefront text under that URL.
export const markHtmlNoindex = (html = "") =>
  String(html)
    .replace(/<meta\s+name=["']robots["'][^>]*>/gi, "")
    .replace("</head>", `    <meta name="robots" content="noindex,follow" />\n  </head>`);

export const createStorefrontProductSeoPageHandler = ({
  loadProduct = loadProductSeoData,
  loadShell = cachedStorefrontHtmlShell,
  loadExtras = loadProductSeoExtras,
} = {}) => async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || "").trim();
    let loaded = null;
    try {
      loaded = await loadProduct(identifier);
    } catch (error) {
      console.warn("[storefront-seo] product data unavailable; serving the plain shell", {
        identifier,
        error: error?.message || String(error),
      });
    }
    const product = loaded?.product || null;
    if (!product) {
      if (loaded?.status === 404) return sendSeoHtml(res, markHtmlNoindex(await loadShell()), { status: 404 });
      // A slow or failing lookup is temporary: no noindex (that would drop a ranking page), and
      // the shell's generic meta is what a crawler that renders the app replaces anyway.
      return sendSeoHtml(res, await loadShell());
    }
    // The ad feeds link each colourway with ?color=; the schema must quote that colour's offer.
    const color = String(req.query?.color || "").trim().slice(0, 120);
    const variant = String(req.query?.variant || "").trim().slice(0, 40);
    // The shipping rates depend on the price (free-shipping threshold), so the policies are
    // priced with the very offer this page quotes.
    const productPrice = Number(buildProductSeo(product, { color, variant }).productJsonLd?.offers?.price || 0);
    const extras = await loadExtras(product, { productPrice }).catch(() => ({}));
    const html = injectProductSeoIntoHtml(
      await loadShell(),
      makeProductSeoImagesAbsolute(buildProductSeo({ ...product, ...extras }, { color, variant }))
    );
    return sendSeoHtml(res, html, { cacheable: true });
  } catch (error) {
    // A request-timeout middleware may already have answered; a second response throws
    // ERR_HTTP_HEADERS_SENT (seen in production during the 524 storm).
    if (res.headersSent) return undefined;
    return next(error);
  }
};

export const storefrontProductSeoPageHandler = createStorefrontProductSeoPageHandler();
