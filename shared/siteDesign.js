// SITE DESIGN — the storefront's look, expressed once, editable from the ERP.
//
// The storefront already had a token vocabulary; it was just hard-coded in three
// stylesheets. This module names those tokens, gives them defaults identical to
// what ships today, and turns a stored record into the CSS that re-points them.
// Nothing here invents a new design system: it re-points the tokens the site is
// already built on, which is why a change reaches every page at once.
//
//   .storefront-shell                  --sf-font-family, --sf-purple, --sf-cream
//   .storefront-dark                   --bg/--surface/--text/--sf-dark-*
//   .storefront-shell:not(.dark)       --sf-light-*
//   .m1h (homepage)                    --m1h-*
//
// Stored as the public setting `storefront.site_design`, so it rides the
// /settings/public payload the storefront already fetches on boot — no new
// endpoint, no extra request.
//
// Pure ESM with no imports on purpose: the settings registry (server), the
// storefront (browser) and the tests all read this one file.

export const SITE_DESIGN_VERSION = 1;
export const SITE_DESIGN_SETTING_KEY = "storefront.site_design";

/* ------------------------------------------------------------------ palette */

// Every colour the studio can move, per mode. The defaults are lifted verbatim
// from the shipped stylesheets, so a freshly-saved untouched record is a no-op.
export const PALETTE_FIELDS = [
  { key: "page", label: { ar: "خلفية الصفحة", en: "Page background" } },
  { key: "surface", label: { ar: "خلفية البطاقات", en: "Card surface" } },
  { key: "surfaceSoft", label: { ar: "خلفية ثانوية", en: "Soft surface" } },
  { key: "border", label: { ar: "الحدود", en: "Border" } },
  { key: "borderStrong", label: { ar: "الحدود القوية", en: "Strong border" } },
  { key: "text", label: { ar: "لون النص", en: "Text" } },
  { key: "textSoft", label: { ar: "نص ثانوي", en: "Secondary text" } },
  { key: "textMuted", label: { ar: "نص خافت", en: "Muted text" } },
  { key: "accent", label: { ar: "اللون الأساسي", en: "Accent" } },
  { key: "accentStrong", label: { ar: "الأساسي الفاتح", en: "Accent highlight" } },
  { key: "accentSoft", label: { ar: "خلفية الأساسي", en: "Accent wash" } },
  { key: "sale", label: { ar: "لون التخفيض", en: "Sale" } },
  { key: "saleText", label: { ar: "نص التخفيض", en: "Sale text" } },
  { key: "invert", label: { ar: "الشرائط الداكنة", en: "Inverted band" } },
  { key: "invertText", label: { ar: "نص الشرائط", en: "Inverted band text" } },
];

export const PALETTE_FIELD_KEYS = PALETTE_FIELDS.map((field) => field.key);

const LIGHT_PALETTE = {
  page: "#f3f3f1",
  surface: "#ffffff",
  surfaceSoft: "#f7f7f5",
  border: "#dedbd3",
  borderStrong: "#c9c5bc",
  text: "#25231f",
  textSoft: "#5d5952",
  textMuted: "#716e67",
  accent: "#a47a12",
  accentStrong: "#d0a632",
  accentSoft: "#fff7df",
  sale: "#b4231b",
  saleText: "#ffffff",
  invert: "#14120f",
  invertText: "#f8f6f1",
};

const DARK_PALETTE = {
  page: "#070707",
  surface: "#101010",
  surfaceSoft: "#151515",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  text: "#efeee9",
  textSoft: "#b9b6ae",
  textMuted: "#8d8981",
  accent: "#d0a632",
  accentStrong: "#e5c469",
  accentSoft: "rgba(208,166,50,0.12)",
  sale: "#e0564c",
  saleText: "#14120f",
  invert: "#f6f5f1",
  invertText: "#14120f",
};

/* ------------------------------------------------------------------- shapes */

