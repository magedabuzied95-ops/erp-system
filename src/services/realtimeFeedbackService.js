import toast from "react-hot-toast";

import { getRealtimePriorityBehavior, normalizeRealtimePriority, priorityRank } from "../config/realtimePriorityConfig";
import { DEFAULT_REALTIME_SOUND_THEME, getRealtimeSoundTheme } from "../config/realtimeSoundThemes";

const STORAGE_KEY = "erp.realtimeFeedback.settings";
const SETTINGS_EVENT = "erp:realtime-feedback-settings";
const FEEDBACK_EVENT = "erp:realtime-feedback-event";
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart", "click"];

const DEFAULT_SOUND_FILES = {
  orderNew: "/sounds/order-new.mp3",
  paymentSuccess: "/sounds/payment-success.mp3",
  notification: "/sounds/notification.mp3",
  warning: "/sounds/warning.mp3",
  attendance: "/sounds/attendance.mp3",
  aiMessage: "/sounds/ai-message.mp3",
  error: "/sounds/error.mp3",
  barcodeScan: "/sounds/barcode-scan.mp3",
};

const EVENT_MAP = {
  new_order: { sound: "orderNew", priority: "high", toastType: "success", title: "New order" },
  website_order_created: { sound: "orderNew", priority: "high", toastType: "success", title: "New order" },
  order_created: { sound: "orderNew", priority: "high", toastType: "success", title: "New order" },
  payment_success: { sound: "paymentSuccess", priority: "high", toastType: "success", title: "Payment received" },
  payment_confirmed: { sound: "paymentSuccess", priority: "high", toastType: "success", title: "Payment confirmed" },
  payment_proof_uploaded: { sound: "notification", priority: "normal", toastType: "default", title: "Payment proof uploaded" },
  pos_barcode_scan: { sound: "barcodeScan", priority: "normal", toastType: "silent", title: "Barcode scanned" },
  pos_product_not_found: { sound: "error", priority: "high", toastType: "error", title: "Product not found" },
  pos_error: { sound: "error", priority: "high", toastType: "error", title: "POS error" },
  low_stock: { sound: "warning", priority: "high", toastType: "default", title: "Low stock" },
  attendance: { sound: "attendance", priority: "normal", toastType: "success", title: "Attendance updated" },
  attendance_check_in: { sound: "attendance", priority: "normal", toastType: "success", title: "Attendance check-in" },
  attendance_check_out: { sound: "attendance", priority: "normal", toastType: "success", title: "Attendance check-out" },
  ai_message: { sound: "aiMessage", priority: "normal", toastType: "default", title: "AI message" },
  ai_recommendation: { sound: "aiMessage", priority: "normal", toastType: "default", title: "AI recommendation" },
  ai_exact_product_found: { sound: "paymentSuccess", priority: "high", toastType: "success", title: "Exact product found" },
  ai_no_results: { sound: "error", priority: "normal", toastType: "default", title: "No AI results" },
  ai_escalation: { sound: "warning", priority: "high", toastType: "default", title: "AI handoff" },
  ai_customer_message: { sound: "aiMessage", priority: "normal", toastType: "default", title: "Customer message" },
  notification: { sound: "notification", priority: "normal", toastType: "default", title: "Notification" },
  error: { sound: "error", priority: "high", toastType: "error", title: "Error" },
};

const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.65,
  criticalOnly: false,
  muteAi: false,
  posMode: false,
  silentHoursEnabled: false,
  silentHoursStart: "22:00",
  silentHoursEnd: "07:00",
  browserNotificationsEnabled: false,
  soundTheme: DEFAULT_REALTIME_SOUND_THEME,
};

const lastPlayedAt = new Map();
const lastToastAt = new Map();
const lastVibrateAt = new Map();
const lastEventAt = new Map();
const audioPools = new Map();
const duplicateActiveCount = new Map();
let hiddenBatch = [];
let hiddenBatchTimer = null;
let settingsCache = null;
let unlocked = false;
let audioContext = null;
let unlockRegistered = false;
let shortcutRegistered = false;

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

