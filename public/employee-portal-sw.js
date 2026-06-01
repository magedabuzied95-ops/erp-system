const CACHE_NAME = "employee-portal-shell-v3";
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/employee-portal-192.png",
  "/icons/employee-portal-512.png",
];
const BADGE_DB_NAME = "employee-portal-badges";
const BADGE_STORE_NAME = "badge-state";
const BADGE_STATE_KEY = "counts";
const EMPTY_BADGE_STATE = { unreadChats: 0, pendingNotifications: 0, newTasks: 0 };
let lastBadgeClearAt = 0;

const badgeTotal = (state = EMPTY_BADGE_STATE) =>
  Math.max(0, Number(state.unreadChats || 0) + Number(state.pendingNotifications || 0) + Number(state.newTasks || 0));

const openBadgeDb = () =>
  new Promise((resolve, reject) => {
    if (!self.indexedDB) {
      resolve(null);
      return;
    }
    const request = self.indexedDB.open(BADGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(BADGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readBadgeState = async () => {
  const db = await openBadgeDb().catch(() => null);
  if (!db) return { ...EMPTY_BADGE_STATE };
  return new Promise((resolve) => {
    const transaction = db.transaction(BADGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(BADGE_STORE_NAME).get(BADGE_STATE_KEY);
    request.onsuccess = () => resolve({ ...EMPTY_BADGE_STATE, ...(request.result || {}) });
    request.onerror = () => resolve({ ...EMPTY_BADGE_STATE });
  });
};

const writeBadgeState = async (state = EMPTY_BADGE_STATE) => {
  const db = await openBadgeDb().catch(() => null);
  if (!db) return state;
  return new Promise((resolve) => {
    const nextState = {
      unreadChats: Math.max(0, Number(state.unreadChats || 0)),
      pendingNotifications: Math.max(0, Number(state.pendingNotifications || 0)),
      newTasks: Math.max(0, Number(state.newTasks || 0)),
    };
    const transaction = db.transaction(BADGE_STORE_NAME, "readwrite");
    transaction.objectStore(BADGE_STORE_NAME).put(nextState, BADGE_STATE_KEY);
    transaction.oncomplete = () => resolve(nextState);
    transaction.onerror = () => resolve(nextState);
  });
};

const applyAppBadge = async (state = EMPTY_BADGE_STATE) => {
  const count = badgeTotal(state);
  console.info("[employee-badge:update-total]", { total: count, ...state });
  const target = self.registration || self.navigator || {};
  if (count > 0 && typeof target.setAppBadge === "function") return target.setAppBadge(count).catch(() => null);
  if (count === 0 && typeof target.clearAppBadge === "function") return target.clearAppBadge().catch(() => null);
  if (count > 0 && self.navigator?.setAppBadge) return self.navigator.setAppBadge(count).catch(() => null);
  if (count === 0 && self.navigator?.clearAppBadge) return self.navigator.clearAppBadge().catch(() => null);
  return null;
};

const badgeFieldForTag = (tag = "") => {
  const safeTag = String(tag || "");
  if (safeTag === "employee-chat") return "unreadChats";
  if (["task-assigned", "staff-task-update", "staff-task-overdue"].some((value) => safeTag.includes(value))) return "newTasks";
  if (["advance-approved", "advance-rejected", "leave-approved", "leave-rejected"].includes(safeTag)) return "pendingNotifications";
  return "";
};

const incrementBadgeForTag = async (tag = "") => {
  const field = badgeFieldForTag(tag);
  if (!field) return applyAppBadge(await readBadgeState());
  const current = await readBadgeState();
  const next = await writeBadgeState({ ...current, [field]: Number(current[field] || 0) + 1 });
  return applyAppBadge(next);
};

const clearBadgeScope = async (scope = "") => {
  const field = scope === "chat" ? "unreadChats" : scope === "requests" ? "pendingNotifications" : scope === "tasks" ? "newTasks" : "";
  if (!field) return;
  lastBadgeClearAt = Date.now();
  console.info("[employee-badge:clear-portion]", { portion: scope, field });
  const current = await readBadgeState();
  const next = await writeBadgeState({ ...current, [field]: 0 });
  await applyAppBadge(next);
};

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
    incrementBadgeForTag(badgeTag),
    broadcastBadge(),
  ]));
});

self.addEventListener("message", (event) => {
  const type = event.data?.type || "";
  if (type === "employee-portal:badge-sync") {
    const sentAt = Number(event.data.at || 0);
    if (sentAt && sentAt < lastBadgeClearAt) return;
    event.waitUntil(writeBadgeState(event.data.counts || EMPTY_BADGE_STATE).then(applyAppBadge));
  }
  if (type === "employee-portal:badge-clear" || type === "EMPLOYEE_BADGE_CLEAR_PORTION") {
    event.waitUntil(clearBadgeScope(event.data.scope || event.data.portion || ""));
  }
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
