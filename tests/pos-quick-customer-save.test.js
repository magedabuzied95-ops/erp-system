import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");

test("the customer source no longer blocks a quick save", () => {
  const start = source.indexOf("const handleCreateCustomer = useCallback");
  const end = source.indexOf("const handleCloseShift", start);
  const createSource = source.slice(start, end);

  assert.doesNotMatch(createSource, /customerSourceRequired/);
  assert.match(createSource, /const sourceKey = quickCustomer\.source_key \|\| ""/);
  // The name is still the one required field.
  assert.match(createSource, /customerNameRequired/);
});

test("Enter in the quick-customer fields saves", () => {
  assert.match(source, /const handleQuickCustomerKeyDown = useCallback/);
  assert.match(source, /if \(event\.key !== "Enter"[^)]*\) return;/);
  assert.match(source, /void handleCreateCustomerFromToolbar\(\);/);

  // Both text fields carry it, and the name field is focused on open so the
  // cashier can type and press Enter without touching the mouse.
  const handlers = source.match(/onKeyDown=\{handleQuickCustomerKeyDown\}/g) || [];
  assert.equal(handlers.length, 2);
  assert.match(source, /onKeyDown=\{handleQuickCustomerKeyDown\}\s*\n\s*autoFocus/);
});

test("an IME composition Enter does not submit", () => {
  assert.match(source, /event\.nativeEvent\?\.isComposing/);
});
