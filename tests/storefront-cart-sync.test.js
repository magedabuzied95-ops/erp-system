import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A signed-in customer's cart is saved to the server only once cartSyncReady is true, and the
// abandoned-cart reminder can only see carts that reached the server. On mobile, browsing products
// updates `recent`, which re-ran the sync effect and cancelled the in-flight run; the finally then
// skipped setCartSyncReady because `cancelled` was true, so saving stayed OFF forever — reads
// worked, every cart PUT was silently skipped, and the reminder never saw mobile carts.

const source = fs.readFileSync(
  new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8"
);

// isolate the sync effect: from its cartSyncReady(false) reset to its dependency array
const start = source.indexOf("customerAuthTokenRef.current = token;");
assert.ok(start > -1, "the sync effect is where the test expects it");
const effect = source.slice(start, source.indexOf("}, [customerAuth.token]", start) + 40);

test("saving is enabled even when the sync run was cancelled", () => {
  const finallyBlock = effect.slice(effect.indexOf("} finally {"), effect.indexOf("void syncCustomerLists()"));
  assert.match(finallyBlock, /setCartSyncReady\(true\)/, "the flag still flips");
  assert.ok(!/if \(!cancelled\)\s*\{\s*setCartSyncReady/.test(finallyBlock),
    "the flag must not be gated on !cancelled — that is what stuck it off");
});

test("the sync effect only re-runs on token change, not on browsing", () => {
  const deps = effect.slice(effect.lastIndexOf("}, ["));
  assert.match(deps, /\}, \[customerAuth\.token\]/, "token-only deps");
  assert.ok(!deps.includes("recent"), "recent must not retrigger the sync");
  assert.ok(!deps.includes("wishlist"), "wishlist must not retrigger the sync");
});

test("the save effect still guards on the flag and the token", () => {
  const saveStart = source.indexOf("cartSyncSaveTimerRef.current = window.setTimeout");
  assert.ok(saveStart > -1, "the debounced save exists");
  const saveEffect = source.slice(source.lastIndexOf("useEffect(() => {", saveStart), saveStart);
  assert.match(saveEffect, /if \(!cartSyncReady\) return/, "still waits for readiness");
  assert.match(saveEffect, /if \(!token\)/, "still refuses without a token");
});
