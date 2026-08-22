// Appearance Studio guards — the profile layer that re-points the M1 tokens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const {
  APPEARANCE_MANAGED_TOKENS,
  APPEARANCE_PRESETS,
  ARABIC_FONTS,
  ARABIC_FONT_MAP,
  CONTROL_PROFILE_MAP,
  DEFAULT_APPEARANCE,
  LATIN_FONTS,
  LATIN_FONT_MAP,
  RADIUS_PROFILE_MAP,
  appearanceVariables,
  googleFontHref,
  isDefaultAppearance,
  normalizeAppearance,
  profileFromPreset,
} = await import("../src/theme/appearance.js");

test("every preset points at fonts and profiles that exist", () => {
  for (const preset of APPEARANCE_PRESETS) {
    assert.ok(ARABIC_FONT_MAP[preset.fontAr], `${preset.id}: unknown Arabic font ${preset.fontAr}`);
    assert.ok(LATIN_FONT_MAP[preset.fontEn], `${preset.id}: unknown Latin font ${preset.fontEn}`);
    assert.ok(RADIUS_PROFILE_MAP[preset.radius], `${preset.id}: unknown radius ${preset.radius}`);
    assert.ok(CONTROL_PROFILE_MAP[preset.controls], `${preset.id}: unknown controls ${preset.controls}`);
    assert.ok(preset.name?.ar && preset.name?.en, `${preset.id}: bilingual name`);
    assert.ok(preset.description?.ar && preset.description?.en, `${preset.id}: bilingual description`);
  }
  const ids = APPEARANCE_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "preset ids must be unique");
});

test("the default profile is the M1 Classic preset and writes no overrides", () => {
  assert.equal(normalizeAppearance(null).preset, "m1-classic");
  assert.ok(isDefaultAppearance(profileFromPreset("m1-classic")));
  assert.ok(isDefaultAppearance(undefined));
  assert.equal(normalizeAppearance(DEFAULT_APPEARANCE).preset, "m1-classic");
});

test("unknown ids fall back silently and the preset label stays honest", () => {
  const profile = normalizeAppearance({ preset: "tajawal-soft", fontAr: "does-not-exist", fontEn: "inter", radius: "round", controls: "comfortable" });
  assert.equal(profile.fontAr, DEFAULT_APPEARANCE.fontAr, "unknown font falls back to Cairo");
  assert.equal(profile.preset, "custom", "axes no longer match the named preset");

  const recovered = normalizeAppearance({ preset: "custom", fontAr: "tajawal", fontEn: "dm-sans", radius: "round", controls: "comfortable" });
  assert.equal(recovered.preset, "tajawal-soft", "a custom combination that equals a preset is labelled as that preset");
});

test("Arabic stacks always keep an Arabic fallback; Latin stacks carry the Arabic face second", () => {
  for (const font of ARABIC_FONTS) {
    const vars = appearanceVariables({ fontAr: font.id, fontEn: "inter" });
    assert.match(vars["font-ar"], /Cairo|Tajawal|Noto Sans Arabic/, `${font.id}: Arabic fallback`);
    assert.ok(vars["font-ar"].startsWith(`"${font.family}"`), `${font.id}: chosen family leads`);
  }
  for (const font of LATIN_FONTS) {
    const vars = appearanceVariables({ fontAr: "almarai", fontEn: font.id });
    assert.match(vars["font-en"], /"Almarai"/, `${font.id}: Arabic content inside the EN UI keeps the chosen Arabic face`);
    if (font.family) assert.ok(vars["font-en"].startsWith(`"${font.family}"`), `${font.id}: chosen family leads`);
    else assert.ok(vars["font-en"].startsWith("system-ui"), "system option uses the OS font");
  }
});

test("profiles only re-point tokens the design system already owns", () => {
  const themes = read("src/theme/themes.js");
  const foundation = read("src/theme/foundation.css");
  for (const token of APPEARANCE_MANAGED_TOKENS) {
    const declared = themes.includes(`"${token}":`) || foundation.includes(`--${token}:`);
    assert.ok(declared, `--${token} is not a token the system declares`);
  }
  // Control heights keep their sm < md < lg relationship in every profile.
  for (const profile of Object.values(CONTROL_PROFILE_MAP)) {
    const px = (key) => Number.parseInt(profile.values[key], 10);
    assert.ok(px("control-height-sm") < px("control-height-md") && px("control-height-md") < px("control-height-lg"), `${profile.id}: sm < md < lg`);
  }
});

test("Google Fonts hrefs are well-formed and the system font loads nothing", () => {
  assert.equal(googleFontHref(LATIN_FONT_MAP.system), null);
  const href = googleFontHref(ARABIC_FONT_MAP["ibm-plex-arabic"]);
  assert.ok(href.startsWith("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@"), href);
  assert.match(href, /display=swap$/);
});

test("the language switch tracks the font tokens instead of freezing a literal stack", () => {
  // i18n.js writes --app-font INLINE on <html>; a literal there would override
  // every font choice on the next language change.
  const i18n = read("src/i18n/i18n.js");
  assert.match(i18n, /var\(--font-ar,/, "Arabic --app-font must read --font-ar");
  assert.match(i18n, /var\(--font-en,/, "English --app-font must read --font-en");
});

test("the store-wide default is registered, public, and hidden from the General form", () => {
  const registry = read("shared/settingsRegistry.js");
  assert.match(registry, /\["general\.appearance_profile", "general", "json"/);
  assert.match(registry, /general\.appearance_profile"[^\n]*isPublic: true/);
  const center = read("src/modules/settings/pages/SettingsCenter.jsx");
  assert.match(center, /"general\.appearance_profile"/, "SettingsCenter must exclude the key from the generic JSON editor");
  const html = read("index.html");
  assert.match(html, /erp\.appearance/, "index.html must seed fonts before React mounts");
});

test("the studio stylesheet owns no literal colour or font stack", () => {
  const css = read("src/modules/settings/pages/AppearanceStudio.m1.css");
  assert.equal((css.match(/#[0-9a-f]{3,8}\b/gi) || []).length, 0, "hex colour in AppearanceStudio.m1.css");
  for (const decl of css.match(/font-family:\s*[^;]+;/g) ?? []) assert.match(decl, /var\(--/);
  assert.equal((css.match(/!important/g) || []).length, 0);
});
