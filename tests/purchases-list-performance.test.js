import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(new URL("../server/routes/purchases.js", import.meta.url), "utf8");
const loadStart = route.indexOf("const loadPurchases = async (client, { tenantId }) =>");
const loadEnd = route.indexOf("\nconst resolveSupplierForPurchaseUpdate", loadStart);
const loadPurchases = route.slice(loadStart, loadEnd);

test("purchases list verifies schema once per process (no per-request DDL)", () => {
  assert.match(loadPurchases, /await ensurePurchaseSchemaReady\(\);/);
  assert.doesNotMatch(loadPurchases, /await ensurePurchaseCreateSchema\(client\)/);
});

test("purchases list is a single header query — no per-row stock-reversal N+1", () => {
  // the O(N) safety CALL and the full purchase_items bulk-load are gone from the list
  assert.doesNotMatch(loadPurchases, /await getPurchaseStockReversalState\(client/);
  assert.doesNotMatch(loadPurchases, /WHERE purchase_id = ANY\(\$1::bigint\[\]\)/);
  // list returns compact summaries (empty items + empty safety)
  assert.match(loadPurchases, /return result\.rows\.map\(\(row\) => normalizePurchaseRow\(row, \[\], \{\}\)\)/);
});

test("purchases list still exposes item_count (rows render a count, not items)", () => {
  assert.match(loadPurchases, /COALESCE\(item_counts\.item_count, 0\)::int AS item_count/);
  assert.match(loadPurchases, /SELECT purchase_id, COUNT\(\*\) AS item_count\s*\n\s*FROM purchase_items/);
});

test("detail + delete/reverse still recompute authoritative stock-reversal safety", () => {
  // safety must remain on the authoritative paths (just not on the list)
  assert.match(route, /getPurchaseStockReversalState\(client, \{ tenantId, purchase/);
  assert.match(route, /loadPurchaseById/);
});