const clampVolume = (value) => Math.max(0, Math.min(1, Number(value || 0)));
const reducedMotion = () => isBrowser() && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

const parseSettings = (value) => {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

export const getRealtimeFeedbackSettings = () => {
  if (!isBrowser()) return { ...DEFAULT_SETTINGS };
  if (!settingsCache) {
    settingsCache = {
      ...DEFAULT_SETTINGS,
      ...parseSettings(window.localStorage.getItem(STORAGE_KEY)),
    };
    settingsCache.volume = clampVolume(settingsCache.volume);
    settingsCache.soundTheme = getRealtimeSoundTheme(settingsCache.soundTheme).id;
  }
  return { ...settingsCache };
};

export const saveRealtimeFeedbackSettings = (patch = {}) => {
  if (!isBrowser()) return getRealtimeFeedbackSettings();
  settingsCache = {
    ...getRealtimeFeedbackSettings(),
    ...patch,
  };
  settingsCache.volume = clampVolume(settingsCache.volume);
  settingsCache.soundTheme = getRealtimeSoundTheme(settingsCache.soundTheme).id;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsCache));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settingsCache }));
  return { ...settingsCache };
};

export const subscribeRealtimeFeedbackSettings = (listener) => {
  if (!isBrowser() || typeof listener !== "function") return () => {};
  const handler = (event) => {
    if (event?.type === "storage" && event.key === STORAGE_KEY) settingsCache = null;
    listener(event.detail || getRealtimeFeedbackSettings());
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
};

const debug = (...args) => {
  if (import.meta.env.DEV) console.debug("[realtime-feedback]", ...args);
};

const currentTheme = () => getRealtimeSoundTheme(getRealtimeFeedbackSettings().soundTheme);

const soundSourceFor = (sound) => currentTheme().sounds?.[sound] || DEFAULT_SOUND_FILES[sound] || "";

const getAudioContext = () => {
  if (!isBrowser()) return null;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  return audioContext;
};

const poolSizeFor = (sound) => {
  if (sound === "barcodeScan") return 5;
  if (["paymentSuccess", "error", "orderNew"].includes(sound)) return 3;
  return 2;
};

const prewarmSoundPool = (sound) => {
  if (!isBrowser() || audioPools.has(sound)) return;
  const src = soundSourceFor(sound);
  if (!src) return;
  try {
    const pool = Array.from({ length: poolSizeFor(sound) }, () => {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.load?.();
      return audio;
    });
    audioPools.set(sound, { cursor: 0, pool });
  } catch (error) {
    debug("audio pool skipped", sound, error?.message);
  }
};

const prewarmAudioPools = () => {
  ["barcodeScan", "paymentSuccess", "error", "orderNew", "notification", "warning", "attendance", "aiMessage"].forEach(prewarmSoundPool);
};

export const unlockRealtimeFeedbackAudio = async () => {
  if (!isBrowser()) return false;
  unlocked = true;
  try {
    const context = getAudioContext();
    if (context?.state === "suspended") await context.resume();
    prewarmAudioPools();
  } catch {
    // Browsers may still block audio; playback handles that silently.
  }
  return unlocked;
};

export const initRealtimeFeedback = () => {
  if (!isBrowser() || unlockRegistered) return;
  unlockRegistered = true;
  const unlock = () => {
    unlockRealtimeFeedbackAudio();
    UNLOCK_EVENTS.forEach((eventName) => window.removeEventListener(eventName, unlock, true));
  };
  UNLOCK_EVENTS.forEach((eventName) => window.addEventListener(eventName, unlock, true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) flushHiddenBatch();
  });
  if (!shortcutRegistered) {
    shortcutRegistered = true;
    window.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || !event.shiftKey || String(event.key || "").toLowerCase() !== "m") return;
      event.preventDefault();
      const next = !getRealtimeFeedbackSettings().enabled;
      saveRealtimeFeedbackSettings({ enabled: next });
      toast(next ? "Realtime sounds enabled" : "Realtime sounds muted", { id: "realtime-feedback-mute-toggle" });
    });
  }
};

