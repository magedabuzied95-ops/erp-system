export const DEFAULT_THEME_ID = "light";
export const DEFAULT_ACCENT_ID = "default";
export const DEFAULT_DENSITY = "normal";

// M1 has one product accent. Keeping the accent API preserves backwards
// compatibility while preventing green/blue from becoming action colors.
export const ACCENTS = [
  { id: "default", name: "M1 Gold", primary: null, primarySoft: null },
  { id: "gold", name: "M1 Gold", primary: null, primarySoft: null },
];

const shared = {
  primary: "#a47a12",
  "primary-hover": "#8a6410",
  "primary-active": "#71510a",
  "primary-contrast": "#0d0a02",
  success: "#198754",
  warning: "#c47a08",
  danger: "#d14343",
  // Foreground for solid danger surfaces. Literals belong in the token layer;
  // primitives must never hardcode one.
  "danger-foreground": "#ffffff",
  // Neutral dialog scrim. Same in both themes; primitives must not inline it.
  "overlay-scrim": "rgba(0, 0, 0, 0.5)",
  info: "#4f6f8f",
  "radius-xs": "4px",
  "radius-sm": "7px",
  "radius-md": "10px",
  "radius-lg": "14px",
  "radius-xl": "18px",
  "control-height-sm": "32px",
  "control-height-md": "38px",
  "control-height-lg": "44px",
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "12px",
  "space-4": "16px",
  "space-5": "20px",
  "space-6": "24px",
  "space-8": "32px",
  "font-ar": '"Cairo", "Tajawal", "Noto Sans Arabic", sans-serif',
  "font-en": '"Inter", "Segoe UI", sans-serif',
  // Typography scale. Derived from what the product already uses rather than
  // invented: 11px and 10px account for two thirds of every sized string in the
  // repo, with 13px body and 15px section titles behind them. Seven steps, no
  // page names — the long tail of 8.5/9.5/10.5/12.5/12.75/17/22/23px snaps onto
  // these.
  //
  // Line heights are generous on purpose. Arabic ascenders and diacritics need
  // more vertical room than a Latin-first scale allows, and this product is
  // Arabic-first: nothing here goes below 1.35, and body text sits at 1.55.
  "font-caption": "10px",
  "font-caption-lh": "1.45",
  "font-label": "11px",
  "font-label-lh": "1.45",
  "font-body": "13px",
  "font-body-lh": "1.55",
  "font-section-title": "16px",
  "font-section-title-lh": "1.45",
  "font-page-title": "22px",
  "font-page-title-lh": "1.35",
  "font-display": "30px",
  "font-display-lh": "1.2",
};

export const THEMES = [
  {
    id: "light",
    name: "M1 Light",
    description: "Calm, dense ERP surfaces with restrained M1 gold actions.",
    mode: "light",
    density: "normal",
    variables: {
      ...shared,
      bg: "#eae7e0",
      surface: "#ffffff",
      card: "#ffffff",
      text: "#1b1915",
      muted: "#6a665e",
      border: "#d5cfc2",
      "border-strong": "#b5ae9e",
      "primary-soft": "#faf0d6",
      "success-soft": "#e9f7ef",
      "warning-soft": "#fff4df",
      "danger-soft": "#fceaea",
      "info-soft": "#edf3f8",
      "surface-soft": "#f4f1ea",
      "surface-raised": "#ffffff",
      "card-soft": "#f4f1ea",
      "sidebar": "#e4e0d7",
      "topbar": "#1c1c1a",
      "topbar-text": "#f4f3ef",
      "text-secondary": "#565149",
      "text-tertiary": "#8a857b",
      "table-head": "#f2eee6",
      "table-hover": "#f7f4ed",
      // Row selection. The only table state without an existing token: head and
      // hover already lived here, selection was being improvised per page.
      "table-selected": "#f7ecd0",
      "focus-ring": "rgba(164, 122, 18, 0.30)",
      shadow: "rgba(28, 25, 18, 0.10)",
      "shadow-card": "0 1px 2px rgba(28, 25, 18, 0.06)",
      "shadow-overlay": "0 18px 44px rgba(28, 25, 18, 0.18)",
    },
    preview: { sidebar: "#ececea", card: "#ffffff", button: "#a47a12", text: "#25231f", border: "#dedbd3" },
  },
  {
    id: "dark",
    name: "M1 Dark",
    description: "Neutral charcoal ERP surfaces with readable dense data.",
    mode: "dark",
    density: "normal",
    variables: {
      ...shared,
      primary: "#dcb03a",
      "primary-hover": "#e9bf4c",
      "primary-active": "#c39a2b",
      bg: "#131211",
      surface: "#1d1c1a",
      card: "#232220",
      text: "#f3f1ec",
      muted: "#a8a399",
      border: "#33312d",
      "border-strong": "#4c4941",
      "primary-soft": "#3a3018",
      success: "#42b883",
      "success-soft": "#183529",
      warning: "#e0a23a",
      "warning-soft": "#3a2d17",
      danger: "#ef6b6b",
      "danger-soft": "#3b2020",
      info: "#82a4c2",
      "info-soft": "#1f2d38",
      "surface-soft": "#191817",
      "surface-raised": "#282623",
      "card-soft": "#191817",
      sidebar: "#171614",
      topbar: "#10100f",
      "topbar-text": "#f4f3ef",
      "text-secondary": "#c9c4ba",
      "text-tertiary": "#948f85",
      "table-head": "#242320",
      "table-hover": "#2a2825",
      "table-selected": "#3f341a",
      "focus-ring": "rgba(220, 176, 58, 0.34)",
      shadow: "rgba(0, 0, 0, 0.32)",
      "shadow-card": "0 1px 2px rgba(0, 0, 0, 0.30)",
      "shadow-overlay": "0 18px 48px rgba(0, 0, 0, 0.42)",
    },
    preview: { sidebar: "#1d1d1b", card: "#232321", button: "#d0a632", text: "#efeee9", border: "#393936" },
  },
];

export const THEME_MAP = Object.fromEntries(THEMES.map((theme) => [theme.id, theme]));
