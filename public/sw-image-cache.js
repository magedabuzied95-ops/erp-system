/* eslint-env serviceworker */
/**
 * Shared offline image cache for every PWA service worker in this app.
 *
 * The bug this exists to prevent, which was present identically in all three
 * workers: photos are served from the API origin, and each worker's fetch
 * handler began with
 *
 *     if (url.origin !== self.location.origin) return;
 *
 * so no photo was ever cached and none was ever served. Offline, the POS was a
 * grid of broken products, the inbox showed no customer media, and the portals
 * showed no avatars.
 *
 * Loaded with `importScripts("/sw-image-cache.js")`. If that fetch fails the
 * worker fails to install, which leaves the PREVIOUS worker active -- the safe
 * outcome, since the app keeps working with the older behaviour rather than
 * installing a worker whose helpers are undefined.
 *
 * Kept as one file on purpose: three copies of the opaque-response rules are
 * how the original bug survived this long.
 */

self.createSwImageCache = ({
  cacheName,
  maxEntries = 2000,
  warmConcurrency = 6,
  log = () => {},
} = {}) => {
  if (!cacheName) throw new Error("createSwImageCache requires a cacheName");

  const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?|$)/i;

  const isHtmlResponse = (response) =>
    String(response?.headers?.get("content-type") || "").toLowerCase().includes("text/html");

  /**
   * Cloudinary and friends serve images from extensionless, transform-laden
   * paths, so the file extension alone is not enough. `request.destination` is
   * the browser's own answer to "what is this for" and is authoritative.
   *
   * Deliberately NOT sniffing the Accept header: Chrome sends
   * `text/html,...,image/avif,image/webp,...` for a NAVIGATION, so an
   * `accept.includes("image/")` test captures the app's own page and routes it
   * into the image cache -- costing the shell its offline fallback, which is
   * the opposite of the point.
   */
  const isImageRequest = (request, url) => {
    if (request.method !== "GET") return false;
    if (request.mode === "navigate") return false;
    if (url.pathname.startsWith("/api/")) return false;
    const destination = String(request.destination || "");
    if (destination === "image") return true;
    // A destination the runtime does not report (older engines, test harnesses)
    // falls back to the path, which is safe because a document URL carries no
    // image extension.
    if (destination) return false;
    return IMAGE_EXTENSION.test(url.pathname);
  };

  /**
   * An opaque response (status 0, from a no-cors fetch) is what a cross-origin
   * image without CORS headers produces. It cannot be inspected, but it CAN be
   * stored with `cache.put` and rendered by an `<img>` -- which is why every
   * write here uses `cache.put` and never `cache.add`, whose internal
   * `response.ok` check rejects opaque responses outright and silently.
   */
  const isUsableImageResponse = (response) => {
    if (!response) return false;
    if (response.type === "opaque") return true;
    if (!response.ok) return false;
    return !isHtmlResponse(response);
  };

  // Oldest-first: Cache Storage preserves insertion order in `keys()`, so the
  // cap costs the least-recently-warmed photos rather than failing new writes
  // once the device's storage quota is reached.
  const trim = async () => {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const excess = keys.length - maxEntries;
      if (excess <= 0) return 0;
      await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
      log("SW_IMAGE_CACHE_TRIMMED", { cacheName, removed: excess });
      return excess;
    } catch {
      return 0;
    }
  };

  const warmOne = async (cache, url) => {
    try {
      if (await cache.match(url)) return "hit";

      // CORS first, deliberately. An opaque response hides its status, so a 404
      // for a photo that was never uploaded would be stored as a permanent
      // broken image -- the same failure shape as a CDN caching a 404 as
      // immutable. The API origin does send CORS headers, so the common case
      // gets a readable status and a real check.
      try {
        const corsResponse = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
        if (corsResponse && corsResponse.ok && !isHtmlResponse(corsResponse)) {
          await cache.put(url, corsResponse);
          return "stored";
        }
        if (corsResponse && !corsResponse.ok) return "skipped";
      } catch {
        // The host sends no CORS headers. Fall through to the opaque path,
        // which is the only way to store its images at all.
      }

      const response = await fetch(url, { mode: "no-cors", credentials: "omit", cache: "no-store" });
      if (!isUsableImageResponse(response)) return "skipped";
      await cache.put(url, response);
      return "stored";
    } catch {
      return "failed";
    }
  };

  /** Warms the cache from a list the page supplies, with bounded concurrency. */
  const warm = async (urls = []) => {
    const unique = Array.from(new Set((urls || []).filter((url) => typeof url === "string" && url)));
    if (!unique.length) return { requested: 0, stored: 0, hit: 0, failed: 0, skipped: 0 };

    const cache = await caches.open(cacheName);
    const counts = { requested: unique.length, stored: 0, hit: 0, failed: 0, skipped: 0 };
    let cursor = 0;

    const worker = async () => {
      while (cursor < unique.length) {
        const index = cursor;
        cursor += 1;
        const outcome = await warmOne(cache, unique[index]);
        counts[outcome] = (counts[outcome] || 0) + 1;
      }
    };

    await Promise.all(Array.from({ length: Math.min(warmConcurrency, unique.length) }, worker));
    await trim();
    log("SW_IMAGES_WARMED", { cacheName, ...counts });
    return counts;
  };

  /**
   * Cache-first, network-populating. Browsing the catalogue online is what
   * fills the cache for everything nobody thought to warm.
   */
  const handleFetch = (event, request) =>
    (async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        // Usually opaque, because the browser issues an <img> request in
        // no-cors mode. Cached anyway: the cost is that a missing file gets
        // stored as a broken image, but that image renders broken online too,
        // so this persists an existing data problem rather than creating an
        // offline-only one. The warm path takes the stricter route because it
        // can afford to.
        if (isUsableImageResponse(response)) {
          const copy = response.clone();
          event.waitUntil(cache.put(request, copy).then(trim).catch(() => null));
        }
        return response;
      } catch (error) {
        // Offline and never seen. Nothing useful to return, so let the page's
        // own broken-image fallback do its job rather than inventing a body.
        log("SW_IMAGE_UNAVAILABLE", { cacheName, url: request.url });
        throw error;
      }
    })();

  const status = async () => {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      return { cached: keys.length, cap: maxEntries };
    } catch {
      return { cached: 0, cap: maxEntries };
    }
  };

  return { cacheName, isImageRequest, isUsableImageResponse, handleFetch, warm, trim, status };
};