// The homepage radius scale. Named profiles rather than four free numbers: the
// four values only look right in proportion to each other.
export const SITE_RADIUS_PROFILES = [
  { id: "sharp", label: { ar: "حاد", en: "Sharp" }, values: { sm: "2px", md: "4px", lg: "6px", xl: "8px", pill: "6px" } },
  { id: "default", label: { ar: "قياسي", en: "Standard" }, values: { sm: "8px", md: "12px", lg: "16px", xl: "20px", pill: "999px" } },
  { id: "soft", label: { ar: "ناعم", en: "Soft" }, values: { sm: "12px", md: "16px", lg: "22px", xl: "28px", pill: "999px" } },
  { id: "round", label: { ar: "دائري", en: "Round" }, values: { sm: "16px", md: "22px", lg: "28px", xl: "36px", pill: "999px" } },
];

export const SITE_RADIUS_PROFILE_MAP = Object.fromEntries(SITE_RADIUS_PROFILES.map((item) => [item.id, item]));

/* --------------------------------------------------------------- hero video */

export const HERO_TEXT_POSITIONS = [
  { id: "bottom", label: { ar: "أسفل", en: "Bottom" } },
  { id: "center", label: { ar: "المنتصف", en: "Middle" } },
];

export const HERO_TEXT_ALIGNMENTS = [
  { id: "start", label: { ar: "بداية السطر", en: "Line start" } },
  { id: "center", label: { ar: "توسيط", en: "Centred" } },
];

const DEFAULT_HERO = {
  enabled: true,
  position: "bottom",
  align: "start",
  eyebrow: { ar: "وصل حديثًا", en: "New arrivals" },
  title: { ar: "خطوة للأمام", en: "Step forward" },
  subtitle: {
    ar: "أحدث الموديلات من أشهر الماركات — حصريًا في متجرنا.",
    en: "Iconic sneakers from top brands — fresh drops, first here.",
  },
  primaryLabel: { ar: "تسوّق الآن", en: "Shop now" },
  primaryHref: "/products?sort=newest",
  secondaryLabel: { ar: "شوف الكل", en: "View all" },
  secondaryHref: "/products",
  textColor: "#ffffff",
  // The scrim is what makes the copy legible over moving footage. It is a
  // bottom-anchored gradient rather than a flat wash so the top of the frame —
  // where the product usually is — stays untouched.
  scrimColor: "#000000",
  scrimOpacity: 0.72,
  scrimHeight: 62,
};

/* --------------------------------------------------------- announcement strip */

// The strip is the first thing on every page and it is NOT on the palette: it is
// black in dark and white in light by an explicit owner decision, and the two
// corner controls (language, theme toggle) take their colour from it. So it gets
// its own two colours per mode rather than following `page`/`surface`.
const DEFAULT_STRIP = {
  enabled: true,
  // Empty means "use the five built-in promises", which are translated. The
  // moment the owner writes their own, those are used verbatim in both
  // languages — a shop that writes its own promises does not want ours.
  items: [],
  light: { background: "#ffffff", text: "#25231f" },
  // Transparent, not black: measured on a fresh load, the dark strip paints no
  // background of its own and the page gradient behind it supplies the near-black
  // (#030303 at the top of the page). Defaulting to a solid colour would have
  // been a change nobody asked for, and would flatten the strip’s backdrop blur.
  dark: { background: "transparent", text: "rgba(248,250,252,0.82)" },
};

export const STRIP_MAX_ITEMS = 8;

/* ------------------------------------------------------------------- footer */

// The footer's own band, plus the copyright bar under it. The bar is a separate
// colour because it is nearly black in both themes today and reads as the page's
// floor rather than as part of the footer.
const DEFAULT_FOOTER = {
  light: { background: "#f5f3ef", text: "#1c1917", bar: "#050505", barText: "#ffffff" },
  dark: { background: "#0b0b0b", text: "#efeee9", bar: "#070707", barText: "#8d8981" },
};

/* --------------------------------------------------- homepage section order */

// The homepage in the order it ships. `id` is the contract with Storefront.jsx —
// renaming one drops that section for every store that already saved an order,
// so the renderer treats an unknown id as "skip" and appends anything new to the
// end (see resolveHomeSections).
//
// The footer is deliberately not in this list: it is the end of the page, not a
// section, and an owner who dragged it to the top would just be reporting a bug.
export const HOME_SECTIONS = [
  { id: "heroVideo", label: { ar: "فيديو المقدمة", en: "Hero video" }, titled: false },
  { id: "productHero", label: { ar: "واجهة المنتجات", en: "Product hero" }, titled: false },
  { id: "categories", label: { ar: "تسوّق حسب القسم", en: "Shop by category" }, titled: true },
  { id: "mostWanted", label: { ar: "الأكثر طلبًا", en: "Most wanted" }, titled: true },
  { id: "newArrivals", label: { ar: "وصل حديثًا", en: "New arrivals" }, titled: true },
  { id: "offers", label: { ar: "العروض", en: "Offers" }, titled: false },
  { id: "brands", label: { ar: "الماركات", en: "Brands" }, titled: false },
  { id: "trust", label: { ar: "شريط الضمانات", en: "Trust strip" }, titled: false },
];

