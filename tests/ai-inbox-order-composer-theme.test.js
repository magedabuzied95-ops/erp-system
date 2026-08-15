import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// AI Inbox — order composer drawer ("Create an order from this conversation").
//
// The drawer portals outside `.m1-shell-root .m1-shell-content`, so
// foundation.css's palette→token normalisation never reached it: its chrome was
// fixed-dark (bg-[#111512], bg-slate-950/70, text-white) with emerald/cyan/
// amber/rose accents, and the whole drawer was unreadable in a Light ERP. These
// assertions lock it onto the M1 tokens, and mirror the guard that already
// protects the Product Link modal opened from the same conversation.

const source = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url),
  "utf8"
);
const styles = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxOrderComposer.m1.css", import.meta.url),
  "utf8"
);

// Slice out the composer's markup so nothing below can be satisfied by another
// surface in this very large file.
const composerStart = source.indexOf("const content = (", source.indexOf("const submitPayload = (confirm)"));
const composer = source.slice(
  composerStart,
  source.indexOf("return portalTarget && typeof document", composerStart)
);

test("order composer markup is a real slice of the drawer", () => {
  assert.ok(composerStart > 0, "composer branch not found");
  assert.match(composer, /aiSupport\.inbox\.order\.orderHeading/);
  assert.match(composer, /aiSupport\.inbox\.order\.saveInvoice/);
});

test("order composer exposes semantic theme hooks for its chrome", () => {
  for (const hook of [
    "ai-order__scrim",
    "ai-order__dialog",
    "ai-order__header",
    "ai-order__eyebrow",
    "ai-order__title",
    "ai-order__close",
    "ai-order__group",
    "ai-order__group-title",
    "ai-order__label",
    "ai-order__saved",
    "ai-order__saved-chip",
    "ai-order__field",
    "ai-order__choice",
    "ai-order__empty",
    "ai-order__line",
    "ai-order__qty",
    "ai-order__discount",
    "ai-order__segment",
    "ai-order__deduction",
    "ai-order__total",
    "ai-order__notice",
    "ai-order__action",
    "ai-order__hint",
  ]) {
    assert.match(composer, new RegExp(hook), `missing theme hook: ${hook}`);
  }
  assert.match(source, /import "\.\/AiInboxOrderComposer\.m1\.css";/);
});

test("order composer keeps no fixed-dark canvas in its markup", () => {
  // The exact literal that produced the Light-mode defect.
  assert.doesNotMatch(composer, /#111512/, "fixed-dark canvas still present");
  for (const utility of [
    /\btext-white\b/,
    /\btext-slate-\d{3}\b/,
    /\bbg-slate-\d{3}\b/,
    /\bborder-white\b/,
    /\bbg-white\b/,
    // Meaning colours must resolve through tokens too — these accents are what
    // turned into invisible tint-on-tint once the surface re-pointed.
    /\bemerald-\d{3}\b/,
    /\bamber-\d{3}\b/,
    /\brose-\d{3}\b/,
    /\bcyan-\d{3}\b/,
  ]) {
    assert.doesNotMatch(composer, utility, `chrome still uses a palette utility: ${utility}`);
  }
});

test("order composer hierarchy resolves through M1 theme tokens", () => {
  assert.match(styles, /\.ai-order__scrim\s*\{[^}]*background:\s*var\(--overlay-scrim\)/s);
  assert.match(styles, /\.ai-order__dialog\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.ai-order__group\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /\.ai-order__field\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(styles, /\.ai-order__choice\s*\{[^}]*background:\s*var\(--surface\)/s);
  // The native option list is OS-painted; without this a Light dropdown opens
  // dark over a light dialog.
  assert.match(styles, /\.ai-order__field option\s*\{[^}]*background:\s*var\(--surface\)/s);
});

test("order composer selected states use the primary contract, not a local accent", () => {
  assert.match(styles, /\.ai-order__choice\.is-active\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(styles, /\.ai-order__choice\.is-active\s*\{[^}]*color:\s*var\(--primary-contrast\)/s);
  assert.match(styles, /\.ai-order__segment-option\.is-active\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(styles, /\.ai-order__action--primary\s*\{[^}]*background:\s*var\(--primary\)/s);
  assert.match(styles, /\.ai-order__action--primary\s*\{[^}]*color:\s*var\(--primary-contrast\)/s);
  // Disabled must stay a real surface, not an opacity wash over gold.
  assert.match(styles, /\.ai-order__action:disabled\s*\{[^}]*background:\s*var\(--surface-soft\)/s);
});

test("order composer text tiers stay token-driven and readable", () => {
  assert.match(styles, /\.ai-order__title\s*\{[^}]*color:\s*var\(--text\)/s);
  assert.match(styles, /\.ai-order__subtitle\s*\{[^}]*color:\s*var\(--muted\)/s);
  // Gold measures 3.91:1 on Light --surface, so the small-caps eyebrow must not
  // use it. This assertion is the reason that decision cannot silently drift.
  assert.match(styles, /\.ai-order__eyebrow\s*\{[^}]*color:\s*var\(--text-secondary\)/s);
  assert.doesNotMatch(styles, /\.ai-order__eyebrow\s*\{[^}]*color:\s*var\(--primary\)/s);
  // Warning banners: amber text on an amber tint is the pairing that made these
  // invisible, so the foreground stays --text.
  assert.match(styles, /\.ai-order__notice\s*\{[^}]*color:\s*var\(--text\)/s);
  // A deduction is a state change on the total, so it carries the danger token.
  assert.match(styles, /\.ai-order__deduction\s*\{[^}]*color:\s*var\(--danger\)/s);
});

test("order composer typography inherits the application stack", () => {
  assert.match(styles, /\.ai-order\s*\{[^}]*font-family:\s*var\(--font-ui\)/s);
  assert.doesNotMatch(styles, /font-family:(?!\s*var\()/);
  for (const scaled of ["--font-caption", "--font-label", "--font-body", "--font-page-title"]) {
    assert.ok(styles.includes(scaled), `typography scale not used: ${scaled}`);
  }
});

test("order composer stylesheet carries no palette literal and no blanket override", () => {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  const literals = withoutComments.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g);
  assert.equal(literals, null, `colour literals must live in themes.js, found: ${literals}`);
  assert.doesNotMatch(withoutComments, /!important/, "blanket !important is not allowed — these hooks own their elements");
  assert.doesNotMatch(withoutComments, /\*\s*\{/, "wildcard selectors are not allowed");
});

test("order composer behaviour surface is untouched", () => {
  // Presentation-only checkpoint: the handlers the order path depends on must
  // all still be wired to the same controls.
  for (const anchor of [
    "setCustomerName",
    "setCustomerPhone",
    "setShippingProvider",
    "setShippingCityId",
    "setShippingZoneId",
    "setShippingDistrictId",
    "setStreetAddress",
    "setBuildingNumber",
    "setPaymentMethod",
    "setDiscountType",
    "setDiscountValue",
    "setNotes",
    "savedAddresses.map",
    "onRequestPick",
    "submitPayload(false)",
    "submitPayload(true)",
    'role="radiogroup"',
    "aria-checked={active}",
  ]) {
    assert.ok(composer.includes(anchor), `behaviour anchor lost: ${anchor}`);
  }
});
