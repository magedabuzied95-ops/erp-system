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
  CARD_TEMPLATES,
  DEFAULT_SITE_DESIGN,
  HOME_SECTIONS,
  PALETTE_FIELD_KEYS,
  SITE_DESIGN_SETTING_KEY,
  heroScrimImage,
  isSafeCssColor,
  normalizeSiteDesign,
  STRIP_MAX_ITEMS,
  resolveCardLook,
  resolveHeroCopy,
  resolveHomeSections,
  resolveSectionTitle,
  resolveStripItems,
  sharedPaletteVariables,
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
  // the <video> element itself, not on the container, or the headline and the
  // buttons disappear from every screen reader. Read off the <video> tag rather
  // than a neighbouring prop: this guard once pinned `onCanPlay`, and renaming
  // the media event that marks the clip ready broke it for no real reason.
  const videoStart = component.indexOf("<video");
  const videoTag = component.slice(videoStart, component.indexOf("/>", videoStart));
  assert.ok(videoStart !== -1 && videoTag.length > 40, "the <video> element is gone from the hero");
  assert.ok(videoTag.includes('aria-hidden="true"'), "the video lost its aria-hidden");
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

/* ------------------------------------------- strip, footer, section order */

test("the shipped section order round-trips, and an unknown id cannot blank the homepage", () => {
  const shipped = normalizeSiteDesign(DEFAULT_SITE_DESIGN).sections.map((section) => section.id);
  assert.deepEqual(resolveHomeSections(DEFAULT_SITE_DESIGN), shipped);
  // A stored id the code no longer has is dropped, not rendered as a hole.
  const stale = normalizeSiteDesign({ sections: [{ id: "ghostSection" }, { id: "categories" }] });
  assert.ok(!stale.sections.some((section) => section.id === "ghostSection"));
  // ...and a section the code HAS but the stored order does not is appended, so
  // adding a section to the code makes it appear for stores that saved earlier.
  assert.deepEqual(new Set(stale.sections.map((s) => s.id)), new Set(shipped));
  assert.equal(stale.sections[0].id, "categories", "the stored order lost its first entry");
});

test("hiding a section removes it from the render list and nothing else", () => {
  const design = normalizeSiteDesign({ sections: [{ id: "heroVideo", enabled: false }] });
  const visible = resolveHomeSections(design);
  assert.ok(!visible.includes("heroVideo"));
  assert.equal(design.sections.length, HOME_SECTIONS.length, "a hidden section must stay in the stored order");
  assert.ok(visible.includes("productHero"));
});

test("a reordered list is preserved exactly", () => {
  const design = normalizeSiteDesign({
    sections: [{ id: "categories" }, { id: "heroVideo" }, { id: "productHero" }],
  });
  assert.deepEqual(design.sections.slice(0, 3).map((s) => s.id), ["categories", "heroVideo", "productHero"]);
});

test("a section heading falls back to the shipped wording, never to an empty heading", () => {
  assert.equal(resolveSectionTitle(DEFAULT_SITE_DESIGN, "categories", "en"), "Shop by category");
  assert.equal(resolveSectionTitle({ sectionTitles: { categories: { ar: "", en: "" } } }, "categories", "en"), "Shop by category");
  assert.equal(resolveSectionTitle({ sectionTitles: { categories: { ar: "الأقسام", en: "" } } }, "categories", "en"), "الأقسام");
});

test("an empty promise list means 'use the built-in ones', not 'show nothing'", () => {
  // The caller distinguishes the two by null vs []; collapsing them would either
  // strand a store with no promises or make the off switch impossible.
  assert.deepEqual(resolveStripItems(DEFAULT_SITE_DESIGN, "ar"), []);
  assert.equal(resolveStripItems({ strip: { enabled: false } }, "ar"), null);
  const own = resolveStripItems({ strip: { items: [{ ar: "شحن مجاني", en: "Free shipping" }] } }, "en");
  assert.deepEqual(own, ["Free shipping"]);
});

