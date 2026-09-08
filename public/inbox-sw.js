// Shared with the POS and employee-portal workers. A failed import fails the
// install, which leaves the previous worker active -- the safe outcome.
importScripts("/sw-image-cache.js");

const VERSION = "ai-inbox-v17";
// Customer photos, message attachments and product cards all come from the API
// origin, and the fetch handler below returns early for every cross-origin
// request -- so an inbox with no connection showed no media at all. Versioned on
// its own, and deliberately NOT under the "ai-inbox-" prefix that activate()
// deletes -- a name inside that prefix would throw the media away on every
// single version bump.
const MEDIA_CACHE = "inbox-media-v1";
const inboxMedia = self.createSwImageCache({ cacheName: MEDIA_CACHE, maxEntries: 1500 });
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const SHELL_URLS = [
  "/inbox",
  "/inbox-manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/employee-portal-192.png",
  "/icons/employee-portal-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.startsWith("ai-inbox-") && key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Media is handled BEFORE the same-origin gate: customer photos, message
  // attachments and product cards are the one thing the inbox needs that does
  // not live on this origin, and the gate below is what used to drop them all.
  if (inboxMedia.isImageRequest(request, url)) {
    event.respondWith(inboxMedia.handleFetch(event, request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname.startsWith("/inbox")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache a healthy shell. Caching a 5xx/opaque error response would
          // pin a broken app shell (referencing missing bundles) and strand users
          // on a permanent loading state until the cache is manually cleared.
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put("/inbox", clone)).catch(() => null);
          }
          return response;
        })
        .catch(() => caches.match("/inbox"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/inbox-manifest.webmanifest") {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => null);
          }
          return response;
        });
      })
    );
  }
});
