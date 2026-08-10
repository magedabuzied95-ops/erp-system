import test from "node:test";
import assert from "node:assert/strict";
import { buildManagerPortalInvoiceObject } from "../../server/services/managerPortalService.js";

// The dashboard "today invoices" list was hydrated via an N+1 (one detail call per
// invoice). It now uses a batched query that shares buildManagerPortalInvoiceObject with
// the single-invoice endpoint. These tests pin the invoice-object contract so the batch
// and single paths stay byte-identical and profit gating is preserved.

const sampleOrder = {
  id: 42,
  invoice_number: "INV-42",
  status: "completed",
  created_at: "2026-08-10T09:00:00.000Z",
  updated_at: "2026-08-10T09:05:00.000Z",
  branch_id: 3,
  customer_name: "أحمد",
  payment_method: "cash",
  total_amount: 250,
  paid_amount: 200,
  profit: 80,
  cost_amount: 170,
};

const sampleItems = [
  { id: 1, order_id: 42, product_id: 7, variant_id: 11, product_name: "قميص", color: "أزرق", size: "M", quantity: 2, price: 100, line_total: 200 },
  { id: 2, order_id: 42, product_id: 9, variant_id: null, product_name: "حزام", color: "", size: "", quantity: 1, price: 50, line_total: 50 },
];

test("subtotal is summed from item line totals", () => {
  const out = buildManagerPortalInvoiceObject(sampleOrder, sampleItems, true);
  assert.equal(out.subtotal, 250);
  assert.equal(out.total, 250);
  assert.equal(out.items.length, 2);
});

test("remaining_amount = total - paid, floored at 0", () => {
  const out = buildManagerPortalInvoiceObject(sampleOrder, sampleItems, true);
  assert.equal(out.paid_amount, 200);
  assert.equal(out.remaining_amount, 50);
  const overpaid = buildManagerPortalInvoiceObject({ ...sampleOrder, paid_amount: 999 }, sampleItems, true);
  assert.equal(overpaid.remaining_amount, 0);
});

test("profit and cost are exposed only when profit is authorized", () => {
  const allowed = buildManagerPortalInvoiceObject(sampleOrder, sampleItems, true);
  assert.equal(allowed.profit, 80);
  assert.equal(allowed.cost, 170);
  assert.equal(allowed.permissions.can_view_profit, true);

  const denied = buildManagerPortalInvoiceObject(sampleOrder, sampleItems, false);
  assert.equal(denied.profit, null);
  assert.equal(denied.cost, null);
  assert.equal(denied.permissions.can_view_profit, false);
});

test("batched hydration equals single-path hydration for the same order+items", () => {
  // Simulate the batch grouping: items keyed by order_id, then built per order.
  const itemsByOrder = new Map();
  for (const item of sampleItems) {
    const key = String(item.order_id);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(item);
  }
  const batched = buildManagerPortalInvoiceObject(sampleOrder, itemsByOrder.get("42") || [], true);
  const single = buildManagerPortalInvoiceObject(sampleOrder, sampleItems, true);
  assert.deepEqual(batched, single);
});

test("invoice_number falls back to INV-<id> when missing", () => {
  const out = buildManagerPortalInvoiceObject({ ...sampleOrder, invoice_number: "" }, sampleItems, true);
  assert.equal(out.invoice_number, "INV-42");
});