const minutesFromTime = (value) => {
  const [hours, minutes] = String(value || "").split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const inSilentHours = (settings) => {
  if (!settings.silentHoursEnabled) return false;
  const start = minutesFromTime(settings.silentHoursStart);
  const end = minutesFromTime(settings.silentHoursEnd);
  if (start === null || end === null || start === end) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
};

const isAiFeedbackEvent = (event = {}) =>
  String(event.eventName || "").toLowerCase().startsWith("ai_") ||
  String(event.payload?.type || event.payload?.event || "").toLowerCase().startsWith("ai_") ||
  String(event.payload?.category || "").toLowerCase() === "ai";

const isFeedbackSuppressedByMode = (event = {}, settings = getRealtimeFeedbackSettings(), theme = currentTheme()) => {
  if (settings.muteAi && isAiFeedbackEvent(event)) return true;
  if ((settings.criticalOnly || theme.criticalOnly) && event.priority !== "critical") return true;
  return false;
};

const recentlySeenEvent = (event = {}) => {
  const payload = event.payload || {};
  const entityId =
    payload.feedbackId ||
    payload.notification_id ||
    payload.notificationId ||
    payload.order_id ||
    payload.orderId ||
    payload.payment_id ||
    payload.paymentId ||
    payload.id ||
    event.id ||
    "";
  const fingerprint = [
    event.eventName,
    event.sound,
    entityId,
    event.title,
    event.message,
  ].map((part) => String(part || "")).join(":");
  const now = Date.now();
  if (now - Number(lastEventAt.get(fingerprint) || 0) < 900) return true;
  lastEventAt.set(fingerprint, now);
  if (lastEventAt.size > 160) {
    Array.from(lastEventAt.entries()).slice(0, 40).forEach(([key]) => lastEventAt.delete(key));
  }
  return false;
};

const shouldPlay = ({ sound, priority, key }) => {
  const settings = getRealtimeFeedbackSettings();
  const behavior = getRealtimePriorityBehavior(priority);
  const theme = currentTheme();
  if (!settings.enabled || !sound || behavior.sound === false) return false;
  if ((settings.criticalOnly || theme.criticalOnly) && priority !== "critical") return false;
  if (inSilentHours(settings) && priority !== "critical") return false;
  if (isBrowser() && document.hidden && priority !== "critical") return false;

  const now = Date.now();
  const throttleKey = `${key || sound}:${sound}`;
  const throttleMs = sound === "barcodeScan" ? 80 : behavior.throttleMs || 4500;
  if (now - Number(lastPlayedAt.get(throttleKey) || 0) < throttleMs) return false;
  lastPlayedAt.set(throttleKey, now);
  return true;
};

const playFallbackTone = async (sound, priority) => {
  if (!unlocked) return;
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume();
    const settings = getRealtimeFeedbackSettings();
    const theme = currentTheme();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = {
      orderNew: 740,
      paymentSuccess: 880,
      notification: 620,
      warning: 420,
      attendance: 700,
      aiMessage: 560,
      error: 240,
      barcodeScan: 980,
    };
    oscillator.type = sound === "error" || sound === "warning" ? "square" : "sine";
    oscillator.frequency.value = frequencies[sound] || 620;
    gain.gain.value = clampVolume(settings.volume) * (theme.volumeMultiplier ?? 1) * (settings.posMode ? 0.18 : 0.1) * (priority === "critical" ? 1.35 : 1);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (sound === "barcodeScan" ? 0.07 : 0.16));
  } catch (error) {
    debug("fallback tone blocked", error?.message);
  }
};