export const HOME_SECTION_MAP = Object.fromEntries(HOME_SECTIONS.map((section) => [section.id, section]));

// Only the three rails carry a visible heading, so only those three are editable.
export const TITLED_HOME_SECTIONS = HOME_SECTIONS.filter((section) => section.titled);

const DEFAULT_SECTION_TITLES = {
  categories: { ar: "تسوّق حسب القسم", en: "Shop by category" },
  mostWanted: { ar: "الأكثر طلبًا", en: "Most wanted" },
  newArrivals: { ar: "وصل حديثًا", en: "New arrivals" },
};

/* ------------------------------------------------------------------ defaults */

export const DEFAULT_SITE_DESIGN = Object.freeze({
  version: SITE_DESIGN_VERSION,
  enabled: true,
  fontAr: "cairo",
  fontEn: "inter",
  radius: "default",
  palette: { light: { ...LIGHT_PALETTE }, dark: { ...DARK_PALETTE } },
  hero: { ...DEFAULT_HERO },
  strip: { ...DEFAULT_STRIP },
  footer: { light: { ...DEFAULT_FOOTER.light }, dark: { ...DEFAULT_FOOTER.dark } },
  sections: HOME_SECTIONS.map((section) => ({ id: section.id, enabled: true })),
  sectionTitles: {
    categories: { ...DEFAULT_SECTION_TITLES.categories },
    mostWanted: { ...DEFAULT_SECTION_TITLES.mostWanted },
    newArrivals: { ...DEFAULT_SECTION_TITLES.newArrivals },
  },
});

/* --------------------------------------------------------------- normalizing */

// A colour arriving from the studio is trusted only as far as it can be proven
// safe: this string lands inside a generated stylesheet, so anything that could
// close a declaration and open a rule has to be refused outright. Hex, rgb(a),
// hsl(a) and a bare CSS keyword are all a palette ever needs.
const COLOR_PATTERN = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z.,%\s/+-]+\s*\)|[a-z]{3,24})$/i;

export const isSafeCssColor = (value) => COLOR_PATTERN.test(String(value ?? "").trim());

const color = (value, fallback) => {
  const text = String(value ?? "").trim();
  return isSafeCssColor(text) ? text : fallback;
};

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

// Storefront links only. An absolute URL here would be an open redirect painted
// across the top of the homepage, so anything that is not a same-site path is
// dropped back to the default.
const internalHref = (value, fallback) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!text.startsWith("/") || text.startsWith("//")) return fallback;
  return text;
};

const text = (value, fallback = "", limit = 160) => {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return fallback;
  return raw.slice(0, limit);
};

// Bilingual copy.
//
// A missing SIDE falls back to the other one, so an owner who only writes Arabic
// does not get English sitting underneath it. A field that is present but
// deliberately emptied stays empty — clearing the headline is how the overlay is
// removed, and a normalizer that helpfully put the shipped headline back would
// make that impossible. Only a field that was never written at all takes the
// default.
const bilingual = (value, fallback, limit = 160) => {
  if (value === undefined || value === null) return { ...fallback };
  const source = typeof value === "object" ? value : {};
  const ar = text(source.ar, "", limit);
  const en = text(source.en, "", limit);
  return { ar: ar || en, en: en || ar };
};

const pickId = (value, map, fallback) => (typeof value === "string" && map[value] ? value : fallback);

const normalizePalette = (input, defaults) => {
  const source = input && typeof input === "object" ? input : {};
  return Object.fromEntries(PALETTE_FIELD_KEYS.map((key) => [key, color(source[key], defaults[key])]));
};

