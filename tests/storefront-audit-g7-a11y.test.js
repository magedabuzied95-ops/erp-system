import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DIALOG_FOCUSABLE_SELECTOR, nextDialogFocusIndex } from "../src/storefront/lib/dialogFocus.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

// The body of a top-level `function name(` up to the next top-level function.
const functionSource = (source, name) => {
  const start = source.search(new RegExp(`^(export\\s+)?(const\\s+${name}\\s*=|function\\s+${name}\\s*\\()`, "m"));
  assert.ok(start >= 0, `${name} not found`);
  const rest = source.slice(start + 1);
  const end = rest.search(/^(export\s+)?(async\s+)?function\s+\w+|^const\s+\w+\s*=\s*(memo\()?/m);
  return end >= 0 ? source.slice(start, start + 1 + end) : source.slice(start);
};

// ---- the Tab wrap rule --------------------------------------------------

test("Tab from outside the dialog lands on its first element, Shift+Tab on its last", () => {
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: -1 }), 0);
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: -1, shift: true }), 3);
});

test("Tab wraps at both ends and leaves the middle to the browser", () => {
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: 3 }), 0);
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: 0, shift: true }), 3);
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: 1 }), -1);
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: 3, shift: true }), -1);
  assert.equal(nextDialogFocusIndex({ count: 4, currentIndex: 0 }), -1);
});

test("a single tabbable element keeps focus on itself in both directions", () => {
  assert.equal(nextDialogFocusIndex({ count: 1, currentIndex: 0 }), 0);
  assert.equal(nextDialogFocusIndex({ count: 1, currentIndex: 0, shift: true }), 0);
});

test("an empty dialog keeps focus on the container, stale indexes re-enter", () => {
  assert.equal(nextDialogFocusIndex({ count: 0, currentIndex: -1 }), -2);
  assert.equal(nextDialogFocusIndex({ count: undefined, currentIndex: 2 }), -2);
  assert.equal(nextDialogFocusIndex({ count: 2, currentIndex: 5 }), 0);
  assert.equal(nextDialogFocusIndex({ count: 2, currentIndex: undefined, shift: true }), 1);
});

