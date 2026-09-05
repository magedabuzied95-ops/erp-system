// The storefront's reader for the stored site design.
//
// Three jobs, in the order they matter to a visitor:
//
//   1. Paint from cache SYNCHRONOUSLY. The design lives in a setting fetched
//      over the network, and a palette that arrives 400ms late is a visible
//      colour flip on every cold load. The last known-good record is mirrored
//      into localStorage and read during module evaluation, so the stylesheet is
//      in <head> before React's first commit.
//   2. Refresh from /settings/public. That request is already made on boot by
//      the shell, and publicSettings.js de-duplicates it, so this costs nothing.
//   3. Notify. `useSiteDesign()` re-renders the hero overlay when the record
//      changes, which is also what makes the studio's live preview honest.
//
// Everything it writes is scoped to `body.storefront-shell` (see
// shared/siteDesign.js), so nothing here can reach an ERP page.

import { useSyncExternalStore } from "react";

import {
  DEFAULT_SITE_DESIGN,
  SITE_DESIGN_SETTING_KEY,
  normalizeSiteDesign,
  sharedPaletteVariables,
  siteDesignStylesheet,
} from "../../../shared/siteDesign.js";
import { arabicFontStack, ensureFontLoaded, latinFontStack, ARABIC_FONT_MAP, LATIN_FONT_MAP } from "../../theme/appearance";
import { getPublicSettingsResponse } from "../../shared/api/publicSettings";

const CACHE_KEY = "storefront.site_design";
const STYLE_ID = "sf-site-design";

const readCache = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // A private window, a full quota, a corrupted entry — all mean "no cache",
    // never "no storefront".
    return null;
  }
};

const writeCache = (design) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(design));
  } catch {
    /* nothing to do: the design still applies for this page view */
  }
};

let current = normalizeSiteDesign(readCache() || DEFAULT_SITE_DESIGN);
let snapshot = current;
const listeners = new Set();

const fontStacks = (design) => ({
  fontAr: arabicFontStack(design.fontAr),
  fontEn: latinFontStack(design.fontEn, design.fontAr),
});

const loadFonts = (design) => {
  ensureFontLoaded(ARABIC_FONT_MAP[design.fontAr]);
  ensureFontLoaded(LATIN_FONT_MAP[design.fontEn]);
};

/**
 * Writes the generated stylesheet into <head>.
 *
 * Deliberately one <style> element reused across every update rather than
 * per-token `setProperty` calls: the `--m1h-*` tokens are declared on the
 * homepage root, not the body, so an inline write on either would lose to
 * home.css. A stylesheet can carry a selector specific enough to win.
 */
export const applySiteDesign = (input) => {
  if (typeof document === "undefined") return;
  const design = normalizeSiteDesign(input);
  loadFonts(design);
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  const css = siteDesignStylesheet(design, fontStacks(design));
  if (style.textContent !== css) style.textContent = css;
};

/* ------------------------------------------- the tokens ThemeProvider owns */

// `--bg/--surface/--card/--surface-soft/--border/--text/--muted` are written
// INLINE on <html> and <body> by src/theme/ThemeProvider.jsx — 69 custom
// properties, measured — and an inline declaration beats any stylesheet rule on
// the same element. The generated sheet therefore cannot move them, and they are
// not decoration: index.css remaps a set of Tailwind utilities through them
// (`html[data-theme] .text-white { color: var(--text) !important }`), so a
// storefront element carrying a bare `text-white` reads its colour from --text.
//
// The fix is to write them inline too, on <body>, while a storefront route is
// mounted — and to put them back whenever something else rewrites that
// attribute. The observer is idempotent by construction: it only writes a
// property whose current value differs, so its own write produces a mutation
// record that asks for no further write and the loop settles immediately.
let bodyObserver = null;
let attached = false;

const applySharedTokens = () => {
  if (!attached || typeof document === "undefined") return;
  const body = document.body;
  if (!body) return;
  const mode = body.classList.contains("storefront-dark") ? "dark" : "light";
  const variables = sharedPaletteVariables(current, mode);
  Object.entries(variables).forEach(([name, value]) => {
    if (body.style.getPropertyValue(name) !== value) body.style.setProperty(name, value);
  });
};

const releaseSharedTokens = () => {
  if (typeof document === "undefined" || !document.body) return;
  Object.keys(sharedPaletteVariables(current, "light")).forEach((name) => {
    document.body.style.removeProperty(name);
  });
};

/**
 * Starts applying the design's shared tokens to <body>. Called by the storefront
 * shell alongside the `storefront-shell` class, so the ERP never inherits them.
 */
export const attachSiteDesign = () => {
  if (typeof document === "undefined" || attached) return;
  attached = true;
  applySharedTokens();
  if (typeof MutationObserver === "undefined") return;
  bodyObserver = new MutationObserver(applySharedTokens);
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
};

/** Hands <body> back to the ERP theme when the storefront unmounts. */
export const detachSiteDesign = () => {
  bodyObserver?.disconnect();
  bodyObserver = null;
  if (!attached) return;
  attached = false;
  releaseSharedTokens();
};

const publish = (design) => {
  const next = normalizeSiteDesign(design);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  snapshot = next;
  applySiteDesign(next);
  applySharedTokens();
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* one bad subscriber must not stop the others */
    }
  });
};

// Paint before React mounts. Import order is what makes this work: the module
// is imported by Storefront.jsx, which is itself imported before any render.
applySiteDesign(current);

let loaded = false;

/**
 * Pulls the record out of the shared /settings/public payload. Safe to call as
 * often as you like — the underlying request is cached and de-duplicated, and a
 * failed read simply leaves the cached design in place.
 */
export const refreshSiteDesign = async ({ force = false } = {}) => {
  if (loaded && !force) return current;
  loaded = true;
  try {
    const response = await getPublicSettingsResponse(force ? { force: true } : {});
    const settings = response?.settings || {};
    const stored = settings[SITE_DESIGN_SETTING_KEY] ?? settings?.storefront?.site_design ?? null;
    if (stored) {
      const design = normalizeSiteDesign(stored);
      publish(design);
      writeCache(design);
    }
  } catch {
    loaded = false;
  }
  return current;
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => snapshot;

/** The active site design, re-rendering the caller whenever it changes. */
export const useSiteDesign = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const getSiteDesign = () => current;

export { DEFAULT_SITE_DESIGN, normalizeSiteDesign };
