import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const labelsPage = readFileSync(
  new URL("../src/modules/products/pages/BarcodeLabels.jsx", import.meta.url),
  "utf8",
);
const pdfGenerator = readFileSync(
  new URL("../src/modules/products/lib/barcodePdfGenerator.js", import.meta.url),
  "utf8",
);

test("landscape label preview keeps the downloaded label's 2:1 reference size", () => {
  assert.match(labelsPage, /LANDSCAPE_PREVIEW_WIDTH_PX\s*=\s*600/);
  assert.match(labelsPage, /LANDSCAPE_PREVIEW_HEIGHT_PX\s*=\s*300/);
  assert.match(labelsPage, /referenceScale\s*=\s*Math\.min/);
  assert.match(labelsPage, /availableWidthPx \/ intrinsicWidthPx/);
  assert.match(pdfGenerator, /orientation:\s*"landscape"[\s\S]*?format:\s*\[100, 50\]/);
});
