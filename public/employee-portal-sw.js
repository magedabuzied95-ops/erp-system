const CACHE_NAME = "employee-portal-shell-v3";
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/employee-portal-192.png",
  "/icons/employee-portal-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/") || caches.match("/index.html"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") && /\.(js|mjs)$/i.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg" || url.pathname === "/apple-touch-icon.png") {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "تنبيه جديد", body: event.data?.text() || "" };
  }

  const title = payload.title || "تنبيه جديد";
  let options = {
    body: payload.body || "لديك تحديث جديد في بوابة الموظف.",
    icon: payload.icon || "/icons/employee-portal-192.png",
    badge: payload.badge || "/icons/employee-portal-192.png",
    tag: payload.data?.tag || payload.tag || "employee-portal",
    renotify: payload.renotify !== false,
    data: payload.data || {},
  };
  if ((payload.data?.tag || payload.tag) === "employee-chat") {
    options = {
      body: payload.body || "لديك رسالة جديدة في تطبيق الموظف",
      tag: "employee-chat",
      data: { url: payload.url || payload.data?.url || "/employee-app/?tab=chat", tag: "employee-chat" },
    };
  }

  const badgeTag = payload.data?.tag || payload.tag || "employee-portal";
  const updateBadge = () => {
    const badgeCount = Number(payload.badgeCount || payload.badge_count || 1);
    if (self.navigator?.setAppBadge) {
      return self.navigator.setAppBadge(Number.isFinite(badgeCount) && badgeCount > 0 ? badgeCount : 1).catch(() => null);
    }
    return Promise.resolve();
  };
  const broadcastBadge = () =>
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: "employee-portal:push-badge",
          tag: badgeTag,
          payload,
        });
      });
    });

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    updateBadge(),
    broadcastBadge(),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || (data.token ? `/employee-app/${encodeURIComponent(data.token)}${data.tab ? `?tab=${encodeURIComponent(data.tab)}` : ""}` : "/employee-app/");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.includes("/employee-app/") || client.url.includes("/employee-portal/") || client.url.includes("/employee/portal/"));
      if (existing) {
        existing.navigate?.(url);
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