const normalizeHero = (input) => {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled !== false,
    position: pickId(source.position, Object.fromEntries(HERO_TEXT_POSITIONS.map((item) => [item.id, item])), DEFAULT_HERO.position),
    align: pickId(source.align, Object.fromEntries(HERO_TEXT_ALIGNMENTS.map((item) => [item.id, item])), DEFAULT_HERO.align),
    eyebrow: bilingual(source.eyebrow, DEFAULT_HERO.eyebrow, 48),
    title: bilingual(source.title, DEFAULT_HERO.title, 80),
    subtitle: bilingual(source.subtitle, DEFAULT_HERO.subtitle, 200),
    primaryLabel: bilingual(source.primaryLabel, DEFAULT_HERO.primaryLabel, 40),
    primaryHref: internalHref(source.primaryHref, DEFAULT_HERO.primaryHref) || DEFAULT_HERO.primaryHref,
    secondaryLabel: bilingual(source.secondaryLabel, DEFAULT_HERO.secondaryLabel, 40),
    secondaryHref: internalHref(source.secondaryHref, DEFAULT_HERO.secondaryHref),
    textColor: color(source.textColor, DEFAULT_HERO.textColor),
    scrimColor: color(source.scrimColor, DEFAULT_HERO.scrimColor),
    scrimOpacity: clamp(source.scrimOpacity, 0, 1, DEFAULT_HERO.scrimOpacity),
    scrimHeight: clamp(source.scrimHeight, 20, 100, DEFAULT_HERO.scrimHeight),
  };
};

const normalizeBand = (input, defaults) => {
  const source = input && typeof input === "object" ? input : {};
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, color(source[key], defaults[key])]));
};

const normalizeStrip = (input) => {
  const source = input && typeof input === "object" ? input : {};
  const items = Array.isArray(source.items)
    ? source.items
        .map((item) => bilingual(item, { ar: "", en: "" }, 80))
        .filter((item) => item.ar || item.en)
        .slice(0, STRIP_MAX_ITEMS)
    : [];
  return {
    enabled: source.enabled !== false,
    items,
    light: normalizeBand(source.light, DEFAULT_STRIP.light),
    dark: normalizeBand(source.dark, DEFAULT_STRIP.dark),
  };
};

const normalizeFooter = (input) => {
  const source = input && typeof input === "object" ? input : {};
  return {
    light: normalizeBand(source.light, DEFAULT_FOOTER.light),
    dark: normalizeBand(source.dark, DEFAULT_FOOTER.dark),
  };
};

/**
 * The homepage running order.
 *
 * Two rules, both about not losing a section. A stored id that no longer exists
 * is dropped, and a section that exists but is not in the stored list is
 * appended in its shipped position — so adding a new section to HOME_SECTIONS
 * makes it appear for every store that saved an order before it existed, rather
 * than silently never rendering.
 */
const normalizeSections = (input) => {
  const stored = Array.isArray(input) ? input : [];
  const seen = new Set();
  const ordered = [];
  for (const entry of stored) {
    const id = typeof entry === "string" ? entry : String(entry?.id || "");
    if (!HOME_SECTION_MAP[id] || seen.has(id)) continue;
    seen.add(id);
    ordered.push({ id, enabled: typeof entry === "object" && entry !== null ? entry.enabled !== false : true });
  }
  for (const section of HOME_SECTIONS) {
    if (!seen.has(section.id)) ordered.push({ id: section.id, enabled: true });
  }
  return ordered;
};

const normalizeSectionTitles = (input) => {
  const source = input && typeof input === "object" ? input : {};
  return Object.fromEntries(
    TITLED_HOME_SECTIONS.map((section) => [section.id, bilingual(source[section.id], DEFAULT_SECTION_TITLES[section.id], 60)])
  );
};

/**
 * Accepts anything at all — a stored blob, a half-filled form, null — and
 * returns a complete, renderable record. It never throws and never returns a
 * partial: a storefront that cannot trust this would need a fallback at every
 * single read site.
 */
