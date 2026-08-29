// AI Inbox push worker.
//
// Registered at root scope by BOTH inbox surfaces (`/admin/ai-inbox` and the
// `/inbox` PWA) so a browser holds exactly ONE push subscription and a customer
// message never arrives as two notifications on the same device.
//
// This worker deliberately has NO `fetch` handler. `inbox-sw.js` is cache-first
// for `/assets/`, which at root scope would pin a stale app bundle across the
// WHOLE ERP — the exact failure that once stranded the inbox on months-old code.
// A notification-only worker cannot cache anything, so it cannot cause that.

const VERSION = "ai-inbox-push-v1";
const INBOX_URL_MARKERS = ["/inbox", "/admin/ai-inbox"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const readPayload = (event) => {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    try {
      return { body: event.data.text() || "" };
    } catch {
      return {};
    }
  }
};

const isInboxClient = (client) => {
  const url = String(client?.url || "");
  return INBOX_URL_MARKERS.some((marker) => url.includes(marker));
};

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const data = payload.data || {};
  const title = payload.title || "رسالة جديدة";
  const body = payload.body || "وصلتك رسالة جديدة في الإنبوكس";
  const tag = data.tag || payload.tag || "ai-inbox";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Tell every open inbox tab, so it can chime and bump its unread badge even
      // when the OS notification is suppressed below.
      clients.filter(isInboxClient).forEach((client) => {
        client.postMessage({ type: "ai-inbox:push", payload: { ...payload, data } });
      });

      // The operator is already looking at the inbox: the page's own sound and
      // toast cover it, and an OS banner on top would be double-alerting.
      const focusedInbox = clients.find(
        (client) => isInboxClient(client) && client.focused === true && client.visibilityState === "visible"
      );
      if (focusedInbox) return undefined;

      return self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        silent: false,
        vibrate: [180, 90, 180],
        icon: payload.icon || "/icons/employee-portal-192.png",
        badge: payload.badge || "/icons/employee-portal-192.png",
        data: { ...data, url: data.url || payload.url || "/inbox", tag },
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/inbox";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(isInboxClient);
      if (existing) {
        // Navigate first, then focus: focusing a tab still showing another
        // conversation would land the operator on the wrong thread.
        const navigated = existing.navigate ? existing.navigate(url).catch(() => existing) : Promise.resolve(existing);
        return navigated.then((client) => (client || existing).focus());
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ai-inbox:push-sw-ping") {
    event.source?.postMessage({ type: "ai-inbox:push-sw-pong", version: VERSION });
  }
});
