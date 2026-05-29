const baseSounds = Object.freeze({
  orderNew: "/sounds/order-new.mp3",
  paymentSuccess: "/sounds/payment-success.mp3",
  notification: "/sounds/notification.mp3",
  warning: "/sounds/warning.mp3",
  attendance: "/sounds/attendance.mp3",
  aiMessage: "/sounds/ai-message.mp3",
  error: "/sounds/error.mp3",
  barcodeScan: "/sounds/barcode-scan.mp3",
});

export const REALTIME_SOUND_THEME_IDS = Object.freeze([
  "classic_retail",
  "luxury",
  "minimal",
  "gaming_store",
  "silent_professional",
]);

export const realtimeSoundThemes = Object.freeze({
  classic_retail: {
    id: "classic_retail",
    name: "Classic Retail",
    description: "Clear operational feedback for busy cashier and admin teams.",
    sounds: baseSounds,
    toastIntensity: "normal",
    animationIntensity: "normal",
    vibration: "light",
    volumeMultiplier: 1,
  },
  luxury: {
    id: "luxury",
    name: "Luxury",
    description: "Softer premium feedback with calmer movement.",
    sounds: baseSounds,
    toastIntensity: "soft",
    animationIntensity: "soft",
    vibration: "minimal",
    volumeMultiplier: 0.78,
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Reduced sound and compact visual feedback.",
    sounds: baseSounds,
    toastIntensity: "compact",
    animationIntensity: "soft",
    vibration: "minimal",
    volumeMultiplier: 0.55,
  },
  gaming_store: {
    id: "gaming_store",
    name: "Gaming Store",
    description: "Snappier feedback for high-speed store counters.",
    sounds: baseSounds,
    toastIntensity: "bright",
    animationIntensity: "high",
    vibration: "light",
    volumeMultiplier: 1.12,
  },
  silent_professional: {
    id: "silent_professional",
    name: "Silent Professional",
    description: "Visual-first alerts with sound reserved for critical events.",
    sounds: baseSounds,
    toastIntensity: "compact",
    animationIntensity: "soft",
    vibration: "off",
    volumeMultiplier: 0.5,
    criticalOnly: true,
  },
});

export const DEFAULT_REALTIME_SOUND_THEME = "classic_retail";

export const getRealtimeSoundTheme = (themeId = DEFAULT_REALTIME_SOUND_THEME) =>
  realtimeSoundThemes[themeId] || realtimeSoundThemes[DEFAULT_REALTIME_SOUND_THEME];
