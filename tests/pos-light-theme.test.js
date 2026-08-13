import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

// Strip comments before scanning for literals, so the rationale may quote the
// values that were removed without the guard reading them as live declarations.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("POS keeps the class hooks the design system binds to", () => {
  const page = read("../src/modules/pos/pages/POSPro.jsx");
  const grid = read("../src/modules/pos/components/ProductGrid.jsx");
  const cart = read("../src/modules/pos/components/CartSidebar.jsx");

  assert.match(page, /import "\.\/POSPro\.m1\.css"/);
  assert.match(page, /pos-pro-shell/);
  assert.match(page, /pos-catalog-panel/);
  assert.match(grid, /pos-product-card/);
  assert.match(grid, /pos-product-price-value/);
  assert.match(cart, /pos-customer-picker/);
  assert.match(cart, /pos-cart-totals/);
  assert.match(cart, /pos-payment-panel/);
  assert.match(cart, /pos-payment-method/);
  assert.match(cart, /pos-checkout-actions/);
  assert.match(page, /pos-action-shift/);
});

// The previous version of this guard pinned POS to a light-ONLY override block
// and to the literal `--pos-light-text: #25231f`. That was the defect, not the
// contract: POS owned a private palette because foundation.css's normalisation
// could not reach it. The guard now asserts the convergence instead.
test("POS owns no private palette — surfaces resolve to canonical tokens", () => {
  const styles = stripComments(read("../src/modules/pos/pages/POSPro.m1.css"));

  assert.doesNotMatch(styles, /--pos-light-/, "POS must not redeclare a private light palette");
  assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/, "POS must not hardcode colour literals");
  assert.doesNotMatch(
    styles,
    /html\[data-theme="light"\]/,
    "POS surfaces must be theme-agnostic — one declaration serving both themes",
  );

  // Same rules, no theme gate: Dark and Light derive from the same source.
  assert.match(styles, /^\.pos-pro-shell \.pos-product-card \{/m);
  assert.match(styles, /\.pos-pro-shell \{[\s\S]*?var\(--bg\)/);
  assert.match(styles, /\.pos-pro-shell \{[\s\S]*?color: var\(--text\)/);
  assert.match(styles, /pos-payment-method\[data-tone="purple"\]/);
  assert.match(styles, /\.pos-checkout-primary \{[\s\S]*?background: var\(--primary\)/);
});

test("smart filters use real token names, not fallback-masked inventions", () => {
  const css = stripComments(read("../src/modules/pos/components/SmartPosFilters.m1.css"));

  // Every one of these resolved to its hex fallback because no such token has
  // ever existed; the file only looked token-driven.
  for (const invented of ["--text-muted", "--surface-subtle", "--on-primary", "--field-bg"]) {
    assert.doesNotMatch(css, new RegExp(invented.replace(/-/g, "\\-")), `${invented} is not a design token`);
  }
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no colour literals, including var() fallbacks");
  assert.doesNotMatch(
    css,
    /\[data-theme="dark"\][\s\S]*?--surface:/,
    "the panel must not locally shadow canonical tokens with a private dark palette",
  );
  assert.match(css, /var\(--primary-contrast\)/);
  assert.match(css, /var\(--surface-soft\)/);
  assert.match(css, /var\(--muted\)/);
});

test("palette normalisation reaches POS, including its body-level portals", () => {
  const foundation = read("../src/theme/foundation.css");
  const page = read("../src/modules/pos/pages/POSPro.jsx");

  // POS renders outside `.m1-shell-root`; six of its surfaces are portaled to
  // <body> and so sit outside `.pos-pro-shell` too. Both scopes are required.
  assert.match(foundation, /:is\(\.m1-shell-root \.m1-shell-content, \.pos-pro-shell, body\.pos-route\)/);
  assert.match(page, /classList\.add\("pos-route"\)/);
  assert.match(page, /classList\.remove\("pos-route"\)/);

  // The status families POS actually uses must all be covered in that scope.
  for (const family of ["text-emerald-", "text-amber-", "text-rose-", "text-cyan-"]) {
    const rule = new RegExp(
      `:is\\(\\.m1-shell-root \\.m1-shell-content, \\.pos-pro-shell, body\\.pos-route\\)[^{]*${family}`,
    );
    assert.match(foundation, rule, `${family} must normalise inside POS`);
  }
});

test("the POS shell canvas is no longer a fixed-dark island", () => {
  const page = read("../src/modules/pos/pages/POSPro.jsx");

  // The root used to inline `#09090b -> #111111` plus `text-white`, which is what
  // no theme could reach. Colour now comes from POSPro.m1.css off --bg/--text.
  assert.doesNotMatch(page, /className="pos-pro-shell[^"]*bg-\[radial-gradient/);
  assert.doesNotMatch(page, /className="pos-pro-shell[^"]*text-white/);
  assert.match(page, /className="pos-pro-shell h-\[100dvh\]/);
});
