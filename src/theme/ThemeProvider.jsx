import { useEffect, useMemo, useState } from "react";

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
import { ACCENTS, DEFAULT_ACCENT_ID, DEFAULT_DENSITY, DEFAULT_THEME_ID, THEMES } from "./themes";
import { ThemeContext } from "./themeContext";

const resolveAccent = (accentId) => ACCENTS.find((item) => item.id === accentId) || ACCENTS[0];

const applyThemeVariables = (theme, accentId, density) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const body = document.body;
  const accent = resolveAccent(accentId);
  const densityValue = density === "compact" ? "compact" : "normal";

  const variables = { ...theme.variables };
  if (accent.id !== DEFAULT_ACCENT_ID) {
    variables.primary = accent.primary;
    variables.primarySoft = accent.primarySoft;
  }

  Object.entries(variables).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
    body?.style?.setProperty?.(`--${key}`, value);
  });

  root.dataset.theme = theme.id;
  root.dataset.accent = accent.id;
  root.dataset.density = densityValue;
  root.classList.add("theme-app");
  root.classList.toggle("dark", theme.mode === "dark");
  root.style.colorScheme = theme.mode || "dark";
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
};

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => getStoredTheme() || DEFAULT_THEME_ID);
  const [accentId, setAccentId] = useState(() => getStoredAccent() || DEFAULT_ACCENT_ID);
  const [density, setDensity] = useState(() => getStoredDensity() || DEFAULT_DENSITY);

  const theme = useMemo(() => resolveTheme(themeId), [themeId]);

  useEffect(() => {
    applyThemeVariables(theme, accentId, density);
    setStoredTheme(theme.id);
    setStoredAccent(accentId);
    setStoredDensity(density);
  }, [theme, accentId, density]);

  const value = useMemo(
    () => ({
      themeId: theme.id,
      theme,
      themes: THEMES,
      accentId,
      density,
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
      resetTheme: () => {
        clearStoredTheme();
        clearStoredAccent();
        clearStoredDensity();
        setThemeId(DEFAULT_THEME_ID);
        setAccentId(DEFAULT_ACCENT_ID);
        setDensity(DEFAULT_DENSITY);
      },
    }),
    [theme, accentId, density]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
