// Appearance profiles — the user-tunable layer on top of the M1 token system.
//
// themes.js owns the colour palettes and the default shape/typography tokens.
// An appearance profile does NOT invent new tokens; it re-points the handful of
// tokens the whole product is already built on:
//
//   --font-ar / --font-en              (1 source, every page derives --app-font)
//   --radius-control / --radius-card   (1,640 + 1,313 consumers)
//   --radius-xs … --radius-xl
//   --control-height-sm/md/lg          (860+ consumers; every button/input)
//
// So changing a profile restyles every surface that follows the design system,
// and nothing else. Colours stay M1 gold on purpose: the product has one accent
// (see ACCENTS in themes.js) and light/dark remain the only two palettes.

export const APPEARANCE_VERSION = 1;

const GOOGLE_FONTS_BASE = "https://fonts.googleapis.com/css2";

// `family` is the exact Google Fonts family name (also used for the CSS stack).
// `weights` are requested from Google; every family here ships at least 400/700.
// `stack` is what actually lands in the CSS variable. Arabic stacks keep
// Cairo/Tajawal as fallbacks so nothing ever renders in a Latin-only face; the
// Latin stacks keep the chosen Arabic face second so customer names and
// messages never change typeface when the UI language is English.
export const ARABIC_FONTS = [
  { id: "cairo", family: "Cairo", name: "Cairo", weights: [400, 500, 600, 700, 800], note: { ar: "الخط الافتراضي لـ M1 — متوازن وواضح", en: "M1 default — balanced and crisp" } },
  { id: "tajawal", family: "Tajawal", name: "Tajawal", weights: [400, 500, 700, 800], note: { ar: "ناعم ومفتوح، مريح للقوائم الطويلة", en: "Soft and open, easy on long lists" } },
  { id: "almarai", family: "Almarai", name: "Almarai", weights: [400, 700, 800], note: { ar: "هندسي مضغوط، ممتاز للجداول", en: "Geometric and compact, great for tables" } },
  { id: "ibm-plex-arabic", family: "IBM Plex Sans Arabic", name: "IBM Plex Sans Arabic", weights: [400, 500, 600, 700], note: { ar: "طابع مكتبي رسمي", en: "Formal office character" } },
  { id: "noto-kufi", family: "Noto Kufi Arabic", name: "Noto Kufi Arabic", weights: [400, 500, 600, 700, 800], note: { ar: "كوفي حديث بحواف نظيفة", en: "Modern Kufi with clean edges" } },
  { id: "noto-sans-arabic", family: "Noto Sans Arabic", name: "Noto Sans Arabic", weights: [400, 500, 600, 700, 800], note: { ar: "محايد وعالي الوضوح", en: "Neutral, highly legible" } },
  { id: "readex", family: "Readex Pro", name: "Readex Pro", weights: [400, 500, 600, 700], note: { ar: "واسع ومريح للقراءة الطويلة", en: "Wide and relaxed for long reading" } },
  { id: "alexandria", family: "Alexandria", name: "Alexandria", weights: [400, 500, 600, 700, 800], note: { ar: "عصري بشخصية قوية", en: "Contemporary with strong personality" } },
  { id: "rubik", family: "Rubik", name: "Rubik", weights: [400, 500, 600, 700, 800], note: { ar: "خط واحد للعربي والإنجليزي", en: "One family for both scripts" } },
  { id: "changa", family: "Changa", name: "Changa", weights: [400, 500, 600, 700, 800], note: { ar: "مضغوط بطابع عرضي", en: "Condensed display feel" } },
];

export const LATIN_FONTS = [
  { id: "inter", family: "Inter", name: "Inter", weights: [400, 500, 600, 700], note: { ar: "الافتراضي — واجهات الأعمال", en: "Default — business UI standard" } },
  { id: "manrope", family: "Manrope", name: "Manrope", weights: [400, 500, 600, 700, 800], note: { ar: "حديث ومستدير قليلًا", en: "Modern, slightly rounded" } },
  { id: "ibm-plex", family: "IBM Plex Sans", name: "IBM Plex Sans", weights: [400, 500, 600, 700], note: { ar: "زوج طبيعي لـ Plex Arabic", en: "Natural pair for Plex Arabic" } },
  { id: "dm-sans", family: "DM Sans", name: "DM Sans", weights: [400, 500, 600, 700], note: { ar: "هندسي ودود", en: "Friendly geometric" } },
  { id: "plus-jakarta", family: "Plus Jakarta Sans", name: "Plus Jakarta Sans", weights: [400, 500, 600, 700, 800], note: { ar: "عريض ومريح", en: "Wide and airy" } },
  { id: "roboto", family: "Roboto", name: "Roboto", weights: [400, 500, 700], note: { ar: "كلاسيكي للشاشات الكثيفة", en: "Classic for dense screens" } },
  { id: "open-sans", family: "Open Sans", name: "Open Sans", weights: [400, 500, 600, 700, 800], note: { ar: "محايد وعالي الوضوح", en: "Neutral, highly legible" } },
  { id: "source-sans", family: "Source Sans 3", name: "Source Sans 3", weights: [400, 500, 600, 700], note: { ar: "مضغوط قليلًا، جيد للجداول", en: "Slightly narrow, good for tables" } },
  { id: "nunito-sans", family: "Nunito Sans", name: "Nunito Sans", weights: [400, 500, 600, 700, 800], note: { ar: "ناعم ومستدير", en: "Soft and rounded" } },
  { id: "poppins", family: "Poppins", name: "Poppins", weights: [400, 500, 600, 700], note: { ar: "جريء بشخصية واضحة", en: "Bold with clear personality" } },
  { id: "rubik", family: "Rubik", name: "Rubik", weights: [400, 500, 600, 700, 800], note: { ar: "خط واحد للعربي والإنجليزي", en: "One family for both scripts" } },
  { id: "system", family: null, name: "System UI", weights: [], note: { ar: "خط نظام التشغيل — بدون تحميل", en: "OS font — nothing to download" } },
];

