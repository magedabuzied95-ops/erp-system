import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/modules/purchases/pages/PurchaseOrder.jsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../server/routes/purchases.js", import.meta.url), "utf8");

test("purchase page no longer loads the full products-with-variants catalog on open", () => {
  // the mount browse fetch must be bounded (a limit param), not the ~55MB catalog
  assert.match(page, /api\.get\("\/products\/with-variants", \{ params: \{ limit: \d+ \} \}\)/);
  // and the old unbounded bare call must be gone
  assert.doesNotMatch(page, /api\.get\("\/products\/with-variants"\)\s*,/);
  // server-side search path is still present (>=2 chars) so anything is reachable
  assert.match(page, /params: \{ search: query, preserveSearchVariants: "true" \}/);
});

test("create-purchase DDL runs once per process on the pool, not inside every transaction", () => {
  assert.match(route, /let purchaseSchemaReadyPromise = null;/);
  assert.match(route, /const ensurePurchaseSchemaReady = \(\) => \{/);
  assert.match(route, /ensurePurchaseCreateSchema\(pool\)/);
  assert.match(route, /ensurePurchaseCreateIndexes\(pool\)/);
  // the create handler verifies schema once, before BEGIN
  assert.match(route, /runStep\("schema\.ensureOnce", \(\) => ensurePurchaseSchemaReady\(\)\)/);
  // the per-request in-transaction ensure steps are removed from create
  assert.doesNotMatch(route, /runStep\("schema\.purchaseCreate", \(\) => ensurePurchaseCreateSchema\(client\)\)/);
  assert.doesNotMatch(route, /runStep\("schema\.indexVerification", \(\) => ensurePurchaseCreateIndexes\(client\)\)/);
});

test("purchase save stays server-authoritative: idempotency + single transaction preserved", () => {
  // advisory-lock idempotency guard still present
  assert.match(route, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(route, /findExistingPurchaseByIdempotencyKey/);
  // single transaction envelope intact
  assert.match(route, /client\.query\("BEGIN"\)/);
  assert.match(route, /transaction\.commit/);
});

test("frontend keeps its double-submit guard + stable idempotency key", () => {
  assert.match(page, /if \(postingRef\.current \|\| posting\) return;/);
  assert.match(page, /headers: \{ "Idempotency-Key": purchaseSaveId \}/);
});
