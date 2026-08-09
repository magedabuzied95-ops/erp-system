import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pickerSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url),
  "utf8"
);
const pwaSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url),
  "utf8"
);

test("AI Inbox product sender uses the shared POS smart filter panel", () => {
  assert.match(pickerSource, /import SmartPosFilters from "\.\.\/\.\.\/pos\/components\/SmartPosFilters"/);
  assert.match(pickerSource, /<SmartPosFilters/);
  assert.match(pickerSource, /onClick=\{openPosFilters\}/);
  assert.doesNotMatch(pickerSource, />Category<\/span>/);
});

test("the visible PWA Send Product sheet opens the shared POS filter panel", () => {
  assert.match(pwaSource, /function ProductSheet\(/);
  assert.match(pwaSource, /<h3[^>]*>Send Product<\/h3>/);
  assert.match(pwaSource, /onClick=\{openPosFilters\}/);
  assert.match(pwaSource, /<SmartPosFilters/);
  assert.match(pwaSource, /onApply=\{applyDraftPosFilters\}/);
  assert.match(pwaSource, /selectedBrandId=\{draftPosFilters\?\.brand \?\? productFilters\.brand\}/);
});

test("AI Inbox product sender uses the same active POS classifications and canonical product types", () => {
  assert.match(pickerSource, /useProductClassifications\(\{ includeInactive: false \}\)/);
  assert.match(pickerSource, /classificationGroupsToFieldOptions/);
  assert.match(pickerSource, /normalizeCanonicalProductType/);
  assert.match(pickerSource, /moveWinterCollectionToEnd/);
  assert.match(pickerSource, /getProductAudienceValues/);
});

test("AI Inbox POS filters keep draft selections until Apply and support multi-select", () => {
  assert.match(pickerSource, /const \[draftPosFilters, setDraftPosFilters\] = useState\(null\)/);
  assert.match(pickerSource, /toggleMultiFilterValue\(current\?\.\[field\] \|\| \[\], value\)/);
  assert.match(pickerSource, /onApply=\{applyPosFilters\}/);
  assert.match(pickerSource, /onReset=\{resetPosFilters\}/);
  assert.match(pickerSource, /onClose=\{\(\) => setFiltersOpen\(false\)\}/);
});
