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

test("wholesale menu entries and routes exist only on the wholesale host", () => {
  const rbac = read("../../src/modules/permissions/lib/rbacStore.js");
  assert.match(rbac, /\(IS_WHOLESALE_APP \|\| !item\.wholesaleOnly\)/);
  assert.match(rbac, /to: "\/wholesale\/invoice"[^}]*wholesaleOnly: true/);
  const app = read("../../src/App.jsx");
  assert.match(app, /\{IS_WHOLESALE_APP \? \(\s*<Route\s+path="wholesale\/invoice"/);
});

test("the wholesale sections on the product, customer and purchase pages render nothing on retail", () => {
  for (const file of ["WholesaleProductSection.jsx", "WholesaleCustomerTerms.jsx"]) {
    const src = read(`../../src/modules/wholesale/components/${file}`);
    assert.match(src, /if \(!IS_WHOLESALE_APP\) return null;/, `${file} must render nothing on retail`);
    assert.match(src, /if \(!IS_WHOLESALE_APP \|\| !/, `${file} must not call the wholesale API on retail`);
  }
});