test("the promise list is bounded and drops blank rows", () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ ar: `عرض ${index}`, en: `Deal ${index}` }));
  assert.equal(normalizeSiteDesign({ strip: { items: many } }).strip.items.length, STRIP_MAX_ITEMS);
  assert.equal(normalizeSiteDesign({ strip: { items: [{ ar: "", en: "" }, { ar: "x", en: "x" }] } }).strip.items.length, 1);
});

test("the strip and footer are painted from variables the stylesheet sets", () => {
  const css = siteDesignStylesheet(DEFAULT_SITE_DESIGN);
  for (const token of ["--sf-strip-bg", "--sf-strip-ink", "--sf-footer-bg", "--sf-footer-ink", "--sf-footer-bar-bg", "--sf-footer-bar-ink"]) {
    assert.ok(css.includes(`${token}:`), `${token} is not written by the generated sheet`);
    assert.ok(stylesheetSource.includes(`var(${token},`), `index.css does not read ${token} with a fallback`);
  }
});

// The dark strip paints no background of its own today — the page gradient
// behind it supplies the near-black. A solid default would have been a silent
// visual change and would have flattened the strip's backdrop blur.
test("the dark strip stays transparent by default", () => {
  assert.equal(normalizeSiteDesign(DEFAULT_SITE_DESIGN).strip.dark.background, "transparent");
});