test("the tabbable selector skips disabled controls and tabindex=-1", () => {
  assert.match(DIALOG_FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/);
  assert.match(DIALOG_FOCUSABLE_SELECTOR, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
  assert.match(DIALOG_FOCUSABLE_SELECTOR, /a\[href\]/);
});

// ---- the hook -----------------------------------------------------------

test("useDialogFocus moves focus in, traps Tab, closes on Escape and returns focus", () => {
  const hook = read("src/storefront/lib/useDialogFocus.js");
  assert.match(hook, /nextDialogFocusIndex\(/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /onCloseRef\.current\?\.\(\)/);
  assert.match(hook, /initialFocusRef\?\.current \|\| tabbablesIn\(container\)\[0\]/);
  assert.match(hook, /returnFocusRef\?\.current \|\| previous/);
  assert.match(hook, /document\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(hook, /document\.removeEventListener\("keydown", onKeyDown\)/);
  // A dialog stacked on top owns the keyboard.
  assert.match(hook, /activeRoot !== modalRootOf\(container\)/);
});

// ---- wiring -------------------------------------------------------------

test("#68 the cart drawer panel is wired to the dialog focus hook", () => {
  const source = read("src/storefront/Storefront.jsx");
  assert.match(source, /import \{ useDialogFocus \} from "\.\/lib\/useDialogFocus";/);
  const drawer = functionSource(source, "CartDrawer");
  assert.match(drawer, /useDialogFocus\(open, panelRef, \{ onClose, initialFocusRef: closeButtonRef \}\)/);
  assert.match(drawer, /<aside ref=\{panelRef\} className="sf-bag__panel" role="dialog" aria-modal="true"/);
  assert.match(drawer, /<button ref=\{closeButtonRef\} type="button" className="sf-bag__close"/);
});

test("#69 the phone menu drawer takes focus, closes on Escape and reports aria-expanded", () => {
  const source = read("src/storefront/Storefront.jsx");
  assert.match(source, /useDialogFocus\(menuOpen, mobileMenuPanelRef, \{ onClose: closeMobileMenu, initialFocusRef: mobileMenuCloseRef \}\)/);
  assert.match(source, /<aside ref=\{mobileMenuPanelRef\} data-theme=\{effectiveTheme\} className=\{`sf-mobile-menu-drawer/);
  assert.match(source, /ref=\{mobileMenuCloseRef\}\s+type="button"\s+onClick=\{closeMobileMenu\}/);
  const toggles = source.match(/onClick=\{\(\) => setMobileMenuOpen\(\(value\) => !value\)\}\s+aria-label=\{t\("storefront\.header\.menu"\)\}\s+aria-expanded=\{menuOpen\}/g) || [];
  assert.equal(toggles.length, 2);
});

test("#70 the catalog filters sheet is wired to the dialog focus hook", () => {
  const source = read("src/storefront/pages/StorefrontProductListingPage.jsx");
  assert.match(source, /import \{ useDialogFocus \} from "\.\.\/lib\/useDialogFocus";/);
  const drawer = functionSource(source, "CatalogFiltersDrawer");
  assert.match(drawer, /useDialogFocus\(open, sheetRef, \{ onClose, initialFocusRef: closeButtonRef \}\)/);
  assert.match(drawer, /<div ref=\{sheetRef\} className="sfx-sheet">/);
  assert.match(drawer, /<button ref=\{closeButtonRef\} type="button" onClick=\{onClose\} className="sfx-icon-btn"/);
});

test("#71 gallery and zoom thumbnails carry a name and the current state", () => {
  const gallery = read("src/storefront/components/StorefrontProductGallery.jsx");
  assert.match(gallery, /aria-label=\{thumbnailLabel\(displayTitle, imageIndex, galleryItems\.length\)\}/);
  assert.match(gallery, /aria-current=\{active \? "true" : undefined\}/);
  assert.match(gallery, /sfText\("storefront\.products\.thumbnailLabel"/);
  const zoom = read("src/storefront/components/ProductImageZoom.jsx");
  assert.match(zoom, /aria-current=\{thumbIndex === current \? "true" : undefined\}/);
  assert.match(zoom, /aria-label=\{\[String\(title \|\| ""\)\.trim\(\), sfText\("storefront\.products\.thumbnailLabel"/);
});

test("#71 the thumbnail label exists in both storefront locales", () => {
  for (const lang of ["ar", "en"]) {
    const products = JSON.parse(read(`src/locales/${lang}/storefront.json`)).products;
    assert.match(products.thumbnailLabel, /\{\{current\}\}.*\{\{total\}\}/, lang);
  }
});

test("#72 the phone search sheet close button has a name", () => {
  const source = read("src/storefront/Storefront.jsx");
  // A visible "Cancel" word names it now, so no aria-label that would differ from it.
  assert.match(source, /<button type="button" onClick=\{onClose\} className="sf-search-cancel">\s*\{t\("storefront\.search\.cancel"\)\}\s*<\/button>/);
});

test("#73 the checkout location picker hands focus back to its trigger", () => {
  const parts = read("src/storefront/checkout/CheckoutParts.jsx");
  const picker = parts.slice(parts.indexOf("export const CheckoutLocationSelect"));
  assert.match(picker, /const triggerRef = useRef\(null\);/);
  assert.match(picker, /<button\s+ref=\{triggerRef\}\s+type="button"\s+className=\{`sfc-select/);
  assert.match(picker, /triggerRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(picker, /onDismiss: \(event\) => close\(event\?\.type === "keydown"\)/);
  const choose = picker.slice(picker.indexOf("const choose"), picker.indexOf("const list"));
  assert.match(choose, /close\(\);/);
  assert.doesNotMatch(choose, /setOpen\(false\)/);
  assert.doesNotMatch(picker, /onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(picker, /if \(event\.key === "Escape"\) close\(\);/);
});

test("#104 address-link selects and inputs are named", () => {
  const page = read("src/storefront/pages/CustomerAddressPage.jsx");
  for (const key of ["cityPlaceholder", "areaPlaceholder", "districtPlaceholder", "fullNamePlaceholder", "streetPlaceholder", "buildingPlaceholder", "floorPlaceholder", "apartmentPlaceholder", "landmarkPlaceholder"]) {
    assert.match(page, new RegExp(`aria-label=\\{sfText\\("storefront\\.addressLink\\.${key}"\\)\\}`), key);
  }
});

test("#105 the catalog sort box shows keyboard focus", () => {
  const css = read("src/storefront/catalog-skin.css");
  const rule = css.match(/:is\(body\.storefront-shell, \.sfx-scope\) \.sfx-select:focus-within \{([^}]*)\}/);
  assert.ok(rule, "focus-within rule missing");
  assert.match(rule[1], /border-color: var\(--m1h-accent\)/);
  assert.match(rule[1], /box-shadow: 0 0 0 3px var\(--sfx-focus\)/);
});

test("#106 checkout native select links and announces its error", () => {
  const parts = read("src/storefront/checkout/CheckoutParts.jsx");
  const select = functionSource(parts, "CheckoutNativeSelect");
  assert.match(select, /aria-invalid=\{error \? "true" : undefined\}/);
  assert.match(select, /aria-describedby=\{error \? `\$\{id\}-error` : undefined\}/);
  assert.match(select, /<span id=\{`\$\{id\}-error`\} className="sfc-error" role="alert">/);
});

// ---- #107 contrast ------------------------------------------------------

const luminance = (hex) => {
  const channels = hex.replace("#", "").match(/../g).map((pair) => parseInt(pair, 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("contrast math matches known WCAG values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
});

test("#107 homepage card brand line and was-price clear 4.5:1 in light and dark", () => {
  const css = read("src/storefront/home/home.css");
  const block = (selector) => {
    const match = css.match(new RegExp(`^${selector.replace(/[.[\]"=]/g, "\\$&")} \\{([\\s\\S]*?)^\\}`, "m"));
    assert.ok(match, selector);
    const token = (name) => {
      const value = match[1].match(new RegExp(`--m1h-${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
      assert.ok(value, `${selector} --m1h-${name}`);
      return value[1];
    };
    return { text3: token("text-3"), bg: token("bg"), surface: token("surface") };
  };
  // Both the card and its brand/was-price rules read --m1h-text-3.
  assert.match(css, /\.m1h-card__brand \{[^}]*color: var\(--m1h-text-3\)/);
  assert.match(css, /\.m1h-card__price-was \{[^}]*color: var\(--m1h-text-3\)/);
  for (const selector of [".m1h", ".m1h[data-theme=\"dark\"]"]) {
    const tokens = block(selector);
    assert.ok(contrast(tokens.text3, tokens.surface) >= 4.5, `${selector} text-3 on surface ${contrast(tokens.text3, tokens.surface).toFixed(2)}`);
    assert.ok(contrast(tokens.text3, tokens.bg) >= 4.5, `${selector} text-3 on bg ${contrast(tokens.text3, tokens.bg).toFixed(2)}`);
  }
});
