import { api } from "../../../shared/api/api";

// Sound + web push for inbound AI Inbox messages.
//
// This module is shared by BOTH inbox surfaces on purpose. `/admin/ai-inbox` and
// `/inbox` are two separate implementations of one product, and anything written
// once per page drifts — a fix lands on one and silently does not exist on the
// other. Notification behaviour lives here so both call the same code.

const PREFS_KEY = "m1:ai-inbox:notification-prefs";
const PUSH_SW_URL = "/ai-inbox-push-sw.js?v=1";
const PUSH_SW_SCOPE = "/";

const DEFAULT_PREFS = { sound: true, push: true, volume: 0.5 };

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

export const readInboxNotificationPrefs = () => {
  if (!isBrowser()) return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return {
      sound: parsed?.sound !== false,
      push: parsed?.push !== false,
      volume: Number.isFinite(Number(parsed?.volume)) ? Math.min(1, Math.max(0, Number(parsed.volume))) : DEFAULT_PREFS.volume,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const writeInboxNotificationPrefs = (patch = {}) => {
  const next = { ...readInboxNotificationPrefs(), ...patch };
  if (isBrowser()) {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage can be unavailable (private mode, blocked site data) — prefs just don't persist */
    }
  }
  return next;
};

/* ------------------------------------------------------------------ sound */

let audioContext = null;
let audioPrimed = false;

const getAudioContext = () => {
  if (!isBrowser()) return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return audioContext;
};

// Browsers start an AudioContext suspended until the page has seen a real user
// gesture. Without this the very first message of a session would arrive silent.
export const primeInboxChime = () => {
  if (!isBrowser() || audioPrimed) return;
  const context = getAudioContext();
  if (!context) return;
  const resume = () => {
    context.resume?.().catch(() => null);
    audioPrimed = true;
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    window.removeEventListener("touchstart", resume);
  };
  if (context.state === "running") {
    audioPrimed = true;
    return;
  }
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });
  window.addEventListener("touchstart", resume, { once: true });
};

// Synthesised rather than an audio file: no asset to 404, nothing for a CDN to
// cache wrong, and it works offline in the installed PWA.
export const playInboxChime = ({ volume } = {}) => {
  const prefs = readInboxNotificationPrefs();
  if (!prefs.sound) return false;
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") context.resume?.().catch(() => null);

  const level = Math.min(1, Math.max(0, Number.isFinite(Number(volume)) ? Number(volume) : prefs.volume));
  if (level <= 0) return false;

  try {
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.value = level;
    master.connect(context.destination);

    // Two-note rising chime (C6 → E6): short, clearly "a message landed",
    // and quiet enough to sit under a phone call.
    [
      { frequency: 1046.5, at: 0, duration: 0.18 },
      { frequency: 1318.5, at: 0.12, duration: 0.26 },
    ].forEach(({ frequency, at, duration }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + at);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.9, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now + at);
      oscillator.stop(now + at + duration + 0.02);
    });
    return true;
  } catch {
    return false;
  }
};

/* ----------------------------------------------------------------- push */

export const inboxPushSupported = () =>
  isBrowser() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const inboxNotificationPermission = () =>
  isBrowser() && "Notification" in window ? window.Notification.permission : "unsupported";

const urlBase64ToUint8Array = (base64String = "") => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
};

const registerPushWorker = async () => {
  if (!inboxPushSupported()) return null;
  // Register returns the registration for THIS script/scope directly. Using
  // `navigator.serviceWorker.ready` instead would resolve to whichever worker
  // controls the page — on `/inbox` that is the caching `inbox-sw.js`, and the
  // subscription would land on the wrong registration.
  return navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE }).catch((error) => {
    console.warn("[ai-inbox-push] worker registration failed", error?.message || error);
    return null;
  });
};

export const enableInboxPush = async ({ surface = "/inbox" } = {}) => {
  if (!inboxPushSupported()) return { ok: false, reason: "unsupported" };

  const permission =
    window.Notification.permission === "granted"
      ? "granted"
      : await window.Notification.requestPermission().catch(() => "denied");
  if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };

  const keyResponse = await api.get("/ai-inbox/push/public-key").catch(() => null);
  const publicKey = keyResponse?.publicKey || "";
  if (!publicKey) return { ok: false, reason: "vapid-missing" };

  const registration = await registerPushWorker();
  if (!registration) return { ok: false, reason: "sw-failed" };

  let subscription = await registration.pushManager.getSubscription().catch(() => null);
  if (subscription) {
    // A subscription minted against a previous VAPID key is dead on arrival:
    // the push service accepts it and every send returns 403.
    const existingKey = subscription.options?.applicationServerKey;
    const expectedKey = urlBase64ToUint8Array(publicKey);
    const sameKey =
      existingKey && new Uint8Array(existingKey).length === expectedKey.length &&
      new Uint8Array(existingKey).every((byte, index) => byte === expectedKey[index]);
    if (!sameKey) {
      await subscription.unsubscribe().catch(() => null);
      subscription = null;
    }
  }
  if (!subscription) {
    subscription = await registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      .catch((error) => {
        console.warn("[ai-inbox-push] subscribe failed", error?.message || error);
        return null;
      });
  }
  if (!subscription) return { ok: false, reason: "subscribe-failed" };

  const saved = await api
    .post("/ai-inbox/push/subscribe", { subscription: subscription.toJSON(), surface })
    .catch((error) => {
      console.warn("[ai-inbox-push] save failed", error?.message || error);
      return null;
    });
  if (!saved?.success) return { ok: false, reason: "save-failed" };

  writeInboxNotificationPrefs({ push: true });
  return { ok: true, endpoint: subscription.endpoint };
};

