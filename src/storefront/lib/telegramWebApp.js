// The storefront running INSIDE Telegram.
//
// The shop bot's "order now" button opens this same storefront as a Telegram
// mini app, in Telegram's own webview. Two things follow from that:
//
// 1. Telegram does NOT inject its JS bridge on its own -- the page has to load
//    telegram-web-app.js. Putting that in index.html would buy every ordinary
//    shopper a third-party request they will never use, so it is loaded only
//    when the URL says we are inside Telegram: the webview appends
//    #tgWebAppPlatform=... to the fragment before the page runs.
// 2. Telegram opens the view at roughly half the screen height until the page
//    asks for the rest. A checkout in half a phone screen is a checkout nobody
//    finishes, so the page asks.
//
// Everything here is best-effort and guarded: this is the same page on an
// ordinary browser, where none of it exists.

const BRIDGE_SRC = "https://telegram.org/js/telegram-web-app.js";
const BRIDGE_TIMEOUT_MS = 4_000;

// Read from the fragment rather than from window.Telegram, which is exactly
// what is not there yet at this point.
export const looksLikeTelegramWebApp = () => {
  if (typeof window === "undefined") return false;
  const hash = String(window.location?.hash || "");
  const search = String(window.location?.search || "");
  return /tgWebApp(Platform|Version|Data)/.test(hash) || /[?&]tgWebAppPlatform=/.test(search);
};

const telegram = () => {
  if (typeof window === "undefined") return null;
  const api = window.Telegram?.WebApp;
  return api && typeof api === "object" ? api : null;
};

export const isTelegramWebApp = () => Boolean(telegram()?.platform);

let bridgePromise = null;
const loadTelegramBridge = () => {
  if (telegram()) return Promise.resolve(true);
  if (bridgePromise) return bridgePromise;
  if (typeof document === "undefined") return Promise.resolve(false);
  bridgePromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = BRIDGE_SRC;
    script.async = true;
    // A blocked or slow CDN must not leave the page waiting on Telegram: the
    // shop still works, it is only the expand and the back arrow that are lost.
    const timer = setTimeout(() => resolve(false), BRIDGE_TIMEOUT_MS);
    const finish = (ok) => { clearTimeout(timer); resolve(ok); };
    script.addEventListener("load", () => finish(Boolean(telegram())));
    script.addEventListener("error", () => finish(false));
    document.head.appendChild(script);
  });
  return bridgePromise;
};

export const initTelegramWebApp = async () => {
  if (!looksLikeTelegramWebApp()) return false;
  const loaded = await loadTelegramBridge();
  const api = telegram();
  if (!loaded || !api) return false;
  try {
    api.ready?.();
    api.expand?.();
    // Marks the document so CSS can allow for Telegram's own header instead of
    // drawing a second sticky bar underneath it.
    if (typeof document !== "undefined") document.documentElement.classList.add("in-telegram");
  } catch {
    return false;
  }
  return true;
};

// Telegram's own back arrow, so a shopper inside the mini app is not left on the
// product page with no way back other than closing the whole thing.
export const bindTelegramBackButton = (onBack) => {
  const api = telegram();
  if (!api?.BackButton || typeof onBack !== "function") return () => {};
  try {
    api.BackButton.show?.();
    api.BackButton.onClick?.(onBack);
  } catch {
    return () => {};
  }
  return () => {
    try {
      api.BackButton.offClick?.(onBack);
      api.BackButton.hide?.();
    } catch {
      // The view is already gone; nothing to unbind.
    }
  };
};

export default { isTelegramWebApp, looksLikeTelegramWebApp, initTelegramWebApp, bindTelegramBackButton };
