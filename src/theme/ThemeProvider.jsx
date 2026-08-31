import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearStoredAccent,
  clearStoredDensity,
  clearStoredTheme,
  getStoredAccent,
  getStoredDensity,
  getStoredTheme,
  resolveTheme,
  setStoredAccent,
  setStoredDensity,
  setStoredTheme,
} from "./themeStore";
import { clearStoredAppearance, getStoredAppearance, setStoredAppearance } from "./appearanceStore";
import { setAppColorScheme } from "./documentColorScheme";
import {
  APPEARANCE_MANAGED_TOKENS,
  DEFAULT_APPEARANCE,
  appearanceEquals,
  appearanceVariables,
  ensureProfileFontsLoaded,
  isDefaultAppearance,
  normalizeAppearance,
  profileFromPreset,
} from "./appearance";
import { ACCENTS, DEFAULT_ACCENT_ID, DEFAULT_DENSITY, DEFAULT_THEME_ID, THEMES } from "./themes";
import { ThemeContext } from "./themeContext";

const resolveAccent = (accentId) => ACCENTS.find((item) => item.id === accentId) || ACCENTS[0];

const applyThemeVariables = (theme, accentId, density, appearance) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const body = document.body;
  const accent = resolveAccent(accentId);
  const densityValue = density === "compact" ? "compact" : "normal";

  const variables = { ...theme.variables };
  if (accent.id !== DEFAULT_ACCENT_ID && accent.variables) {
    Object.assign(variables, accent.variables);
  }

  // The appearance profile is layered AFTER the palette so its font, radius
  // and control-height tokens win over the shared defaults in themes.js. The
  // default profile writes nothing and clears anything a previous profile
  // left behind, so "reset" really returns to the stylesheet values.
  const overrides = isDefaultAppearance(appearance) ? {} : appearanceVariables(appearance);
  Object.assign(variables, overrides);

  Object.entries(variables).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
    body?.style?.setProperty?.(`--${key}`, value);
  });
  APPEARANCE_MANAGED_TOKENS.forEach((key) => {
    if (key in variables) return;
    root.style.removeProperty(`--${key}`);
    body?.style?.removeProperty?.(`--${key}`);
  });

  root.dataset.theme = theme.id;
  root.dataset.accent = accent.id;
  root.dataset.density = densityValue;
  root.dataset.appearance = normalizeAppearance(appearance).preset;
  root.classList.add("theme-app");
  root.classList.toggle("dark", theme.mode === "dark");
  if (body) {
    body.classList.add("theme-app");
    body.classList.toggle("dark", theme.mode === "dark");
    body.dataset.theme = theme.id;
    body.dataset.accent = accent.id;
    body.dataset.density = densityValue;
    body.classList.toggle("theme-density-compact", densityValue === "compact");
    body.classList.toggle("theme-density-normal", densityValue !== "compact");
    body.style.background = "var(--bg)";
    body.style.color = "var(--text)";
  }

  // Both the root `color-scheme` and the theme-color meta go through the one
  // owner. Writing them here directly used to clobber whatever the storefront
  // had set, because this provider is the outermost one and React flushes its
  // effect last. See src/theme/documentColorScheme.js.
  const themeColor = theme.mode === "light" ? variables.bg || "#f7f4ee" : variables.bg || "#050816";
  setAppColorScheme(theme.mode, themeColor);
};

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => getStoredTheme() || DEFAULT_THEME_ID);
  const [accentId, setAccentId] = useState(() => getStoredAccent() || DEFAULT_ACCENT_ID);
  const [density, setDensity] = useState(() => getStoredDensity() || DEFAULT_DENSITY);
  // `localAppearance` is what this browser chose (null = never chose).
  // `tenantAppearance` is the store-wide default the app learns after boot.
  // Effective = local ?? tenant ?? built-in.
  const [localAppearance, setLocalAppearance] = useState(() => getStoredAppearance());
  const [tenantAppearance, setTenantAppearance] = useState(null);

  const theme = useMemo(() => resolveTheme(themeId), [themeId]);
  const appearance = useMemo(
    () => normalizeAppearance(localAppearance || tenantAppearance || DEFAULT_APPEARANCE),
    [localAppearance, tenantAppearance]
  );

  useEffect(() => {
    ensureProfileFontsLoaded(appearance);
    applyThemeVariables(theme, accentId, density, appearance);
    setStoredTheme(theme.id);
    setStoredAccent(accentId);
    setStoredDensity(density);
  }, [theme, accentId, density, appearance]);

  const setAppearance = useCallback((next) => {
    const normalized = normalizeAppearance(next);
    setLocalAppearance(normalized);
    setStoredAppearance(normalized);
  }, []);

  const applyAppearancePreset = useCallback(
    (presetId) => {
      const preset = profileFromPreset(presetId);
      setAppearance(preset);
      if (preset.density) setDensity(preset.density === "compact" ? "compact" : "normal");
    },
    [setAppearance]
  );

  const resetAppearance = useCallback(() => {
    clearStoredAppearance();
    setLocalAppearance(null);
  }, []);

  const setTenantAppearanceDefault = useCallback((profile) => {
    setTenantAppearance(profile ? normalizeAppearance(profile) : null);
  }, []);

  const value = useMemo(
    () => ({
      themeId: theme.id,
      theme,
      themes: THEMES,
      accentId,
      density,
      appearance,
      // True when this browser holds its own choice rather than following the
      // store default. The studio uses it to label the "reset" action honestly.
      hasLocalAppearance: Boolean(localAppearance),
      tenantAppearance,
      appearanceFollowsTenant: !localAppearance && Boolean(tenantAppearance),
      isAppearanceDirtyAgainstTenant: Boolean(localAppearance) && !appearanceEquals(localAppearance, tenantAppearance || DEFAULT_APPEARANCE),
      setTheme: (nextThemeId) => {
        const next = resolveTheme(nextThemeId);
        setThemeId(next.id);
      },
      setAccent: (nextAccentId) => {
        setAccentId(nextAccentId);
      },
      setDensity: (nextDensity) => {
        setDensity(nextDensity === "compact" ? "compact" : "normal");
      },
      setAppearance,
      applyAppearancePreset,
      resetAppearance,
      setTenantAppearanceDefault,
      resetTheme: () => {
        clearStoredTheme();
        clearStoredAccent();
        clearStoredDensity();
        clearStoredAppearance();
        setThemeId(DEFAULT_THEME_ID);
        setAccentId(DEFAULT_ACCENT_ID);
        setDensity(DEFAULT_DENSITY);
        setLocalAppearance(null);
      },
    }),
    [theme, accentId, density, appearance, localAppearance, tenantAppearance, setAppearance, applyAppearancePreset, resetAppearance, setTenantAppearanceDefault]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