export const playRealtimeSound = async (sound, options = {}) => {
  const priority = normalizeRealtimePriority(options.priority || "normal");
  if (!shouldPlay({ sound, priority, key: options.key })) return false;

  const settings = getRealtimeFeedbackSettings();
  const theme = currentTheme();
  const src = soundSourceFor(sound);
  if (!src || !unlocked) {
    await playFallbackTone(sound, priority);
    return false;
  }

  try {
    const activeKey = `${sound}:${src}`;
    const activeCount = Number(duplicateActiveCount.get(activeKey) || 0);
    const maxDuplicates = sound === "barcodeScan" ? 2 : 1;
    if (activeCount >= maxDuplicates) return false;
    duplicateActiveCount.set(activeKey, activeCount + 1);

    const pool = audioPools.get(sound);
    const audio = pool?.pool?.length
      ? pool.pool[pool.cursor++ % pool.pool.length]
      : new Audio(src);
    audio.preload = "auto";
    audio.volume = clampVolume(settings.volume) * (theme.volumeMultiplier ?? 1) * (settings.posMode ? 1 : 0.72);
    audio.currentTime = 0;
    const cleanup = () => {
      duplicateActiveCount.set(activeKey, Math.max(0, Number(duplicateActiveCount.get(activeKey) || 1) - 1));
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("pause", cleanup);
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("pause", cleanup, { once: true });
    await audio.play();
    return true;
  } catch (error) {
    duplicateActiveCount.set(`${sound}:${src}`, 0);
    debug("audio file playback skipped", sound, error?.message);
    await playFallbackTone(sound, priority);
    return false;
  }
};

const toastFor = ({ toastType, title, message, id, priority }) => {
  const behavior = getRealtimePriorityBehavior(priority);
  if (toastType === "silent" || behavior.toast === false) return;
  const body = message || title || "Notification";
  const toastKey = `${title || ""}:${body}`;
  const now = Date.now();
  if (priority !== "critical" && now - Number(lastToastAt.get(toastKey) || 0) < 2500) return;
  lastToastAt.set(toastKey, now);
  const options = {
    id,
    duration: behavior.toastDuration || 3000,
    className: [
      "realtime-feedback-toast",
      `realtime-feedback-toast--${priority}`,
      `realtime-feedback-toast--${behavior.toast}`,
      currentTheme().toastIntensity ? `realtime-feedback-toast--${currentTheme().toastIntensity}` : "",
    ].filter(Boolean).join(" "),
  };
  if (toastType === "success") toast.success(body, options);
  else if (toastType === "error") toast.error(body, options);
  else toast(body, options);
};

const browserNotificationFor = ({ title, message, priority, force = false }) => {
  if (!isBrowser()) return;
  const settings = getRealtimeFeedbackSettings();
  const behavior = getRealtimePriorityBehavior(priority);
  if (!settings.browserNotificationsEnabled || (!force && !behavior.browserNotification)) return;
  if (!("Notification" in window) || window.Notification.permission !== "granted") return;
  try {
    new window.Notification(title || "ERP notification", { body: message || "" });
  } catch {
    // Optional browser notification can fail silently.
  }
};

const vibrateFor = (priority) => {
  const behavior = getRealtimePriorityBehavior(priority);
  const theme = currentTheme();
  const now = Date.now();
  if (!isBrowser() || !navigator?.vibrate || !behavior.vibrate || theme.vibration === "off") return;
  if (now - Number(lastVibrateAt.get(priority) || 0) < 1200) return;
  lastVibrateAt.set(priority, now);
  try {
    navigator.vibrate(priority === "critical" ? [90, 45, 90] : 45);
  } catch {
    // Optional mobile feedback can fail silently.
  }
};

export const requestBrowserNotificationPermission = async () => {
  if (!isBrowser() || !("Notification" in window)) return "unsupported";
  if (window.Notification.permission === "granted") {
    saveRealtimeFeedbackSettings({ browserNotificationsEnabled: true });
    return "granted";
  }
  const permission = await window.Notification.requestPermission();
  saveRealtimeFeedbackSettings({ browserNotificationsEnabled: permission === "granted" });
  return permission;
};

export const resolveFeedbackEvent = (eventName, payload = {}) => {
  const type = String(payload?.type || payload?.event || eventName || "notification").toLowerCase();
  const category = String(payload?.category || "").toLowerCase();
  const priorityValue = String(payload?.priority || "").toLowerCase();
  const mapped =
    EVENT_MAP[type] ||
    (category === "orders" ? EVENT_MAP.new_order : null) ||
    (category === "payments" ? EVENT_MAP.payment_proof_uploaded : null) ||
    (category === "inventory" ? EVENT_MAP.low_stock : null) ||
    (category === "attendance" ? EVENT_MAP.attendance : null) ||
    EVENT_MAP.notification;

  const priority = normalizeRealtimePriority(priorityValue || mapped.priority);

  return {
    ...mapped,
    eventName,
    priority,
    title: payload?.title || mapped.title,
    message: payload?.message || payload?.body || payload?.description || "",
    id: payload?.id || payload?.notification_id || payload?.order_id || payload?.orderId || `${type}-${Date.now()}`,
    payload,
  };
};

const dispatchVisualFeedback = (event) => {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, {
    detail: {
      ...event,
      behavior: getRealtimePriorityBehavior(event.priority),
      theme: currentTheme(),
      reducedMotion: reducedMotion(),
    },
  }));
};

