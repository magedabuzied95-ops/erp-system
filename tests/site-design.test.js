// Site Studio writes one record that repaints the whole public storefront, so
// the failure modes worth guarding are the silent ones: a colour that is really
// a CSS injection, an "internal" link that leaves the site, a generated
// stylesheet that loses to home.css and changes nothing, and a token family
// that gets dropped from the mapping so one page keeps the old palette.
//
// Every assertion here is written so that DELETING the code it covers makes it
// fail — a guard that passes against an empty implementation guards nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_SITE_DESIGN,
  PALETTE_FIELD_KEYS,
  SITE_DESIGN_SETTING_KEY,
  heroScrimImage,
  isSafeCssColor,
  normalizeSiteDesign,
  resolveHeroCopy,
  siteDesignPreviewVariables,
  siteDesignStylesheet,
} from "../shared/siteDesign.js";
import { settingsByKey } from "../shared/settingsRegistry.js";

const storefrontSource = readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const stylesheetSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const homeCss = readFileSync(new URL("../src/storefront/home/home.css", import.meta.url), "utf8");

/* --------------------------------------------------------------- the record */

test("a garbage record still normalizes into a complete design", () => {
  for (const input of [null, undefined, 0, "nope", [], { palette: "red" }]) {
    const design = normalizeSiteDesign(input);
    assert.equal(typeof design.hero.title.ar, "string");
    for (const mode of ["light", "dark"]) {
      for (const key of PALETTE_FIELD_KEYS) {
        assert.ok(design.palette[mode][key], `${mode}.${key} is empty for input ${JSON.stringify(input)}`);
      }
    }
  }
});

test("the shipped defaults survive a normalize round trip unchanged", () => {
  assert.deepEqual(normalizeSiteDesign(DEFAULT_SITE_DESIGN), normalizeSiteDesign(normalizeSiteDesign(DEFAULT_SITE_DESIGN)));
});

/* ------------------------------------------------------------ CSS injection */

// The palette lands inside a generated <style>. A value that can close a
// declaration can open a rule anywhere on the page.
test("a colour that could break out of its declaration is refused", () => {
  const attacks = [
    "red; } body { display: none; } .x {",
    "url(javascript:alert(1))",
    "#fff /*",
    "expression(alert(1))",
    "var(--x); background-image: url(https://evil.example/x.png)",
  ];
  for (const attack of attacks) {
    assert.equal(isSafeCssColor(attack), false, `${attack} passed the colour check`);
    const design = normalizeSiteDesign({ palette: { light: { page: attack } } });
    assert.equal(design.palette.light.page, DEFAULT_SITE_DESIGN.palette.light.page);
    assert.ok(!siteDesignStylesheet(design).includes("display: none"));
  }
});

test("real colour notations are accepted", () => {
  for (const value of ["#fff", "#a47a12", "#a47a12ff", "rgba(255,255,255,0.08)", "hsl(40 80% 50%)", "transparent"]) {
    assert.equal(isSafeCssColor(value), true, `${value} was refused`);
  }
});

/* ------------------------------------------------------------- hero linking */

// The hero buttons sit across the top of the homepage. An absolute URL here
// would be an open redirect painted over the store's own front door.
test("a hero button cannot be pointed off-site", () => {
  for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)", "http://x.test/y"]) {
    const design = normalizeSiteDesign({ hero: { primaryHref: href, secondaryHref: href } });
    assert.equal(design.hero.primaryHref, DEFAULT_SITE_DESIGN.hero.primaryHref, `${href} was kept as primary`);
    assert.equal(design.hero.secondaryHref, DEFAULT_SITE_DESIGN.hero.secondaryHref, `${href} was kept as secondary`);
  }
  assert.equal(normalizeSiteDesign({ hero: { primaryHref: "/offers" } }).hero.primaryHref, "/offers");
});

test("a hero with no headline renders nothing rather than a bare scrim", () => {
  assert.equal(resolveHeroCopy({ hero: { title: { ar: "", en: "" }, eyebrow: { ar: "x", en: "x" } } }, "ar"), null);
  assert.equal(resolveHeroCopy({ hero: { enabled: false } }, "ar"), null);
  assert.equal(resolveHeroCopy({ enabled: false }, "ar"), null);
});

test("copy written in one language only is shown in both", () => {
  const design = normalizeSiteDesign({ hero: { title: { ar: "عرض الصيف", en: "" } } });
  assert.equal(design.hero.title.en, "عرض الصيف");
  assert.equal(resolveHeroCopy(design, "en").title, "عرض الصيف");
});

/* --------------------------------------------------------------- the scrim */

