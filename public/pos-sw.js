// v11 is a deliberate eviction, not a cosmetic bump. `activate` deletes every
// `pos-shell-*` cache that is not the current pair, so shipping a new version is
// what heals clients whose v10 runtime cache already holds an HTML SPA-fallback
// response stored under a `.js` key. Asset reads are cache-first, so those
// entries were otherwise permanent for that browser profile.
const VERSION = "pos-shell-v12";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// ---------------------------------------------------------------------------
// PRODUCT IMAGES
// Product photos live on the API origin (and any CDN in front of it), which is a
// DIFFERENT origin from the POS shell. The fetch handler below used to return
// early for every cross-origin request, so no product image was ever cached and
// none was ever served -- an offline till showed a grid of broken pictures, and
// a cashier cannot sell from a grid of broken pictures.
//
// Deliberately versioned on its own, and NOT matched by the `pos-shell-` prefix
// the activate handler evicts: shipping a new shell must not throw away a
// warmed image cache that took a whole catalogue download to build.
const IMAGE_CACHE = "pos-product-images-v1";
// Roughly a full catalogue of thumbnails. The trim is oldest-first, so the cap
// costs the least-recently-warmed images rather than failing new writes once a
// device's storage quota is reached.
const IMAGE_CACHE_MAX_ENTRIES = 4000;
const IMAGE_WARM_CONCURRENCY = 6;
const SHELL_URLS = [
  "/pos",
  "/pos-manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/pos-180.png",
  "/icons/pos-192.png",
  "/icons/pos-512.png",
];

const DEBUG = new URL(self.location.href).searchParams.get("debug") === "1";
const log = (...args) => {
  if (DEBUG) console.info(...args);
};

const isSafeShellAsset = (url) => {
  if (!url || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.includes("/orders") ||
    url.pathname.includes("/checkout") ||
    url.pathname.includes("/payments") ||
    url.pathname.includes("/auth") ||
    url.pathname.includes("/stock")
  ) {
    return false;
  }
  if (url.pathname.startsWith("/assets/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname.startsWith("/fonts/")) return true;
  return /\.(js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|svg|webp|ico)$/i.test(url.pathname);
};

// ---------------------------------------------------------------------------
// RESPONSE-TYPE SAFETY
// The origin answers a missing /assets/* request with the SPA shell: HTTP 200,
// Content-Type text/html. `response.ok` is true for it, so the previous logic
// happily stored that HTML under the .js cache key. Because asset reads are
// cache-first, the browser then had a permanent "module" that is really HTML,
// which is the "Failed to load module script ... MIME type of text/html" boot
// failure. Every cache write and every cache read is now type-checked.
// ---------------------------------------------------------------------------
const SCRIPT_LIKE = /\.(js|mjs|css)$/i;

const isHtmlResponse = (response) =>
  String(response?.headers?.get("content-type") || "").toLowerCase().includes("text/html");

const isUsableAssetResponse = (url, response) => {
  if (!response || !response.ok) return false;
  // A script or stylesheet must never be satisfied by an HTML document.
  if (SCRIPT_LIKE.test(new URL(url, self.location.origin).pathname) && isHtmlResponse(response)) {
    return false;
  }
  return true;
};

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?|$)/i;

// Cloudinary and friends serve images from extensionless, transform-laden paths,
// so the file extension alone is not enough. `request.destination` is the
// browser's own answer to "what is this for" and is authoritative when present.
//
// Deliberately NOT sniffing the Accept header: Chrome sends
// `text/html,...,image/avif,image/webp,...` for a NAVIGATION, so an
// `accept.includes("image/")` test captures the POS page itself and routes it
// into the image cache -- which would cost the shell its offline fallback and
// break the very thing this file exists for.
const isProductImageRequest = (request, url) => {
  if (request.method !== "GET") return false;
  if (request.mode === "navigate") return false;
  if (url.pathname.startsWith("/api/")) return false;
  const destination = String(request.destination || "");
  if (destination === "image") return true;
  // A destination the runtime does not report (older engines, some harnesses)
  // falls back to the path, which is safe because a document URL has no image
  // extension.
  if (destination) return false;
  return IMAGE_EXTENSION.test(url.pathname);
};

const isUsableImageResponse = (response) => {
  if (!response) return false;
  // An opaque response (status 0, from a no-cors fetch) is exactly what a
  // cross-origin image without CORS headers produces. It cannot be inspected,
  // but it CAN be stored with cache.put and rendered by an <img> -- which is
  // why the warm path uses cache.put and never cache.add, whose internal
  // response.ok check rejects opaque responses outright.
  if (response.type === "opaque") return true;
  if (!response.ok) return false;
  return !isHtmlResponse(response);
};

// Oldest-first, because Cache Storage preserves insertion order in `keys()`.
const trimImageCache = async () => {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const keys = await cache.keys();
    const excess = keys.length - IMAGE_CACHE_MAX_ENTRIES;
    if (excess <= 0) return 0;
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    log("POS_SW_IMAGE_CACHE_TRIMMED", { removed: excess });
    return excess;
  } catch {
    return 0;
  }
};

