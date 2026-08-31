// The mobile storefront header: five slots on one line, modelled on the
// reference the shop owner picked (levelshoes.com) — menu and search on the
// start edge, wishlist and bag on the end edge, logo dead centre between them.
//
// This file used to assert the opposite arrangement (a cart icon in the row and
// NO search). That was the previous design, replaced deliberately; the
// assertions below are the current intent, not a relaxation of the old one.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");
const stylesheet = fs.readFileSync("src/index.css", "utf8");

const start = storefrontSource.indexOf('<div className="sf-mobile-header-shell md:hidden"');
const end = storefrontSource.indexOf('<div className="sf-utility-row', start);
const mobileHeader = storefrontSource.slice(start, end);

test("the mobile header is one line with the logo centred between two clusters", () => {
  assert.ok(start >= 0 && end > start, "the mobile header block must be findable");
  assert.match(mobileHeader, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(mobileHeader, /sf-header-logo mx-auto/);
  // 52px is the reference's row height, and the logo is sized to sit inside it
  // rather than push it open.
  assert.match(mobileHeader, /h-\[52px\]/);
});

test("menu and search hold the start edge, wishlist and bag the end edge", () => {
  const positions = ["Menu", "Search", "Heart", "ShoppingBag"].map((icon) => ({
    icon,
    at: mobileHeader.indexOf(`<${icon} `),
  }));
  for (const { icon, at } of positions) assert.ok(at > 0, `${icon} must be in the mobile header`);
  const order = positions.map((entry) => entry.at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "start-edge → end-edge order must not drift");
});

test("the icons are bare glyphs — no chip behind them", () => {
  assert.doesNotMatch(mobileHeader, /sf-mobile-header-button/, "the chip class belongs to the old header");
  assert.equal((mobileHeader.match(/sf-topbar-button/g) || []).length, 4, "exactly four actions");
});

test("the count badge sits on the icon's INNER corner, never against the screen edge", () => {
  // `.sf-mobile-cart-badge` is an !important rule inside @layer components that
  // pins the badge to `left`. On the outermost icon of a right-to-left header
  // that IS the edge of the display: the count crowds it and reads as a second,
  // half-cut icon — which is exactly how this was reported. Putting the class
  // back reinstates the bug, and no unlayered rule can override it.
  assert.doesNotMatch(mobileHeader, /sf-mobile-cart-badge/);

  const ruleStart = stylesheet.indexOf(".storefront-shell .sf-topbar-button .sf-action-badge");
  assert.ok(ruleStart > 0, "the topbar badge must own its own placement");
  const rule = stylesheet.slice(ruleStart, stylesheet.indexOf("}", ruleStart));
  assert.match(rule, /inset-inline-start/, "logical placement so it flips with the language");
  assert.doesNotMatch(rule, /left:\s*-/, "a negative left pushes it off the outer edge again");
});

test("the announcement line can set its own colour", () => {
  // `.sf-header-announcement span` is !important inside @layer components, and
  // an unlayered !important cannot outrank a layered one — so this line has to
  // stay something other than a span or it can never be white.
  // Stop at the desktop marquee, which is a separate block and legitimately
  // still made of spans.
  const soloStart = storefrontSource.indexOf("sf-announcement-solo relative");
  const announcement = storefrontSource.slice(
    soloStart,
    storefrontSource.indexOf('className="relative mx-auto hidden h-8', soloStart)
  );
  assert.ok(announcement.length > 0, "the mobile announcement block must be findable");
  assert.match(announcement, /<div\s/, "rendered as a div, not a span");
  assert.doesNotMatch(announcement, /<span[\s>]/);
});
