// Supplier-return hold integrity.
//
// A manufacturing-defect return removes a unit from SELLABLE stock without restocking
// it. Stock was already correct — the unit left at SALE_OUT and never came back — but
// nothing recorded WHERE it went, so an inventory ledger could not explain the gap.
// These tests pin the fix: the trace exists, it is written exactly once, and it can
// never move stock a second time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const controller = () => read("../../server/controllers/ordersController.js");

test("a manufacturing-defect hold records a movement", async () => {
  const source = await controller();
  assert.match(source, /const recordSupplierReturnHoldMovement = async \(client, \{/);
  assert.match(source, /await recordSupplierReturnHoldMovement\(client, \{/, "the hold path must call it");
  assert.match(source, /movementType: "SUPPLIER_RETURN_HOLD"/);
});

test("the ledger entry records the event and never moves stock", async () => {
  const source = await controller();
  const fn = source.slice(
    source.indexOf("const recordSupplierReturnHoldMovement"),
    source.indexOf("const markCustomerTrustedForCompletedOrder")
  );

  // quantity_change 0 with before == after: a disposition change, not a stock change.
  assert.match(fn, /quantityDelta: 0/, "the ledger entry must not carry a stock delta");
  assert.match(fn, /quantityBefore: currentStock/);
  assert.match(fn, /quantityAfter: currentStock/);

  // Explicit quantities are what make this safe: recordInventoryMovement only updates
  // product_variants.stock when quantities are ABSENT. Omitting them would decrement.
  assert.ok(
    fn.includes("quantityBefore") && fn.includes("quantityAfter"),
    "explicit quantities are what prevent a second decrement"
  );
  // It must never call the stock-mutating helper.
  assert.ok(!/adjustVariantStock|applyStockDelta/.test(fn), "the hold must not adjust stock");
});

test("the movement is written exactly once, even on a replayed return", async () => {
  const source = await controller();
  const fn = source.slice(source.indexOf("const queueSupplierReturnItem"), source.indexOf("const recordSupplierReturnHoldMovement"));

  // ON CONFLICT DO NOTHING returns no row for an existing hold, so the ledger write is
  // guarded by whether the hold was actually inserted.
  assert.match(fn, /ON CONFLICT \(return_item_id\) DO NOTHING\s*\n\s*RETURNING id/);
  assert.match(fn, /if \(!inserted\.rows\.length\) return;/, "a duplicate hold must not write a second movement");
});

test("the hold carries the linkage needed to explain it later", async () => {
  const source = await controller();
  const fn = source.slice(
    source.indexOf("const recordSupplierReturnHoldMovement"),
    source.indexOf("const markCustomerTrustedForCompletedOrder")
  );
  assert.match(fn, /referenceType: "supplier_return_hold"/);
  assert.match(fn, /referenceId: supplierReturnItemId/, "must point at the hold it describes");
  assert.match(fn, /productId/);
  assert.match(fn, /variantId: variantId \|\| null/, "variant where available, null where not");
  assert.match(fn, /reason: reason \|\| "Manufacturing defect held for supplier return"/);
  assert.match(fn, /notes: `return:\$\{returnId\}`/, "must link back to the customer return");
});

test("a hold is neither a sale nor a customer return", async () => {
  const source = await controller();
  const fn = source.slice(
    source.indexOf("const recordSupplierReturnHoldMovement"),
    source.indexOf("const markCustomerTrustedForCompletedOrder")
  );
  assert.ok(!/SALE_OUT/.test(fn), "a hold is not a sale");
  assert.ok(!/RETURN_IN/.test(fn), "a hold is not a restocked return");
});

test("a failed ledger write cannot roll back the return itself", async () => {
  const source = await controller();
  const fn = source.slice(
    source.indexOf("const recordSupplierReturnHoldMovement"),
    source.indexOf("const markCustomerTrustedForCompletedOrder")
  );
  // The hold is the business fact; the trace is secondary and must not fail the return.
  assert.match(fn, /catch \(error\)/);
  assert.match(fn, /console\.error\("\[orders\] supplier return hold movement failed"/);
  assert.ok(!/throw error/.test(fn), "a trace failure must not surface as a failed return");
});

test("the restock path is untouched and still restocks", async () => {
  const source = await controller();
  // Regression guard: the fix must not change what a normal return does.
  assert.match(source, /const shouldRestock = disposition === "restock";/);
  assert.match(source, /movementType: "RETURN_IN"/, "a restocked return still writes RETURN_IN");
  const holdBranch = source.slice(source.indexOf('} else if (disposition === "manufacturing_defect") {'));
  assert.match(holdBranch.slice(0, 400), /queueSupplierReturnItem/, "the defect branch still queues the hold");
});

test("no historical row is backfilled", async () => {
  const source = await controller();
  // The single production row predates this code and stays untouched: a backfill needs
  // its own approval.
  assert.ok(!/backfill/i.test(source.slice(source.indexOf("const queueSupplierReturnItem"), source.indexOf("const markCustomerTrustedForCompletedOrder"))));
});
