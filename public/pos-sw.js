const VERSION = "pos-shell-v6";
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

const cacheShellUrl = async (cache, requestUrl) => {
  try {
    const response = await fetch(requestUrl, { cache: "no-store" });
    if (!response?.ok) return;
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
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request, { cache: "no-store" }).then((response) => {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
        return response;
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "POS_SW_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});
