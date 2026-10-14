import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isWholesaleMode, requireWholesaleMode } from "../../server/modules/wholesale/wholesaleMode.js";

// Retail and wholesale run the same code. Everything wholesale must stay switched off
// unless BUSINESS_MODE=wholesale: no routes, no tables, no menu entries.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("wholesale mode is on only for BUSINESS_MODE=wholesale", () => {
  assert.equal(isWholesaleMode({}), false);
  assert.equal(isWholesaleMode({ BUSINESS_MODE: "retail" }), false);
  assert.equal(isWholesaleMode({ BUSINESS_MODE: " Wholesale " }), true);
});

test("on retail every /api/wholesale route answers 404 before any handler runs", () => {
  const saved = process.env.BUSINESS_MODE;
  delete process.env.BUSINESS_MODE;
  try {
    let status = 0;
    let nextCalled = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    requireWholesaleMode({}, res, () => { nextCalled = true; });
    assert.equal(status, 404);
    assert.equal(nextCalled, false);
  } finally {
    if (saved !== undefined) process.env.BUSINESS_MODE = saved;
  }
});

test("the router is gated first, and tables are created only behind the mode check", () => {
  const routes = read("../../server/modules/wholesale/wholesale.routes.js");
  const gateAt = routes.indexOf("router.use(requireWholesaleMode)");
  assert.ok(gateAt > 0 && gateAt < routes.indexOf("router.get("), "gate must precede every route");
  const schema = read("../../server/modules/wholesale/wholesale.schema.js");
  assert.match(schema, /if \(!isWholesaleMode\(\)\) throw/);
  for (const [, table] of schema.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)/gi)) {
    assert.match(table, /^wholesale_/, `wholesale must not alter the retail table ${table}`);
  }
});

test("the POS sells wholesale units only on the wholesale host", () => {
  const picker = read("../../src/modules/wholesale/components/WholesalePosPicker.jsx");
  // No wholesale price (so the retail price stands) and no wholesale API call on retail.
  assert.match(picker, /const priceOf = useCallback\(\(productId\) => \{\s*if \(!IS_WHOLESALE_APP\) return null;/);
  assert.match(picker, /useEffect\(\(\) => \{\s*if \(!IS_WHOLESALE_APP\) return;\s*api\.get\("\/wholesale\/prices"\)/);
  const pos = read("../../src/modules/pos/pages/POSPro.jsx");
  assert.match(pos, /const activePrice = wholesalePrice !== null \? wholesalePrice : Number\(variant\.price/);
  assert.match(pos, /wholesalePricing\.enabled\s*\? orderedVisibleProducts\.map/);
  // The same colour picker as retail; only the size slot changes.
  assert.equal((pos.match(/\{wholesalePricing\.enabled \? renderWholesaleUnitChoices\(/g) || []).length, 2);
  assert.match(pos, /\(variants\.length === 1 && !wholesalePricing\.enabled\)\) return false;/);
  assert.match(pos, /if \(wholesalePricing\.enabled\) \{ void handleAddSelectedProductToCart\(\); return; \}/);
  assert.doesNotMatch(read("../../src/App.jsx"), /wholesale\/invoice/, "the separate wholesale invoice page is gone");
});

test("the wholesale sections on the product, customer and purchase pages render nothing on retail", () => {
  for (const file of ["WholesaleProductSection.jsx", "WholesaleCustomerTerms.jsx"]) {
    const src = read(`../../src/modules/wholesale/components/${file}`);
    assert.match(src, /if \(!IS_WHOLESALE_APP\) return null;/, `${file} must render nothing on retail`);
    assert.match(src, /if \(!IS_WHOLESALE_APP \|\| !/, `${file} must not call the wholesale API on retail`);
  }
});