// `.sf-footer__bar` carries Tailwind's `text-white`, which index.css repoints at
// var(--text) — the ERP's near-black, written inline by ThemeProvider. The
// copyright line was rendering #1b1915 on #070707: invisible in both themes.
test("the copyright bar has an ink colour of its own", () => {
  assert.ok(
    /\.sf-footer__bar \{[\s\S]{0,240}color: var\(--sf-footer-bar-ink/.test(stylesheetSource),
    "the copyright bar no longer sets its own colour and falls back to the remapped text-white"
  );
  const design = normalizeSiteDesign(DEFAULT_SITE_DESIGN);
  assert.notEqual(design.footer.dark.barText, design.footer.dark.bar, "the bar ink matches its background");
  assert.notEqual(design.footer.light.barText, design.footer.light.bar);
});

// ThemeProvider writes the generic palette tokens INLINE on <body>, and an
// inline declaration cannot be beaten from a stylesheet. The storefront has to
// write them inline too, or the studio's text colour reaches nothing that reads
// var(--text) — which is every storefront element carrying a bare `text-white`.
test("the shared tokens are applied inline, not only through the sheet", () => {
  const variables = sharedPaletteVariables(DEFAULT_SITE_DESIGN, "dark");
  assert.equal(variables["--text"], DEFAULT_SITE_DESIGN.palette.dark.text);
  assert.equal(variables["--bg"], DEFAULT_SITE_DESIGN.palette.dark.page);
  const store = readFileSync(new URL("../src/storefront/lib/siteDesign.js", import.meta.url), "utf8");
  assert.ok(store.includes("body.style.setProperty"), "the store no longer writes the shared tokens inline");
  assert.ok(store.includes("MutationObserver"), "nothing re-applies them after ThemeProvider rewrites the attribute");
  assert.ok(store.includes("removeProperty"), "the ERP never gets <body> back when the storefront unmounts");
  assert.ok(
    storefrontSource.includes("attachSiteDesign()") && storefrontSource.includes("detachSiteDesign()"),
    "the shell no longer attaches and detaches the inline tokens"
  );
});

test("the homepage renders its sections from the stored order", () => {
  assert.ok(storefrontSource.includes("homeSectionOrder.map("), "the homepage went back to a fixed sequence");
  assert.ok(storefrontSource.includes("const homeSectionNodes = {"), "the section map is gone");
  for (const section of HOME_SECTIONS) {
    assert.ok(
      new RegExp(`\\b${section.id}:`).test(storefrontSource),
      `the homepage has no node for the "${section.id}" section, so it can never render`
    );
  }
  // The footer is rendered outside the loop on purpose.
  assert.ok(
    /homeSectionOrder\.map\([\s\S]{0,700}<HomeSimpleFooter/.test(storefrontSource),
    "the footer is no longer pinned after the section list"
  );
});

test("turning the strip off leaves the language and theme controls in place", () => {
  // The two corner controls live on the strip by owner decree, so "off" has to
  // mean "no promises", never "no strip".
  assert.ok(
    storefrontSource.includes("ownAnnouncements === null"),
    "the header no longer distinguishes an empty promise list from a disabled strip"
  );
  assert.ok(
    !/\{announcementItems\.length \?[\s\S]{0,80}sf-announcement-row/.test(storefrontSource),
    "the whole strip is now conditional, which would take the language switch with it"
  );
});

/* --------------------------------------------------- product card templates */

test("an unknown card template falls back to the shipped look", () => {
  assert.equal(normalizeSiteDesign({ card: { template: "fancy" } }).card.template, "classic");
  assert.equal(resolveCardLook({ card: { template: "overlay" } }).className, "m1h-card--overlay");
});

test("every template has a rule, and classic deliberately has none", () => {
  for (const template of CARD_TEMPLATES) {
    const look = resolveCardLook({ card: { template: template.id } });
    assert.equal(look.className, `m1h-card--${template.id}`);
    if (template.id === "classic") continue;
    assert.ok(
      homeCss.includes(`.m1h-card--${template.id}`),
      `the "${template.id}" template has no CSS, so picking it would change nothing`
    );
  }
  // classic IS the base look; a rule for it would be a second source of truth.
  assert.ok(!homeCss.includes(".m1h-card--classic"), "classic grew its own rules instead of staying the base");
});

test("the card reads its look from the record rather than forking the component", () => {
  const sections = readFileSync(new URL("../src/storefront/home/HomeSections.jsx", import.meta.url), "utf8");
  assert.ok(sections.includes("resolveCardLook(useSiteDesign())"), "the card no longer follows the stored template");
  // One card component, four looks. A second card component is how the wishlist
  // button ends up fixed in one of them and broken in the other three.
  assert.equal((sections.match(/function HomeProductCard/g) || []).length, 1, "a second product card component appeared");
  for (const modifier of ["m1h-card--no-brand", "m1h-card--no-badge"]) {
    assert.ok(sections.includes(modifier), `${modifier} is never applied`);
    assert.ok(homeCss.includes(modifier), `${modifier} has no rule`);
  }
});

// The catalogue was re-cropped so the product sits centred in the frame rather
// than the file being centred (3,188 images). A template that switched the image
// to `cover` would undo all of it, so no template may touch object-fit.
test("no template changes how the product image is fitted", () => {
  const templateBlock = homeCss.slice(homeCss.indexOf(".m1h-card--framed"), homeCss.indexOf(".m1h-card--no-badge"));
  assert.ok(templateBlock.length > 400, "the template block was not found");
  assert.ok(!/object-fit/.test(templateBlock), "a template overrides object-fit, which undoes the card-fit backfill");
  assert.ok(!/\.m1h-card__img\s*\{/.test(templateBlock), "a template restyles the product image itself");
});

test("the studio previews cards through the storefront's own rules", () => {
  const studio = readFileSync(new URL("../src/modules/settings/pages/SiteStudio.jsx", import.meta.url), "utf8");
  assert.ok(studio.includes('import "../../../storefront/home/home.css"'), "the preview lost the real card stylesheet");
  assert.ok(studio.includes('className="m1-site__mock-grid"'), "the preview grid is gone");
  assert.ok(studio.includes("m1h-card__plate"), "the preview stopped using real card markup");
  const css = readFileSync(new URL("../src/modules/settings/pages/SiteStudio.m1.css", import.meta.url), "utf8");
  assert.ok(!/\.m1-site__mock-card \{/.test(css), "the superseded lookalike card rule is back");
});
