const STOREFRONT_THEME_PALETTES = {
  dark: {
    background: "linear-gradient(180deg,#030303 0%,#070707 45%,#0b0b0b 100%)",
    surface: "linear-gradient(180deg,#050505 0%,#101010 45%,#151515 100%)",
    card: "#101010",
    cardSoft: "#151515",
    border: "rgba(255,255,255,0.08)",
    borderStrong: "rgba(255,255,255,0.12)",
    textPrimary: "#efeee9",
    textSecondary: "#c5c2ba",
    muted: "#a19e96",
    accent: "#d0a632",
    accentText: "#1f1908",
    accentSoft: "rgba(208,166,50,0.14)",
    success: "#42b883",
    warning: "#e0a23a",
    error: "#ef6b6b",
    shadow: "0 18px 48px rgba(0,0,0,0.42)",
    shadowSoft: "0 1px 2px rgba(0,0,0,0.24)",
    heroGradient: "linear-gradient(180deg,#050505 0%,#101010 45%,#151515 100%)",
    heroGlow: "radial-gradient(circle at 14% 16%, rgba(208,166,50,0.12), transparent 30%), radial-gradient(circle at 82% 20%, rgba(255,255,255,0.035), transparent 32%)",
  },
  light: {
    background: "#f3f3f1",
    surface: "#ffffff",
    card: "#ffffff",
    cardSoft: "#f7f7f5",
    border: "#dedbd3",
    borderStrong: "#c9c5bc",
    textPrimary: "#25231f",
    textSecondary: "#5d5952",
    muted: "#716e67",
    accent: "#a47a12",
    accentText: "#1f1908",
    accentSoft: "#fff7df",
    success: "#198754",
    warning: "#c47a08",
    error: "#d14343",
    shadow: "0 16px 40px rgba(31,29,25,0.16)",
    shadowSoft: "0 1px 2px rgba(31,29,25,0.05)",
    heroGradient: "linear-gradient(135deg,#ffffff 0%,#f7f7f5 54%,#fff7df 100%)",
    heroGlow: "radial-gradient(circle at 16% 20%, rgba(164,122,18,0.12), transparent 30%), radial-gradient(circle at 84% 18%, rgba(255,255,255,0.82), transparent 34%)",
  },
};

export const resolveStorefrontThemeMode = (themeMode = "light") => {
  const normalized = String(themeMode || "").trim().toLowerCase();
  if (normalized === "system") {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  }
  return normalized === "dark" ? "dark" : "light";
};

export const getStorefrontThemeTokens = (themeMode = "light") => {
  const resolvedMode = resolveStorefrontThemeMode(themeMode);
  const palette = STOREFRONT_THEME_PALETTES[resolvedMode] || STOREFRONT_THEME_PALETTES.light;
  return {
    mode: String(themeMode || resolvedMode || "light"),
    resolvedMode,
    ...palette,
  };
};
