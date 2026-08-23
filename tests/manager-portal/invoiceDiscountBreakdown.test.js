import test from "node:test";
import assert from "node:assert/strict";

import { buildManagerPortalInvoiceObject } from "../../server/services/managerPortalService.js";

/**
 * A manager looking at a discounted invoice needs to know WHY, not just by how much.
 *
 * orders.discount_amount is all-inclusive (item + invoice + loyalty + coupon — analyticsMetrics
 * D-02), so the parts are reported alongside it and must never be summed into it. INV-609 is the
 * live case: 3,600 of goods, a 10% single-item coupon on the dearest piece, total 3,415.
 */

const items = [
  { line_total: 1850, quantity: 1, sale_price: 1850 },
  { line_total: 1750, quantity: 1, sale_price: 1750 },
];

test("a coupon invoice reports the code and the coupon's own share", () => {
  const invoice = buildManagerPortalInvoiceObject(
    { id: 609, invoice_number: "INV-609", total_amount: 3415, discount_amount: 185, coupon_discount_amount: 185, coupon_code: "MN-684P6H" },
    items,
    false
  );
  assert.equal(invoice.discount, 185, "the all-inclusive total is unchanged");
  assert.equal(invoice.coupon_discount, 185);
  assert.equal(invoice.coupon_code, "MN-684P6H");
  assert.equal(invoice.subtotal, 3600);
  assert.equal(invoice.total, 3415);
  // The parts must never be added on top of the total.
  assert.equal(invoice.subtotal - invoice.discount, invoice.total);
});

test("a manual discount is told apart from a coupon", () => {
  const invoice = buildManagerPortalInvoiceObject(
    { id: 610, total_amount: 3400, discount_amount: 200, invoice_discount_amount: 200, invoice_discount_reason: "عميل دائم" },
    items,
    false
  );
  assert.equal(invoice.coupon_discount, 0);
  assert.equal(invoice.coupon_code, "");
  assert.equal(invoice.invoice_discount, 200);
  assert.equal(invoice.invoice_discount_reason, "عميل دائم");
});

test("an ordinary invoice reports no breakdown at all", () => {
  const invoice = buildManagerPortalInvoiceObject({ id: 611, total_amount: 3600, discount_amount: 0 }, items, false);
  assert.equal(invoice.discount, 0);
  assert.equal(invoice.coupon_discount, 0);
  assert.equal(invoice.invoice_discount, 0);
  assert.equal(invoice.loyalty_discount, 0);
});

test("coupon and loyalty on one invoice are each reported", () => {
  const invoice = buildManagerPortalInvoiceObject(
    { id: 612, total_amount: 3315, discount_amount: 285, coupon_discount_amount: 185, coupon_code: "MN-X", loyalty_discount_amount: 100 },
    items,
    false
  );
  assert.equal(invoice.discount, 285);
  assert.equal(invoice.coupon_discount + invoice.loyalty_discount, 285, "the parts account for the total");
});
