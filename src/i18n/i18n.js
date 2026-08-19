import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  buildLocaleResources,
  loadCoreBundles,
  loadRestBundles,
  mergeRemainingBundles,
  shouldDeferErpLocales,
} from "./loadLocaleScope";
import { SUPPORTED_LOCALES } from "./localeManifest";


export const DEFAULT_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "app_language";

export const normalizeLanguage = (language) => (String(language || "").toLowerCase().startsWith("ar") ? "ar" : "en");
export const isRtlLanguage = (language) => normalizeLanguage(language) === "ar";
export const getLanguageDirection = (language) => (isRtlLanguage(language) ? "rtl" : "ltr");

const readStorage = (key) => {
  try {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const writeStorage = (key, value) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

const removeStorage = (key) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

const parseStoredJson = (key) => {
  try {
    const raw = readStorage(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const readUserLanguagePreference = () => {
  const user = parseStoredJson("user");
  return (
    user?.language ||
    user?.preferredLanguage ||
    user?.preferred_language ||
    user?.settings?.language ||
    user?.profile?.language ||
    ""
  );
};

export const getStoredLanguage = () => {
  const stored = readStorage(LANGUAGE_STORAGE_KEY);
  if (stored) return normalizeLanguage(stored);

  const userLanguage = readUserLanguagePreference();
  return userLanguage ? normalizeLanguage(userLanguage) : null;
};

export const getBrowserLanguage = () => {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  return normalizeLanguage(navigator.language || DEFAULT_LANGUAGE);
};

export const resolveInitialLanguage = () => {
  return getStoredLanguage() || getBrowserLanguage();
};

const resolveFontFamily = (language) =>
  normalizeLanguage(language) === "ar"
    ? '"Cairo", "Tajawal", "Noto Sans Arabic", "IBM Plex Sans Arabic", "Segoe UI", sans-serif'
    : '"Inter", "Cairo", "Tajawal", "Noto Sans Arabic", "IBM Plex Sans Arabic", "Segoe UI", sans-serif';

export const applyDocumentLanguage = (language) => {
  if (typeof document === "undefined") return;

  const normalized = normalizeLanguage(language);
  const dir = getLanguageDirection(normalized);
  const fontFamily = resolveFontFamily(normalized);
  const textAlign = dir === "rtl" ? "right" : "left";
  const start = dir === "rtl" ? "right" : "left";
  const end = dir === "rtl" ? "left" : "right";

  document.documentElement.lang = normalized;
  document.documentElement.dir = dir;
  document.documentElement.dataset.language = normalized;
  document.documentElement.dataset.direction = dir;
  document.documentElement.classList.toggle("rtl", dir === "rtl");
  document.documentElement.classList.toggle("ltr", dir === "ltr");
  document.documentElement.classList.toggle("dir-rtl", dir === "rtl");
  document.documentElement.classList.toggle("dir-ltr", dir === "ltr");
  document.documentElement.style.setProperty("--app-font", fontFamily);
  document.documentElement.style.setProperty("--dir", dir);
  document.documentElement.style.setProperty("--text-align", textAlign);
  document.documentElement.style.setProperty("--start", start);
  document.documentElement.style.setProperty("--end", end);

  if (document.body) {
    document.body.dir = dir;
    document.body.dataset.language = normalized;
    document.body.dataset.direction = dir;
    document.body.classList.toggle("rtl", dir === "rtl");
    document.body.classList.toggle("ltr", dir === "ltr");
    document.body.classList.toggle("dir-rtl", dir === "rtl");
    document.body.classList.toggle("dir-ltr", dir === "ltr");
    document.body.style.setProperty("--app-font", fontFamily);
    document.body.style.setProperty("--dir", dir);
    document.body.style.setProperty("--text-align", textAlign);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:language-changed", { detail: { language: normalized, dir } }));
  }
};

export const persistApplicationLanguage = (language) => {
  const normalized = normalizeLanguage(language);
  writeStorage(LANGUAGE_STORAGE_KEY, normalized);

  const user = parseStoredJson("user");
  if (user && typeof user === "object") {
    const nextUser = {
      ...user,
      language: normalized,
      preferredLanguage: normalized,
      settings: {
        ...(user.settings && typeof user.settings === "object" ? user.settings : {}),
        language: normalized,
      },
    };

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("user", JSON.stringify(nextUser));
      }
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }

  applyDocumentLanguage(normalized);
  return normalized;
};

const initialLanguage = resolveInitialLanguage();

const readableMissingKeyFallback = (key = "") =>
  String(Array.isArray(key) ? key[0] : key || "")
    .split(".")
    .pop()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

removeStorage("erp.language");
removeStorage("i18nextLng");
removeStorage("language");
removeStorage("lang");

/**
 * Boot dictionaries.
 *
 * Only the ACTIVE language is loaded before init, and on a public storefront
 * route only its core bundles. Everything else — the rest of this language's
 * bundles, plus the fallback language — is grafted on after first paint by
 * `hydrateRemainingLocales` below, so none of it sits on the critical path.
 *
 * See src/i18n/loadLocaleScope.js for why this split exists.
 */
const deferErpLocales = shouldDeferErpLocales();
const bootFiles = deferErpLocales
  ? await loadCoreBundles(initialLanguage)
  : { ...(await loadCoreBundles(initialLanguage)), ...(await loadRestBundles(initialLanguage)) };

await i18n.use(initReactI18next).init({
  resources: buildLocaleResources(initialLanguage, bootFiles),
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: ["ar", "en"],
  nonExplicitSupportedLngs: true,
  saveMissing: typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV),
  interpolation: {
    escapeValue: false,
  },
});

/**
 * Fills in everything boot skipped: the deferred bundles for the active
 * language, then the fallback language in full. Both are best-effort — a failed
 * chunk must never break a page that already painted, and every key an already
 * rendered screen needs is by construction in the boot set.
 *
 * Awaited by `whenLocalesReady()` so a screen that genuinely needs the full
 * dictionary (a language switch, an ERP route reached from the storefront) can
 * wait for it instead of rendering fallback text.
 */
const hydrateRemainingLocales = async () => {
  if (deferErpLocales) {
    await mergeRemainingBundles(i18n, initialLanguage).catch(() => false);
  }
  await Promise.all(
    SUPPORTED_LOCALES.filter((locale) => locale !== initialLanguage).map((locale) =>
      mergeRemainingBundles(i18n, locale, { includeCore: true }).catch(() => false)
    )
  );
};

// Started on idle rather than immediately: kicking these chunks off the moment
// init resolves puts them back in contention with App/Storefront for the very
// bandwidth this split was meant to free. `whenLocalesReady()` short-circuits
// the wait for anything that actually needs the full dictionary now.
let localeHydration = null;
const startLocaleHydration = () => {
  if (!localeHydration) localeHydration = hydrateRemainingLocales();
  return localeHydration;
};

if (typeof window !== "undefined") {
  // After `load`, then on idle: the first waits out the render and the product
  // imagery, the second waits out whatever the page is still busy with. Either
  // alone would still let these chunks compete with the very work this split
  // was meant to unblock.
  const onIdle = () => {
    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1200));
    schedule(() => startLocaleHydration(), { timeout: 4000 });
  };
  if (document.readyState === "complete") onIdle();
  else window.addEventListener("load", onIdle, { once: true });
} else {
  startLocaleHydration();
}

/** Resolves once every locale bundle has been merged into the instance. */
export const whenLocalesReady = () => startLocaleHydration();

const originalT = i18n.t.bind(i18n);
i18n.t = (key, options, ...rest) => {
  if (typeof key !== "string" && !Array.isArray(key)) {
    if (typeof options?.defaultValue === "string") return options.defaultValue;
    if (typeof key?.label === "string") return key.label;
    if (typeof key?.title === "string") return key.title;
    if (typeof key?.name === "string") return key.name;
    if (typeof key?.value === "string") return key.value;
    return "";
  }
  const translated = originalT(key, options, ...rest);
  const primaryKey = Array.isArray(key) ? key.find((item) => typeof item === "string") : key;
  if (typeof translated === "string" && typeof primaryKey === "string" && translated === primaryKey) {
    return typeof options?.defaultValue === "string" ? options.defaultValue : readableMissingKeyFallback(primaryKey);
  }
  return translated;
};

if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
  const missingKeys = new Set();
  i18n.on("missingKey", (lngs, namespace, key) => {
    if (typeof key !== "string") {
      console.warn("[i18n] non-string missing key blocked", {
        lngs,
        namespace,
        key,
        keyType: typeof key,
        stack: new Error().stack,
      });
      return;
    }
    const id = `${namespace}:${key}`;
    if (missingKeys.has(id)) return;
    missingKeys.add(id);
    console.warn("[i18n] missing key", { lngs, namespace, key });
  });
}

i18n.on("languageChanged", (language) => {
  applyDocumentLanguage(language);
  // The target language may still be mid-hydration (or not started, if the
  // switch happens before idle). Force it and re-emit so mounted screens
  // re-render once its bundles land.
  startLocaleHydration().then(() => i18n.emit("loaded"));
});

applyDocumentLanguage(initialLanguage);

export { i18n };
export default i18n;
