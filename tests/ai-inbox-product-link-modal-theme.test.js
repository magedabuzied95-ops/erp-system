import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// AI Inbox — Product Link modal ("المتاح بالمقاس").
//
// POST-CLOSURE USER VISUAL REJECTION / AI_INBOX_PRODUCT_LINK_MODAL: in Light the
// dialog stayed near-black because every surface was a fixed hex literal and the
// dialog portals outside `.m1-shell-root .m1-shell-content`, where foundation.css
// could have normalised it. These assertions lock the modal onto the M1 tokens so
// the same defect cannot be reintroduced, and mirror the guard that already
// protects the PWA Send Product sheet.

const source = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url),
  "utf8"
);
const styles = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/ProductLinkPicker.m1.css", import.meta.url),
  "utf8"
);
const desktopStyles = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxDesktop.css", import.meta.url),
  "utf8"
);

// The sizeMode branch is the Product Link modal. Slice it out so the assertions
// below can never be satisfied by the product-card branch further down.
const sizeBranch = source.slice(
  source.indexOf("const sizeContent = ("),
  source.indexOf("const content = (")
);

test("Product Link modal exposes semantic theme hooks for its chrome", () => {
  for (const hook of [
    "ai-plink__scrim",
    "ai-plink__dialog",
    "ai-plink__header",
    "ai-plink__body",
    "ai-plink__group",
    "ai-plink__chip",
    "ai-plink__size-grid",
    "ai-plink__size",
    "ai-plink__field",
    "ai-plink__preview",
    "ai-plink__footer",
    "ai-plink__send",
  ]) {
    assert.match(sizeBranch, new RegExp(hook), `missing theme hook: ${hook}`);
  }
  assert.match(source, /import "\.\/ProductLinkPicker\.m1\.css";/);
});

test("Product Link modal keeps no fixed-dark canvas in its markup", () => {
  // These are the exact literals that produced the Light-mode defect.
  for (const literal of ["#111310", "#151714", "#191b17"]) {
    assert.doesNotMatch(sizeBranch, new RegExp(literal), `fixed-dark canvas still present: ${literal}`);
  }
  // No generic chrome colour may be a palette utility any more: dark canvases,
  // hardcoded foregrounds and muted greys all have to resolve through tokens.
  for (const utility of [
    /\btext-white\b/,
    /\bbg-black\//,
    /\btext-slate-\d{3}\b/,
    /\bbg-slate-\d{3}\b/,
    /\bborder-white\//,
    /\bbg-white\//,
  ]) {
    assert.doesNotMatch(sizeBranch, utility, `generic chrome still uses a palette utility: ${utility}`);
  }
});

test("Product Link modal hierarchy resolves through M1 theme tokens", () => {
  assert.match(styles, /\.ai-plink__scrim\s*\{[^}]*background:\s*var\(--overlay-scrim\)/s);
  assert.match(styles, /\.ai-plink__dialog\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.ai-plink__body\s*\{[^}]*background:\s*var\(--bg\)/s);
  assert.match(styles, /\.ai-plink__group\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /\.ai-plink__chip\s*\{[^}]*background:\s*var\(--surface\)/s);
});

test("Product Link selected states use the primary contract, not a local gold", () => {
  assert.match(styles, /\.ai-plink__chip\.is-active\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(styles, /\.ai-plink__chip\.is-active\s*\{[^}]*color:\s*var\(--primary-contrast\)/s);
  assert.match(styles, /\.ai-plink__size\.is-active\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(styles, /\.ai-plink__size\.is-active\s*\{[^}]*color:\s*var\(--primary-contrast\)/s);
  assert.match(styles, /\.ai-plink__send\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(styles, /\.ai-plink__send\s*\{[^}]*color:\s*var\(--primary-contrast\)/s);
  // Disabled must stay a real surface, not an opacity wash over gold — that is
  // what made the old footer unreadable in Light.
  assert.match(styles, /\.ai-plink__send:disabled\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
});

test("Product Link text tiers stay token-driven and readable", () => {
  assert.match(styles, /\.ai-plink__title\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.ai-plink__hint\s*\{[^}]*color:\s*var\(--muted\)/s);
  // Gold measures 3.91:1 on Light --surface, so the small-caps eyebrow must not
  // use it. This assertion is the reason that decision cannot silently drift.
  assert.match(styles, /\.ai-plink__eyebrow\s*\{[^}]*color:\s*var\(--text-secondary\)/s);
  assert.doesNotMatch(styles, /\.ai-plink__eyebrow\s*\{[^}]*color:\s*var\(--primary\)/s);
});

test("Product Link typography inherits the application stack", () => {
  // Arabic resolves to Cairo and English to Inter through --font-ui / --app-font;
  // the modal must never name a font of its own.
  assert.match(styles, /\.ai-plink\s*\{[^}]*font-family:\s*var\(--font-ui\)/s);
  assert.doesNotMatch(styles, /font-family:(?!\s*var\()/);
  for (const scaled of ["--font-caption", "--font-label", "--font-body", "--font-section-title"]) {
    assert.ok(styles.includes(scaled), `typography scale not used: ${scaled}`);
  }
});

test("Product Link stylesheet carries no palette literal and no blanket override", () => {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  const literals = withoutComments.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g);
  assert.equal(literals, null, `colour literals must live in themes.js, found: ${literals}`);
  assert.doesNotMatch(withoutComments, /!important/, "blanket !important is not allowed — these hooks own their elements");
  assert.doesNotMatch(withoutComments, /\*\s*\{/, "wildcard selectors are not allowed");
});

test("the desktop product picker no longer runs a second AI Inbox palette", () => {
  // --picker-* used to be a hand-tuned light/dark pair with a literal gold, so
  // re-pointing the brand in themes.js could not reach this surface.
  // Comments are stripped: the block above names the retired literal on purpose,
  // so matching raw text would assert against its own documentation.
  const desktopRules = desktopStyles.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(desktopRules, /--picker-accent:\s*var\(--primary\);/);
  assert.match(desktopRules, /--picker-bg:\s*var\(--bg\);/);
  assert.match(desktopRules, /--picker-surface:\s*var\(--surface\);/);
  assert.match(desktopRules, /--picker-text:\s*var\(--text\);/);
  assert.doesNotMatch(desktopRules, /#d4af37/i);
  assert.doesNotMatch(desktopRules, /212,\s*175,\s*55/);
  // One token-driven definition replaces the per-theme override block.
  assert.doesNotMatch(desktopRules, /html\[data-theme="light"\] \.ai-inbox-product-picker-desktop,/);
});

test("Product Link behaviour surface is untouched", () => {
  // Presentation-only checkpoint: the ids the send path and its tests depend on,
  // and the builders that produce the URL/message, must all still be here.
  for (const anchor of [
    'data-testid="available-by-size-dialog"',
    'data-testid="available-by-size-close"',
    'data-testid="available-by-size-send"',
    "submitSelectionWithSizeMode",
    "setSelectedLinkSizes",
    "setSelectedLinkTypes",
    "setSelectedLinkGender",
    "setSelectedLinkBrand",
    "setSelectedLinkMinPrice",
    "setSelectedLinkMaxPrice",
  ]) {
    assert.ok(sizeBranch.includes(anchor), `behaviour anchor lost: ${anchor}`);
  }
  assert.match(source, /buildAvailableProductsUrl/);
  assert.match(source, /buildAvailableProductsMessage/);
});