export const subscribeRealtimeFeedbackEvents = (listener) => {
  if (!isBrowser() || typeof listener !== "function") return () => {};
  const handler = (event) => listener(event.detail);
  window.addEventListener(FEEDBACK_EVENT, handler);
  return () => window.removeEventListener(FEEDBACK_EVENT, handler);
};

const flushHiddenBatch = () => {
  if (!hiddenBatch.length) return;
  const count = hiddenBatch.length;
  const top = hiddenBatch.find((event) => priorityRank[event.priority] >= priorityRank.high) || hiddenBatch[0];
  hiddenBatch = [];
  hiddenBatchTimer = null;
  browserNotificationFor({
    ...top,
    title: count > 1 ? `${count} new ERP updates` : top.title,
    message: count > 1 ? "Open the ERP workspace to review the latest activity." : top.message,
    priority: top.priority,
    force: true,
  });
};

const queueHiddenEvent = (event) => {
  if (!isBrowser() || !document.hidden || priorityRank[event.priority] >= priorityRank.high) return false;
  hiddenBatch.push(event);
  if (!hiddenBatchTimer) {
    hiddenBatchTimer = window.setTimeout(flushHiddenBatch, 1800);
  }
  return true;
};

export const emitRealtimeFeedback = async (eventName, payload = {}, options = {}) => {
  const event = {
    ...resolveFeedbackEvent(eventName, payload),
    ...options,
  };
  event.priority = normalizeRealtimePriority(event.priority);
  const settings = getRealtimeFeedbackSettings();
  const theme = currentTheme();
  if (recentlySeenEvent(event) || isFeedbackSuppressedByMode(event, settings, theme)) return event;
  if (queueHiddenEvent(event)) return event;
  dispatchVisualFeedback(event);
  toastFor({
    toastType: event.toastType,
    title: event.title,
    message: event.message,
    id: `feedback-${event.eventName}-${event.id}`,
    priority: event.priority,
  });
  await playRealtimeSound(event.sound, { priority: event.priority, key: event.id || event.eventName });
  if (!(inSilentHours(settings) && event.priority !== "critical")) vibrateFor(event.priority);
  browserNotificationFor(event);
  return event;
};

export const realtimeFeedbackService = {
  init: initRealtimeFeedback,
  unlock: unlockRealtimeFeedbackAudio,
  getSettings: getRealtimeFeedbackSettings,
  saveSettings: saveRealtimeFeedbackSettings,
  subscribeSettings: subscribeRealtimeFeedbackSettings,
  subscribeEvents: subscribeRealtimeFeedbackEvents,
  requestBrowserNotificationPermission,
  play: playRealtimeSound,
  emit: emitRealtimeFeedback,
  resolve: resolveFeedbackEvent,
};

export default realtimeFeedbackService;
