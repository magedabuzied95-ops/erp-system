import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/controllers/ordersController.js", import.meta.url), "utf8");

const sliceBetween = (start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end marker: ${end}`);
  return source.slice(from, to);
};

const createOrder = sliceBetween("export const createOrder", "\nexport const ");
const editOrder = sliceBetween("// Rewriting the lines deletes order_items", "const expectedAmountDueNow");
const returnOrder = sliceBetween("export const returnOrder", "\nexport const ");
const createReturn = sliceBetween('const routeName = "POST /api/orders/returns";', "\nexport const getSingleOrder");

// capLineRefundGross is pure; evaluate the exported source on its own so the
// test does not boot the database, sockets and services the controller imports.
const capSource = sliceBetween("export const capLineRefundGross", "\n};\n") + "\n};";
const capLineRefundGross = new Function(`${capSource.replace("export const", "const")}; return capLineRefundGross;`)();

test("a return refund is capped at what the sold line was worth", () => {
  const line = { quantity: 2, total_amount: 900 };
  assert.equal(capLineRefundGross(line, 1, 50000), 450);
  assert.equal(capLineRefundGross(line, 1, 300), 300);
  assert.equal(capLineRefundGross(line, 2, undefined), 900);
  assert.equal(capLineRefundGross(line, 1, "abc"), 450);
  assert.equal(capLineRefundGross(line, 1, -20), 0);
  assert.equal(capLineRefundGross(line, 0, 100), 0);
});

test("checkout builds the subtotal from the lines, not the body", () => {
  assert.match(createOrder, /const computedSubtotal = normalizeInvoiceMoney\(totalPrice\);/);
  assert.doesNotMatch(createOrder, /Number\.isFinite\(Number\(subtotal\)\) \? Number\(subtotal\) : totalPrice/);
});

test("checkout caps item discounts at the lines and loyalty money at points x redeem value", () => {
  assert.match(createOrder, /const itemDiscountAmount = Math\.min\(requestedItemDiscountAmount, lineDiscountTotal\);/);
  assert.match(createOrder, /requestedLoyaltyPoints \* redeemValue/);
  assert.match(createOrder, /const nonCouponDiscount = itemDiscountAmount \+ normalizedInvoiceDiscountAmount \+ verifiedLoyaltyDiscount;/);
  assert.doesNotMatch(createOrder, /loyalty: Number\(loyalty_discount_amount \|\| 0\)/);
});

test("a coupon discount without a validated code is ignored", () => {
  assert.match(createOrder, /const couponDiscountAmount = safeCouponCode \? Number\(couponValidation\?\.discount_amount \|\| 0\) : 0;/);
});

test("exchange credit must come from an unspent exchange return on the original invoice", () => {
  assert.match(createOrder, /await resolveAvailableExchangeCredit\(client, \{ tenantId, originalOrderId: original_order_id \}\)/);
  assert.match(createOrder, /code: "EXCHANGE_CREDIT_NOT_AVAILABLE"/);
  assert.match(createOrder, /normalizeInvoiceMoney\(Math\.max\(0, computedTotal - exchangeAppliedCredit\)\)/);
  const helper = sliceBetween("const resolveAvailableExchangeCredit", "\nconst normalizeOperationItem");
  assert.match(helper, /FOR UPDATE/);
  assert.match(helper, /metadata->>'mode', ''\)\) = 'exchange'/);
  assert.match(helper, /o\.original_order_id = \$1/);
});

test("an invoice edit uses the stored paid amount and refuses invoices with returns", () => {
  assert.match(editOrder, /code: "ORDER_HAS_RETURNS"/);
  assert.match(editOrder, /: Math\.max\(0, loadedOriginalPaidAmount\);/);
  assert.doesNotMatch(editOrder, /requestedOriginalPaidAmount > 0\s*\?\s*requestedOriginalPaidAmount/);
  assert.match(editOrder, /Math\.min\(requestedEditDiscount, editLineDiscountTotal \+ invoiceDiscountAmount\)/);
});

test("the POS return route never pays out the body's refund_amount", () => {
  assert.match(returnOrder, /capLineRefundGross\(original, quantity, requested\.refund_amount\)/);
  assert.doesNotMatch(returnOrder, /refundTotal \|\| Number\(req\.body\.refund_amount/);
});

test("the returns page route pays the prorated line total and refuses cancelled invoices", () => {
  assert.doesNotMatch(createReturn, /requestedRefundAmount/);
  assert.match(createReturn, /effectiveRefundAmount = Number\(proratedRefundTotal\.toFixed\(2\)\);/);
  assert.match(createReturn, /capLineRefundGross\(originalItem, quantity, requestedGross\)/);
  assert.match(createReturn, /normalizeOrderStatus\(orderRow\.status\) === "cancelled"/);
  assert.match(createReturn, /if \(!items\.some\(\(item\) => Number\(item\?\.quantity \|\| 0\) > 0\)\)/);
});

test("the POS starts an exchange with the refund the server recorded", () => {
  const drawer = readFileSync(new URL("../src/modules/pos/components/RecentOperationsDrawer.jsx", import.meta.url), "utf8");
  assert.match(drawer, /returnTotal: Number\.isFinite\(serverRefund\) \? serverRefund : returnTotal,/);
  const pos = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  assert.match(pos, /creditAmount: Math\.max\(0, Number\(returnTotal\) \|\| 0\),/);
});
