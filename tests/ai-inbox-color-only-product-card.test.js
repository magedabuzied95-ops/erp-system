import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pwaSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url),
  "utf8"
);
const routeSource = fs.readFileSync(
  new URL("../server/routes/aiAgentOrders.js", import.meta.url),
  "utf8"
);
const metaSource = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url),
  "utf8"
);

test("PWA product sender allows a color-only product card and keeps size optional", () => {
  assert.match(pwaSource, /card_reply_mode: clean\(selectedColor\) && !clean\(selectedSize\) \? "color_only"/);
  assert.match(pwaSource, /needsColorSelection \|\| !needsSizeSelection/);
  // Localized: the size field must still be marked optional, or a colour-only card
  // looks like it is missing a required choice.
  assert.match(pwaSource, /\{t\("aiSupport\.inbox\.pwa\.optional"\)\}/);
  // The sizes used to be flattened into an English sentence ("Available sizes: ...").
  // They are now structured fields on the payload, which is what a card renderer and a
  // channel adapter can each use without parsing prose.
  assert.match(pwaSource, /available_sizes: asArray\(availableSizes\)/);
  assert.match(pwaSource, /size_options: asArray\(availableSizes\)/);
  assert.match(pwaSource, /buildProductCardPayload\(selectedProduct, variant, selectedColor, selectedSize, availableSizesForColor\)/);
});

test("color-only cards carry all in-stock sizes without inventing a selected variant", () => {
  assert.match(pwaSource, /variant_id: clean\(selectedSize\) \?/);
  assert.match(pwaSource, /available_sizes: asArray\(availableSizes\)/);
  assert.match(routeSource, /const colorOnlySelection = Boolean\(color && !envText\(normalizedCard\.size\) && derivedAvailableSizes\.length\)/);
  assert.match(routeSource, /variant_id: colorOnlySelection \? ""/);
  assert.match(routeSource, /card_reply_mode: colorOnlySelection \? "color_only"/);
});

test("Messenger generic cards display the selected color's available sizes", () => {
  assert.match(metaSource, /`Available sizes: \$\{availableSizes\.join\(", "\)\}`/);
  assert.match(metaSource, /selectedSize \? `Size: \$\{selectedSize\}`/);
});
