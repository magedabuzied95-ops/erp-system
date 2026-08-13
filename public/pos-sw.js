// v11 is a deliberate eviction, not a cosmetic bump. `activate` deletes every
// `pos-shell-*` cache that is not the current pair, so shipping a new version is
// what heals clients whose v10 runtime cache already holds an HTML SPA-fallback
// response stored under a `.js` key. Asset reads are cache-first, so those
// entries were otherwise permanent for that browser profile.
const VERSION = "pos-shell-v11";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
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
  }
});
