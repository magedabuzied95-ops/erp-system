const STOREFRONT_THEME_PALETTES = {
  dark: {
    background: "#050505",
    surface: "#0b0b0c",
    card: "rgba(255,255,255,0.045)",
    cardSoft: "rgba(255,255,255,0.065)",
    border: "rgba(255,255,255,0.10)",
    borderStrong: "rgba(255,255,255,0.16)",
    textPrimary: "#f8fafc",
    textSecondary: "rgba(248,250,252,0.74)",
    muted: "rgba(248,250,252,0.54)",
    accent: "#d4af37",
    accentText: "#111827",
    accentSoft: "rgba(212,175,55,0.16)",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    shadow: "0 32px 120px rgba(0,0,0,0.36)",
    shadowSoft: "0 18px 48px rgba(0,0,0,0.18)",
    heroGradient: "linear-gradient(135deg,#050505 0%,#0a0a0a 55%,#141414 100%)",
    heroGlow: "radial-gradient(circle at 14% 16%, rgba(212,175,55,0.14), transparent 28%), radial-gradient(circle at 82% 20%, rgba(255,255,255,0.06), transparent 30%)",
  },
  light: {
    background: "#f6f1e8",
    surface: "#fffdf8",
    card: "rgba(255,255,255,0.95)",
    cardSoft: "rgba(255,255,255,0.88)",
    border: "rgba(15,23,42,0.12)",
    borderStrong: "rgba(15,23,42,0.20)",
    textPrimary: "#1f2937",
    textSecondary: "#2f3d50",
    muted: "#475569",
    accent: "#d4af37",
    accentText: "#111827",
    accentSoft: "rgba(212,175,55,0.12)",
    success: "#16a34a",
    warning: "#d97706",
    error: "#dc2626",
    shadow: "0 28px 100px rgba(15,23,42,0.10)",
    shadowSoft: "0 18px 42px rgba(15,23,42,0.10)",
    heroGradient: "linear-gradient(135deg,#fffdf8 0%,#fff8ee 54%,#eef2ff 100%)",
    heroGlow: "radial-gradient(circle at 16% 20%, rgba(212,175,55,0.12), transparent 28%), radial-gradient(circle at 84% 18%, rgba(255,255,255,0.78), transparent 33%)",
  },
};

export const resolveStorefrontThemeMode = (themeMode = "dark") => {
  const normalized = String(themeMode || "").trim().toLowerCase();
  if (normalized === "system") {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  }
  return normalized === "light" ? "light" : "dark";
};

export const getStorefrontThemeTokens = (themeMode = "dark") => {
  const resolvedMode = resolveStorefrontThemeMode(themeMode);
  const palette = STOREFRONT_THEME_PALETTES[resolvedMode] || STOREFRONT_THEME_PALETTES.dark;
  return {
    mode: String(themeMode || resolvedMode || "dark"),
    resolvedMode,
    ...palette,
  };
};