export const ARABIC_FONT_MAP = Object.fromEntries(ARABIC_FONTS.map((font) => [font.id, font]));
export const LATIN_FONT_MAP = Object.fromEntries(LATIN_FONTS.map((font) => [font.id, font]));

// Shape profiles re-point the radius scale. `control` and `card` are the two
// derived aliases foundation.css builds from md/lg; they are set explicitly so
// a "round" profile can give pill controls without 28px card corners.
export const RADIUS_PROFILES = [
  { id: "sharp", label: { ar: "حاد", en: "Sharp" }, values: { "radius-xs": "2px", "radius-sm": "4px", "radius-md": "6px", "radius-lg": "8px", "radius-xl": "10px", "radius-control": "6px", "radius-card": "8px" } },
  { id: "default", label: { ar: "قياسي", en: "Standard" }, values: { "radius-xs": "4px", "radius-sm": "7px", "radius-md": "10px", "radius-lg": "14px", "radius-xl": "18px", "radius-control": "10px", "radius-card": "14px" } },
  { id: "soft", label: { ar: "ناعم", en: "Soft" }, values: { "radius-xs": "6px", "radius-sm": "10px", "radius-md": "14px", "radius-lg": "18px", "radius-xl": "22px", "radius-control": "14px", "radius-card": "18px" } },
  { id: "round", label: { ar: "دائري", en: "Round" }, values: { "radius-xs": "8px", "radius-sm": "12px", "radius-md": "18px", "radius-lg": "22px", "radius-xl": "28px", "radius-control": "999px", "radius-card": "22px" } },
];

// Control-size profiles re-point the three control heights together so the
// sm/md/lg relationship every page relies on is preserved.
export const CONTROL_PROFILES = [
  { id: "compact", label: { ar: "مضغوط", en: "Compact" }, values: { "control-height-sm": "28px", "control-height-md": "34px", "control-height-lg": "40px" } },
  { id: "default", label: { ar: "قياسي", en: "Standard" }, values: { "control-height-sm": "32px", "control-height-md": "38px", "control-height-lg": "44px" } },
  { id: "comfortable", label: { ar: "مريح", en: "Comfortable" }, values: { "control-height-sm": "36px", "control-height-md": "42px", "control-height-lg": "50px" } },
];

export const RADIUS_PROFILE_MAP = Object.fromEntries(RADIUS_PROFILES.map((item) => [item.id, item]));
export const CONTROL_PROFILE_MAP = Object.fromEntries(CONTROL_PROFILES.map((item) => [item.id, item]));

