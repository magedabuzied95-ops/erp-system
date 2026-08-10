import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pwaSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url),
  "utf8"
);
const pwaStyles = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxPwa.css", import.meta.url),
  "utf8"
);

test("Send Product sheet exposes semantic theme hooks for its main controls", () => {
  assert.match(pwaSource, /ai-pwa-product-sheet__toolbar/);
  assert.match(pwaSource, /ai-pwa-product-sheet__search/);
  assert.match(pwaSource, /ai-pwa-product-sheet__audience-chip/);
  assert.match(pwaSource, /ai-pwa-product-sheet__product-row/);
  assert.match(pwaSource, /ai-pwa-product-sheet__send/);
});

test("Send Product sheet derives light and dark colors from system theme tokens", () => {
  assert.match(
    pwaStyles,
    /\.ai-pwa-product-sheet--mobile\s*\{[^}]*background:\s*var\(--bg\)/s
  );
  assert.match(
    pwaStyles,
    /\.ai-pwa-product-sheet__toolbar,[\s\S]*?\.ai-pwa-product-sheet__footer\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--surface\)/
  );
  assert.match(
    pwaStyles,
    /\.ai-pwa-product-sheet__audience-chip\.is-active\s*\{[^}]*background:\s*var\(--primary\)/s
  );
  assert.match(
    pwaStyles,
    /\.ai-pwa-product-sheet__product-row\.is-active\s*\{[^}]*background:\s*var\(--primary-soft\)/s
  );
  assert.match(
    pwaStyles,
    /\.ai-pwa-product-sheet__send\s*\{[^}]*background:\s*var\(--primary\)/s
  );
  assert.match(
    pwaStyles,
    /\.ai-pwa-product-sheet__send:disabled\s*\{[^}]*background:\s*var\(--surface-soft\)/s
  );
});
