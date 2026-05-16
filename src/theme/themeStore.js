import {
  ACCENTS,
  DEFAULT_ACCENT_ID,
  DEFAULT_DENSITY,
  DEFAULT_THEME_ID,
  THEME_MAP,
  THEMES,
} from "./themes";

export const THEME_STORAGE_KEY = "erp.theme";
export const ACCENT_STORAGE_KEY = "erp.accent";
export const DENSITY_STORAGE_KEY = "erp.density";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

export const getStoredTheme = () => {
  const win = safeWindow();
  if (!win) return DEFAULT_THEME_ID;

  try {
    const stored = win.localStorage.getItem(THEME_STORAGE_KEY);
    return stored && THEME_MAP[stored] ? stored : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
};

export const setStoredTheme = (themeId) => {
  const win = safeWindow();
  if (!win) return;
  if (!THEME_MAP[themeId]) return;
  win.localStorage.setItem(THEME_STORAGE_KEY, themeId);
};

export const clearStoredTheme = () => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.removeItem(THEME_STORAGE_KEY);
};

export const getStoredAccent = () => {
  const win = safeWindow();
  if (!win) return DEFAULT_ACCENT_ID;

  try {
    const stored = win.localStorage.getItem(ACCENT_STORAGE_KEY);
    return stored && ACCENTS.some((item) => item.id === stored) ? stored : DEFAULT_ACCENT_ID;
  } catch {
    return DEFAULT_ACCENT_ID;
  }
};

export const setStoredAccent = (accentId) => {
  const win = safeWindow();
  if (!win) return;
  if (!ACCENTS.some((item) => item.id === accentId)) return;
  win.localStorage.setItem(ACCENT_STORAGE_KEY, accentId);
};

export const clearStoredAccent = () => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.removeItem(ACCENT_STORAGE_KEY);
};

export const getStoredDensity = () => {
  const win = safeWindow();
  if (!win) return DEFAULT_DENSITY;

  try {
    const stored = win.localStorage.getItem(DENSITY_STORAGE_KEY);
    return stored === "compact" || stored === "normal" ? stored : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
};

export const setStoredDensity = (density) => {
  const win = safeWindow();
  if (!win) return;
  if (density !== "compact" && density !== "normal") return;
  win.localStorage.setItem(DENSITY_STORAGE_KEY, density);
};

export const clearStoredDensity = () => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.removeItem(DENSITY_STORAGE_KEY);
};

export const resolveTheme = (themeId = DEFAULT_THEME_ID) =>
  THEME_MAP[themeId] || THEME_MAP[DEFAULT_THEME_ID];

export const getThemeList = () => THEMES;