// Named pairings. Mode (light/dark) is deliberately NOT part of a preset: the
// palettes are an independent axis and the user toggles them from the top bar
// too. A preset is fonts + shape + size + density.
export const APPEARANCE_PRESETS = [
  { id: "m1-classic", name: { ar: "M1 الكلاسيكي", en: "M1 Classic" }, description: { ar: "Cairo مع Inter — الهوية الأصلية للنظام", en: "Cairo with Inter — the original product identity" }, fontAr: "cairo", fontEn: "inter", radius: "default", controls: "default", density: "normal" },
  { id: "kufi-modern", name: { ar: "كوفي حديث", en: "Kufi Modern" }, description: { ar: "Noto Kufi مع Manrope — حواف ناعمة وشخصية معاصرة", en: "Noto Kufi with Manrope — soft edges, contemporary voice" }, fontAr: "noto-kufi", fontEn: "manrope", radius: "soft", controls: "default", density: "normal" },
  { id: "plex-office", name: { ar: "مكتب Plex", en: "Plex Office" }, description: { ar: "IBM Plex للعربي والإنجليزي — حاد ومضغوط للمحاسبة", en: "IBM Plex in both scripts — sharp and dense for accounting" }, fontAr: "ibm-plex-arabic", fontEn: "ibm-plex", radius: "sharp", controls: "compact", density: "compact" },
  { id: "tajawal-soft", name: { ar: "تجوال الناعم", en: "Tajawal Soft" }, description: { ar: "Tajawal مع DM Sans — أزرار دائرية ومساحات مريحة", en: "Tajawal with DM Sans — pill buttons and relaxed spacing" }, fontAr: "tajawal", fontEn: "dm-sans", radius: "round", controls: "comfortable", density: "normal" },
  { id: "almarai-focus", name: { ar: "المراعي المركّز", en: "Almarai Focus" }, description: { ar: "Almarai مع Roboto — للشاشات الكثيفة والكاشير", en: "Almarai with Roboto — for dense screens and the POS" }, fontAr: "almarai", fontEn: "roboto", radius: "default", controls: "compact", density: "compact" },
  { id: "readex-airy", name: { ar: "ريدكس الواسع", en: "Readex Airy" }, description: { ar: "Readex Pro مع Plus Jakarta — قراءة مريحة وعناصر أكبر", en: "Readex Pro with Plus Jakarta — relaxed reading, larger controls" }, fontAr: "readex", fontEn: "plus-jakarta", radius: "soft", controls: "comfortable", density: "normal" },
  { id: "alexandria-bold", name: { ar: "إسكندرية الجريء", en: "Alexandria Bold" }, description: { ar: "Alexandria مع Poppins — شخصية قوية للعلامة", en: "Alexandria with Poppins — strong brand personality" }, fontAr: "alexandria", fontEn: "poppins", radius: "soft", controls: "default", density: "normal" },
  { id: "rubik-unified", name: { ar: "روبيك الموحّد", en: "Rubik Unified" }, description: { ar: "Rubik للعربي والإنجليزي — خط واحد للكل", en: "Rubik in both scripts — one family everywhere" }, fontAr: "rubik", fontEn: "rubik", radius: "default", controls: "default", density: "normal" },
];

export const APPEARANCE_PRESET_MAP = Object.fromEntries(APPEARANCE_PRESETS.map((item) => [item.id, item]));

export const DEFAULT_APPEARANCE = Object.freeze({
  version: APPEARANCE_VERSION,
  preset: "m1-classic",
  fontAr: "cairo",
  fontEn: "inter",
  radius: "default",
  controls: "default",
});

const pick = (value, map, fallback) => (typeof value === "string" && map[value] ? value : fallback);

// Accepts anything (stored JSON, a tenant setting, a preset) and returns a
// complete, valid profile. Unknown ids fall back to the default silently: a
// removed font must never leave the UI without a typeface.
export const normalizeAppearance = (input) => {
  const source = input && typeof input === "object" ? input : {};
  const profile = {
    version: APPEARANCE_VERSION,
    preset: source.preset === "custom" ? "custom" : pick(source.preset, APPEARANCE_PRESET_MAP, DEFAULT_APPEARANCE.preset),
    fontAr: pick(source.fontAr, ARABIC_FONT_MAP, DEFAULT_APPEARANCE.fontAr),
    fontEn: pick(source.fontEn, LATIN_FONT_MAP, DEFAULT_APPEARANCE.fontEn),
    radius: pick(source.radius, RADIUS_PROFILE_MAP, DEFAULT_APPEARANCE.radius),
    controls: pick(source.controls, CONTROL_PROFILE_MAP, DEFAULT_APPEARANCE.controls),
  };
  // Keep `preset` honest: it is only a label for the combination that is
  // actually active. If the axes no longer match the named preset, it is custom.
  const named = APPEARANCE_PRESET_MAP[profile.preset];
  if (!named || named.fontAr !== profile.fontAr || named.fontEn !== profile.fontEn || named.radius !== profile.radius || named.controls !== profile.controls) {
    profile.preset = matchPreset(profile) || "custom";
  }
  return profile;
};

export const matchPreset = (profile) => {
  const hit = APPEARANCE_PRESETS.find(
    (preset) => preset.fontAr === profile.fontAr && preset.fontEn === profile.fontEn && preset.radius === profile.radius && preset.controls === profile.controls
  );
  return hit ? hit.id : null;
};

export const profileFromPreset = (presetId) => {
  const preset = APPEARANCE_PRESET_MAP[presetId] || APPEARANCE_PRESET_MAP[DEFAULT_APPEARANCE.preset];
  return normalizeAppearance({ preset: preset.id, fontAr: preset.fontAr, fontEn: preset.fontEn, radius: preset.radius, controls: preset.controls });
};

