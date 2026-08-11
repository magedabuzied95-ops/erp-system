import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const invoiceNormalizer = read("../src/shared/utils/orderInvoice.js");
const invoiceCard = read("../src/shared/components/invoices/OrderInvoiceCard.jsx");
const pos = read("../src/modules/pos/pages/POSPro.jsx");
const controller = read("../server/controllers/ordersController.js");

test("public invoices expose and render paid and remaining balances", () => {
  assert.match(controller, /AS remaining_amount/);
  assert.match(controller, /paid_amount: normalizeInvoiceMoney\(order\.paid_amount\)/);
  assert.match(controller, /remaining_amount: normalizeInvoiceMoney\(order\.remaining_amount\)/);
  assert.match(invoiceNormalizer, /totals\?\.paid/);
  assert.match(invoiceNormalizer, /remainingAmount/);
  assert.match(invoiceCard, /label=\{copy\.paidAmount\}/);
  assert.match(invoiceCard, /label=\{copy\.remainingAmount\}/);
});

test("invoice payment method follows the collected deposit method", () => {
  assert.match(controller, /collectedPaymentMethods/);
  assert.match(controller, /collected_payment_method: collectedPaymentMethod/);
  assert.match(invoiceNormalizer, /resolveCollectedPaymentMethod/);
  assert.match(invoiceCard, /deferredRemainder/);
  assert.match(pos, /resolveCollectedPaymentMode/);
});

test("service fees are not presented as shipping and zero shipping is hidden", () => {
  assert.match(invoiceNormalizer, /order\.shipping_fee \?\? order\.delivery_fee \?\? order\.totals\?\.shipping/);
  assert.doesNotMatch(invoiceNormalizer, /order\.shipping_fee \?\? order\.delivery_fee \?\? order\.service_fee/);
  assert.match(invoiceCard, /Number\(totals\?\.shipping \|\| 0\) > 0/);
});

test("zero discounts stay hidden on public and printed invoices", () => {
  const receipt = read("../src/modules/pos/components/CartSidebar.jsx");
  assert.match(invoiceCard, /Number\(totals\?\.discount \|\| 0\) > 0 \? <Summary/);
  assert.match(receipt, /premiumDiscount > 0 \? <ReceiptTotalRow/);
});

test("thermal receipts fall back to persisted remaining amount", () => {
  assert.match(pos, /order\.remaining_amount \?\? order\.remainingAmount/);
});
