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
  // Localized: the sheet must still be titled, in whatever language.
  assert.match(pwaSource, /<h3[^>]*>\{t\("aiSupport\.inbox\.picker\.sendProduct"\)\}<\/h3>/);
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

test("picking a filter narrows the other groups to what that selection contains", () => {
  // Each group is counted over rows matching every OTHER draft selection, so choosing
  // "men" leaves only men's types/grades/brands/factories, with counts updating before Apply.
  assert.match(pickerSource, /const rowMatchesPosFilters = \(row, filters = \{\}, skip = ""\) => \{/);
  assert.match(pickerSource, /const facetFilters = useMemo\(\s*\n\s*\(\) => draftPosFilters \|\| \{/);
  for (const group of ["gender", "productType", "grade", "brands", "manufacturers"]) {
    assert.ok(pickerSource.includes(`${group}: rowsFor("${group}")`), `${group} must be counted without its own selection`);
  }
  assert.match(pickerSource, /count: facetRows\.gender\.filter/);
  assert.match(pickerSource, /count: facetRows\.productType\.filter/);
  assert.match(pickerSource, /count: facetRows\.grade\.filter/);
  assert.match(pickerSource, /facetRows\.brands\.forEach/);
  assert.match(pickerSource, /facetRows\.manufacturers\.forEach/);
  // Empty chips disappear, but a selected one stays so it can be switched off.
  assert.match(pickerSource, /option\.count > 0 \|\| chosen\.has\(lower\(option\.id\)\)/);
  // The applied list uses the same predicate, so counts and results cannot disagree.
  assert.match(pickerSource, /return rowMatchesPosFilters\(row, applied\);/);
});