export const normalizeSiteDesign = (input) => {
  const source = input && typeof input === "object" ? input : {};
  const palette = source.palette && typeof source.palette === "object" ? source.palette : {};
  return {
    version: SITE_DESIGN_VERSION,
    enabled: source.enabled !== false,
    fontAr: text(source.fontAr, DEFAULT_SITE_DESIGN.fontAr, 40),
    fontEn: text(source.fontEn, DEFAULT_SITE_DESIGN.fontEn, 40),
    radius: pickId(source.radius, SITE_RADIUS_PROFILE_MAP, DEFAULT_SITE_DESIGN.radius),
    palette: {
      light: normalizePalette(palette.light, LIGHT_PALETTE),
      dark: normalizePalette(palette.dark, DARK_PALETTE),
    },
    hero: normalizeHero(source.hero),
    strip: normalizeStrip(source.strip),
    footer: normalizeFooter(source.footer),
    sections: normalizeSections(source.sections),
    sectionTitles: normalizeSectionTitles(source.sectionTitles),
  };
};

export const isDefaultSiteDesign = (input) =>
  JSON.stringify(normalizeSiteDesign(input)) === JSON.stringify(normalizeSiteDesign(DEFAULT_SITE_DESIGN));

/* ------------------------------------------------------------------- to CSS */

// One palette entry can feed several token names because the same colour is
// spelled differently in each of the three stylesheets the storefront grew out
// of. Re-pointing all of them together is the whole point: miss one and a page
// keeps the old colour for no visible reason.
// The generic token names the ERP theme also owns. They matter on the storefront
// because index.css remaps a set of Tailwind utilities through them
// (`html[data-theme] .text-white { color: var(--text) !important }` and friends),
// so a storefront element carrying a bare `text-white` reads its colour from here.
//
// ⚠️ ThemeProvider writes these INLINE on <html> and <body> (69 custom properties
// measured, 2026-09-05), and an inline declaration beats any stylesheet rule on
// the same element. So the block this map generates is a fallback, not the
// mechanism: the storefront applies these same values inline instead — see
// `sharedPaletteVariables` and its use in src/storefront/lib/siteDesign.js.
const SHARED_TOKENS = {
  page: ["--bg"],
  surface: ["--surface", "--card"],
  surfaceSoft: ["--surface-soft"],
  border: ["--border"],
  text: ["--text"],
  textMuted: ["--muted"],
};

/**
 * The shared tokens as a flat `{ "--name": value }` map for one mode — the
 * values the storefront writes inline on <body> to outrank ThemeProvider.
 */
export const sharedPaletteVariables = (input, mode = "light") => {
  const design = normalizeSiteDesign(input);
  const palette = design.palette[mode === "dark" ? "dark" : "light"];
  const variables = {};
  Object.entries(SHARED_TOKENS).forEach(([field, tokens]) => {
    tokens.forEach((token) => {
      variables[token] = palette[field];
    });
  });
  return variables;
};

const LIGHT_TOKENS = {
  page: ["--sf-light-page", "--sf-light-bg", "--sf-cream"],
  surface: ["--sf-light-surface", "--sf-light-surface-strong"],
  surfaceSoft: ["--sf-light-page-soft", "--sf-light-surface-soft", "--sf-light-soft"],
  border: ["--sf-light-border"],
  borderStrong: ["--sf-light-border-strong"],
  text: ["--sf-light-text"],
  textSoft: ["--sf-light-text-secondary"],
  textMuted: ["--sf-light-muted"],
  accent: ["--sf-light-accent"],
  accentSoft: ["--sf-light-surface-tint"],
};

const DARK_TOKENS = {
  surface: ["--sf-dark-card", "--sf-dark-card-strong"],
  surfaceSoft: ["--sf-dark-nested", "--sf-dark-nested-strong"],
  border: ["--sf-dark-border"],
  borderStrong: ["--sf-dark-border-strong"],
  text: ["--sf-dark-text"],
  textSoft: ["--sf-dark-secondary"],
  textMuted: ["--sf-dark-muted"],
  input: [],
};

// The homepage layer. `--m1h-plate` is deliberately absent: product photography
// is shot on white and the plate stays white in both modes (see home.css).
const HOME_TOKENS = {
  page: ["--m1h-bg"],
  surface: ["--m1h-surface"],
  border: ["--m1h-line"],
  borderStrong: ["--m1h-plate-edge"],
  text: ["--m1h-text"],
  textSoft: ["--m1h-text-2"],
  textMuted: ["--m1h-text-3"],
  accent: ["--m1h-accent"],
  accentSoft: ["--m1h-accent-soft"],
  sale: ["--m1h-sale"],
  saleText: ["--m1h-sale-fg"],
  invert: ["--m1h-invert-bg"],
  invertText: ["--m1h-invert-text"],
};

