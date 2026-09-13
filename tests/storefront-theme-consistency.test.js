import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const storefrontSource = fs.readFileSync("src/storefront/Storefront.jsx", "utf8");
const listingSource = fs.readFileSync("src/storefront/pages/StorefrontProductListingPage.jsx", "utf8");
const confirmationSource = fs.readFileSync("src/storefront/pages/OrderConfirmationActionPage.jsx", "utf8");
const styles = fs.readFileSync("src/index.css", "utf8");
const lightStyles = fs.readFileSync("src/storefront/storefront-light.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("src/main.jsx", "utf8");

test("storefront brand theme is identical before the first paint on every browser", () => {
  assert.match(html, /storedTheme\s*=\s*isStorefrontHost\s*\?\s*"dark"/);
  assert.doesNotMatch(html, /localStorage\.getItem\(isStorefrontHost\s*\?\s*"storefront\.theme"/);
  assert.match(html, /root\.dataset\.theme\s*=\s*theme/);
  assert.match(html, /root\.style\.backgroundColor\s*=\s*dark\s*\?/);
  assert.match(main, /if \(!document\.documentElement\.dataset\.theme\)/);
  assert.doesNotMatch(main, /localStorage\.getItem\("erp\.theme"\) \|\| "dark"/);
});

test("the dark storefront paints its ink on every page, not only the homepage", () => {
  // `dark:` utilities are inert under the shop (documentColorScheme.js keeps
  // Tailwind's `dark` class off in both themes), so any element whose dark ink
  // exists ONLY as a `dark:` utility renders its LIGHT colour on a black page.
  // Measured live before this guard: the footer's "Customer service" at 1.13
  // contrast on /product/*, the catalogue h1 at 1.03 and the card name at 1.09.
  // home.css repaints the footer under `.m1h[data-theme="dark"]` — the homepage
  // only — so these rules carry every other page.
  const darkFooterInk = /body\.storefront-shell\.storefront-dark \.sf-footer \.sf-footer__contact\s*\{[^}]*color:/;
  assert.match(styles, darkFooterInk, "the footer contact lines need a dark colour outside .m1h");
  assert.match(styles, /body\.storefront-shell\.storefront-dark \.sf-footer \.sf-footer__link\s*\{[^}]*color:/);
  assert.match(styles, /body\.storefront-shell\.storefront-dark \.sf-catalog-title/);
  assert.match(styles, /body\.storefront-shell\.storefront-dark \.sf-product-card \.sf-product-card-name/);
  assert.match(styles, /body\.storefront-shell\.storefront-dark \.sf-product-card \.sf-product-card-brand/);

  // The footer wordmark is two files, and `dark:hidden` / `hidden dark:block`
  // left the DARK-ink one painting on the black footer.
  assert.match(styles, /body\.storefront-shell\.storefront-dark \.sf-footer \.sf-footer-logo--on-light\s*\{[^}]*display:\s*none/);
  assert.match(styles, /body\.storefront-shell\.storefront-dark \.sf-footer \.sf-footer-logo--on-dark\s*\{[^}]*display:\s*block/);
  assert.doesNotMatch(
    storefrontSource,
    /className=["'`][^"'`]*dark:hidden/,
    "no storefront element may swap itself with the inert dark variant"
  );

  // The CSS above is only reachable through these hooks.
  assert.match(storefrontSource, /className=\{`sf-product-card-name /);
  assert.match(storefrontSource, /className="sf-footer-logo sf-footer-logo--on-light /);
  assert.match(storefrontSource, /className="sf-footer-logo sf-footer-logo--on-dark /);
  assert.match(storefrontSource, /className="sf-product-card-brand /);
  assert.match(listingSource, /className="sf-catalog-intro /);
  assert.match(listingSource, /className="sf-catalog-pagesize-label /);
  assert.match(listingSource, /className="sf-catalog-seo-chip /);
});

test("storefront owns one synchronized light-dark theme state", () => {
  // `storefront-dark` is the shop's own class and it writes that itself. The
  // three signals it SHARES with the ERP theme — the root colour-scheme, the
  // Tailwind `dark` class and `data-theme` — go through the owner module, or
  // the last effect to run decides them (see tests/browser-force-dark-optout).
  assert.match(storefrontSource, /body\.classList\.toggle\("storefront-dark", dark\)/);
  assert.match(storefrontSource, /setStorefrontColorScheme\(themeMode,/);
  assert.doesNotMatch(storefrontSource, /root\.classList\.toggle\("dark"/);
  assert.doesNotMatch(storefrontSource, /body\.classList\.toggle\("dark"/);
  assert.doesNotMatch(storefrontSource, /root\.setAttribute\("data-theme"/);
  assert.doesNotMatch(storefrontSource, /root\.style\.colorScheme = themeMode/);
});

test("storefront uses Cairo as its single typography family", () => {
  assert.match(styles, /--sf-font-family:\s*"Cairo",\s*"Segoe UI",\s*sans-serif/);
  assert.match(styles, /font-family:\s*var\(--sf-font-family\)/);
});

test("storefront palette overrides the shared app palette in both modes", () => {
  assert.match(styles, /\.storefront-dark\s*\{[\s\S]*?--bg:\s*#050505/);
  assert.match(styles, /\.storefront-shell:not\(\.storefront-dark\)\s*\{[\s\S]*?--bg:\s*#f3f3f1/);
  assert.match(styles, /body\.storefront-shell:not\(\.storefront-dark\)[\s\S]*?background:\s*#f3f3f1\s*!important/);
});

test("catalog heading and result count read from the homepage palette in both themes", () => {
  const catalogSkin = fs.readFileSync("src/storefront/catalog-skin.css", "utf8");
  assert.match(listingSource, /sf-catalog-title[^"]*text-stone-950/);
  assert.match(listingSource, /className="sf-catalog-eyebrow sfx-eyebrow"/);
  assert.match(listingSource, /className="sf-catalog-count sfx-muted"/);
  assert.ok(/\.sfx-listing \.sfx-page-title \{[^}]*color: var\(--m1h-text\) !important/.test(catalogSkin));
  assert.ok(/\.sfx-muted \{[^}]*color: var\(--m1h-text-2\) !important/.test(catalogSkin));
});

test("the listing card is the homepage card: same plate, badge, heart and Site Studio template", () => {
  const cardStart = storefrontSource.indexOf("const ProductCard = memo(function ProductCard(");
  const card = storefrontSource.slice(cardStart, storefrontSource.indexOf("}, (prev, next) => {", cardStart));
  assert.ok(card.includes("const cardLook = resolveCardLook(useSiteDesign());"));
  assert.ok(card.includes('"sfx-product-card m1h-card group/product"'));
  assert.match(card, /<div className="m1h-card__plate">/);
  assert.match(card, /className="m1h-badge m1h-badge--sale"/);
  assert.match(card, /m1h-fav/);
  assert.doesNotMatch(card, /#d4af37|linear-gradient/, "the card takes its colours from the tokens, not literals");
  assert.doesNotMatch(storefrontSource, /#d90429|#c1121f|#ef233c|#ff334d|#ff6574/);
});

test("mobile dark palette is scoped to dark storefronts", () => {
  const mediaStart = styles.indexOf("@media (max-width: 1023px)", styles.indexOf("@media (max-width: 1023px)") + 1);
  const blockStart = styles.indexOf(".storefront-shell.storefront-dark {", mediaStart);
  const blockEnd = styles.indexOf(".storefront-shell .sf-header-wordmark", blockStart);
  const mobileThemeBlock = styles.slice(blockStart, blockEnd);
  const scopedSelectorLines = mobileThemeBlock
    .split(/\r?\n/)
    .filter((line) => line.includes(".storefront-shell"));

  assert.ok(blockStart > mediaStart && blockEnd > blockStart, "mobile storefront theme block must exist");
  assert.ok(scopedSelectorLines.length > 0);
  assert.ok(scopedSelectorLines.every((line) => line.trimStart().startsWith(".storefront-shell.storefront-dark")));
  assert.doesNotMatch(mobileThemeBlock, /\.storefront-dark--/);
});

test("public order pages no longer force dark mode", () => {
  assert.doesNotMatch(storefrontSource, /className="storefront-dark relative/);
  assert.doesNotMatch(confirmationSource, /className="storefront-dark min-h-screen/);
});