export const disableInboxPush = async () => {
  writeInboxNotificationPrefs({ push: false });
  if (!inboxPushSupported()) return { ok: true };
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE).catch(() => null);
  const subscription = await registration?.pushManager?.getSubscription?.().catch(() => null);
  if (subscription) {
    await api.post("/ai-inbox/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => null);
    await subscription.unsubscribe().catch(() => null);
  }
  return { ok: true };
};

export const sendInboxPushTest = () =>
  api.post("/ai-inbox/push/test", {}).catch((error) => {
    console.warn("[ai-inbox-push] test failed", error?.message || error);
    return null;
  });

// Re-subscribing on load keeps the stored endpoint fresh. Push services rotate
// endpoints, and a rotated one fails silently — the operator would just stop
// getting notifications with nothing on screen to say so.
export const refreshInboxPushSubscription = async ({ surface = "/inbox" } = {}) => {
  if (!inboxPushSupported()) return { ok: false, reason: "unsupported" };
  if (!readInboxNotificationPrefs().push) return { ok: false, reason: "disabled" };
  if (window.Notification.permission !== "granted") return { ok: false, reason: "not-granted" };
  return enableInboxPush({ surface });
};

/* ------------------------------------------------------- in-page delivery */

const recentlyNotified = new Map();
const RECENT_TTL_MS = 60 * 1000;

const seenRecently = (key = "") => {
  if (!key) return false;
  const now = Date.now();
  for (const [existing, expiry] of recentlyNotified) {
    if (expiry <= now) recentlyNotified.delete(existing);
  }
  if (recentlyNotified.has(key)) return true;
  recentlyNotified.set(key, now + RECENT_TTL_MS);
  return false;
};

const text = (value = "") => String(value ?? "").trim();

export const isInboundCustomerMessage = (message = {}) => {
  if (!message || typeof message !== "object") return false;
  const senderType = text(message.sender_type).toLowerCase();
  if (senderType === "staff" || senderType === "ai" || senderType === "agent" || senderType === "system") return false;
  if (message.is_echo === true || message.echo === true) return false;
  if (senderType === "customer") return true;
  return Boolean(text(message.customer_message));
};

export const inboxMessagePreview = (message = {}) => {
  const body = text(message.customer_message || message.message_text || message.body);
  if (body) return body.slice(0, 140);
  const type = text(message.message_type || message.attachment_type).toLowerCase();
  if (type.includes("image")) return "📷 صورة";
  if (type.includes("voice") || type.includes("audio")) return "🎤 رسالة صوتية";
  if (type.includes("video")) return "🎬 فيديو";
  if (type === "product_card") return "🛍️ كارت منتج";
  if (type) return "📎 مرفق";
  return "رسالة جديدة";
};

const hasActivePushSubscription = async () => {
  if (!inboxPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
    const subscription = await registration?.pushManager?.getSubscription?.();
    return Boolean(subscription);
  } catch {
    return false;
  }
};

/**
 * Called by both surfaces when a realtime `ai_inbox:message` lands.
 *
 * Sound always plays. The OS notification is left to the push worker whenever a
 * subscription exists — it fires for the same message, and showing one here too
 * would notify the operator twice for one customer. The in-page Notification is
 * only the fallback for when push is off or unsupported.
 */
export const handleInboundInboxMessage = async ({ message = {}, conversationId = "", channel = "", surface = "/inbox" } = {}) => {
  if (!isInboundCustomerMessage(message)) return { notified: false, reason: "not-inbound" };
  const identity = text(message.id || message.dedupe_key || message.external_message_id || message.provider_message_id);
  if (!identity) return { notified: false, reason: "no-identity" };
  if (seenRecently(`${conversationId}|${identity}`)) return { notified: false, reason: "duplicate" };

  playInboxChime();

  const prefs = readInboxNotificationPrefs();
  if (!prefs.push) return { notified: true, reason: "sound-only" };
  if (inboxNotificationPermission() !== "granted") return { notified: true, reason: "sound-only" };
  if (!document.hidden) return { notified: true, reason: "page-visible" };
  if (await hasActivePushSubscription()) return { notified: true, reason: "push-owns-notification" };

  try {
    const customerName = text(message.customer_name || message.sender_name) || "عميل";
    const notification = new window.Notification(customerName, {
      body: inboxMessagePreview(message),
      tag: `ai-inbox-${conversationId || identity}`,
      icon: "/icons/employee-portal-192.png",
      badge: "/icons/employee-portal-192.png",
      data: { conversationId, channel },
    });
    notification.onclick = () => {
      window.focus();
      const target =
        surface === "/admin/ai-inbox"
          ? `/admin/ai-inbox${conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : ""}`
          : `/inbox${conversationId ? `/${encodeURIComponent(conversationId)}` : ""}`;
      if (window.location.pathname + window.location.search !== target) window.location.assign(target);
      notification.close();
    };
    return { notified: true, reason: "local-notification" };
  } catch {
    return { notified: true, reason: "sound-only" };
  }
};

/**
 * Bridges the push worker back into the page: when a push lands while an inbox
 * tab is open, the worker posts here so the tab chimes even if the OS banner was
 * suppressed for being focused.
 */
export const subscribeToPushWorkerMessages = (handler) => {
  if (!isBrowser() || !("serviceWorker" in navigator)) return () => {};
  const listener = (event) => {
    if (event.data?.type !== "ai-inbox:push") return;
    playInboxChime();
    if (typeof handler === "function") handler(event.data.payload || {});
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
};
