import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createM1SelectTypographyStyles } from "../src/shared/ui/selectTypography.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native ERP options inherit the owning select typography without touching storefront", () => {
  const foundation = read("src/theme/foundation.css");
  assert.match(foundation, /GLOBAL_DROPDOWN_TYPOGRAPHY/);
  assert.match(foundation, /\.m1-shell-root[\s\S]*select :where\(option, optgroup\)/);
  assert.match(foundation, /font-family: inherit/);
  assert.match(foundation, /font-size: inherit/);
  assert.match(foundation, /font-weight: inherit/);
  assert.doesNotMatch(foundation, /\.storefront-shell[\s\S]{0,120}GLOBAL_DROPDOWN_TYPOGRAPHY/);
});

test("custom dropdown contract uses the approved typography tokens", () => {
  const foundation = read("src/theme/foundation.css");
  for (const token of ["--app-font", "--font-body", "--font-body-lh", "--control-height-md"]) {
    assert.match(foundation, new RegExp(token));
  }
  assert.match(foundation, /html\[dir="rtl"\][\s\S]*direction: rtl/);
  assert.match(foundation, /html\[dir="ltr"\][\s\S]*direction: ltr/);
});

test("portal react-select typography follows theme direction", () => {
  const rtl = createM1SelectTypographyStyles({ isRtl: true });
  const ltr = createM1SelectTypographyStyles({ isRtl: false });
  assert.equal(rtl.menuPortal({}).fontFamily, "var(--app-font)");
  assert.equal(rtl.menuPortal({}).direction, "rtl");
  assert.equal(ltr.menuPortal({}).direction, "ltr");
  assert.equal(rtl.option({}).fontSize, "var(--font-body)");
  assert.equal(rtl.option({}).minHeight, "var(--control-height-md)");
});

test("canonical classes cover the live custom picker owners", () => {
  const owners = [
    "src/modules/products/pages/ProductsList.jsx",
    "src/modules/accounting/pages/Expenses.jsx",
    "src/modules/purchases/pages/PurchaseOrder.jsx",
    "src/modules/pos/components/CartSidebar.jsx",
    "src/shared/components/LanguageSwitcher.jsx",
  ];
  for (const owner of owners) {
    assert.match(read(owner), /m1-dropdown-(?:trigger|menu|option)/, owner);
  }
  const manufacturer = read("src/modules/products/components/ManufacturerSelect.jsx");
  assert.match(manufacturer, /createM1SelectTypographyStyles/);
  assert.match(manufacturer, /classNamePrefix="m1-react-select"/);
});

test("searchable brand picker keeps complete listbox keyboard semantics", () => {
  const products = read("src/modules/products/pages/ProductsList.jsx");
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"]) {
    assert.match(products, new RegExp(`event\\.key === "${key}"`), key);
  }
  assert.match(products, /role="combobox"/);
  assert.match(products, /role="listbox"/);
  assert.match(products, /aria-activedescendant/);
  assert.match(products, /aria-selected/);
});

test("dropdown convergence does not change raw values or selection handlers", () => {
  const products = read("src/modules/products/pages/ProductsList.jsx");
  assert.match(products, /onChange\?\.\(brand\)/);
  assert.match(products, /setBrandFilter\(nextBrand\)/);
  const manufacturer = read("src/modules/products/components/ManufacturerSelect.jsx");
  assert.match(manufacturer, /option\.map\(\(item\) => item\.value\)/);
  assert.match(manufacturer, /option\?\.value \|\| ""/);
});
