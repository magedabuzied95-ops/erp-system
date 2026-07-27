import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/modules/pos/components/SmartPosFilters.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/modules/pos/components/SmartPosFilters.m1.css", import.meta.url), "utf8");
const posPage = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");

test("smart POS filters share the system font rhythm and readable control heights", () => {
  assert.match(source, /m1-smart-filter-title/);
  assert.match(source, /m1-smart-filter-pill-name/);
  assert.match(source, /m1-smart-filter-count/);
  assert.match(styles, /font-family: var\(--app-font/);
  assert.match(styles, /\.m1-smart-filter-pill[\s\S]*?min-height: 34px/);
  assert.match(styles, /\.m1-smart-filter-select[\s\S]*?min-height: 44px/);
  assert.match(styles, /\.m1-smart-filter-footer button[\s\S]*?min-height: 44px/);
});

test("smart POS filter choices stay local until the cashier applies them", () => {
  assert.match(posPage, /const \[draftPosFilters, setDraftPosFilters\] = useState\(null\)/);
  assert.match(posPage, /onApply=\{handleApplyDraftPosFilters\}/);
  assert.match(posPage, /setSelectedBrandId\(draftPosFilters\.brands \|\| \[\]\)/);
  assert.doesNotMatch(source, /backdrop-blur-xl/);
});