const declarations = (map, palette, indent = "  ") =>
  Object.entries(map)
    .flatMap(([field, tokens]) => tokens.map((token) => `${indent}${token}: ${palette[field]};`))
    .filter(Boolean);

// `--m1h-line-soft` sits between the line colour and the surface; deriving it
// from the border rather than exposing a 16th swatch keeps the studio honest
// about how many decisions the owner actually has to make.
const homeExtras = (palette, indent = "  ") => [
  `${indent}--m1h-line-soft: ${palette.border};`,
  `${indent}--sf-purple: ${palette.accent};`,
  `${indent}--sf-purple-2: ${palette.accentStrong};`,
  `${indent}--sf-premium-gold: ${palette.accent};`,
  `${indent}--sf-premium-gold-soft: ${palette.accentStrong};`,
];

const block = (selector, lines) => (lines.length ? `${selector} {\n${lines.join("\n")}\n}` : "");

/* --------------------------------------------------------------- hero scrim */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const hexToRgb = (value) => {
  const hex = String(value || "").trim();
  if (!HEX.test(hex)) return null;
  const digits = hex.slice(1);
  const full = digits.length === 3 ? digits.split("").map((d) => d + d).join("") : digits;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
};

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * The scrim gradient, as literal rgba() stops.
 *
 * The alpha ramp is computed here rather than left to `color-mix()` in the
 * stylesheet on purpose: this sheet is injected at runtime, so the build's
 * legacy-colour fallback pass (scripts/legacy-color-fallbacks.mjs) never sees
 * it, and a `color-mix()` an older engine cannot parse would drop the whole
 * declaration — leaving white text on bare footage. rgba() has no such cliff.
 *
 * Three stops, not two: a straight linear ramp reads as a grey bar with an edge,
 * while holding most of the density over the bottom half and easing out early
 * keeps the product in the upper frame untouched.
 */
export const heroScrimImage = (colorValue, opacity) => {
  const alpha = clamp(opacity, 0, 1, DEFAULT_HERO.scrimOpacity);
  const rgb = hexToRgb(colorValue);
  if (!rgb) {
    // A non-hex colour (rgb(), hsl(), a keyword) cannot be given an alpha ramp
    // by string surgery. Ramp to `transparent` instead and let the element's own
    // opacity carry the strength — same result, one less assumption.
    return `linear-gradient(to top, ${colorValue} 0%, ${colorValue} 34%, transparent 100%)`;
  }
  const [r, g, b] = rgb;
  const stop = (fraction, position) => `rgba(${r}, ${g}, ${b}, ${round(alpha * fraction)}) ${position}`;
  return `linear-gradient(to top, ${stop(1, "0%")}, ${stop(0.82, "26%")}, ${stop(0.34, "62%")}, ${stop(0, "100%")})`;
};

const heroScrimOpacity = (colorValue, opacity) =>
  hexToRgb(colorValue) ? 1 : round(clamp(opacity, 0, 1, DEFAULT_HERO.scrimOpacity));

/**
 * A soft halo behind the hero copy, in the scrim's own colour.
 *
 * The scrim handles the frame as a whole; this handles the one bright patch
 * that happens to land behind a word. It is taken from the scrim colour rather
 * than hard-coded black so a light scrim (dark text over pale footage) gets a
 * light halo instead of an outline that fights it.
 */
