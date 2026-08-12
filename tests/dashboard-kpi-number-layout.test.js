import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboard = fs.readFileSync("src/pages/Dashboard.jsx", "utf8");
const theme = fs.readFileSync("src/theme/reference.css", "utf8");

test("dashboard uses one Latin digit system in Arabic and English", () => {
  assert.match(dashboard, /ar-EG-u-nu-latn/);
});

test("KPI values keep a stable direction and fit inside their cards", () => {
  assert.match(dashboard, /dir=\{textValue \? undefined : "ltr"\}/);
  assert.match(theme, /\.dashboard-kpi-grid article \.m1-kpi-value[\s\S]*max-width: 100%/);
  assert.match(theme, /font-size: clamp\(1rem, 1\.25vw, 1\.5rem\)/);
  assert.match(theme, /unicode-bidi: isolate/);
});