// The scrim is what makes the copy legible over moving footage. It is computed
// as literal rgba() rather than color-mix() because this sheet is injected at
// runtime and never sees the build's legacy-colour fallback pass.
test("the scrim gradient is plain rgba, never color-mix or oklch", () => {
  const css = siteDesignStylesheet(DEFAULT_SITE_DESIGN);
  assert.ok(css.includes("--sf-hero-scrim-image"), "the scrim variable is missing");
  assert.ok(/rgba\(/.test(css), "the scrim is not expressed in rgba");
  assert.ok(!/color-mix\(|oklch\(|oklab\(/.test(css), "the generated sheet uses a colour function older engines drop");
});

test("scrim strength actually reaches the gradient", () => {
  const weak = heroScrimImage("#000000", 0.2);
  const strong = heroScrimImage("#000000", 0.9);
  assert.notEqual(weak, strong);
  assert.ok(strong.includes("0.9"), `expected the full strength in ${strong}`);
  // Bottom-anchored: the last stop is fully transparent so the top of the
  // frame — where the product is — is never veiled.
  assert.ok(/rgba\(0, 0, 0, 0\) 100%\)$/.test(strong), `the ramp does not clear by the top: ${strong}`);
});

test("a non-hex scrim colour still produces a usable gradient", () => {
  const css = siteDesignStylesheet({ ...DEFAULT_SITE_DESIGN, hero: { ...DEFAULT_SITE_DESIGN.hero, scrimColor: "rgb(20, 18, 15)", scrimOpacity: 0.5 } });
  assert.ok(css.includes("linear-gradient"), "no gradient was produced");
  // rgba() surgery is impossible on that notation, so the element's own opacity
  // has to carry the strength instead.
  assert.ok(/--sf-hero-scrim-opacity: 0\.5;/.test(css), "the strength was silently dropped");
});

/* ---------------------------------------------------- the generated sheet */

test("the generated sheet out-specifies the homepage's own tokens", () => {
  // home.css declares --m1h-* on `.m1h` and `.m1h[data-theme="dark"]`, unlayered.
  assert.ok(homeCss.includes(".m1h[data-theme=\"dark\"] {"), "home.css no longer declares the dark tokens this way");
  const css = siteDesignStylesheet(DEFAULT_SITE_DESIGN);
  assert.ok(css.includes("body.storefront-shell .m1h {"), "the light homepage block lost its body prefix");
  assert.ok(css.includes("body.storefront-shell .m1h[data-theme=\"dark\"] {"), "the dark homepage block lost its body prefix");
  // Every selector must be scoped to the storefront body: an unscoped rule
  // would repaint the ERP too.
  for (const selector of css.split("\n").filter((line) => line.endsWith(" {"))) {
    assert.ok(/body\.storefront-shell/.test(selector), `unscoped selector would leak into the ERP: ${selector}`);
  }
});

test("every token family the storefront paints from is re-pointed", () => {
  const css = siteDesignStylesheet(DEFAULT_SITE_DESIGN, { fontAr: '"Cairo"', fontEn: '"Inter"' });
  // One representative token per stylesheet the storefront grew out of. Missing
  // any one of them is exactly the bug where a page keeps the old colour.
  for (const token of ["--sf-light-page", "--sf-dark-card", "--m1h-bg", "--m1h-accent", "--sf-purple", "--sf-font-family", "--m1h-r-lg"]) {
    assert.ok(css.includes(`${token}:`), `${token} is no longer re-pointed`);
  }
});

test("turning the design off emits no CSS at all", () => {
  assert.equal(siteDesignStylesheet({ ...DEFAULT_SITE_DESIGN, enabled: false }), "");
});

test("the preview is fed the same values as the live sheet", () => {
  const design = normalizeSiteDesign({ palette: { light: { accent: "#ff0000" } } });
  const preview = siteDesignPreviewVariables(design, "light");
  assert.equal(preview["--m1h-accent"], "#ff0000");
  assert.ok(siteDesignStylesheet(design).includes("--m1h-accent: #ff0000;"));
});

/* ------------------------------------------------------------- the wiring */

test("the design is stored as a public setting the storefront can read", () => {
  const definition = settingsByKey[SITE_DESIGN_SETTING_KEY];
  assert.ok(definition, `${SITE_DESIGN_SETTING_KEY} is not in the settings registry`);
  assert.equal(definition.isPublic, true, "the storefront reads this from /settings/public and cannot authenticate");
  assert.equal(definition.category, "storefront");
});

test("the hero overlay is rendered and the video stays out of the reading order", () => {
  assert.ok(storefrontSource.includes("<StorefrontHeroVideoOverlay />"), "the overlay is no longer mounted on the hero");
  assert.ok(
    storefrontSource.includes("function StorefrontHeroVideoOverlay()"),
    "StorefrontHeroVideoOverlay is gone"
  );
  const start = storefrontSource.indexOf("function StorefrontHeroVideo()");
  const component = storefrontSource.slice(start, storefrontSource.indexOf("function StorefrontHeroVideoOverlay()"));
  // The clip is scenery; the copy on top of it is not. aria-hidden has to sit on
  // the <video>, not on the container, or the headline and buttons disappear
  // from every screen reader.
  assert.ok(/aria-hidden="true"[\s\S]{0,200}onCanPlay/.test(component), "the video lost its aria-hidden");
  assert.ok(
    !/<div className="sf-hero-video" aria-hidden/.test(component),
    "aria-hidden is back on the hero container, which hides the overlay copy from screen readers"
  );
});

test("the overlay stylesheet is shared with Site Studio's preview", () => {
  assert.ok(
    stylesheetSource.includes(":is(.storefront-shell, .sf-hero-preview) .sf-hero-video__overlay"),
    "the preview no longer renders through the real hero rules"
  );
  assert.ok(stylesheetSource.includes(".sf-hero-video__scrim"), "the scrim rule is gone");
  assert.ok(
    stylesheetSource.includes("--sf-hero-scrim-image,"),
    "the scrim no longer reads the studio's gradient"
  );
});

test("the overlay uses logical sides so Arabic and English both read correctly", () => {
  const start = stylesheetSource.indexOf(".sf-hero-video__overlay {");
  const end = stylesheetSource.indexOf(".sf-hero-video__cta--ghost");
  const block = stylesheetSource.slice(start, end);
  assert.ok(block.length > 200, "the overlay CSS block was not found");
  for (const physical of ["padding-left:", "padding-right:", "margin-left:", "margin-right:", "text-align: left", "text-align: right"]) {
    assert.ok(!block.includes(physical), `the overlay uses a physical side (${physical}), which breaks one of the two directions`);
  }
  assert.ok(block.includes("text-align: start"), "the copy no longer follows the document direction");
});
