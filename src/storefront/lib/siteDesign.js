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

import { DEFAULT_SITE_DESIGN, SITE_DESIGN_SETTING_KEY, normalizeSiteDesign, siteDesignStylesheet } from "../../../shared/siteDesign.js";
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

const publish = (design) => {
  const next = normalizeSiteDesign(design);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  snapshot = next;
  applySiteDesign(next);
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
