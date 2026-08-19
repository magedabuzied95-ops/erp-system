import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The light-mode storefront header is painted with a near-black gradient, so anything
// sitting on it needs light text. Both defects below shipped because the fix was written
// in an unlayered rule that can never beat the layered light theme for !important
// declarations — see the layer-inversion note in src/index.css.
test("light-mode header keeps the utility row readable and the cart badge on brand", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const layered = css.slice(css.indexOf("@layer components {"));

  const utilityRow = layered.match(
    /\.storefront-shell:not\(\.storefront-dark\) \.sf-utility-row \{[^}]+\}/,
  );
  assert.ok(utilityRow, "the layered light theme must own .sf-utility-row text colour");
  assert.match(utilityRow[0], /color: rgba\(255, 255, 255/, "utility row text must be light");

  const utilityLinks = layered.match(
    /\.storefront-shell:not\(\.storefront-dark\) \.sf-utility-row :is\(a, button\) \{[^}]+\}/,
  );
  assert.ok(utilityLinks, "utility row links need a light colour in the layered block");
  assert.match(utilityLinks[0], /color: rgba\(255, 255, 255/);

  // The row must never go back to the light stone greys that measured ~2.1:1 on the bar.
  assert.doesNotMatch(utilityRow[0], /#57534e|#1c1917|var\(--sf-light-text\)/);
  assert.doesNotMatch(utilityLinks[0], /#57534e|#1c1917/);

  const badgeRules = [...css.matchAll(/\.sf-action-badge \{[^}]+\}/g)].map((match) => match[0]);
  assert.ok(badgeRules.length >= 2, "expected the light and dark cart-badge rules");
  for (const rule of badgeRules) {
    assert.doesNotMatch(rule, /6d28d9|7c3aed|8b5cf6/, "the cart count must not be violet");
  }
});