export const isDefaultAppearance = (profile) => {
  const normalized = normalizeAppearance(profile);
  return (
    normalized.fontAr === DEFAULT_APPEARANCE.fontAr &&
    normalized.fontEn === DEFAULT_APPEARANCE.fontEn &&
    normalized.radius === DEFAULT_APPEARANCE.radius &&
    normalized.controls === DEFAULT_APPEARANCE.controls
  );
};

export const appearanceEquals = (a, b) => {
  const left = normalizeAppearance(a);
  const right = normalizeAppearance(b);
  return left.fontAr === right.fontAr && left.fontEn === right.fontEn && left.radius === right.radius && left.controls === right.controls;
};

const quote = (family) => `"${family}"`;

export const arabicFontStack = (fontId) => {
  const font = ARABIC_FONT_MAP[fontId] || ARABIC_FONT_MAP[DEFAULT_APPEARANCE.fontAr];
  const fallbacks = ["Cairo", "Tajawal", "Noto Sans Arabic"].filter((name) => name !== font.family).map(quote);
  return [quote(font.family), ...fallbacks, "sans-serif"].join(", ");
};

export const latinFontStack = (fontEnId, fontArId) => {
  const latin = LATIN_FONT_MAP[fontEnId] || LATIN_FONT_MAP[DEFAULT_APPEARANCE.fontEn];
  const arabic = ARABIC_FONT_MAP[fontArId] || ARABIC_FONT_MAP[DEFAULT_APPEARANCE.fontAr];
  const head = latin.family ? [quote(latin.family)] : ["system-ui", "-apple-system"];
  // The Arabic face rides second on purpose (see themes.js `font-en`): Arabic
  // customer content must not change typeface when the shell language is EN.
  const fallbacks = [arabic.family, "Cairo", "Tajawal", "Noto Sans Arabic"].filter((name, index, list) => list.indexOf(name) === index).map(quote);
  return [...head, ...fallbacks, '"Segoe UI"', "sans-serif"].join(", ");
};

// Token values a profile produces. ThemeProvider writes these after the theme
// palette so they override the shared defaults in themes.js.
export const appearanceVariables = (input) => {
  const profile = normalizeAppearance(input);
  return {
    "font-ar": arabicFontStack(profile.fontAr),
    "font-en": latinFontStack(profile.fontEn, profile.fontAr),
    ...RADIUS_PROFILE_MAP[profile.radius].values,
    ...CONTROL_PROFILE_MAP[profile.controls].values,
  };
};

// Every token an appearance profile may touch. ThemeProvider clears exactly
// this set when a profile is reset so the stylesheet defaults come back.
export const APPEARANCE_MANAGED_TOKENS = Array.from(
  new Set([
    "font-ar",
    "font-en",
    ...RADIUS_PROFILES.flatMap((item) => Object.keys(item.values)),
    ...CONTROL_PROFILES.flatMap((item) => Object.keys(item.values)),
  ])
);

/* ----------------------------------------------------------- font loading */

export const googleFontHref = (font) => {
  if (!font?.family) return null;
  const weights = font.weights?.length ? font.weights.join(";") : "400;700";
  const family = encodeURIComponent(font.family).replace(/%20/g, "+");
  return `${GOOGLE_FONTS_BASE}?family=${family}:wght@${weights}&display=swap`;
};

const FONT_LINK_ATTR = "data-erp-font";

// Idempotent: one <link> per family for the lifetime of the document. Cairo and
// Inter are already imported by foundation.css, so they are skipped.
const PRELOADED_FAMILIES = new Set(["Cairo", "Inter"]);

export const ensureFontLoaded = (font) => {
  if (typeof document === "undefined" || !font?.family) return;
  if (PRELOADED_FAMILIES.has(font.family)) return;
  const href = googleFontHref(font);
  if (!href) return;
  const key = `${font.family}`;
  // Either this module or the index.html seed may already have added it.
  const existing = Array.from(document.head.querySelectorAll("link[rel=\"stylesheet\"]")).some(
    (link) => link.getAttribute(FONT_LINK_ATTR) === key || link.getAttribute("href") === href
  );
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(FONT_LINK_ATTR, key);
  document.head.appendChild(link);
};

export const ensureProfileFontsLoaded = (input) => {
  const profile = normalizeAppearance(input);
  ensureFontLoaded(ARABIC_FONT_MAP[profile.fontAr]);
  ensureFontLoaded(LATIN_FONT_MAP[profile.fontEn]);
};

// The studio shows every family as a live specimen, so it loads the whole
// catalogue once on mount. Deduplicated by family (Rubik appears in both lists).
export const ensureCatalogFontsLoaded = () => {
  const seen = new Set();
  [...ARABIC_FONTS, ...LATIN_FONTS].forEach((font) => {
    if (!font.family || seen.has(font.family)) return;
    seen.add(font.family);
    ensureFontLoaded(font);
  });
};