export const heroTextHalo = (colorValue) => {
  const rgb = hexToRgb(colorValue);
  if (!rgb) return "transparent";
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, 0.45)`;
};

/**
 * The stylesheet a design record produces.
 *
 * Every selector is prefixed with `body.storefront-shell` so it out-specifies
 * the unlayered `.m1h` rules in home.css, and the whole sheet is injected
 * unlayered so it also beats everything inside `@layer components`. Scoping to
 * `.storefront-shell` is what keeps it off the ERP: the class is only on the
 * body while a storefront route is mounted.
 *
 * @param {object} input  a site design record (raw or normalized)
 * @param {{fontAr?: string, fontEn?: string}} [stacks]  resolved font stacks
 * @returns {string} CSS text
 */
export const siteDesignStylesheet = (input, stacks = {}) => {
  const design = normalizeSiteDesign(input);
  if (!design.enabled) return "";
  const light = design.palette.light;
  const dark = design.palette.dark;
  const radius = (SITE_RADIUS_PROFILE_MAP[design.radius] || SITE_RADIUS_PROFILE_MAP.default).values;

  const shell = [
    stacks.fontEn ? `  --sf-font-en: ${stacks.fontEn};` : "",
    stacks.fontAr ? `  --sf-font-ar: ${stacks.fontAr};` : "",
    stacks.fontEn ? "  --sf-font-family: var(--sf-font-en);" : "",
  ].filter(Boolean);

  const rtl = stacks.fontAr
    ? block(
        'html[dir="rtl"] body.storefront-shell,\nhtml[data-language="ar"] body.storefront-shell',
        ["  --sf-font-family: var(--sf-font-ar);"]
      )
    : "";

  const home = [
    `  --m1h-r-sm: ${radius.sm};`,
    `  --m1h-r-md: ${radius.md};`,
    `  --m1h-r-lg: ${radius.lg};`,
    `  --m1h-r-xl: ${radius.xl};`,
  ];

  const hero = [
    `  --sf-hero-text: ${design.hero.textColor};`,
    `  --sf-hero-scrim-image: ${heroScrimImage(design.hero.scrimColor, design.hero.scrimOpacity)};`,
    `  --sf-hero-scrim-opacity: ${heroScrimOpacity(design.hero.scrimColor, design.hero.scrimOpacity)};`,
    `  --sf-hero-scrim-height: ${design.hero.scrimHeight}%;`,
    `  --sf-hero-text-halo: ${heroTextHalo(design.hero.scrimColor)};`,
  ];

  // The strip and the footer are the two bands that are NOT on the palette:
  // both are decided colours (a black-or-white strip, a warm-grey footer) that
  // an owner tunes directly. index.css reads these four variables through
  // `var(… , <today's literal>)`, so an untouched store is unchanged.
  const band = (mode) => [
    `  --sf-strip-bg: ${design.strip[mode].background};`,
    `  --sf-strip-ink: ${design.strip[mode].text};`,
    `  --sf-footer-bg: ${design.footer[mode].background};`,
    `  --sf-footer-ink: ${design.footer[mode].text};`,
    `  --sf-footer-bar-bg: ${design.footer[mode].bar};`,
    `  --sf-footer-bar-ink: ${design.footer[mode].barText};`,
  ];

  return [
    "/* generated from storefront.site_design — edit it in Site Studio, not here */",
    block("body.storefront-shell", [...shell, ...hero]),
    rtl,
    block("body.storefront-shell:not(.storefront-dark)", [
      ...declarations(SHARED_TOKENS, light),
      ...declarations(LIGHT_TOKENS, light),
      ...band("light"),
    ]),
    block("body.storefront-shell.storefront-dark", [
      ...declarations(SHARED_TOKENS, dark),
      ...declarations(DARK_TOKENS, dark),
      ...band("dark"),
    ]),
    block("body.storefront-shell .m1h", [...declarations(HOME_TOKENS, light), ...homeExtras(light), ...home]),
    block('body.storefront-shell .m1h[data-theme="dark"]', [
      ...declarations(HOME_TOKENS, dark),
      ...homeExtras(dark),
    ]),
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * The same token values as a plain style object, for one mode.
 *
 * Site Studio's preview is a panel inside an ERP page, not a storefront
 * document, so the generated stylesheet's `body.storefront-shell` selectors
 * cannot reach it. Feeding the identical values in as inline custom properties
 * on the preview element is what keeps the preview honest — it is the same
 * numbers, not a lookalike.
 *
 * @param {object} input a site design record
 * @param {"light"|"dark"} mode
 */
export const siteDesignPreviewVariables = (input, mode = "light") => {
  const design = normalizeSiteDesign(input);
  const palette = design.palette[mode === "dark" ? "dark" : "light"];
  const radius = (SITE_RADIUS_PROFILE_MAP[design.radius] || SITE_RADIUS_PROFILE_MAP.default).values;
  const variables = {};
  const add = (map) => {
    Object.entries(map).forEach(([field, tokens]) => {
      tokens.forEach((token) => {
        variables[token] = palette[field];
      });
    });
  };
  add(SHARED_TOKENS);
  add(HOME_TOKENS);
  variables["--m1h-line-soft"] = palette.border;
  variables["--m1h-plate"] = palette.surface;
  variables["--sf-purple"] = palette.accent;
  variables["--sf-purple-2"] = palette.accentStrong;
  variables["--m1h-r-sm"] = radius.sm;
  variables["--m1h-r-md"] = radius.md;
  variables["--m1h-r-lg"] = radius.lg;
  variables["--m1h-r-xl"] = radius.xl;
  variables["--sf-hero-text"] = design.hero.textColor;
  variables["--sf-hero-scrim-image"] = heroScrimImage(design.hero.scrimColor, design.hero.scrimOpacity);
  variables["--sf-hero-scrim-opacity"] = heroScrimOpacity(design.hero.scrimColor, design.hero.scrimOpacity);
  variables["--sf-hero-scrim-height"] = `${design.hero.scrimHeight}%`;
  variables["--sf-hero-text-halo"] = heroTextHalo(design.hero.scrimColor);
  const bandMode = mode === "dark" ? "dark" : "light";
  variables["--sf-strip-bg"] = design.strip[bandMode].background;
  variables["--sf-strip-ink"] = design.strip[bandMode].text;
  variables["--sf-footer-bg"] = design.footer[bandMode].background;
  variables["--sf-footer-ink"] = design.footer[bandMode].text;
  variables["--sf-footer-bar-bg"] = design.footer[bandMode].bar;
  variables["--sf-footer-bar-ink"] = design.footer[bandMode].barText;
  return variables;
};

/**
 * The announcement promises for one language.
 *
 * Returns null when the strip is turned off, and an empty array when the owner
 * has written nothing — the caller keeps its own translated defaults in that
 * case, so an untouched store still shows five promises in the reader's
 * language rather than none.
 */
export const resolveStripItems = (input, language = "ar") => {
  const design = normalizeSiteDesign(input);
  if (!design.enabled || !design.strip.enabled) return null;
  const lang = String(language || "ar").toLowerCase().startsWith("en") ? "en" : "ar";
  return design.strip.items.map((item) => String(item[lang] || item.ar || item.en || "").trim()).filter(Boolean);
};

/**
 * The homepage sections to render, in order, already filtered to the visible
 * ones. Ids the renderer does not know are simply not rendered, so a section
 * removed from the code cannot crash a store that still has it in its order.
 */
export const resolveHomeSections = (input) => {
  const design = normalizeSiteDesign(input);
  return design.sections.filter((section) => section.enabled).map((section) => section.id);
};

/** A section's heading in one language, falling back to the shipped wording. */
export const resolveSectionTitle = (input, sectionId, language = "ar") => {
  const design = normalizeSiteDesign(input);
  const lang = String(language || "ar").toLowerCase().startsWith("en") ? "en" : "ar";
  const title = design.sectionTitles[sectionId];
  const fallback = DEFAULT_SECTION_TITLES[sectionId] || { ar: "", en: "" };
  return String(title?.[lang] || title?.ar || title?.en || fallback[lang] || "").trim();
};

/**
 * The hero copy for one language, ready to render. Returns null when the owner
 * turned the overlay off or left the title empty — an unlabelled scrim over the
 * footage is worse than no overlay at all.
 */
export const resolveHeroCopy = (input, language = "ar") => {
  const design = normalizeSiteDesign(input);
  const hero = design.hero;
  if (!design.enabled || !hero.enabled) return null;
  const lang = String(language || "ar").toLowerCase().startsWith("en") ? "en" : "ar";
  const pick = (value) => String(value?.[lang] || value?.ar || value?.en || "").trim();
  const title = pick(hero.title);
  if (!title) return null;
  return {
    eyebrow: pick(hero.eyebrow),
    title,
    subtitle: pick(hero.subtitle),
    primaryLabel: pick(hero.primaryLabel),
    primaryHref: hero.primaryHref,
    secondaryLabel: hero.secondaryHref ? pick(hero.secondaryLabel) : "",
    secondaryHref: hero.secondaryHref,
    position: hero.position,
    align: hero.align,
  };
};

export default {
  DEFAULT_SITE_DESIGN,
  SITE_DESIGN_SETTING_KEY,
  SITE_DESIGN_VERSION,
  normalizeSiteDesign,
  resolveHeroCopy,
  siteDesignStylesheet,
};
