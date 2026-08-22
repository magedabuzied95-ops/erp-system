import { safeSetLocalStorage } from "../utils/safeStorage";
import {
  ARABIC_FONT_MAP,
  LATIN_FONT_MAP,
  appearanceVariables,
  googleFontHref,
  normalizeAppearance,
} from "./appearance";

// One record: the profile the user picked plus a `resolved` block with the
// final CSS stacks and font URLs. The resolved block exists for index.html's
// anti-FOUC seed, which runs before any module loads and therefore cannot see
// the font catalogue — it only needs to copy values into custom properties.
export const APPEARANCE_STORAGE_KEY = "erp.appearance";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

export const buildStoredAppearance = (input) => {
  const profile = normalizeAppearance(input);
  const variables = appearanceVariables(profile);
  const links = [ARABIC_FONT_MAP[profile.fontAr], LATIN_FONT_MAP[profile.fontEn]]
    .map((font) => googleFontHref(font))
    .filter(Boolean);
  return {
    ...profile,
    resolved: {
      fontAr: variables["font-ar"],
      fontEn: variables["font-en"],
      links: Array.from(new Set(links)),
    },
  };
};

// Returns the stored profile, or null when the user has never chosen one. The
// distinction matters: null means "follow the store default", not "use M1
// Classic".
export const getStoredAppearance = () => {
  const win = safeWindow();
  if (!win) return null;
  try {
    const raw = win.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? normalizeAppearance(parsed) : null;
  } catch {
    return null;
  }
};

export const setStoredAppearance = (input) => {
  const win = safeWindow();
  if (!win) return;
  safeSetLocalStorage(APPEARANCE_STORAGE_KEY, buildStoredAppearance(input), { debug: true });
};

export const clearStoredAppearance = () => {
  const win = safeWindow();
  if (!win) return;
  try {
    win.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // Storage access can be denied; the in-memory state still resets.
  }
};
