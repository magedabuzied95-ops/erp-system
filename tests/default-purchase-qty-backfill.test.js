import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBackfillPlanToMemory,
  createBackfillPlan,
} from "../server/scripts/backfillConsumedDefaultPurchaseQty.js";

test("default purchase quantity backfill only consumes successful historical purchase lines", () => {
  const purchases = [
    { id: 1, tenant_id: 1, status: "completed" },
    { id: 2, tenant_id: 1, status: "draft" },
    { id: 3, tenant_id: 1, status: "cancelled" },
    { id: 4, tenant_id: 1, status: "received", deleted_at: "2026-07-01T00:00:00.000Z" },
    { id: 5, tenant_id: 1, status: "posted", reversed_at: "2026-07-01T00:00:00.000Z" },
    { id: 6, tenant_id: 2, status: "completed" },
  ];
  const items = [
    { id: 1, tenant_id: 1, purchase_id: 1, product_id: 10, variant_id: null },
    { id: 2, tenant_id: 1, purchase_id: 1, product_id: 10, variant_id: 100 },
    { id: 3, tenant_id: 1, purchase_id: 2, product_id: 11, variant_id: null },
    { id: 4, tenant_id: 1, purchase_id: 3, product_id: 12, variant_id: 102 },
    { id: 5, tenant_id: 1, purchase_id: 4, product_id: 13, variant_id: 103 },
    { id: 6, tenant_id: 1, purchase_id: 5, product_id: 14, variant_id: 104 },
    { id: 7, tenant_id: 2, purchase_id: 6, product_id: 20, variant_id: 200 },
  ];
  const products = [
    { id: 10, tenant_id: 1, default_purchase_qty: 4, stock: 9 },
    { id: 11, tenant_id: 1, default_purchase_qty: 5, stock: 8 },
    { id: 12, tenant_id: 1, default_purchase_qty: 6, stock: 7 },
  ];
  const variants = [
    { id: 100, tenant_id: 1, default_purchase_qty: 3, stock: 12 },
    { id: 102, tenant_id: 1, default_purchase_qty: 8, stock: 13 },
    { id: 103, tenant_id: 1, default_purchase_qty: 9, stock: 14 },
    { id: 104, tenant_id: 1, default_purchase_qty: 10, stock: 15 },
    { id: 200, tenant_id: 2, default_purchase_qty: 11, stock: 16 },
  ];

  const firstPlan = createBackfillPlan({ tenantId: 1, purchases, items, products, variants });
  const firstApply = applyBackfillPlanToMemory(firstPlan);

  assert.equal(firstApply.updated_products, 1);
  assert.equal(firstApply.updated_variants, 1);
  assert.equal(products.find((product) => product.id === 10).default_purchase_qty, 0);
  assert.equal(variants.find((variant) => variant.id === 100).default_purchase_qty, 0);
  assert.equal(products.find((product) => product.id === 11).default_purchase_qty, 5);
  assert.equal(variants.find((variant) => variant.id === 102).default_purchase_qty, 8);
  assert.equal(variants.find((variant) => variant.id === 103).default_purchase_qty, 9);
  assert.equal(variants.find((variant) => variant.id === 104).default_purchase_qty, 10);
  assert.equal(products.find((product) => product.id === 10).stock, 9);
  assert.equal(variants.find((variant) => variant.id === 100).stock, 12);

  const secondPlan = createBackfillPlan({ tenantId: 1, purchases, items, products, variants });
  const secondApply = applyBackfillPlanToMemory(secondPlan);

  assert.equal(secondApply.updated_products, 0);
  assert.equal(secondApply.updated_variants, 0);
  assert.equal(secondPlan.already_zero, 2);
});