const warmOneImage = async (cache, url) => {
  try {
    const existing = await cache.match(url);
    if (existing) return "hit";

    // CORS first, deliberately. An opaque response hides its status, so a 404
    // for a product whose file was never uploaded would be stored as a
    // permanent broken image -- the same shape of bug as a CDN caching a 404 as
    // immutable. The API origin does send CORS headers, so the common case gets
    // a readable status and a real check.
    try {
      const corsResponse = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
      if (corsResponse && corsResponse.ok && !isHtmlResponse(corsResponse)) {
        await cache.put(url, corsResponse);
        return "stored";
      }
      if (corsResponse && !corsResponse.ok) return "skipped";
    } catch {
      // The host sends no CORS headers. Fall through to the opaque path, which
      // is the only way to store its images at all.
    }

    const response = await fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
    if (!isUsableImageResponse(response)) return "skipped";
    await cache.put(url, response);
    return "stored";
  } catch {
    return "failed";
  }
};

/**
 * Warms the product-image cache from a list the page supplies. Done here rather
 * than in the page because only the worker can store an opaque cross-origin
 * response, and because the cache the worker READS from has to be the same one
 * something WROTE to -- the previous preloader wrote to a cache no fetch
 * handler ever consulted.
 */
const warmProductImages = async (urls = []) => {
  const unique = Array.from(new Set(urls.filter((url) => typeof url === "string" && url)));
  if (!unique.length) return { requested: 0, stored: 0, hit: 0, failed: 0 };

  const cache = await caches.open(IMAGE_CACHE);
  const counts = { requested: unique.length, stored: 0, hit: 0, failed: 0, skipped: 0 };
  let cursor = 0;

  const worker = async () => {
    while (cursor < unique.length) {
      const index = cursor;
      cursor += 1;
      const outcome = await warmOneImage(cache, unique[index]);
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
  };

  await Promise.all(Array.from({ length: Math.min(IMAGE_WARM_CONCURRENCY, unique.length) }, worker));
  await trimImageCache();
  log("POS_SW_IMAGES_WARMED", counts);
  return counts;
};

const cacheShellUrl = async (cache, requestUrl) => {
  try {
    const response = await fetch(requestUrl, { cache: "no-store" });
    if (!isUsableAssetResponse(requestUrl, response)) return;
    await cache.put(requestUrl, response.clone());
  } catch {
    // Shell caching is best-effort.
  }
};

self.addEventListener("install", (event) => {
  log("POS_SW_INSTALL", { version: VERSION });
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(SHELL_URLS.map((url) => cacheShellUrl(cache, url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  log("POS_SW_ACTIVATE", { version: VERSION });
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key.startsWith("pos-shell-") && key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Product images are handled BEFORE the same-origin gate, because they are
  // the one thing the till needs that does not live on this origin. Cache-first
  // and network-populating: the first online render warms the cache as a side
  // effect, so a device that has browsed the catalogue once can render it with
  // no connection at all.
  if (isProductImageRequest(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;
        try {
          const response = await fetch(request);
          // An <img> request is issued in no-cors mode by the browser, so this
          // response is usually opaque and its status cannot be read. It is
          // cached anyway: browsing the catalogue online is what fills the cache
          // for the products nobody thought to warm. The cost is that a missing
          // file gets stored as a broken image -- but that product renders
          // broken online too, so this persists an existing data problem rather
          // than creating an offline-only one. The warm path takes the stricter
          // route because it can afford to.
          if (isUsableImageResponse(response)) {
            const copy = response.clone();
            event.waitUntil(
              cache.put(request, copy).then(trimImageCache).catch(() => null)
            );
          }
          return response;
        } catch (error) {
          // Offline and never seen. Nothing useful to return, so let the page's
          // own broken-image fallback do its job rather than inventing a body.
          log("POS_SW_IMAGE_UNAVAILABLE", { url: request.url });
          throw error;
        }
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/api") ||
    url.pathname.includes("/orders") ||
    url.pathname.includes("/checkout") ||
    url.pathname.includes("/payments") ||
    url.pathname.includes("/auth") ||
    url.pathname.includes("/stock")
  ) {
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/pos")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/pos", copy)).catch(() => null);
          return response;
        })
        .catch(async () => {
          log("POS_SW_NAVIGATE_FALLBACK", { pathname: url.pathname });
          return (await caches.match("/pos")) || Response.error();
        })
    );
    return;
  }

  if (!isSafeShellAsset(url)) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      // Self-heal: a cache entry left behind by an older worker generation can
      // be the SPA shell stored under a script URL. Treat it as a miss and drop
      // it rather than serving HTML to a module loader.
      if (cached && isUsableAssetResponse(request.url, cached)) return cached;
      if (cached) {
        log("POS_SW_EVICT_POISONED", { url: request.url });
        const runtime = await caches.open(RUNTIME_CACHE).catch(() => null);
        await runtime?.delete(request).catch(() => null);
        const shell = await caches.open(SHELL_CACHE).catch(() => null);
        await shell?.delete(request).catch(() => null);
      }

      const response = await fetch(request, { cache: "no-store" });

      // Only immutable, correctly-typed asset responses are worth keeping. A
      // 404 (the fixed origin contract for a purged chunk) and an HTML fallback
      // (the old contract) are both refused, so neither can poison the cache.
      if (isUsableAssetResponse(request.url, response)) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
        return response;
      }

      log("POS_SW_ASSET_NOT_CACHEABLE", { url: request.url, status: response.status });

      // Defence in depth, independent of hosting. If the origin still answers a
      // script request with an HTML document -- a stale CDN entry, a preview
      // host, a misconfigured rewrite -- do not hand that to the module loader.
      // A clean 404 raises a ChunkLoadError, which the application already knows
      // how to recover from; an HTML body raises an unrecoverable MIME error.
      if (SCRIPT_LIKE.test(url.pathname) && isHtmlResponse(response)) {
        return new Response("", { status: 404, statusText: "Stale asset" });
      }
      return response;
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "POS_SW_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (event.data?.type === "POS_WARM_IMAGES") {
    const port = event.ports?.[0] || null;
    event.waitUntil(
      warmProductImages(Array.isArray(event.data.urls) ? event.data.urls : [])
        .then((counts) => port?.postMessage({ type: "POS_WARM_IMAGES_DONE", counts }))
        .catch((error) => port?.postMessage({ type: "POS_WARM_IMAGES_FAILED", message: String(error?.message || error) }))
    );
    return;
  }

  if (event.data?.type === "POS_IMAGE_CACHE_STATUS") {
    const port = event.ports?.[0] || null;
    event.waitUntil(
      caches
        .open(IMAGE_CACHE)
        .then((cache) => cache.keys())
        .then((keys) => port?.postMessage({ type: "POS_IMAGE_CACHE_STATUS", cached: keys.length, cap: IMAGE_CACHE_MAX_ENTRIES }))
        .catch(() => port?.postMessage({ type: "POS_IMAGE_CACHE_STATUS", cached: 0, cap: IMAGE_CACHE_MAX_ENTRIES }))
    );
  }
});
