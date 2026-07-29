import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const labelsPage = readFileSync(
  new URL("../src/modules/products/pages/BarcodeLabels.jsx", import.meta.url),
  "utf8",
);
const barcodeLabels = readFileSync(
  new URL("../src/modules/products/lib/barcodeLabels.js", import.meta.url),
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
  assert.match(labelsPage, /buildLandscapePrintSvg\(item, \{ size: "SIZE", color: "COLOR" \}\)/);
  assert.match(barcodeLabels, /pdfFontPointsToSvgUnits/);
  assert.match(barcodeLabels, /minimumModuleWidth:\s*0\.12/);
  assert.match(barcodeLabels, /barLeft:\s*barcodeCell\.x/);
  assert.match(pdfGenerator, /orientation:\s*"landscape"[\s\S]*?format:\s*\[100, 50\]/);
});

test("landscape size value can shrink enough for Arabic one-size labels", () => {
  assert.match(barcodeLabels, /fitThermalSizeValueFontSize[\s\S]*?Math\.max\(8\.5,/);
  assert.match(barcodeLabels, /otherWeight:\s*Number\(options\?\.otherWeight \?\? 0\.68\)/);
  assert.match(labelsPage, /fitThermalSizeValueFontSize\([\s\S]*?measureTextWidth:\s*titleMeasureTextWidth/);
  assert.match(labelsPage, /direction:\s*"auto"/);
});
